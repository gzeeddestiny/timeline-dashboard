import { yesterdayWindow, summarizeDigestChanges } from "../src/lib/digestChanges.js"
import { callAppsScript } from "./_appsScript.js"
import { fetchAllRows } from "../src/lib/supabasePages.js"
import { taskOwnerNames } from "../src/lib/teamConfig.js"
import { normalizeBrandKey } from "../src/lib/sharedState.js"
import { bangkokDate } from "../src/lib/dates.js"
import { buildNotificationEmail } from "../src/lib/notificationFormat.js"
import {
  DIGEST_OWNER_LIMIT,
  DIGEST_PERSONAL_LIMIT,
  digestCategory,
  digestRows,
  isNoActivity,
  manualDuplicateFingerprint,
  notificationDedupeKey,
  templateTokensForField,
  tasksNotCoveredByDigest,
  uniqueTaskCount,
  validateTemplateText,
} from "../src/lib/notifications.js"

const CLOCK_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Bangkok", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
})
const RETRY_MINUTES = [15, 30, 60]

export function bangkokClock(now = new Date()) {
  const parts = CLOCK_FORMATTER.formatToParts(now)
  const value = (type) => parts.find((part) => part.type === type)?.value
  return { weekday: value("weekday"), time: `${value("hour")}:${value("minute")}`, date: bangkokDate(now) }
}

export function scheduledType(settings, now = new Date()) {
  const clock = bangkokClock(now)
  const [hour, minute] = clock.time.split(":").map(Number)
  const slotTime = `${String(hour).padStart(2, "0")}:${String(minute - (minute % 15)).padStart(2, "0")}`
  const dailyTime = String(settings?.daily_time || "09:00").slice(0, 5)
  const noActivityTime = String(settings?.no_activity_time || "09:15").slice(0, 5)
  return {
    daily: settings?.daily_enabled === true && !["Sat", "Sun"].includes(clock.weekday) && slotTime === dailyTime,
    noActivity: settings?.no_activity_enabled === true && slotTime === noActivityTime,
    businessDate: clock.date,
  }
}

export function validateSettings(body) {
  const quarterHour = /^([01]\d|2[0-3]):(00|15|30|45)$/
  if (!body || !quarterHour.test(body.dailyTime || "") || !quarterHour.test(body.noActivityTime || "")) return "Times must use 15-minute increments"
  if (typeof body.dailyEnabled !== "boolean" || typeof body.noActivityEnabled !== "boolean" || typeof body.manualEnabled !== "boolean") return "Invalid notification switches"
  if (typeof body.senderName !== "string" || !body.senderName.trim() || body.senderName.length > 100 || /[\r\n]/.test(body.senderName)) return "Invalid sender name"
  if (body.primaryOwnerEmail !== null && body.primaryOwnerEmail !== undefined && (typeof body.primaryOwnerEmail !== "string" || !body.primaryOwnerEmail.includes("@"))) return "Invalid Primary Owner"
  if (!Array.isArray(body.ownerDigestEmails) || body.ownerDigestEmails.some((email) => typeof email !== "string" || !email.includes("@"))) return "Invalid Owner recipients"
  return null
}

export function validateTemplates(templates) {
  if (!Array.isArray(templates) || templates.length !== 4) return "All four template variants are required"
  const keys = new Set()
  for (const template of templates) {
    const key = `${template.templateType}:${template.audience}`
    if (!new Set(["daily_digest:employee", "daily_digest:owner", "no_activity:employee", "manual:employee"]).has(key) || keys.has(key)) return "Invalid template variant"
    keys.add(key)
    for (const [field, maxLength] of [["subject", 200], ["greeting", 500], ["intro", 1000], ["reminder", 1000], ["description", 1000], ["closing", 1000]]) {
      const error = validateTemplateText(template[field], { maxLength, allowedTokens: templateTokensForField(key, field) })
      if (error || (field === "subject" && !template[field])) return error || "Template subject is required"
      if (field === "subject" && /[\r\n]/.test(template[field])) return "Template subject must use one line"
    }
  }
  return null
}

function templateRecord(row) {
  return {
    templateType: row.template_type,
    audience: row.audience,
    subject: row.subject,
    greeting: row.greeting,
    intro: row.intro,
    reminder: row.reminder,
    description: row.description,
    closing: row.closing,
    updatedBy: row.updated_by_email,
    updatedAt: row.updated_at,
  }
}

