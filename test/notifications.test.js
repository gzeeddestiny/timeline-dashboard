import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import {
  digestCategory,
  digestRows,
  escapeHtml,
  isNoActivity,
  manualDuplicateFingerprint,
  notificationDedupeKey,
  renderTemplateText,
  tasksNotCoveredByDigest,
  uniqueTaskCount,
  validateTemplateText,
} from "../src/lib/notifications.js"
import { validateWorkflow, workflowRpcArgs } from "../api/workflow.js"
import { buildNotificationEmail, taskDeepLink } from "../src/lib/notificationFormat.js"
import { bangkokClock, scheduledType, validateSettings, validateTemplates, loadNotificationData } from "../api/_notifications.js"
import { DEFAULT_NOTIFICATION_TEMPLATES, templateTokensForField } from "../src/lib/notifications.js"

const task = { taskKey: "sheet:1:t1", topic: "Launch", clientName: "Acme", dueDate: "2026-08-30", done: false, active: true }

test("digest category is exclusive and follows urgency precedence", () => {
  assert.equal(digestCategory(task, "blocked", "2026-08-31"), "overdue")
  assert.equal(digestCategory({ ...task, dueDate: "2026-09-02" }, "blocked", "2026-08-31"), "due_soon")
  assert.equal(digestCategory({ ...task, dueDate: "2026-09-20" }, "blocked", "2026-08-31"), "blocked")
  assert.equal(digestCategory({ ...task, dueDate: "2026-09-20" }, "not_started", "2026-08-31"), null)
})

test("digest rows sort by urgency and enforce cap", () => {
  const result = digestRows([
    { ...task, taskKey: "later", dueDate: "2026-09-20" },
    { ...task, taskKey: "due", dueDate: "2026-09-02" },
    { ...task, taskKey: "late", dueDate: "2026-08-01" },
  ], { later: "in_progress" }, "2026-08-31", 2)
  assert.deepEqual(result.rows.map((row) => row.taskKey), ["late", "due"])
  assert.equal(result.total, 3)
  assert.equal(result.truncated, true)
})

test("no activity begins at exactly 120 hours and respects snooze", () => {
  const now = new Date("2026-08-30T02:15:00.000Z")
  assert.equal(isNoActivity({ lastActivityAt: "2026-08-25T02:15:01.000Z" }, task, now), false)
  assert.equal(isNoActivity({ lastActivityAt: "2026-08-25T02:15:00.000Z" }, task, now), true)
  assert.equal(isNoActivity({ lastActivityAt: "2026-08-20T00:00:00.000Z", snoozedUntil: "2026-08-30" }, task, now), false)
  assert.equal(isNoActivity({ lastActivityAt: "2026-08-20T00:00:00.000Z" }, { ...task, done: true }, now), false)
})

test("template rendering validates tokens and escapes fixed HTML values", () => {
  assert.equal(validateTemplateText("สวัสดี {{employee_name}}"), null)
  assert.match(validateTemplateText("{{secret}}"), /Unsupported/)
  assert.match(validateTemplateText("{{employee_name"), /Malformed/)
  assert.equal(renderTemplateText("Hi {{employee_name}}", { employee_name: "May" }), "Hi May")
  assert.equal(escapeHtml('<img src=x onerror="x">'), "&lt;img src=x onerror=&quot;x&quot;&gt;")
})

test("dedupe and manual fingerprints are stable across recipient order", () => {
  assert.equal(notificationDedupeKey("daily_digest", "employee", "MAY@EXAMPLE.COM", "2026-08-30"), "daily_digest:employee:may@example.com:2026-08-30")
  assert.equal(
    manualDuplicateFingerprint("Acme", ["b", "a"], ["b@example.com", "a@example.com"]),
    manualDuplicateFingerprint(" acme ", ["a", "b"], ["a@example.com", "b@example.com"]),
  )
})

test("shared tasks count once company-wide and digest-covered stale tasks do not get duplicate email", () => {
  const shared = { ...task, taskKey: "shared", ownerNames: ["May", "Ton"] }
  assert.equal(uniqueTaskCount([shared, shared, { ...task, taskKey: "other" }]), 2)
  assert.deepEqual(tasksNotCoveredByDigest([shared, { ...task, taskKey: "other" }], [{ task_keys: ["shared"] }]).map((item) => item.taskKey), ["other"])
})

