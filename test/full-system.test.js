import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { addTransitionMetrics, buildMetricRows, overdueTransitions, taskOwners } from "../api/_metrics.js"
import { taskIdRepairTargets } from "../api/_syncCore.js"
import { assignmentRpcArgs, validateAssignmentPatch } from "../api/assignment.js"
import cronSync, { validCronSecret } from "../api/cron-sync.js"
import { callAppsScript } from "../api/_appsScript.js"
import { validateCompletion } from "../api/completion.js"
import syncApi, { syncDecision } from "../api/sync.js"
import taskTabsApi from "../api/task-tabs.js"
import { blockedRecipients, validateWorkflow, workflowRpcArgs } from "../api/workflow.js"
import { filterDashboardTasks } from "../src/lib/dashboardFilters.js"
import { bangkokDate, daysFrom, parseSheetDate, validIsoDate } from "../src/lib/dates.js"
import { fetchAllRows } from "../src/lib/supabasePages.js"
import { fetchAllSheetsData } from "../src/lib/sheetsApi.js"
import { cachePendingWrites, loadPendingWrites, mergeRemote, taskSheetUrl } from "../src/lib/sharedState.js"
import { columnName, findTaskHeaderRow, inspectTaskHeaders, isSecondaryScheduleHeader, taskRange } from "../src/lib/sheetSchema.js"
import { assignmentMemberNames, assignmentRoleMembers, findMemberByName, responsibilityMentions, taskOwnerNames } from "../src/lib/teamConfig.js"
import { filterMyWorkTasks, myWorkMonths, normalizeMyWorkFilters, partitionMyWorkTasks, selectNextAction } from "../src/lib/workViews.js"

const tasks = [
  { taskKey: "s:1:task-a", taskId: "task-a", spreadsheetId: "s", sheetGid: 1, rowIndex: 1, clientName: "Nike JUL", month: "JUL", topic: "A", responsibility: "Tony", dueDate: "2026-07-01", done: false },
  { taskKey: "s:1:task-b", taskId: "task-b", spreadsheetId: "s", sheetGid: 1, rowIndex: 2, clientName: "Nike JUL", month: "JUL", topic: "B", responsibility: "", dueDate: "2026-07-29", done: false },
  { taskKey: "s:1:task-c", taskId: "task-c", spreadsheetId: "s", sheetGid: 1, rowIndex: 3, clientName: "Nike JUL", month: "JUL", topic: "C", responsibility: "", dueDate: "2026-08-20", done: true },
  { taskKey: "s:1:task-d", taskId: "task-d", spreadsheetId: "s", sheetGid: 1, rowIndex: 4, clientName: "Nike JUL", month: "JUL", topic: "D", responsibility: "", dueDate: "", done: false },
]

test("validates workflow patches", () => {
  assert.equal(validateWorkflow({ key: "s:1:task-a", status: "blocked" }), null)
  assert.equal(validateWorkflow({ key: "s:1:task-a", status: "unknown" }), "Invalid workflow status")
  assert.equal(validateWorkflow({ key: "bad", note: "x" }), "Invalid task key")
  assert.equal(validateWorkflow({ key: "s:1:1" }), "No changes supplied")
})

test("workflow RPC patches only fields present in the request", () => {
  assert.deepEqual(workflowRpcArgs({ key: "s:1:task-a", note: "new note", expectedNoteVersion: 3 }, "actor"), {
    p_task_key: "s:1:task-a",
    p_status: null,
    p_has_status: false,
    p_note: "new note",
    p_has_note: true,
    p_priority: null,
    p_has_priority: false,
    p_actor: "actor",
    p_expected_note_version: 3,
    p_force_note: false,
  })
})

test("assignment RPC updates one role without replacing the whole object", () => {
  assert.equal(validateAssignmentPatch({ key: "nike", role: "creative", members: ["Tony", "Aom"] }), null)
  assert.equal(validateAssignmentPatch({ key: "nike", role: "unknown", members: ["Tony"] }), "Invalid assignment role")
  assert.equal(validateAssignmentPatch({ key: "nike", role: "pm", members: ["Tony", "tony"] }), "Duplicate assignment member")
  assert.deepEqual(assignmentRpcArgs({ key: " nike ", role: "pm", members: [] }, "actor"), {
    p_brand_key: "nike",
    p_role: "pm",
    p_members: [],
    p_clear: false,
    p_actor: "actor",
  })
})

