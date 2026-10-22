import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { addTransitionMetrics, buildMetricRows, overdueTransitions, taskOwners } from "../api/_metrics.js"
import { taskIdRepairTargets } from "../api/_syncCore.js"
import { assignmentRpcArgs, validateAssignmentPatch } from "../api/assignment.js"
import teamAvatarApi, { validateTeamAvatar } from "../api/team-avatar.js"
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
import { cachePendingWrites, loadPendingWrites, mergeRemote, mergeRemoteProjects, overlayPendingProjects, taskSheetUrl } from "../src/lib/sharedState.js"
import { columnName, findTaskHeaderRow, inspectTaskHeaders, isSecondaryScheduleHeader, taskRange } from "../src/lib/sheetSchema.js"
import { applyMemberAvatar, assignmentMemberNames, assignmentRoleMembers, findMemberByName, mergeRemoteTeamMembers, mergeSavedTeamMember, responsibilityMentions, taskOwnerNames } from "../src/lib/teamConfig.js"
import { assignmentKeyForTask, projectForTask, resolveAssignment } from "../src/lib/assignmentResolver.js"
import { avatarBlobFromCanvas, persistAvatarChange, validateAvatarBlob } from "../src/lib/teamAvatar.js"
import { filterMyWorkTasks, myWorkMonths, normalizeMyWorkFilters, partitionMyWorkTasks, selectNextAction } from "../src/lib/workViews.js"
import { MILESTONE_TYPES, calculateContractEnd, completedLateDays, contractDaysRemaining, contractRadarRank, contractState, detectMilestone, milestoneNeedsDate, projectDatesFromTab, projectDeliveryState, projectNameFromTab, riskForBrand, suggestProjectsForBrand, suggestSourceTabsForBrand, timelineRangeDates } from "../src/lib/brandTimeline.js"

const tasks = [
  { taskKey: "s:1:task-a", taskId: "task-a", spreadsheetId: "s", sheetGid: 1, rowIndex: 1, clientName: "Nike JUL", month: "JUL", topic: "A", responsibility: "Tony", dueDate: "2026-07-01", done: false },
  { taskKey: "s:1:task-b", taskId: "task-b", spreadsheetId: "s", sheetGid: 1, rowIndex: 2, clientName: "Nike JUL", month: "JUL", topic: "B", responsibility: "", dueDate: "2026-07-29", done: false },
  { taskKey: "s:1:task-c", taskId: "task-c", spreadsheetId: "s", sheetGid: 1, rowIndex: 3, clientName: "Nike JUL", month: "JUL", topic: "C", responsibility: "", dueDate: "2026-08-20", done: true },
  { taskKey: "s:1:task-d", taskId: "task-d", spreadsheetId: "s", sheetGid: 1, rowIndex: 4, clientName: "Nike JUL", month: "JUL", topic: "D", responsibility: "", dueDate: "", done: false },
]

test("avatar crop produces a CSP-safe JPEG Blob without fetching a data URL", async () => {
  let received = null
  const blob = new Blob(["avatar"], { type: "image/jpeg" })
  const canvas = {
    toBlob(callback, type, quality) {
      received = { type, quality }
      callback(blob)
    },
  }

  assert.equal(await avatarBlobFromCanvas(canvas), blob)
  assert.deepEqual(received, { type: "image/jpeg", quality: 0.85 })
  await assert.rejects(() => avatarBlobFromCanvas({ toBlob: (callback) => callback(null) }), /สร้างไฟล์รูปไม่สำเร็จ/)

  const source = await readFile(new URL("../src/lib/fullSystem.js", import.meta.url), "utf8")
  assert.doesNotMatch(source, /uploadTeamAvatar[\s\S]*?fetch\(dataUrl\)/)
})

test("avatar Blob validation accepts supported images and rejects invalid payloads", () => {
  assert.equal(validateAvatarBlob(new Blob(["jpg"], { type: "image/jpeg" })).type, "image/jpeg")
  assert.equal(validateAvatarBlob(new Blob(["png"], { type: "image/png" })).type, "image/png")
  assert.equal(validateAvatarBlob(new Blob(["webp"], { type: "image/webp" })).type, "image/webp")
  assert.throws(() => validateAvatarBlob(new Blob(["svg"], { type: "image/svg+xml" })), /JPEG, PNG หรือ WebP/)
  assert.throws(() => validateAvatarBlob(new Blob([new Uint8Array(2_097_153)], { type: "image/jpeg" })), /ไม่เกิน 2 MB/)
})

