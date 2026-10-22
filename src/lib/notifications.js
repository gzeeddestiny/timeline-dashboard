import { bangkokDate, daysFrom } from "./dates.js"

export const NOTIFICATION_TIME_ZONE = "Asia/Bangkok"
export const NO_ACTIVITY_MS = 120 * 60 * 60 * 1000
export const DIGEST_PERSONAL_LIMIT = 20
export const DIGEST_OWNER_LIMIT = 10
export const MANUAL_TASK_LIMIT = 20

export const DEFAULT_NOTIFICATION_TEMPLATES = [
  {
    templateType: "daily_digest",
    audience: "employee",
    subject: "[Daily Digest] {{employee_name}} — {{attention_count}} งานที่ต้องติดตาม",
    greeting: "สวัสดี {{employee_name}}",
    intro: "สรุปงานที่ต้องติดตามประจำวันที่ {{digest_date}}",
    reminder: "กรุณาตรวจสอบ Deadline, Last Update และ Next Action ของแต่ละงาน",
    description: "รายการเรียงจากงานที่เร่งด่วนที่สุด",
    closing: "เปิด Dashboard เพื่อดูรายละเอียดและอัปเดตความคืบหน้า",
  },
  {
    templateType: "daily_digest",
    audience: "owner",
    subject: "[Company Daily Digest] {{employee_count}} คน · {{attention_count}} งาน",
    greeting: "สวัสดี {{employee_name}}",
    intro: "ภาพรวมงานที่ต้องติดตามทั้งบริษัทประจำวันที่ {{digest_date}}",
    reminder: "ตรวจสอบงาน Overdue, ใกล้ Deadline และงานที่ไม่มีความคืบหน้า",
    description: "รายการจัดกลุ่มตามพนักงานและเรียงตามความเร่งด่วน",
    closing: "เปิด Follow-up เพื่อดูรายการทั้งหมด",
  },
  {
    templateType: "no_activity",
    audience: "employee",
    subject: "[No Activity] {{employee_name}} — {{stale_count}} งานไม่มีความคืบหน้า",
    greeting: "สวัสดี {{employee_name}}",
    intro: "พบงานที่ไม่มี Activity ใหม่ครบ 5 วัน",
    reminder: "กรุณาอัปเดต Status, Note หรือ Next Action หากงานมีความคืบหน้า",
    description: "หากกำลังรอลูกค้าหรือติดข้อจำกัด สามารถ Snooze พร้อมระบุเหตุผลได้",
    closing: "เปิด My Work เพื่อจัดการรายการทั้งหมด",
  },
  {
    templateType: "manual",
    audience: "employee",
    subject: "[ติดตามงาน] {{project_name}} — {{task_count}} งาน",
    greeting: "สวัสดี {{employee_name}}",
    intro: "มีรายการงานที่ต้องการติดตามเพิ่มเติม",
    reminder: "กรุณาตรวจสอบรายละเอียดและ Next Action",
    description: "ข้อความนี้ส่งโดยผู้ดูแลระบบ",
    closing: "เปิด Dashboard เพื่อดูรายละเอียดงาน",
  },
]

const TOKEN_PATTERN = /{{\s*([a-z_]+)\s*}}/g
export const TEMPLATE_TOKENS = new Set([
  "employee_name", "employee_count", "attention_count", "stale_count", "project_name",
  "task_name", "task_count", "deadline", "days_overdue", "days_since_update", "digest_date",
])

const TASK_TOKENS = ["project_name", "task_name", "task_count", "deadline", "days_overdue", "days_since_update"]
export const TEMPLATE_TOKEN_SCOPES = {
  "daily_digest:employee": new Set(["employee_name", "attention_count", "digest_date", ...TASK_TOKENS]),
  "daily_digest:owner": new Set(["employee_name", "employee_count", "attention_count", "digest_date", ...TASK_TOKENS]),
  "no_activity:employee": new Set(["employee_name", "stale_count", "digest_date", ...TASK_TOKENS]),
  "manual:employee": new Set(["employee_name", ...TASK_TOKENS]),
}

const SUBJECT_TOKEN_SCOPES = {
  "daily_digest:employee": new Set(["employee_name", "attention_count"]),
  "daily_digest:owner": new Set(["employee_count", "attention_count"]),
  "no_activity:employee": new Set(["employee_name", "stale_count"]),
  "manual:employee": new Set(["project_name", "task_count"]),
}

export function templateTokensForField(templateKey, field) {
  if (field === "subject") return SUBJECT_TOKEN_SCOPES[templateKey] || new Set()
  if (field === "greeting") return new Set(["employee_name"])
  return TEMPLATE_TOKEN_SCOPES[templateKey] || new Set()
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
}