test("validates completion targets before writing Google Sheets", () => {
  const valid = { taskKey: "sheet:123:task-uuid", spreadsheetId: "sheet", sheetGid: 123, taskId: "task-uuid", done: true, actualSubmit: "2026-07-29" }
  assert.equal(validateCompletion(valid), null)
  assert.equal(validateCompletion({ ...valid, taskKey: "bad" }), "Invalid task key")
  assert.equal(validateCompletion({ ...valid, sheetGid: 5.5 }), "Invalid sheet target")
  assert.equal(validateCompletion({ ...valid, actualSubmit: "29/07/2026" }), "Invalid completion date")
})

test("enforces sync cooldown and recovers abandoned running syncs", () => {
  const now = new Date("2026-07-29T10:00:00Z").getTime()
  const recentSuccess = { id: "done", status: "success", finished_at: "2026-07-29T09:59:30Z" }
  assert.equal(syncDecision(recentSuccess, false, now).action, "cached")
  assert.equal(syncDecision(recentSuccess, true, now).action, "cached")
  assert.equal(syncDecision({ id: "live", status: "running", started_at: "2026-07-29T09:55:00Z" }, false, now).action, "running")
  assert.deepEqual(syncDecision({ id: "stale", status: "running", started_at: "2026-07-29T09:40:00Z" }, false, now), { action: "recover", staleRunId: "stale" })
  assert.equal(syncDecision(recentSuccess, true, now + 61_000).action, "start")
})

test("uses assignment and responsibility ownership", () => {
  const members = [{ name: "Tony" }, { name: "May" }]
  const owners = taskOwners(tasks[0], members, { "s:1": "Nike" }, { nike: { lead: "May" } })
  assert.deepEqual(owners, ["Tony"])
  assert.deepEqual(taskOwnerNames(tasks[1], members, { lead: "May" }), ["May"])
})

test("supports multiple assignees per role and legacy single names", () => {
  const assignment = { creative: ["AOM", "PLENG"], ae: "TONY" }
  assert.deepEqual(assignmentRoleMembers(assignment, "creative"), ["AOM", "PLENG"])
  assert.deepEqual(assignmentRoleMembers(assignment, "ae"), ["TONY"])
  assert.deepEqual(assignmentMemberNames(assignment), ["AOM", "PLENG", "TONY"])
  assert.deepEqual(taskOwnerNames({ responsibility: "" }, [], assignment), ["AOM", "PLENG", "TONY"])
})

test("matches responsibility names on Unicode-aware boundaries", () => {
  assert.equal(responsibilityMentions("May / Tony", "May"), true)
  assert.equal(responsibilityMentions("Maya / Tony", "May"), false)
  assert.equal(responsibilityMentions("ดูแลโดย เมย์ และ Aom", "เมย์"), true)
})

test("matches an existing timeline member without creating a case variant", () => {
  const members = [{ name: "Maya", role: "creative", avatar: "photo" }]
  assert.equal(findMemberByName(members, "  maya "), members[0])
  assert.equal(findMemberByName(members, "May"), undefined)
})

test("uses Unicode boundaries for blocked notification recipients", () => {
  const access = [
    { email: "may@example.com", member_name: "May" },
    { email: "maya@example.com", member_name: "Maya" },
    { email: "actor@example.com", member_name: "Tony" },
  ]
  assert.deepEqual(
    blockedRecipients(access, new Set(), "Maya / Tony", "actor@example.com").map((entry) => entry.email),
    ["maya@example.com"],
  )
  assert.deepEqual(
    blockedRecipients(access, new Set(["May"]), "Maya", "actor@example.com").map((entry) => entry.email),
    ["maya@example.com"],
  )
})