export async function loadNotificationData(admin) {
  const [tasks, workflow, activity, members, access, brands, projects, projectSources, settings, templates, preferences, assignments] = await Promise.all([
    fetchAllRows((from, to) => admin.from("tasks_current").select("*").eq("active", true).order("task_key").range(from, to)),
    fetchAllRows((from, to) => admin.from("task_workflow").select("task_key,status,note,priority,next_action,updated_at").order("task_key").range(from, to)),
    fetchAllRows((from, to) => admin.from("task_activity_state").select("*").order("task_key").range(from, to)),
    fetchAllRows((from, to) => admin.from("team_members").select("name,role,avatar").order("name").range(from, to)),
    fetchAllRows((from, to) => admin.from("access_list").select("email,role,member_name,active").eq("active", true).order("email").range(from, to)),
    fetchAllRows((from, to) => admin.from("brands").select("tab_key,brand_name").order("tab_key").range(from, to)),
    fetchAllRows((from, to) => admin.from("brand_workstreams").select("id,brand_name,name,assignment").eq("active", true).order("id").range(from, to)),
    fetchAllRows((from, to) => admin.from("brand_workstream_sources").select("workstream_id,tab_key").order("tab_key").range(from, to)),
    admin.from("notification_settings").select("*").eq("id", true).single(),
    fetchAllRows((from, to) => admin.from("notification_templates").select("*").order("template_type").order("audience").range(from, to)),
    fetchAllRows((from, to) => admin.from("notification_preferences").select("email,owner_digest_enabled").range(from, to)),
    fetchAllRows((from, to) => admin.from("assignments").select("brand_key,value").order("brand_key").range(from, to)),
  ])
  if (settings.error) throw settings.error
  const workflowByTask = new Map(workflow.map((row) => [row.task_key, row]))
  const activityByTask = new Map(activity.map((row) => [row.task_key, row]))
  const brandByTab = new Map(brands.map((row) => [row.tab_key, row.brand_name]))
  const assignmentByKey = new Map(assignments.map((row) => [row.brand_key, row.value]))
  const projectById = new Map(projects.map((row) => [row.id, row]))
  const projectByTab = new Map(projectSources.flatMap((source) => {
    const project = projectById.get(source.workstream_id)
    return project ? [[source.tab_key, project]] : []
  }))
  const accessByMember = new Map(access.filter((entry) => entry.member_name).map((entry) => [entry.member_name.toLocaleLowerCase("th-TH"), entry]))
  const enrichedTasks = tasks.map((row) => {
    const task = {
      taskKey: row.task_key,
      spreadsheetId: row.spreadsheet_id,
      sheetGid: Number(row.sheet_gid),
      taskId: row.task_id,
      clientName: row.client_name,
      topic: row.topic,
      responsibility: row.responsibility || "",
      dueDate: row.due_date || "",
      actualSubmit: row.actual_submit || "",
      done: row.done,
      active: row.active,
    }
    const tabKey = `${row.spreadsheet_id}:${row.sheet_gid}`
    const project = projectByTab.get(tabKey)
    const brandName = project?.brand_name || brandByTab.get(tabKey) || row.client_name
    const projectName = project ? `${brandName} · ${project.name}` : brandName
    const assignment = project?.assignment || assignmentByKey.get(tabKey) || assignmentByKey.get(normalizeBrandKey(brandName)) || assignmentByKey.get(brandName) || assignmentByKey.get(row.client_name) || {}
    const ownerNames = taskOwnerNames(task, members, assignment)
    const ownerEmails = ownerNames.flatMap((name) => accessByMember.get(name.toLocaleLowerCase("th-TH"))?.email || [])
    const flow = workflowByTask.get(row.task_key) || {}
    const state = activityByTask.get(row.task_key)
    return {
      ...task,
      brandName,
      projectName,
      projectId: project?.id || null,
      ownerNames,
      ownerEmails,
      shared: ownerNames.length > 1,
      status: flow.status || "not_started",
      note: flow.note || "",
      priority: flow.priority || "",
      nextAction: flow.next_action || "",
      activity: state ? {
        firstSeenAt: state.first_seen_at,
        historyGap: state.history_gap || null,
        lastActionChanges: state.last_action_changes || {},
        lastActivityAt: state.last_activity_at,
        lastActivityKind: state.last_activity_kind,
        lastActivitySource: state.last_activity_source,
        lastActivityActorEmail: state.last_activity_actor_email,
        snoozedUntil: state.snoozed_until,
        snoozeReason: state.snooze_reason,
        resumedAt: state.resumed_at || null,
        lastActivityActorInferred: Boolean(state.last_activity_actor_inferred),
      } : null,
    }
  })
  return {
    tasks: enrichedTasks,
    members,
    access,
    settings: settings.data,
    templates: templates.map(templateRecord),
    preferences,
    ownerDigestEmails: new Set(preferences.filter((row) => row.owner_digest_enabled).map((row) => row.email.toLowerCase())),
  }
}