export function templateTokens(value) {
  return [...String(value || "").matchAll(TOKEN_PATTERN)].map((match) => match[1])
}

export function validateTemplateText(value, { maxLength = 1000, allowedTokens = TEMPLATE_TOKENS } = {}) {
  if (typeof value !== "string" || value.length > maxLength) return "Invalid template text"
  const bracesRemoved = value.replace(TOKEN_PATTERN, "")
  if (bracesRemoved.includes("{{") || bracesRemoved.includes("}}")) return "Malformed template token"
  const invalid = templateTokens(value).find((token) => !allowedTokens.has(token))
  return invalid ? `Unsupported template token: ${invalid}` : null
}

export function renderTemplateText(value, variables = {}) {
  return String(value || "").replace(TOKEN_PATTERN, (_, token) => String(variables[token] ?? "—"))
}

export function activityAgeMs(lastActivityAt, now = new Date()) {
  const timestamp = new Date(lastActivityAt || 0).getTime()
  const current = now instanceof Date ? now.getTime() : new Date(now).getTime()
  return Number.isFinite(timestamp) && Number.isFinite(current) ? Math.max(0, current - timestamp) : null
}

export function daysSinceActivity(lastActivityAt, now = new Date()) {
  const age = activityAgeMs(lastActivityAt, now)
  return age === null ? null : Math.floor(age / 86_400_000)
}

export function isNoActivity(state, task, now = new Date()) {
  if (!task || task.done || task.active === false || !state?.lastActivityAt) return false
  const snoozedUntil = state.snoozedUntil ? new Date(`${state.snoozedUntil}T23:59:59+07:00`) : null
  if (snoozedUntil && snoozedUntil.getTime() >= new Date(now).getTime()) return false
  return activityAgeMs(state.lastActivityAt, now) >= NO_ACTIVITY_MS
}

export function digestCategory(task, status = "not_started", today = bangkokDate()) {
  if (!task || task.done || task.active === false) return null
  const due = daysFrom(task.dueDate, today)
  if (due !== null && due < 0) return "overdue"
  if (due !== null && due <= 3) return "due_soon"
  if (status === "blocked") return "blocked"
  if (status === "waiting_client") return "waiting_client"
  if (status === "in_progress") return "in_progress"
  return null
}

const CATEGORY_ORDER = new Map([
  ["overdue", 0], ["due_soon", 1], ["blocked", 2], ["waiting_client", 2], ["in_progress", 3],
])

export function digestRows(tasks, workflow = {}, today = bangkokDate(), limit = DIGEST_PERSONAL_LIMIT) {
  const rows = tasks.flatMap((task) => {
    const key = task.taskKey || task.task_key
    const category = digestCategory(task, workflow[key] || task.status || "not_started", today)
    return category ? [{ ...task, taskKey: key, category }] : []
  })
  rows.sort((a, b) =>
    (CATEGORY_ORDER.get(a.category) ?? 9) - (CATEGORY_ORDER.get(b.category) ?? 9) ||
    (daysFrom(a.dueDate, today) ?? Number.MAX_SAFE_INTEGER) - (daysFrom(b.dueDate, today) ?? Number.MAX_SAFE_INTEGER) ||
    String(a.projectName || a.clientName || "").localeCompare(String(b.projectName || b.clientName || ""), "th") ||
    String(a.topic || "").localeCompare(String(b.topic || ""), "th")
  )
  return { rows: rows.slice(0, limit), total: rows.length, truncated: rows.length > limit }
}

export function notificationDedupeKey(type, audience, recipientEmail, businessDate, suffix = "") {
  return [type, audience || "employee", String(recipientEmail || "").toLowerCase(), businessDate, suffix].filter(Boolean).join(":")
}

export function uniqueTaskCount(tasks = []) {
  return new Set(tasks.map((task) => task.taskKey || task.task_key).filter(Boolean)).size
}

export function tasksNotCoveredByDigest(staleTasks, digestBatches, limit = DIGEST_PERSONAL_LIMIT) {
  const covered = new Set((digestBatches || []).flatMap((batch) => batch.task_keys || batch.taskKeys || []))
  return (staleTasks || []).filter((task) => !covered.has(task.taskKey || task.task_key)).slice(0, limit)
}

export function manualDuplicateFingerprint(projectName, taskKeys, recipientEmails) {
  return [
    String(projectName || "").trim().toLocaleLowerCase("th-TH"),
    [...new Set(taskKeys || [])].sort().join(","),
    [...new Set((recipientEmails || []).map((email) => String(email).toLowerCase()))].sort().join(","),
  ].join("|")
}