test("rejects missing and incorrect cron credentials before sync", async () => {
  const previous = process.env.CRON_SYNC_SECRET
  process.env.CRON_SYNC_SECRET = "a".repeat(32)
  const response = { statusCode: 0, body: null, setHeader() {}, status(code) { this.statusCode = code; return this }, json(body) { this.body = body; return this } }
  await cronSync({ method: "POST", headers: { "x-cron-secret": "wrong" } }, response)
  assert.equal(response.statusCode, 401)
  assert.equal(validCronSecret("a".repeat(32)), true)
  assert.equal(validCronSecret("b".repeat(32)), false)
  if (previous === undefined) delete process.env.CRON_SYNC_SECRET
  else process.env.CRON_SYNC_SECRET = previous
})

test("requires authentication for the user sync API", async () => {
  const response = { statusCode: 0, body: null, setHeader() {}, status(code) { this.statusCode = code; return this }, json(body) { this.body = body; return this } }
  await syncApi({ method: "GET", headers: {}, query: {} }, response)
  assert.equal(response.statusCode, 401)
  assert.equal(response.body.error, "Authentication required")
})

test("requires authentication for task tab provisioning", async () => {
  const response = { statusCode: 0, body: null, setHeader() {}, status(code) { this.statusCode = code; return this }, json(body) { this.body = body; return this } }
  await taskTabsApi({ method: "POST", headers: {}, body: { action: "inspect", spreadsheetId: "sheet" } }, response)
  assert.equal(response.statusCode, 401)
})

test("propagates Apps Script transport and application failures", async () => {
  const previous = { url: process.env.APPS_SCRIPT_URL, secret: process.env.APPS_SCRIPT_SHARED_SECRET, fetch: globalThis.fetch }
  process.env.APPS_SCRIPT_URL = "https://example.invalid/apps-script"
  process.env.APPS_SCRIPT_SHARED_SECRET = "test-secret"
  globalThis.fetch = async () => ({ ok: false, status: 503 })
  await assert.rejects(callAppsScript({ action: "test" }), /Apps Script failed \(503\)/)
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ success: false, error: "Google write rejected" }) })
  await assert.rejects(callAppsScript({ action: "test" }), /Google write rejected/)
  globalThis.fetch = previous.fetch
  if (previous.url === undefined) delete process.env.APPS_SCRIPT_URL
  else process.env.APPS_SCRIPT_URL = previous.url
  if (previous.secret === undefined) delete process.env.APPS_SCRIPT_SHARED_SECRET
  else process.env.APPS_SCRIPT_SHARED_SECRET = previous.secret
})