export function notificationDataIssues(data) {
  return data.tasks.filter((task) => !task.done).flatMap((task) => {
    const issues = []
    if (task.activity?.historyGap) issues.push(task.activity.historyGap)
    if (task.ownerNames.length === 0) issues.push("ไม่มีผู้รับผิดชอบ")
    else if (task.ownerEmails.length === 0) issues.push("ผู้รับผิดชอบไม่มี Active email")
    if (["in_progress", "waiting_client", "blocked"].includes(task.status) && !task.nextAction) issues.push("ไม่มี Next Action")
    return issues.length ? [{ taskKey: task.taskKey, brandName: task.brandName, projectName: task.projectName, taskName: task.topic, issues }] : []
  })
}

function templateFor(data, type, audience = "employee") {
  const template = data.templates.find((item) => item.templateType === type && item.audience === audience)
  if (!template) throw new Error(`Notification template is missing: ${type}/${audience}`)
  return template
}

function appUrl() {
  return process.env.APP_URL || process.env.TIMELINE_DASHBOARD_URL || "https://timeline-dashboard-rose.vercel.app"
}

function taskSnapshot(task) {
  return {
    taskKey: task.taskKey,
    brandName: task.brandName,
    projectName: task.projectName,
    taskName: task.topic,
    status: task.status,
    ownerNames: task.ownerNames,
    deadline: task.dueDate || null,
    lastUpdate: task.activity?.lastActivityAt || null,
    lastActivityKind: task.activity?.lastActivityKind || null,
    nextAction: task.nextAction || "",
    shared: task.shared === true,
  }
}

async function insertBatch(admin, batch, { email = true, inApp = false, message = "" } = {}) {
  const inserted = await admin.from("notification_batches").insert(batch).select("*").single()
  let savedBatch
  let created = true
  if (inserted.error?.code === "23505") {
    const existing = await admin.from("notification_batches").select("*").eq("dedupe_key", batch.dedupe_key).single()
    if (existing.error) throw existing.error
    savedBatch = existing.data
    created = false
  }
  else if (inserted.error) throw inserted.error
  else savedBatch = inserted.data
  const deliveries = []
  if (email) deliveries.push({ batch_id: savedBatch.id, channel: "email", priority: batch.type === "manual" ? 1 : batch.type === "no_activity" ? 5 : 10 })
  if (inApp) deliveries.push({ batch_id: savedBatch.id, channel: "in_app", priority: 1, status: "sent", attempts: 1, sent_at: new Date().toISOString() })
  if (deliveries.length) {
    const saved = await admin.from("notification_deliveries").upsert(deliveries, { onConflict: "batch_id,channel", ignoreDuplicates: true })
    if (saved.error) throw saved.error
  }
  if (inApp) {
    const notification = await admin.from("notifications").upsert({
      recipient_email: batch.recipient_email,
      type: batch.type === "manual" ? "manual_batch" : "no_activity_batch",
      batch_id: savedBatch.id,
      notification_key: `batch:${savedBatch.id}`,
      message,
      payload: { taskKeys: batch.task_keys, type: batch.type },
    }, { onConflict: "notification_key", ignoreDuplicates: true })
    if (notification.error) throw notification.error
  }
  return { batch: savedBatch, created }
}

function ownerTasks(data, memberName) {
  const normalized = String(memberName || "").toLocaleLowerCase("th-TH")
  return data.tasks.filter((task) => task.ownerNames.some((name) => name.toLocaleLowerCase("th-TH") === normalized))
}

export async function loadYesterdayChanges(admin, now = new Date()) {
  const { start, end } = yesterdayWindow(now)
  return fetchAllRows((from, to) => admin.from("action_events").select("*")
    .gte("occurred_at", start).lt("occurred_at", end)
    .order("occurred_at").order("id").range(from, to))
}

