import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { addTransitionMetrics, buildMetricRows, overdueTransitions, taskOwners } from "../api/_metrics.js"
import cronSync, { validCronSecret } from "../api/cron-sync.js"
import { callAppsScript } from "../api/_appsScript.js"
import { validateCompletion } from "../api/completion.js"
import syncApi, { syncDecision } from "../api/sync.js"
import { blockedRecipients, validateWorkflow } from "../api/workflow.js"
import { filterDashboardTasks } from "../src/lib/dashboardFilters.js"
import { bangkokDate, daysFrom, parseSheetDate, validIsoDate } from "../src/lib/dates.js"
import { fetchAllRows } from "../src/lib/supabasePages.js"
import { taskSheetUrl } from "../src/lib/sharedState.js"
import { responsibilityMentions } from "../src/lib/teamConfig.js"
import { filterMyWorkTasks, myWorkMonths, partitionMyWorkTasks } from "../src/lib/workViews.js"

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
  assert.deepEqual(owners.sort(), ["May", "Tony"])
})

test("matches responsibility names on Unicode-aware boundaries", () => {
  assert.equal(responsibilityMentions("May / Tony", "May"), true)
  assert.equal(responsibilityMentions("Maya / Tony", "May"), false)
  assert.equal(responsibilityMentions("ดูแลโดย เมย์ และ Aom", "เมย์"), true)
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
  assert.deepEqual(myWorkMonths(owned), ["AUG", "JUL"])
})

test("parses Bangkok and DD/MM/YYYY dates without ambiguous fallback", () => {
  assert.equal(bangkokDate(new Date("2026-07-28T17:30:00Z")), "2026-07-29")
  assert.equal(parseSheetDate("29/07/2026"), "2026-07-29")
  assert.equal(parseSheetDate("31/02/2026"), "")
  assert.equal(parseSheetDate("07/29/2026"), "")
  assert.equal(validIsoDate("2026-02-29"), false)
  assert.equal(daysFrom("2026-07-31", "2026-07-29"), 2)
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
  assert.match(cronSql, /'\*\/30 \* \* \* \*'/)
  assert.match(cronSql, /vault\.decrypted_secrets/)
  assert.doesNotMatch(cronSql, /X-Cron-Secret',\s*'[^']{32}/)
})