test("avatar save uses a stable member name and deletes the previous file only after persistence", async () => {
  const events = []
  const members = [{ name: "BOOM", role: "pm", avatar: "https://old.example/avatar.jpg" }]
  const result = await persistAvatarChange({
    members,
    memberName: "BOOM",
    blob: new Blob(["new"], { type: "image/jpeg" }),
    upload: async () => { events.push("upload:new"); return "https://new.example/avatar.jpg" },
    persist: async (memberName, avatar) => { events.push(`persist:${memberName}:${avatar}`); return true },
    remove: async (url) => { events.push(`remove:${url}`) },
  })

  assert.equal(result.saved, true)
  assert.equal(result.members[0].avatar, "https://new.example/avatar.jpg")
  assert.equal(members[0].avatar, "https://old.example/avatar.jpg")
  assert.deepEqual(events, [
    "upload:new",
    "persist:BOOM:https://new.example/avatar.jpg",
    "remove:https://old.example/avatar.jpg",
  ])
})

test("avatar save rolls back the uploaded file when member persistence fails", async () => {
  const events = []
  const members = [{ name: "BOOM", role: "pm", avatar: "https://old.example/avatar.jpg" }]
  const result = await persistAvatarChange({
    members,
    memberName: "boom",
    blob: new Blob(["new"], { type: "image/jpeg" }),
    upload: async () => { events.push("upload:new"); return "https://new.example/avatar.jpg" },
    persist: async () => { events.push("persist:failed"); return false },
    remove: async (url) => { events.push(`remove:${url}`) },
  })

  assert.equal(result.saved, false)
  assert.equal(result.members, members)
  assert.deepEqual(events, ["upload:new", "persist:failed", "remove:https://new.example/avatar.jpg"])
})

test("avatar upload failure never persists or removes an existing profile", async () => {
  const events = []
  const members = [{ name: "BOOM", role: "pm", avatar: "https://old.example/avatar.jpg" }]
  await assert.rejects(() => persistAvatarChange({
    members,
    memberName: "BOOM",
    blob: new Blob(["new"], { type: "image/jpeg" }),
    upload: async () => { events.push("upload:failed"); throw new Error("Storage unavailable") },
    persist: async () => { events.push("persist") },
    remove: async () => { events.push("remove") },
  }), /Storage unavailable/)
  assert.deepEqual(events, ["upload:failed"])
  assert.equal(members[0].avatar, "https://old.example/avatar.jpg")
})

test("a newly saved member is merged into the live team without losing pending edits", () => {
  const live = [
    { name: "BOOM", role: "pm", avatar: "https://example.com/boom.jpg" },
    { name: "MAY", role: "ae", avatar: "" },
  ]
  assert.deepEqual(mergeSavedTeamMember(live, { name: "AUM", role: "creative" }), [
    ...live,
    { name: "AUM", role: "creative", avatar: "" },
  ])
  assert.deepEqual(mergeSavedTeamMember(live, { name: "boom", role: "creative" }), live)
})

test("remote members appear while local team edits are pending", () => {
  const pending = [{ name: "BOOM", role: "creative", avatar: "local-avatar" }]
  const remote = [
    { name: "AUM", role: "creative", avatar: "" },
    { name: "BOOM", role: "pm", avatar: "remote-avatar" },
  ]
  assert.deepEqual(mergeRemoteTeamMembers(pending, remote, true), [
    { name: "BOOM", role: "creative", avatar: "local-avatar" },
    { name: "AUM", role: "creative", avatar: "" },
  ])
  assert.equal(mergeRemoteTeamMembers(pending, remote, false), remote)
})

test("avatar completion patches the latest team state instead of replacing its snapshot", () => {
  const latest = [
    { name: "BOOM", role: "creative", avatar: "old" },
    { name: "AUM", role: "creative", avatar: "" },
  ]
  assert.deepEqual(applyMemberAvatar(latest, "boom", "new"), [
    { name: "BOOM", role: "creative", avatar: "new" },
    { name: "AUM", role: "creative", avatar: "" },
  ])
})

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
    p_next_action: null,
    p_has_next_action: false,
    p_actor: "actor",
    p_expected_note_version: 3,
    p_force_note: false,
  })
})