export async function generateDailyDigest(admin, data, now = new Date()) {
  const businessDate = bangkokDate(now)
  const events = await loadYesterdayChanges(admin, now)
  const companyChanges = summarizeDigestChanges(events, data.tasks, { now })
  const templateEmployee = templateFor(data, "daily_digest", "employee")
  const templateOwner = templateFor(data, "daily_digest", "owner")
  const results = []
  for (const recipient of data.access.filter((entry) => entry.member_name && !data.ownerDigestEmails.has(entry.email.toLowerCase()))) {
    const selected = digestRows(ownerTasks(data, recipient.member_name), {}, businessDate, DIGEST_PERSONAL_LIMIT)
    const changes = summarizeDigestChanges(events, ownerTasks(data, recipient.member_name), { now, personal: true, limit: 20 })
    if (!selected.total && !changes.total) continue
    const tasks = selected.rows.map((task) => ({ ...task, noActivity: isNoActivity(task.activity, task, now) }))
    const email = buildNotificationEmail({ changes, template: templateEmployee, recipientName: recipient.member_name, tasks, baseUrl: appUrl(), viewAllPath: "/?view=my", attentionCount: selected.total, digestDate: businessDate, now })
    results.push(await insertBatch(admin, {
      type: "daily_digest", audience: "employee", recipient_email: recipient.email, business_date: businessDate,
      task_keys: tasks.map((task) => task.taskKey), task_snapshot: tasks.map(taskSnapshot), payload: { email, changes, total: selected.total, truncated: selected.truncated },
      template_snapshot: templateEmployee, dedupe_key: notificationDedupeKey("daily_digest", "employee", recipient.email, businessDate),
    }))
  }

  const issues = notificationDataIssues(data)
  const groups = data.access.filter((entry) => entry.member_name).flatMap((entry) => {
    const selected = digestRows(ownerTasks(data, entry.member_name), {}, businessDate, DIGEST_OWNER_LIMIT)
    return selected.total ? [{ name: entry.member_name, tasks: selected.rows.map((task) => ({ ...task, noActivity: isNoActivity(task.activity, task, now) })), total: selected.total, truncated: selected.truncated }] : []
  })
  const uniqueAttention = uniqueTaskCount(data.tasks.filter((task) => digestCategory(task, task.status, businessDate)))
  if (groups.length || issues.length || companyChanges.total) for (const owner of data.access.filter((entry) => entry.role === "admin" && data.ownerDigestEmails.has(entry.email.toLowerCase()))) {
    const displayedTasks = groups.flatMap((group) => group.tasks)
    const email = buildNotificationEmail({ changes: companyChanges, template: templateOwner, recipientName: owner.member_name || owner.email, tasks: displayedTasks, groups, dataIssues: issues, baseUrl: appUrl(), viewAllPath: "/?view=follow_up", employeeCount: groups.length, attentionCount: uniqueAttention, digestDate: businessDate, now })
    results.push(await insertBatch(admin, {
      type: "daily_digest", audience: "owner", recipient_email: owner.email, business_date: businessDate,
      task_keys: [...new Set(displayedTasks.map((task) => task.taskKey))], task_snapshot: displayedTasks.map(taskSnapshot), payload: { email, changes: companyChanges, groups, dataIssues: issues, attentionCount: uniqueAttention },
      template_snapshot: templateOwner, dedupe_key: notificationDedupeKey("daily_digest", "owner", owner.email, businessDate),
    }))
  }
  return results
}