test("workflow requires Next Action for active attention statuses", () => {
  assert.equal(validateWorkflow({ key: "sheet:1:t1", status: "in_progress" }), null)
  assert.equal(validateWorkflow({ key: "sheet:1:t1", status: "in_progress", nextAction: "ส่ง draft ให้ลูกค้า" }), null)
  assert.equal(validateWorkflow({ key: "sheet:1:t1", nextAction: "ติดตาม feedback" }), null)
  assert.deepEqual(workflowRpcArgs({ key: "sheet:1:t1", nextAction: "ติดตาม feedback" }, "actor"), {
    p_task_key: "sheet:1:t1",
    p_status: null,
    p_has_status: false,
    p_note: null,
    p_has_note: false,
    p_priority: null,
    p_has_priority: false,
    p_next_action: "ติดตาม feedback",
    p_has_next_action: true,
    p_actor: "actor",
    p_expected_note_version: null,
    p_force_note: false,
  })
})

test("email format is escaped, fixed, and deep-links to the task", () => {
  const email = buildNotificationEmail({
    template: { subject: "Hi {{employee_name}}", greeting: "สวัสดี {{employee_name}}", intro: "งานวันนี้", closing: "ขอบคุณ" },
    recipientName: "May <script>",
    tasks: [{ ...task, taskKey: "sheet:1:t1", projectName: "Acme", topic: "<img onerror=x>", status: "in_progress", ownerNames: ["May"], nextAction: "ส่ง draft", activity: { lastActivityAt: "2026-08-29T02:00:00Z" } }],
    baseUrl: "https://timeline.example",
  })
  assert.equal(email.subject, "Hi May <script>")
  assert.match(email.html, /May &lt;script&gt;/)
  assert.doesNotMatch(email.html, /<img onerror=x>/)
  assert.match(email.html, /\?task=sheet%3A1%3At1/)
  assert.equal(taskDeepLink("https://timeline.example", "sheet:1:t1"), "https://timeline.example/?task=sheet%3A1%3At1")
})