test("assignment RPC updates one role without replacing the whole object", () => {
  assert.equal(validateAssignmentPatch({ key: "nike", role: "creative", members: ["Tony", "Aom"] }), null)
  assert.equal(validateAssignmentPatch({ key: "nike", role: "graphic_editor", members: ["Mild"] }), null)
  assert.equal(validateAssignmentPatch({ key: "nike", role: "cameraman", members: ["Film"] }), null)
  assert.equal(validateAssignmentPatch({ key: "nike", role: "media_planner", members: ["Plan"] }), null)
  assert.equal(validateAssignmentPatch({ key: "nike", role: "ads_optimizer", members: ["Optimize"] }), null)
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

test("production team roles are accepted by the database migration", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20260813180000_add_production_team_roles.sql", import.meta.url), "utf8")
  assert.match(sql, /'cameraman'/)
  assert.match(sql, /'media_planner'/)
  assert.match(sql, /'ads_optimizer'/)
  assert.match(sql, /replace_team_members\(jsonb\)/)
  assert.match(sql, /save_access_with_member\(text,text,text,text,boolean\)/)
  assert.match(sql, /patch_assignment_role\(text,text,jsonb,boolean,uuid\)/)
})

test("avatar endpoint validates a single-member atomic update", async () => {
  assert.equal(validateTeamAvatar({ memberName: "AUM", avatar: "https://example.com/aum.jpg" }), null)
  assert.equal(validateTeamAvatar({ memberName: "AUM", avatar: "" }), null)
  assert.equal(validateTeamAvatar({ memberName: "", avatar: "https://example.com/aum.jpg" }), "Invalid team member")
  assert.equal(validateTeamAvatar({ memberName: "AUM", avatar: "data:image/png;base64,abc" }), "Invalid avatar URL")
  const source = await readFile(new URL("../api/team-avatar.js", import.meta.url), "utf8")
  assert.match(source, /context\.access\.role !== "admin"/)
  assert.match(source, /\.update\(\{ avatar,/)
  assert.doesNotMatch(source, /delete\(\)/)
})

test("avatar endpoint requires authentication", async () => {
  const response = { statusCode: 0, body: null, setHeader() {}, status(code) { this.statusCode = code; return this }, json(body) { this.body = body; return this } }
  await teamAvatarApi({ method: "PATCH", headers: {}, body: { memberName: "AUM", avatar: "" } }, response)
  assert.equal(response.statusCode, 401)
})

test("brand timeline migration exposes safe workstream and contract RPCs", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20260820120000_brand_contract_timeline.sql", import.meta.url), "utf8")
  assert.match(sql, /create table if not exists public\.brand_workstreams/)
  assert.match(sql, /create table if not exists public\.contract_rounds/)
  assert.match(sql, /source tab is already assigned/i)
  assert.match(sql, /Contract rounds cannot overlap/i)
  assert.match(sql, /queue_contract_notifications/)
  assert.match(sql, /notifications_dedupe_key_idx/)
  assert.match(sql, /update public\.brand_workstreams/)
  assert.match(sql, /p_status not in \('closed', 'cancelled', 'open'\)/)
  assert.match(sql, /pg_advisory_xact_lock/)
  assert.match(sql, /where id = target_id and workstream_id = p_workstream_id/)
})

test("Brand Project migration keeps legacy data and allows named overlapping contracts", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20260830120000_brand_projects.sql", import.meta.url), "utf8")
  assert.match(sql, /create table if not exists public\.brand_catalog/)
  assert.match(sql, /set assignment = legacy\.value/)
  assert.match(sql, /to_jsonb\(project\.owner_member\)/)
  assert.match(sql, /add column if not exists name text/)
  assert.match(sql, /create or replace function public\.save_brand_project\(/)
  assert.match(sql, /create or replace function public\.save_brand_project_contract\(/)
  assert.doesNotMatch(sql, /Contract rounds cannot overlap/i)
  assert.match(sql, /jsonb_each\(d\.assignment\)/)
  assert.match(sql, /contract_name/)
})

test("Brand Contract hierarchy migration preserves legacy rows and exposes protected RPCs", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20260830204015_brand_contract_project_hierarchy.sql", import.meta.url), "utf8")
  assert.match(sql, /add column if not exists brand_id uuid references public\.brand_catalog/)
  assert.match(sql, /add column if not exists contract_id uuid references public\.contract_rounds/)
  assert.match(sql, /create or replace function public\.upsert_brand_contract/)
  assert.match(sql, /create or replace function public\.upsert_brand_project/)
  assert.match(sql, /p_source_tab_key text/)
  assert.match(sql, /in \(30, 14, 7\)/)
  assert.match(sql, /access\.role = 'admin'/)
  assert.match(sql, /revoke execute on function public\.upsert_brand_contract[\s\S]*from public, anon/)
})

test("brand timeline dates and milestones are deterministic", () => {
  assert.equal(calculateContractEnd("2026-01-01", 3), "2026-03-31")
  assert.equal(calculateContractEnd("2028-02-29", 12), "2029-02-27")
  assert.equal(calculateContractEnd("2026-01-01", 9), "")
  assert.equal(detectMilestone("Idea - Present Idea"), "present_idea")
  assert.equal(detectMilestone("VDO 1: Draft 1 AW"), "draft_1")
  assert.equal(detectMilestone("Draft 10"), null)
  assert.equal(contractState({ startDate: "2026-08-01", endDate: "2026-08-31", status: "open" }, "2026-08-20"), "active")
  assert.equal(contractState({ startDate: "2026-07-01", endDate: "2026-07-31", status: "open" }, "2026-08-20"), "expired")
})

test("brand timeline supports shared ranges, late details and missing milestone dates", () => {
  assert.equal(MILESTONE_TYPES.contract_end.label, "Contract End")
  const late = { taskKey: "s:1:late", topic: "Draft 1", dueDate: "2026-08-01", actualSubmit: "2026-08-04", done: true }
  assert.equal(completedLateDays(late), 3)
  assert.equal(milestoneNeedsDate({ ...late, dueDate: "" }), true)
  const range = timelineRangeDates({ today: "2026-08-20", range: "6m", tasks: [], contracts: [] })
  assert.equal(range.startDate, "2026-05-20")
  assert.equal(range.endDate, "2026-11-20")
  const suggestions = suggestSourceTabsForBrand({
    brandKey: "acme",
    tabs: [{ key: "1:1", title: "Acme Jan", count: 4 }, { key: "1:2", title: "Acme Production", count: 3 }, { key: "1:3", title: "Other", count: 2 }, { key: "1:4", title: "Empty tab", count: 0 }],
    tabBrands: { "1:4": "Acme" },
    tasksByTab: { "1:1": [{ clientName: "Acme Jan" }], "1:2": [{ clientName: "Other" }], "1:3": [{ clientName: "Other" }] },
    brandNameForTask: (task) => task.clientName.split(" ")[0],
  })
  assert.deepEqual(suggestions.map((tab) => tab.key), ["1:1", "1:4", "1:2"])
  assert.equal(suggestions[2].suggested, true)
  assert.equal(suggestions[1].mapped, true)
})

test("Project suggestions keep month identity and never group different tabs", () => {
  assert.equal(projectNameFromTab("(Pleng+Toey) Dr.choice Influ Mar 26", "Dr.choice"), "Influ Mar 26")
  assert.deepEqual(projectDatesFromTab("Dr.choice Influ Mar 26"), { startDate: "2026-03-01", endDate: "2026-03-31" })
  const suggestions = suggestProjectsForBrand({
    brandName: "Dr.choice",
    tabs: [
      { key: "s:1", title: "Dr.choice Video Jan 2026", count: 4 },
      { key: "s:2", title: "Dr.choice Video Feb 2026", count: 5 },
      { key: "s:3", title: "Dr.choice Influ Mar 2026", count: 2 },
    ],
  })
  assert.deepEqual(suggestions.map((item) => [item.name, item.sourceTabKey, item.taskCount]), [
    ["Influ Mar 2026", "s:3", 2],
    ["Video Feb 2026", "s:2", 5],
    ["Video Jan 2026", "s:1", 4],
  ])
})

test("Project delivery uses the manually entered Project end date", () => {
  const base = { startDate: "2026-08-01", endDate: "2026-08-31" }
  assert.deepEqual(projectDeliveryState({ ...base, tasks: [] }, "2026-09-03"), { state: "overdue", days: 3, total: 0, completed: 0, incomplete: 0, percent: 0, complete: false, completionDate: "" })
  assert.equal(projectDeliveryState({ ...base, tasks: [{ done: false }] }, "2026-08-27").state, "due_soon")
  assert.deepEqual(projectDeliveryState({ ...base, tasks: [{ done: true, actualSubmit: "2026-09-02" }] }, "2026-09-03").state, "completed_late")
  assert.equal(projectDeliveryState({ tasks: [{ done: false }] }, "2026-09-03").state, "missing_dates")
})

test("contract radar thresholds and day zero are deterministic", () => {
  const contract = { startDate: "2026-08-01", endDate: "2026-08-20", status: "open" }
  assert.equal(contractDaysRemaining(contract, "2026-08-20"), 0)
  assert.equal(contractRadarRank(contract, "2026-08-20"), 1)
  assert.equal(contractRadarRank({ ...contract, endDate: "2026-10-04" }, "2026-08-20"), 4)
  assert.equal(contractState({ ...contract, startDate: "2026-09-01", endDate: "2026-11-30" }, "2026-08-20"), "upcoming")
})

test("Brand UI keeps Contract overview visible and intake at the bottom", async () => {
  const brand = await readFile(new URL("../src/components/BrandView.jsx", import.meta.url), "utf8")
  const projects = await readFile(new URL("../src/components/BrandProjectsView.jsx", import.meta.url), "utf8")
  const admin = await readFile(new URL("../src/components/AdminSettings.jsx", import.meta.url), "utf8")
  const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8")
  assert.match(brand, /export function ProjectForm/)
  assert.match(brand, /Project หนึ่งรายการใช้ Google Sheet tab เพียงหนึ่งอัน/)
  assert.match(brand, /สัญญาใหญ่ของ/)
  assert.match(projects, /Contract Gantt/)
  assert.match(projects, /Project intake/)
  assert.match(projects, /หนึ่ง tab จะสร้างหนึ่ง Project/)
  assert.match(projects, /onSetProjectActive/)
  assert.doesNotMatch(`${brand}\n${projects}`, /workstream/i)
  assert.doesNotMatch(admin, /brandTimeline|ProjectForm|ContractForm|Brand Projects & contracts/)
  assert.match(app, /onManageBrands=\{\(\) => setViewMode\("brand"\)\}/)
})

test("brand risk keeps contracts ahead of overdue milestone work", () => {
  const risk = riskForBrand({
    today: "2026-08-20",
    tasks: [{ taskKey: "s:1:task-a", topic: "Present Idea", dueDate: "2026-08-01", done: false }],
    contracts: [{ id: "c", startDate: "2026-01-01", endDate: "2026-08-30", status: "open" }],
  })
  assert.equal(risk.rank, 2)
  assert.equal(risk.overdueKeyTasks.length, 1)
})

test("workflow presentation calls blocked data Hold without changing its value", async () => {
  const config = await readFile(new URL("../src/lib/workflowConfig.jsx", import.meta.url), "utf8")
  const select = await readFile(new URL("../src/components/WorkflowSelect.jsx", import.meta.url), "utf8")
  const table = await readFile(new URL("../src/components/TimelineTable.jsx", import.meta.url), "utf8")
  assert.match(config, /value:\s*"blocked",\s*label:\s*"Hold"/)
  assert.match(config, /value:\s*"in_progress"[\s\S]*tone:\s*"progress"/)
  assert.match(config, /value:\s*"done"[\s\S]*tone:\s*"done"/)
  assert.doesNotMatch(config, /value:\s*"hold"/)
  assert.match(select, /data-workflow-tone=/)
  assert.match(table, /workflowLabel\(workflowValue\)/)
})

test("browser data refresh is manual while auth and notifications keep lightweight refresh", async () => {
  const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8")
  const auth = await readFile(new URL("../src/components/AuthGate.jsx", import.meta.url), "utf8")
  const notifications = await readFile(new URL("../src/components/NotificationCenter.jsx", import.meta.url), "utf8")
  assert.doesNotMatch(app, /timeline-shared-state/)
  assert.doesNotMatch(app, /setInterval\(refreshShared/)
  assert.doesNotMatch(app, /addEventListener\("focus", refreshShared/)
  assert.doesNotMatch(app, /cacheExpired[\s\S]*syncData\(\)/)
  assert.match(app, /const refreshScreen = useCallback/)
  assert.match(auth, /setInterval\(refreshAccess, READ_INTERVAL\)/)
  assert.match(notifications, /setInterval\(refresh, 120_000\)/)
})

test("scheduled Google sync leaves a fresh snapshot before notification slots", async () => {
  const sql = await readFile(new URL("../supabase/cron.sql", import.meta.url), "utf8")
  assert.match(sql, /'25,55 \* \* \* \*'/)
  assert.match(sql, /'timeline-dashboard-notifications'[\s\S]*'\*\/15 \* \* \* \*'/)
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
  assert.deepEqual(taskOwners(tasks[1], members, { "s:1": "Nike" }, { "s:1": { lead: "May" }, nike: { lead: "Tony" } }), ["May"])
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

test("modal layer stays above its backdrop and below alerts", async () => {
  const css = await readFile(new URL("../src/index.css", import.meta.url), "utf8")
  const layer = (name) => Number(css.match(new RegExp(`--z-${name}:\\s*(\\d+)`))?.[1])
  assert.ok(Number.isFinite(layer("overlay")), "overlay z-index token must exist")
  assert.ok(Number.isFinite(layer("modal")), "modal z-index token must exist")
  assert.ok(Number.isFinite(layer("alert")), "alert z-index token must exist")
  assert.ok(layer("overlay") < layer("modal"), "modal must render above its backdrop")
  assert.ok(layer("modal") < layer("alert"), "alerts must render above regular modals")
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

test("access account discovery requires authentication", async () => {
  const accessAccountsApi = (await import("../api/access-accounts.js")).default
  const response = { statusCode: 0, body: null, setHeader() {}, status(code) { this.statusCode = code; return this }, json(body) { this.body = body; return this } }
  await accessAccountsApi({ method: "GET", headers: {} }, response)
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
      { range: "'Client''s Plan'!A1:F3", values: [["Title"], ["", "Description", "Responsibility", "Due Date", "Actual Submit", "GD Timeline", "Task ID"], [false, "Launch", "May", "10/08/2026", "", "", "task_1"]] },
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
  assert.match(cronSql, /'25,55 \* \* \* \*'/)
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

test("Explorer assignment resolver keeps legacy tabs assignable and gives Projects precedence", () => {
  const task = { spreadsheetId: "sheet", sheetGid: 7, clientName: "Acme JUL" }
  const project = { id: "project-1", sourceTabKey: "sheet:7", assignment: { creative: ["AOM"] }, active: true }
  assert.equal(projectForTask(task, [project])?.id, "project-1")
  assert.equal(assignmentKeyForTask(task, [project], "Acme"), "project-1")
  assert.deepEqual(resolveAssignment(task, {
    projects: [project],
    projectAssignments: { "project-1": { creative: ["AOM"] } },
    assignments: { acme: { creative: ["TONY"] } },
    brandName: "Acme",
  }), { creative: ["AOM"] })

  const legacyTask = { spreadsheetId: "sheet", sheetGid: 8, clientName: "Acme JUL" }
  assert.equal(assignmentKeyForTask(legacyTask, [], "Acme"), "acme")
  assert.deepEqual(resolveAssignment(legacyTask, { assignments: { acme: { pm: ["BOOM"] } }, brandName: "Acme" }), { pm: ["BOOM"] })
})

test("pending Project assignments survive a stale remote refresh", () => {
  const local = [{ id: "project-1", name: "June", assignment: { pm: ["OLD"] } }]
  const remote = [{ id: "project-1", name: "June", assignment: {} }]
  const pending = new Map([["projectAssignments:project-1", { resource: "projectAssignments", key: "project-1", value: { pm: ["NEW"] } }]])
  assert.deepEqual(mergeRemoteProjects(local, remote, pending)[0].assignment, { pm: ["NEW"] })
  assert.deepEqual(overlayPendingProjects(local, [...pending.values()])[0].assignment, { pm: ["NEW"] })
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

test("legacy migration normalizes priorities and cron uses the notification worker", async () => {
  const migration = await readFile(new URL("../scripts/migrate-gist-to-supabase.mjs", import.meta.url), "utf8")
  assert.match(migration, /value === "fire" \? "urgent"/)
  assert.match(migration, /value === "think" \? "high"/)
  assert.match(migration, /order\("task_key"\)/)
  const cron = await readFile(new URL("../supabase/cron.sql", import.meta.url), "utf8")
  assert.doesNotMatch(cron, /cron\.schedule\(\s*'timeline-dashboard-daily-digest'/)
  assert.match(cron, /cron\.schedule\(\s*'timeline-dashboard-notifications'/)
  const assignment = await readFile(new URL("../api/assignment.js", import.meta.url), "utf8")
  assert.doesNotMatch(assignment, /Manager access required/)
})