export async function generateNoActivity(admin, data, now = new Date()) {
  const businessDate = bangkokDate(now)
  const template = templateFor(data, "no_activity", "employee")
  const results = []
  for (const recipient of data.access.filter((entry) => entry.member_name)) {
    const stale = ownerTasks(data, recipient.member_name).filter((task) => isNoActivity(task.activity, task, now))
    if (!stale.length) continue
    const digest = await admin.from("notification_batches")
      .select("task_keys,notification_deliveries!inner(status)")
      .eq("recipient_email", recipient.email).eq("business_date", businessDate).eq("type", "daily_digest")
      .in("notification_deliveries.status", ["queued", "sending", "sent", "unknown"])
    if (digest.error) throw digest.error
    const emailTasks = tasksNotCoveredByDigest(stale, digest.data, DIGEST_PERSONAL_LIMIT).map((task) => ({ ...task, noActivity: true }))
    const email = emailTasks.length ? buildNotificationEmail({ template, recipientName: recipient.member_name, tasks: emailTasks, baseUrl: appUrl(), viewAllPath: "/?view=my&attention=no_activity", staleCount: stale.length, now }) : null
    results.push(await insertBatch(admin, {
      type: "no_activity", audience: "employee", recipient_email: recipient.email, business_date: businessDate,
      task_keys: stale.map((task) => task.taskKey), task_snapshot: stale.map(taskSnapshot), payload: { email, total: stale.length, emailTaskKeys: emailTasks.map((task) => task.taskKey) },
      template_snapshot: template, dedupe_key: notificationDedupeKey("no_activity", "employee", recipient.email, businessDate),
    }, { email: Boolean(email), inApp: true, message: `${stale.length} งานไม่มี Activity ใหม่ครบ 5 วัน` }))
  }
  return results
}

export async function createManualNotifications(admin, data, { projectName, taskKeys, recipientEmails, customMessage, actorId, forceDuplicate = false }, now = new Date()) {
  const tasks = data.tasks.filter((task) => task.projectName === projectName && taskKeys.includes(task.taskKey) && !task.done)
  if (tasks.length !== taskKeys.length || tasks.length < 1 || tasks.length > 20) throw Object.assign(new Error("Invalid manual task selection"), { status: 400 })
  const recipients = data.access.filter((entry) => recipientEmails.includes(entry.email))
  if (recipients.length !== recipientEmails.length || recipients.length < 1 || recipients.length > 50) throw Object.assign(new Error("Invalid manual recipients"), { status: 400 })
  const fingerprint = manualDuplicateFingerprint(projectName, taskKeys, recipientEmails)
  const recent = await admin.from("notification_batches").select("id,created_at").eq("type", "manual").eq("duplicate_fingerprint", fingerprint).gte("created_at", new Date(now.getTime() - 10 * 60 * 1000).toISOString()).limit(1)
  if (recent.error) throw recent.error
  if (recent.data?.length && !forceDuplicate) throw Object.assign(new Error("Manual notification was sent to this selection in the last 10 minutes"), { status: 409, duplicate: true })
  const template = templateFor(data, "manual", "employee")
  const nonce = forceDuplicate ? `force:${now.toISOString()}:${actorId}` : `${Math.floor(now.getTime() / 600_000)}:${fingerprint}`
  const results = []
  for (const recipient of recipients) {
    const email = buildNotificationEmail({ template, recipientName: recipient.member_name || recipient.email, tasks, projectName, baseUrl: appUrl(), viewAllPath: "/?view=my", customMessage, now })
    results.push(await insertBatch(admin, {
      type: "manual", audience: "employee", recipient_email: recipient.email, business_date: bangkokDate(now),
      task_keys: tasks.map((task) => task.taskKey), task_snapshot: tasks.map(taskSnapshot), payload: { email, total: tasks.length }, template_snapshot: template,
      custom_message: customMessage || null, duplicate_fingerprint: fingerprint, triggered_by: actorId,
      dedupe_key: notificationDedupeKey("manual", "employee", recipient.email, bangkokDate(now), `${nonce}:${tasks.map((task) => task.taskKey).join(",")}`),
    }, { email: true, inApp: true, message: `ติดตาม ${projectName} · ${tasks.length} งาน${customMessage ? ` — ${customMessage}` : ""}` }))
  }
  return results
}

async function notifyOwnersOfDeliveryFailure(admin, delivery, status, error) {
  const owners = await admin.from("notification_preferences").select("email").eq("owner_digest_enabled", true)
  if (owners.error) throw owners.error
  if (!owners.data?.length) return
  const rows = owners.data.map((owner) => ({
    recipient_email: owner.email, type: "delivery_failure", notification_key: `delivery:${delivery.id}:${status}:${owner.email}`,
    message: `Email ${status}: ${error || delivery.id}`, payload: { deliveryId: delivery.id, status },
  }))
  const saved = await admin.from("notifications").upsert(rows, { onConflict: "notification_key", ignoreDuplicates: true })
  if (saved.error) throw saved.error
}