test("large owner email keeps counts and view-all while truncating lower-priority details", () => {
  const many = Array.from({ length: 100 }, (_, index) => ({ ...task, taskKey: `sheet:1:${index}`, projectName: "Acme", status: "in_progress", ownerNames: ["May"], nextAction: "Review" }))
  const email = buildNotificationEmail({ template: DEFAULT_NOTIFICATION_TEMPLATES[1], recipientName: "Owner", tasks: many, groups: [{ name: "May", tasks: many, total: 100 }], attentionCount: 100, employeeCount: 1, baseUrl: "https://timeline.example", viewAllPath: "/?view=follow_up" })
  assert.equal((email.html.match(/href="https:\/\/timeline.example\/\?task=/g) || []).length, 80)
  assert.match(email.html, /รายละเอียดที่เหลือดูได้ใน Dashboard/)
  assert.match(email.html, /view=follow_up/)
})

test("Bangkok scheduler runs weekday digest and daily no-activity at exact slots", () => {
  const mondayNine = new Date("2026-08-31T02:00:00.000Z")
  assert.deepEqual(bangkokClock(mondayNine), { weekday: "Mon", time: "09:00", date: "2026-08-31" })
  assert.deepEqual(scheduledType({ daily_enabled: true, daily_time: "09:00", no_activity_enabled: true, no_activity_time: "09:15" }, mondayNine), { daily: true, noActivity: false, businessDate: "2026-08-31" })
  assert.equal(scheduledType({ daily_enabled: true, daily_time: "09:00" }, new Date("2026-08-31T02:08:00.000Z")).daily, true)
  const sunday = new Date("2026-08-30T02:00:00.000Z")
  assert.equal(scheduledType({ daily_enabled: true, daily_time: "09:00" }, sunday).daily, false)
  assert.equal(scheduledType({ no_activity_enabled: true, no_activity_time: "09:15" }, new Date("2026-08-30T02:15:00.000Z")).noActivity, true)
})

test("settings and all template variants are validated", () => {
  assert.equal(validateSettings({ dailyTime: "09:00", noActivityTime: "09:15", dailyEnabled: false, noActivityEnabled: false, manualEnabled: true, senderName: "Timeline", primaryOwnerEmail: null, ownerDigestEmails: [] }), null)
  assert.match(validateSettings({ dailyTime: "09:07" }), /15-minute/)
  assert.match(validateSettings({ dailyTime: "09:00", noActivityTime: "09:15", dailyEnabled: false, noActivityEnabled: false, manualEnabled: false, senderName: "Bad\nName", primaryOwnerEmail: null, ownerDigestEmails: [] }), /sender/)
  assert.equal(validateTemplates(DEFAULT_NOTIFICATION_TEMPLATES), null)
  assert.match(validateTemplates(DEFAULT_NOTIFICATION_TEMPLATES.map((item, index) => index ? item : { ...item, subject: "{{bad_token}}" })), /Unsupported/)
  assert.match(validateTemplateText("{{stale_count}}", { allowedTokens: templateTokensForField("manual:employee", "subject") }), /Unsupported/)
  assert.match(validateTemplates(DEFAULT_NOTIFICATION_TEMPLATES.map((item, index) => index ? item : { ...item, subject: "{{task_name}}" })), /Unsupported/)
})

test("notification migration tracks semantic activity and keeps setup atomic", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20260830100000_notification_system.sql", import.meta.url), "utf8")
  assert.match(sql, /old\.topic, old\.responsibility, old\.due_date, old\.actual_submit, old\.done/)
  assert.doesNotMatch(sql, /changed :=[\s\S]{0,400}source_synced_at/)
  assert.match(sql, /task_reopened/)
  assert.match(sql, /function public\.save_notification_setup\(/)
  assert.match(sql, /task_snapshot jsonb/)
  assert.match(sql, /interval '90 days'/)
})

test("notification setup migration never performs an unqualified preference delete", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20260830103000_fix_notification_preferences_save.sql", import.meta.url), "utf8")
  assert.match(sql, /delete from public\.notification_preferences as preference\s+where not exists/i)
  assert.doesNotMatch(sql, /delete from public\.notification_preferences\s*;/i)
  assert.match(sql, /jsonb_array_elements_text\(coalesce\(p_owner_emails, '\[\]'::jsonb\)\)/i)
})

test("notification recipients and sync metrics use Project assignments", async () => {
  const notifications = await readFile(new URL("../api/_notifications.js", import.meta.url), "utf8")
  const sync = await readFile(new URL("../api/_syncCore.js", import.meta.url), "utf8")
  assert.match(notifications, /brand_workstreams[\s\S]*assignment/)
  assert.match(notifications, /projectByTab/)
  assert.match(notifications, /project\?\.assignment \|\| assignmentByKey/)
  assert.doesNotMatch(notifications, /assignmentByBrand/)
  assert.match(sync, /projectSourceRows/)
  assert.match(sync, /assignmentByProject/)
})

test("notification owners retain legacy assignments while project assignments take precedence", async () => {
  const records = {
    tasks_current: [1, 2, 3].map((gid) => ({ task_key: `sheet:${gid}:task`, spreadsheet_id: "sheet", sheet_gid: gid, client_name: " ACME ", topic: "Task", active: true })),
    brands: [1, 2, 3].map((gid) => ({ tab_key: `sheet:${gid}`, brand_name: " ACME " })),
    assignments: [{ brand_key: "acme", value: { ae: ["Legacy"] } }],
    brand_workstreams: [{ id: "project", brand_name: "Acme", name: "Project", assignment: { ae: ["Project AE"] } }, { id: "empty", assignment: {} }],
    brand_workstream_sources: [{ workstream_id: "project", tab_key: "sheet:2" }, { workstream_id: "empty", tab_key: "sheet:3" }],
    team_members: [{ name: "Legacy", role: "ae" }, { name: "Project AE", role: "ae" }],
    access_list: [{ member_name: "Legacy", email: "legacy@example.com" }, { member_name: "Project AE", email: "project@example.com" }],
  }
  const admin = { from(table) {
    const query = { select() { return this }, eq() { return this }, order() { return this }, range() { return Promise.resolve({ data: records[table] || [] }) }, single() { return Promise.resolve({ data: {} }) } }
    return query
  } }
  const data = await loadNotificationData(admin)
  assert.deepEqual(data.tasks.map((item) => item.ownerNames), [["Legacy"], ["Project AE"], []])
  assert.deepEqual(data.tasks[0].ownerEmails, ["legacy@example.com"])
})