test("aborts a sync source read instead of accepting a partial Google response", async () => {
  const originalFetch = globalThis.fetch
  let request = 0
  globalThis.fetch = async () => {
    request += 1
    return request === 1
      ? { ok: true, json: async () => ({ properties: { title: "AUG" }, sheets: [{ properties: { title: "Brand", sheetId: 1, hidden: false } }] }) }
      : { ok: true, json: async () => ({ error: { message: "temporary failure" } }) }
  }
  try {
    await assert.rejects(
      fetchAllSheetsData([{ url: "https://docs.google.com/spreadsheets/d/sheet" }], "server-key"),
      /batchGet failed/
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("quotes task ranges and skips visible non-task tabs", async () => {
  assert.equal(taskRange("Client's Plan", "A1:F1"), "'Client''s Plan'!A1:F1")
  assert.deepEqual(inspectTaskHeaders([" Done ", "Topic", "Responsibility", "Due Date", "Actual Submit", "Task ID"]), { valid: true, taskIdReady: true, taskIdAvailable: true })
  assert.equal(findTaskHeaderRow([["Title"], ["", "Description", "Responsibility", "Due Date"]]), 1)
  assert.equal(columnName(27), "AA")
  const originalFetch = globalThis.fetch
  let request = 0
  globalThis.fetch = async () => {
    request += 1
    if (request === 1) return { ok: true, json: async () => ({ properties: { title: "Timeline Aug 26" }, sheets: [
      { properties: { title: "Client's Plan", sheetId: 11, hidden: false, gridProperties: { columnCount: 26 } } },
      { properties: { title: "Summary", sheetId: 12, hidden: false, gridProperties: { columnCount: 26 } } },
    ] }) }
    return { ok: true, json: async () => ({ valueRanges: [
      { range: "'Client''s Plan'!A1:F3", values: [["Title"], ["", "Description", "Responsibility", "Due Date"], [false, "Launch", "May", "10/08/2026", ""]] },
      { range: "Summary!A1:F2", values: [["Metric", "Value"], ["Open", 1]] },
      { range: "'Client''s Plan'!Z1:Z3", values: [[""], ["Task ID"], ["task_1"]] },
      { range: "Summary!Z1:Z2", values: [] },
    ] }) }
  }
  try {
    const result = await fetchAllSheetsData([{ spreadsheetId: "sheet", url: "https://docs.google.com/spreadsheets/d/sheet" }], "server-key")
    assert.equal(result.tasks.length, 1)
    assert.equal(result.tasks[0].clientName, "Client's Plan")
    assert.equal(result.issues.filter((issue) => issue.type === "skipped_tab").length, 1)
  } finally { globalThis.fetch = originalFetch }
})

test("rejects a mismatched source before changing a snapshot", async () => {
  await assert.rejects(
    fetchAllSheetsData([{ spreadsheetId: "registered", url: "https://docs.google.com/spreadsheets/d/different" }], "server-key"),
    /Invalid Google Sheet source/,
  )
})

test("groups automatic Task ID repairs by sheet and tab", () => {
  assert.deepEqual(taskIdRepairTargets([
    { type: "missing_task_id", spreadsheetId: "a", sheetGid: 1 },
    { type: "duplicate_task_id", spreadsheetId: "a", sheetGid: 1 },
    { type: "invalid_task_id", spreadsheetId: "a", sheetGid: 2 },
    { type: "invalid_task_id_header", spreadsheetId: "a", sheetGid: 2 },
    { type: "skipped_tab", spreadsheetId: "a", sheetGid: 3 },
  ]), [{ spreadsheetId: "a", sheetGids: [1, 2] }])
})

test("builds overall, month and person daily metrics without fake dates", () => {
  const now = new Date("2026-07-29T03:00:00Z")
  assert.equal(bangkokDate(now), "2026-07-29")
  const rows = buildMetricRows(tasks, { "s:1:task-a": "blocked" }, [{ name: "Tony" }], { "s:1": "Nike" }, {}, "run", now)
  assert.deepEqual(rows.map((row) => `${row.dimension}:${row.dimension_key}`), ["overall:all", "month:JUL", "person:Tony", "month_person:JUL:Tony"])
  assert.equal(rows[0].metrics.blocked, 1)
  assert.equal(rows[0].metrics.overdue, 1)
})

test("counts overdue created and resolved between real sync snapshots", () => {
  const previous = [
    { task_key: "old", due_date: "2026-07-01", done: false },
    { task_key: "resolved", due_date: "2026-07-01", done: false },
  ]
  const current = [
    { taskKey: "old", dueDate: "2026-07-01", done: false },
    { taskKey: "resolved", dueDate: "2026-07-01", done: true },
    { taskKey: "new", dueDate: "2026-07-02", done: false },
  ]
  assert.deepEqual(overdueTransitions(previous, current, "2026-07-29"), { overdueCreated: 1, overdueResolved: 1 })
})

test("counts a midnight rollover but not a removed task as overdue resolved", () => {
  const previous = [
    { task_key: "crossed", due_date: "2026-08-09", done: false },
    { task_key: "removed", due_date: "2026-08-01", done: false },
  ]
  const current = [{ taskKey: "crossed", dueDate: "2026-08-09", done: false }]
  assert.deepEqual(overdueTransitions(previous, current, "2026-08-10", "2026-08-09"), { overdueCreated: 1, overdueResolved: 0 })
})

test("calculates overdue transitions for month and person trend dimensions", () => {
  const members = [{ name: "Tony" }]
  const current = [{ ...tasks[0], taskKey: "new-overdue", dueDate: "2026-07-01" }]
  const rows = buildMetricRows(current, {}, members, { "s:1": "Nike" }, {}, "run", new Date("2026-07-29T03:00:00Z"))
  const result = addTransitionMetrics(rows, [], current, members, { "s:1": "Nike" }, {}, "2026-07-29")
  assert.equal(result.find((row) => row.dimension === "overall").metrics.overdueCreated, 1)
  assert.equal(result.find((row) => row.dimension === "month").metrics.overdueCreated, 1)
  assert.equal(result.find((row) => row.dimension === "person").metrics.overdueCreated, 1)
  assert.equal(result.find((row) => row.dimension === "month_person").metrics.overdueCreated, 1)
})

test("partitions My Work and supports workflow dashboard filters", () => {
  const workflow = { "s:1:task-a": "blocked", "s:1:task-b": "in_progress" }
  const groups = partitionMyWorkTasks(tasks, workflow, new Date("2026-07-29T10:00:00+07:00"))
  assert.deepEqual(groups.blocked.map((task) => task.topic), ["A"])
  assert.deepEqual(groups.today.map((task) => task.topic), ["B"])
  assert.deepEqual(groups.unscheduled.map((task) => task.topic), ["D"])
  const dashboard = filterDashboardTasks(tasks.map((task) => ({ ...task, workflowStatus: workflow[task.taskKey] })), { status: "blocked", month: "all", member: "all" }, () => [], new Date("2026-07-29T10:00:00+07:00"))
  assert.deepEqual(dashboard.map((task) => task.topic), ["A"])
  const staleDone = filterDashboardTasks([{ ...tasks[2], workflowStatus: "blocked" }], { status: "blocked", month: "all", member: "all" }, () => [], new Date("2026-07-29T10:00:00+07:00"))
  assert.deepEqual(staleDone, [])
  assert.equal(selectNextAction(groups).topic, "A")
})

test("sorts each My Work section by risk and due date", () => {
  const reversed = [
    { ...tasks[0], taskKey: "s:1:newer", dueDate: "2026-07-20", topic: "Newer" },
    { ...tasks[0], taskKey: "s:1:older", dueDate: "2026-07-01", topic: "Older" },
  ]
  const groups = partitionMyWorkTasks(reversed, {}, "2026-07-29")
  assert.deepEqual(groups.overdue.map((task) => task.topic), ["Older", "Newer"])
})

test("accepts only business priority values", () => {
  assert.equal(validateWorkflow({ key: "s:1:task-a", priority: "urgent" }), null)
  assert.equal(validateWorkflow({ key: "s:1:task-a", priority: "fire" }), "Invalid priority")
})

test("filters My Work text, month, workflow and sorts completed newest first", () => {
  const owned = [
    { ...tasks[0], clientName: "ไนกี้", topic: "Launch" },
    { ...tasks[1], month: "AUG", topic: "Review", actualSubmit: "2026-07-27", done: true },
    { ...tasks[2], topic: "Caption", actualSubmit: "2026-07-29", done: true },
  ]
  const workflow = { "s:1:task-a": "blocked", "s:1:task-b": "in_progress" }
  const text = filterMyWorkTasks(owned, { query: "ไนกี้", month: "all", workflow: "all" }, workflow, {}, (task) => task.clientName)
  assert.deepEqual(text.active.map((task) => task.topic), ["Launch"])
  const filtered = filterMyWorkTasks(owned, { query: "", month: "AUG", workflow: "in_progress" }, workflow, {})
  assert.deepEqual(filtered.completed.map((task) => task.topic), ["Review"])
  const completed = filterMyWorkTasks(owned, { query: "", month: "all", workflow: "all" }, workflow, {})
  assert.deepEqual(completed.completed.map((task) => task.topic), ["Caption", "Review"])
  assert.deepEqual(myWorkMonths(owned), ["JUL", "AUG"])
})

test("parses Bangkok and DD/MM/YYYY dates without ambiguous fallback", () => {
  assert.equal(bangkokDate(new Date("2026-07-28T17:30:00Z")), "2026-07-29")
  assert.equal(parseSheetDate("29/07/2026"), "2026-07-29")
  assert.equal(parseSheetDate("20/6/26"), "2026-06-20")
  assert.equal(parseSheetDate("31/02/2026"), "")
  assert.equal(parseSheetDate("07/29/2026"), "")
  assert.equal(validIsoDate("2026-02-29"), false)
  assert.equal(daysFrom("2026-07-31", "2026-07-29"), 2)
})

test("recognizes a secondary Post Date schedule boundary", () => {
  assert.equal(isSecondaryScheduleHeader(["No.", "Content", "Responsibility", "Post Date", "Status"]), true)
  assert.equal(isSecondaryScheduleHeader(["", "Description", "Responsibility", "Due Date", "Actual Submit"]), false)
})

test("paginates Supabase queries beyond the 1,000-row default", async () => {
  const source = Array.from({ length: 2_005 }, (_, id) => ({ id }))
  const calls = []
  const rows = await fetchAllRows(async (from, to) => {
    calls.push([from, to])
    return { data: source.slice(from, to + 1), error: null }
  })
  assert.equal(rows.length, 2_005)
  assert.deepEqual(calls, [[0, 999], [1000, 1999], [2000, 2999]])
})

test("builds a stable Google Sheet row link without changing the app URL", () => {
  assert.equal(taskSheetUrl(tasks[0]), "https://docs.google.com/spreadsheets/d/s/edit#gid=1&range=A1")
  assert.equal(taskSheetUrl(null, "sheet:123:task-id"), "https://docs.google.com/spreadsheets/d/sheet/edit#gid=123")
  assert.equal(taskSheetUrl(null, "bad"), null)
})

test("keeps failed shared writes in a session retry outbox", () => {
  const values = new Map()
  globalThis.sessionStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
  try {
    const pending = [{ resource: "remarks", key: "s:1:task-a", value: "draft", mutation: "draft" }]
    cachePendingWrites(pending)
    assert.deepEqual(loadPendingWrites(), pending)
    cachePendingWrites([])
    assert.deepEqual(loadPendingWrites(), [])
  } finally {
    delete globalThis.sessionStorage
  }
})

test("keeps dirty deletions as tombstones during a remote refresh", () => {
  assert.deepEqual(mergeRemote({}, { task: "old note", other: "keep" }, new Set(["remarks:task"]), "remarks"), { other: "keep" })
})

test("normalizes corrupt My Work preferences", () => {
  assert.deepEqual(normalizeMyWorkFilters({ query: 1, month: null, workflow: "bad", showCompleted: "yes" }), {
    query: "", month: "all", workflow: "all", showCompleted: false,
  })
})

test("RLS migration grants task edits to active users and settings only to admins", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20260729000000_full_system.sql", import.meta.url), "utf8")
  assert.match(sql, /workflow_insert[\s\S]*private\.is_active_user\(\)/)
  assert.match(sql, /workflow_update[\s\S]*private\.is_active_user\(\)/)
  assert.doesNotMatch(sql, /create policy workflow_write/)
  assert.match(sql, /assignments_write[\s\S]*private\.is_active_user\(\)/)
  assert.match(sql, /sheets_admin_insert[\s\S]*private\.is_admin\(\)/)
  assert.match(sql, /sheets_admin_update[\s\S]*private\.is_admin\(\)/)
  assert.match(sql, /team_admin_write[\s\S]*private\.is_admin\(\)/)
  assert.match(sql, /brands_admin_write[\s\S]*private\.is_admin\(\)/)
  assert.match(sql, /recipient_email\) = \(select private\.current_email\(\)\)/)
  assert.match(sql, /revoke execute on function private\.queue_daily_digest\(\) from public, anon, authenticated/)
  assert.match(sql, /actor_email text/)
  assert.match(sql, /select email into actor_mail from auth\.users/)
  assert.match(sql, /protect_last_admin/)
  assert.match(sql, /stamp_authenticated_actor/)
  assert.match(sql, /stamp_team_actor/)
  assert.match(sql, /create table if not exists public\.task_aliases/)
  const launchSql = await readFile(new URL("../supabase/migrations/20260729092005_launch_ready.sql", import.meta.url), "utf8")
  assert.match(launchSql, /'cron'/)
  assert.match(launchSql, /grant select, insert, update on table public\.task_workflow to authenticated/)
  assert.match(launchSql, /public\.email_outbox\s+from anon/)
  assert.match(launchSql, /grant usage on schema private to authenticated, service_role/)
  assert.match(launchSql, /revoke execute on function private\.audit_shared_change\(\) from public, anon, authenticated/)
  assert.match(launchSql, /notifications_update[\s\S]*private\.is_active_user\(\)/)
  const cronSql = await readFile(new URL("../supabase/cron.sql", import.meta.url), "utf8")
  assert.match(cronSql, /'0 \*\/3 \* \* \*'/)
  assert.match(cronSql, /vault\.decrypted_secrets/)
  assert.doesNotMatch(cronSql, /X-Cron-Secret',\s*'[^']{32}/)
  const prioritySql = await readFile(new URL("../supabase/migrations/20260810090000_business_priorities.sql", import.meta.url), "utf8")
  assert.match(prioritySql, /when 'fire' then 'urgent'/)
  assert.match(prioritySql, /'normal', 'high', 'urgent'/)
  const appsScript = await readFile(new URL("../google-apps-script/Code.gs", import.meta.url), "utf8")
  assert.match(appsScript, /target\.sheetGids/)
  assert.doesNotMatch(appsScript, /spreadsheet\.getSheets\(\)\.filter\(function \(sheet\) \{ return !sheet\.isSheetHidden\(\); \}\)/)
})

test("central state migration makes team changes atomic and realtime", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20260809174859_central_state_stability.sql", import.meta.url), "utf8")
  assert.match(sql, /function public\.replace_team_members\(members jsonb\)/)
  assert.match(sql, /if not private\.is_admin\(\)/)
  assert.match(sql, /on conflict \(name\) do update/)
  assert.match(sql, /revoke insert, update, delete on table public\.team_members from authenticated/)
  assert.match(sql, /if TG_TABLE_NAME = 'task_workflow' then/)
  assert.match(sql, /if TG_TABLE_NAME <> 'sheets' then/)
  assert.doesNotMatch(sql, /record_key := case TG_TABLE_NAME/)
  assert.match(sql, /grant execute on function public\.replace_team_members\(jsonb\) to authenticated/)
  assert.match(sql, /function public\.patch_task_workflow\(/)
  assert.match(sql, /status = case when p_has_status/)
  assert.match(sql, /note = case when p_has_note/)
  assert.match(sql, /priority = case when p_has_priority/)
  assert.match(sql, /to service_role/)
  assert.match(sql, /function public\.patch_assignment_role\(/)
  assert.match(sql, /jsonb_set\(assignments\.value, array\[p_role\]/)
  assert.match(sql, /revoke insert, update, delete on table public\.assignments from authenticated/)
  assert.match(sql, /'public\.sheets', 'public\.team_members'/)
  assert.match(sql, /create trigger audit_team_members/)
  assert.match(sql, /create trigger audit_sheets/)
  const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8")
  assert.match(app, /patchSystemState\(resource, key, mutation, options\)/)
  assert.match(app, /cachePendingWrites\(\[\.\.\.pendingWritesRef\.current\.values\(\)\]\)/)
})

test("access creation atomically links a unique timeline member", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20260811122213_save_access_with_member.sql", import.meta.url), "utf8")
  assert.match(sql, /function public\.save_access_with_member\(/)
  assert.match(sql, /if not private\.is_admin\(\)/)
  assert.match(sql, /insert into public\.team_members/)
  assert.match(sql, /insert into public\.access_list/)
  assert.match(sql, /access_list_active_member_name_unique/)
  assert.match(sql, /lower\(trim\(member_name\)\)/)
  assert.match(sql, /already linked to active email/)
  assert.match(sql, /revoke execute on function public\.save_access_with_member[\s\S]*from public, anon/)
  const client = await readFile(new URL("../src/lib/fullSystem.js", import.meta.url), "utf8")
  assert.match(client, /rpc\("save_access_with_member"/)
  const admin = await readFile(new URL("../src/components/AdminSettings.jsx", import.meta.url), "utf8")
  assert.match(admin, /ชื่อที่แสดงใน Timeline/)
  assert.match(admin, /team-member-names/)
  assert.match(admin, /ยังไม่ผูกชื่อพนักงาน/)
})

test("assignment migration stores multiple members per role", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20260811123658_multi_member_assignments.sql", import.meta.url), "utf8")
  assert.match(sql, /jsonb_build_array\(entry\.value\)/)
  assert.match(sql, /p_members jsonb/)
  assert.match(sql, /jsonb_array_elements_text\(clean_members\)/)
  assert.match(sql, /jsonb_set\(assignments\.value, array\[p_role\], clean_members/)
  assert.match(sql, /jsonb_array_elements_text[\s\S]*assigned_member/)
  const assignment = await readFile(new URL("../api/assignment.js", import.meta.url), "utf8")
  assert.match(assignment, /p_members:/)
  assert.match(assignment, /newlyAssigned/)
})

test("active users can add sheets while admin keeps update control", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20260811124050_active_users_add_sheets.sql", import.meta.url), "utf8")
  assert.match(sql, /create policy sheets_active_insert/)
  assert.match(sql, /for insert to authenticated/)
  assert.match(sql, /private\.is_active_user\(\)/)
  const base = await readFile(new URL("../supabase/migrations/20260729000000_full_system.sql", import.meta.url), "utf8")
  assert.match(base, /sheets_admin_update[\s\S]*private\.is_admin\(\)/)
  const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8")
  assert.match(app, /isAdmin \? "Admin" : "Add Sheet"/)
  const settings = await readFile(new URL("../src/components/AdminSettings.jsx", import.meta.url), "utf8")
  assert.match(settings, /isAdmin && <button[^>]*[\s\S]*Task tabs/)
  assert.match(settings, /isAdmin && <button[^>]*[\s\S]*Remove/)
})

test("ready migration applies snapshots and completion atomically", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20260810110000_ready_for_use.sql", import.meta.url), "utf8")
  assert.match(sql, /create table if not exists public\.sync_stage_tasks/)
  assert.match(sql, /function public\.apply_sync_snapshot\(/)
  assert.match(sql, /on conflict \(task_key\) do update/)
  assert.match(sql, /status = 'success'/)
  assert.match(sql, /function public\.finalize_completion\(/)
  assert.match(sql, /note_version bigint not null default 0/)
  assert.match(sql, /NOTE_CONFLICT/)
  assert.match(sql, /team-avatars/)
  assert.match(sql, /drop table if exists public\.email_outbox/)
  const syncCore = await readFile(new URL("../api/_syncCore.js", import.meta.url), "utf8")
  assert.match(syncCore, /from\("sync_stage_tasks"\)\.insert/)
  assert.match(syncCore, /rpc\("apply_sync_snapshot"/)
  assert.match(syncCore, /action: "ensure_task_ids"/)
  const completion = await readFile(new URL("../api/completion.js", import.meta.url), "utf8")
  assert.match(completion, /rpc\("finalize_completion"/)
})

test("legacy migration normalizes priorities and cron has no unsent digest", async () => {
  const migration = await readFile(new URL("../scripts/migrate-gist-to-supabase.mjs", import.meta.url), "utf8")
  assert.match(migration, /value === "fire" \? "urgent"/)
  assert.match(migration, /value === "think" \? "high"/)
  assert.match(migration, /order\("task_key"\)/)
  const cron = await readFile(new URL("../supabase/cron.sql", import.meta.url), "utf8")
  assert.doesNotMatch(cron, /cron\.schedule\(\s*'timeline-dashboard-daily-digest'/)
  const assignment = await readFile(new URL("../api/assignment.js", import.meta.url), "utf8")
  assert.doesNotMatch(assignment, /Manager access required/)
})