export async function processNotificationQueue(admin) {
  const abandoned = await admin.from("notification_deliveries")
    .select("id,batch_id,attempts")
    .eq("channel", "email").eq("status", "sending")
    .lt("updated_at", new Date(Date.now() - 10 * 60_000).toISOString())
    .limit(100)
  if (abandoned.error) throw abandoned.error
  for (const delivery of abandoned.data || []) {
    const error = "Worker stopped before MailApp confirmed the result"
    const marked = await admin.from("notification_deliveries").update({ status: "unknown", last_error: error, updated_at: new Date().toISOString() }).eq("id", delivery.id)
    if (marked.error) throw marked.error
    await notifyOwnersOfDeliveryFailure(admin, delivery, "unknown", error)
  }
  const claimed = await admin.rpc("claim_notification_deliveries", { p_limit: 100 })
  if (claimed.error) throw claimed.error
  if (!claimed.data?.length) return { claimed: 0, sent: 0, failed: 0, unknown: abandoned.data?.length || 0 }
  const batchIds = [...new Set(claimed.data.map((delivery) => delivery.batch_id))]
  const batches = await admin.from("notification_batches").select("id,recipient_email,payload").in("id", batchIds)
  if (batches.error) throw batches.error
  const byId = new Map(batches.data.map((batch) => [batch.id, batch]))
  const deliverable = claimed.data.flatMap((delivery) => {
    const batch = byId.get(delivery.batch_id)
    const email = batch?.payload?.email
    return email ? [{ deliveryId: delivery.id, to: batch.recipient_email, ...email }] : []
  })
  if (!deliverable.length) {
    const error = "Email payload is missing"
    const marked = await admin.from("notification_deliveries").update({ status: "failed", last_error: error, updated_at: new Date().toISOString() }).in("id", claimed.data.map((item) => item.id))
    if (marked.error) throw marked.error
    for (const delivery of claimed.data) await notifyOwnersOfDeliveryFailure(admin, delivery, "failed", error)
    return { claimed: claimed.data.length, sent: 0, failed: claimed.data.length, unknown: 0 }
  }
  let result
  try {
    const settings = await admin.from("notification_settings").select("sender_name,primary_owner_email").eq("id", true).single()
    if (settings.error) throw settings.error
    result = await callAppsScript({
      action: "send_email_batch", messages: deliverable,
      senderName: settings.data.sender_name,
      replyTo: settings.data.primary_owner_email || undefined,
    }, { timeoutMs: 55_000 })
  } catch (error) {
    const status = error.ambiguous ? "unknown" : "queued"
    for (const delivery of claimed.data) {
      if (status === "unknown") {
        await admin.from("notification_deliveries").update({ status, last_error: error.message, updated_at: new Date().toISOString() }).eq("id", delivery.id)
        await notifyOwnersOfDeliveryFailure(admin, delivery, status, error.message)
      } else await scheduleKnownFailure(admin, delivery, error.message)
    }
    return { claimed: claimed.data.length, sent: 0, failed: status === "unknown" ? 0 : claimed.data.length, unknown: status === "unknown" ? claimed.data.length : 0 }
  }
  let sent = 0; let failed = 0
  const resultById = new Map((result.results || []).map((item) => [item.deliveryId, item]))
  for (const delivery of claimed.data) {
    const item = resultById.get(delivery.id)
    if (item?.status === "sent") {
      sent += 1
      await admin.from("notification_deliveries").update({ status: "sent", sent_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString() }).eq("id", delivery.id)
    } else {
      failed += 1
      await scheduleKnownFailure(admin, delivery, item?.error || "MailApp did not confirm the delivery")
    }
  }
  return { claimed: claimed.data.length, sent, failed, unknown: 0, quotaRemaining: result.quotaRemaining }
}

async function scheduleKnownFailure(admin, delivery, error) {
  if (delivery.attempts >= 4) {
    await admin.from("notification_deliveries").update({ status: "failed", last_error: error, updated_at: new Date().toISOString() }).eq("id", delivery.id)
    await notifyOwnersOfDeliveryFailure(admin, delivery, "failed", error)
    return
  }
  const minutes = RETRY_MINUTES[Math.max(0, delivery.attempts - 1)] || 60
  await admin.from("notification_deliveries").update({ status: "queued", next_attempt_at: new Date(Date.now() + minutes * 60_000).toISOString(), last_error: error, updated_at: new Date().toISOString() }).eq("id", delivery.id)
}
