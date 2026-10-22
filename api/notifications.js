import { summarizeDigestChanges, yesterdayWindow } from "../src/lib/digestChanges.js"
import { randomUUID } from "node:crypto"
import { callAppsScript } from "./_appsScript.js"
import { sameOrigin, send, userContext } from "./_supabase.js"
import {
  createManualNotifications,
  loadNotificationData,
  loadYesterdayChanges,
  notificationDataIssues,
  processNotificationQueue,
  validateSettings,
  validateTemplates,
} from "./_notifications.js"
import { buildNotificationEmail } from "../src/lib/notificationFormat.js"
import { bangkokDate, daysFrom, validIsoDate } from "../src/lib/dates.js"
import { daysSinceActivity, digestCategory, isNoActivity } from "../src/lib/notifications.js"
import { fetchAllRows } from "../src/lib/supabasePages.js"

export const config = { maxDuration: 60 }

function requireAdmin(context, response) {
  if (context.access?.role === "admin") return false
  send(response, 403, { error: "Admin access required" })
  return true
}

function normalizedSettings(data) {
  const settings = data.settings
  return {
    dailyEnabled: settings.daily_enabled,
    noActivityEnabled: settings.no_activity_enabled,
    manualEnabled: settings.manual_enabled,
    dailyTime: String(settings.daily_time).slice(0, 5),
    noActivityTime: String(settings.no_activity_time).slice(0, 5),
    timezone: settings.timezone,
    senderName: settings.sender_name,
    primaryOwnerEmail: settings.primary_owner_email,
    testEmailSentAt: settings.test_email_sent_at,
    updatedAt: settings.updated_at,
  }
}

function publicTask(task, now = new Date()) {
  return {
    taskKey: task.taskKey,
    brandName: task.brandName,
    projectName: task.projectName,
    taskName: task.topic,
    status: task.status,
    ownerNames: task.ownerNames,
    ownerEmails: task.ownerEmails,
    dueDate: task.dueDate,
    daysOverdue: task.dueDate && daysFrom(task.dueDate) < 0 ? Math.abs(daysFrom(task.dueDate)) : 0,
    nextAction: task.nextAction,
    activity: task.activity,
    daysSinceUpdate: task.activity?.lastActivityAt ? daysSinceActivity(task.activity.lastActivityAt, now) : null,
    noActivity: isNoActivity(task.activity, task, now),
  }
}

async function settingsResponse(context) {
  const data = await loadNotificationData(context.admin)
  let health
  try {
    const result = await callAppsScript({ action: "email_health" })
    health = { status: "ready", senderEmail: result.senderEmail, quotaRemaining: result.quotaRemaining }
  } catch (error) { health = { status: error.ambiguous ? "unknown" : "failed", error: error.message } }
  const deliveries = await context.admin.from("notification_deliveries").select("status,sent_at,created_at").gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
  if (deliveries.error) throw deliveries.error
  const deliveryCounts = (deliveries.data || []).reduce((counts, row) => ({ ...counts, [row.status]: (counts[row.status] || 0) + 1 }), {})
  const now = new Date()
  const businessDate = bangkokDate(now)
  const digestTasks = data.tasks.filter((task) => digestCategory(task, task.status, businessDate))
  const staleTasks = data.tasks.filter((task) => isNoActivity(task.activity, task, now))
  const ownsAny = (entry, tasks) => entry.member_name && tasks.some((task) => task.ownerNames.some((name) => name.toLocaleLowerCase("th-TH") === entry.member_name.toLocaleLowerCase("th-TH")))
  const events = await loadYesterdayChanges(context.admin, now)
  const changes = summarizeDigestChanges(events, data.tasks, { now })
  const changedKeys = new Set(events.filter((event) => summarizeDigestChanges([event], data.tasks, { now }).total).flatMap((event) => event.task_keys))
  const digestOrChangedTasks = data.tasks.filter((task) => changedKeys.has(task.taskKey) || digestTasks.includes(task))
  const personalDigestRecipients = data.access.filter((entry) => !data.ownerDigestEmails.has(entry.email.toLowerCase()) && ownsAny(entry, digestOrChangedTasks)).length
  const issueCount = notificationDataIssues(data).length
  const ownerDigestRecipients = digestTasks.length || issueCount || changes.total ? data.access.filter((entry) => entry.role === "admin" && data.ownerDigestEmails.has(entry.email.toLowerCase())).length : 0
  const staleRecipients = data.access.filter((entry) => ownsAny(entry, staleTasks)).length
  const lastSuccessfulRun = (deliveries.data || []).filter((row) => row.status === "sent").map((row) => row.sent_at || row.created_at).sort().at(-1) || null
  return {
    settings: normalizedSettings(data),
    templates: data.templates,
    ownerDigestEmails: [...data.ownerDigestEmails],
    adminOptions: data.access.filter((entry) => entry.role === "admin").map((entry) => ({ email: entry.email, memberName: entry.member_name || entry.email })),
    health: { ...health, deliveryCounts, lastSuccessfulRun },
    preflight: {
      daily: { recipients: personalDigestRecipients + ownerDigestRecipients, tasks: new Set(digestTasks.map((task) => task.taskKey)).size, changedTasks: changes.taskCount },
      noActivity: { recipients: staleRecipients, tasks: new Set(staleTasks.map((task) => task.taskKey)).size },
      ownerRecipients: data.ownerDigestEmails.size,
      dataIssues: issueCount,
    },
  }
}

async function handleGet(request, response, context, action) {
  if (action === "settings") {
    if (requireAdmin(context, response)) return
    return send(response, 200, await settingsResponse(context))
  }
  if (action === "history") {
    if (requireAdmin(context, response)) return
    const since = new Date(Date.now() - 90 * 86_400_000).toISOString()
    const history = await fetchAllRows((from, to) => context.admin.from("notification_batches")
      .select("id,type,audience,recipient_email,business_date,task_keys,custom_message,triggered_by,created_at,notification_deliveries(id,channel,status,attempts,last_error,sent_at,updated_at)")
      .gte("created_at", since).order("created_at", { ascending: false }).range(from, to))
    return send(response, 200, { items: history })
  }
  const data = await loadNotificationData(context.admin)
  if (action === "manual-options") {
    if (requireAdmin(context, response)) return
    return send(response, 200, {
      enabled: data.settings.manual_enabled,
      tasks: data.tasks.filter((task) => !task.done).map((task) => publicTask(task)),
      recipients: data.access.map((entry) => ({ email: entry.email, memberName: entry.member_name || entry.email, role: entry.role })),
    })
  }
  if (action === "follow-up") {
    const isAdmin = context.access.role === "admin"
    const visible = isAdmin ? data.tasks : data.tasks.filter((task) => task.ownerEmails.includes(context.access.email))
    const now = new Date()
    const trackingIssues = []
    if (isAdmin) {
      const [sources, health, latest] = await Promise.all([
        context.admin.from('sheets').select('spreadsheet_id').eq('active', true),
        context.admin.from('sheet_activity_health').select('*'),
        context.admin.from('sync_runs').select('status,error,issues,finished_at').order('started_at', { ascending: false }).limit(1).maybeSingle(),
      ])
      if (sources.error || health.error || latest.error) throw sources.error || health.error || latest.error
      for (const source of sources.data) {
        const state = health.data.find((row) => row.spreadsheet_id === source.spreadsheet_id)
        if (!state) trackingIssues.push(`${source.spreadsheet_id}: ยังไม่ได้เปิดรับเหตุการณ์จาก Sheet`)
        else {
          if (Date.now() - Date.parse(state.checked_at) > 5 * 60000) trackingIssues.push(`${source.spreadsheet_id}: ไม่ได้รับสัญญาณการติดตามเกิน 5 นาที`)
          if (state.pending_count) trackingIssues.push(`${source.spreadsheet_id}: รอส่ง ${state.pending_count} เหตุการณ์`)
          if (state.error) trackingIssues.push(`${source.spreadsheet_id}: ${state.error}`)
          const untracked = [...new Set(data.tasks.filter((task) => task.spreadsheetId === source.spreadsheet_id && !state.installed_gids.includes(task.sheetGid)).map((task) => task.sheetGid))]
          if (untracked.length) trackingIssues.push(`${source.spreadsheet_id}: ยังไม่ได้เปิดติดตามแท็บ ${untracked.join(', ')}`)
        }
      }
      if (latest.data?.status === 'failed') trackingIssues.push(`Sync ไม่สำเร็จ: ${latest.data.error}`)
      for (const issue of latest.data?.issues || []) if (issue.type !== 'skipped_tab') trackingIssues.push(`${issue.clientName || issue.spreadsheetId}: ${issue.message}`)
    }
    return send(response, 200, {
      fetchedAt: now.toISOString(), trackingIssues, canSetupTracking: isAdmin,
      historyOptions: {
        aes: data.members.filter((member) => member.role === 'ae').map((member) => member.name),
        projects: [...new Map(visible.filter((task) => task.projectId).map((task) => [task.projectId, { id: task.projectId, name: task.projectName }])).values()],
        tasks: visible.map((task) => ({ key: task.taskKey, name: `${task.projectName} · ${task.topic}` })),
      },
      items: visible.filter((task) => !task.done && (isNoActivity(task.activity, task, now) || task.activity?.snoozedUntil)).map((task) => publicTask(task, now)),
      dataIssues: isAdmin ? notificationDataIssues(data) : [],
    })
  }
  return send(response, 400, { error: "Unknown notification action" })
}

async function saveSettings(response, context, body) {
  if (requireAdmin(context, response)) return
  const settingsError = validateSettings(body.settings)
  const templatesError = validateTemplates(body.templates)
  if (settingsError || templatesError) return send(response, 400, { error: settingsError || templatesError })
  const current = await context.admin.from("notification_settings").select("test_email_sent_at").eq("id", true).single()
  if (current.error) throw current.error
  if ((body.settings.dailyEnabled || body.settings.noActivityEnabled) && !current.data.test_email_sent_at) {
    return send(response, 409, { error: "Send a successful Test email before enabling automatic notifications" })
  }
  const admins = await context.admin.from("access_list").select("email").eq("active", true).eq("role", "admin")
  if (admins.error) throw admins.error
  const allowed = new Set((admins.data || []).map((entry) => entry.email))
  if ((body.settings.dailyEnabled || body.settings.noActivityEnabled || body.settings.manualEnabled) && (!body.settings.ownerDigestEmails.length || !body.settings.primaryOwnerEmail)) {
    return send(response, 400, { error: "Select at least one Owner recipient and one Primary Owner before enabling notifications" })
  }
  if (body.settings.ownerDigestEmails.some((email) => !allowed.has(email)) || (body.settings.primaryOwnerEmail && (!allowed.has(body.settings.primaryOwnerEmail) || !body.settings.ownerDigestEmails.includes(body.settings.primaryOwnerEmail)))) {
    return send(response, 400, { error: "Owner recipients and Primary Owner must be Active Admins" })
  }
  const settingsRow = {
    daily_enabled: body.settings.dailyEnabled,
    no_activity_enabled: body.settings.noActivityEnabled,
    manual_enabled: body.settings.manualEnabled,
    daily_time: body.settings.dailyTime,
    no_activity_time: body.settings.noActivityTime,
    sender_name: body.settings.senderName.trim(),
    primary_owner_email: body.settings.primaryOwnerEmail || "",
  }
  const templateRows = body.templates.map((template) => ({
    template_type: template.templateType, audience: template.audience, subject: template.subject,
    greeting: template.greeting, intro: template.intro, reminder: template.reminder,
    description: template.description, closing: template.closing,
  }))
  const saved = await context.admin.rpc("save_notification_setup", {
    p_settings: settingsRow,
    p_owner_emails: body.settings.ownerDigestEmails,
    p_templates: templateRows,
    p_actor: context.user.id,
    p_actor_email: context.access.email,
  })
  if (saved.error) throw saved.error
  return send(response, 200, await settingsResponse(context))
}

function sampleTask() {
  return {
    taskKey: "sample:1:task", projectName: "Sample Brand", topic: "ตรวจและส่ง Campaign Draft",
    status: "in_progress", ownerNames: ["Sample Employee"], dueDate: bangkokDate(), nextAction: "ส่ง Draft ให้ลูกค้าตรวจ",
    activity: { lastActivityAt: new Date(Date.now() - 6 * 86_400_000).toISOString() }, noActivity: true,
  }
}

async function previewOrTest(response, context, body, test) {
  if (requireAdmin(context, response)) return
  const templateError = validateTemplates(body.templates)
  if (templateError) return send(response, 400, { error: templateError })
  const template = body.templates.find((item) => `${item.templateType}:${item.audience}` === body.templateKey)
  if (!template) return send(response, 400, { error: "Template variant not found" })
  const now = new Date()
  const sample = sampleTask()
  const changes = summarizeDigestChanges([{ id: "preview", task_keys: [sample.taskKey], occurred_at: `${yesterdayWindow(now).date}T14:30:00+07:00`, actor_name: "Sample Employee", source: "dashboard", kind: "workflow_changed", changes: { status: { before: "not_started", after: "in_progress" }, next_action: { before: "รอ Brief", after: "ส่ง Draft ให้ลูกค้าตรวจ" } } }], [sample], { now })
  const email = buildNotificationEmail({ changes, now, digestDate: bangkokDate(now), groups: template.audience === "owner" ? [{ name: "Sample Employee", tasks: [sample], total: 1 }] : null, template, recipientName: context.access.member_name || context.access.email, tasks: [sample], projectName: "Sample Brand", employeeCount: 1, attentionCount: 1, staleCount: 1, baseUrl: process.env.APP_URL || "https://timeline-dashboard-rose.vercel.app" })
  if (!test) return send(response, 200, { email })
  const settings = await context.admin.from("notification_settings").select("sender_name,primary_owner_email").eq("id", true).single()
  if (settings.error) throw settings.error
  const result = await callAppsScript({ action: "send_email_batch", senderName: settings.data.sender_name, replyTo: settings.data.primary_owner_email || undefined, messages: [{ deliveryId: `test-${randomUUID()}`, to: context.access.email, ...email }] }, { timeoutMs: 55_000 })
  if (result.results?.[0]?.status !== "sent") return send(response, 502, { error: result.results?.[0]?.error || "Test email failed" })
  const marked = await context.admin.from("notification_settings").update({ test_email_sent_at: new Date().toISOString(), updated_by: context.user.id, updated_at: new Date().toISOString() }).eq("id", true)
  if (marked.error) throw marked.error
  return send(response, 200, { success: true, quotaRemaining: result.quotaRemaining })
}

async function snoozeTask(response, context, body) {
  if (!validIsoDate(body.until) || typeof body.reason !== "string" || !body.reason.trim() || body.reason.length > 500) return send(response, 400, { error: "Snooze date and reason are required" })
  const today = bangkokDate()
  const duration = daysFrom(body.until, today)
  if (duration === null || duration < 0 || duration > 30) return send(response, 400, { error: "Snooze must end within 30 days" })
  const data = await loadNotificationData(context.admin)
  const task = data.tasks.find((item) => item.taskKey === body.taskKey)
  if (!task) return send(response, 404, { error: "Task not found" })
  if (context.access.role !== "admin" && !task.ownerEmails.includes(context.access.email)) return send(response, 403, { error: "Only a responsible employee or Admin can Snooze this task" })
  const saved = await context.admin.from("task_activity_state").update({ snoozed_until: body.until, snooze_reason: body.reason.trim(), snoozed_by: context.user.id, updated_at: new Date().toISOString() }).eq("task_key", body.taskKey).select("*").single()
  if (saved.error) throw saved.error
  return send(response, 200, { activity: saved.data })
}

async function manualNotification(response, context, body) {
  if (requireAdmin(context, response)) return
  const data = await loadNotificationData(context.admin)
  if (!data.settings.manual_enabled) return send(response, 409, { error: "Manual notifications are disabled" })
  try {
    const batches = await createManualNotifications(context.admin, data, { ...body, actorId: context.user.id })
    const delivery = await processNotificationQueue(context.admin)
    return send(response, 200, { batches: batches.map((item) => item.batch.id), delivery })
  } catch (error) {
    if (error.status === 409) return send(response, 409, { error: error.message, duplicate: true })
    if (error.status === 400) return send(response, 400, { error: error.message })
    throw error
  }
}

async function previewManual(response, context, body) {
  if (requireAdmin(context, response)) return
  const data = await loadNotificationData(context.admin)
  if (!data.settings.manual_enabled) return send(response, 409, { error: "Manual notifications are disabled" })
  if (!Array.isArray(body.taskKeys) || !Array.isArray(body.recipientEmails) || typeof body.projectName !== "string" || typeof body.customMessage !== "string" || body.customMessage.length > 1000) return send(response, 400, { error: "Invalid manual notification preview" })
  const tasks = data.tasks.filter((task) => task.projectName === body.projectName && body.taskKeys.includes(task.taskKey) && !task.done)
  const recipients = data.access.filter((entry) => body.recipientEmails.includes(entry.email))
  if (!tasks.length || tasks.length !== body.taskKeys.length || tasks.length > 20 || !recipients.length || recipients.length !== body.recipientEmails.length || recipients.length > 50) return send(response, 400, { error: "Invalid manual task or recipient selection" })
  const template = data.templates.find((item) => item.templateType === "manual" && item.audience === "employee")
  if (!template) throw new Error("Manual notification template is missing")
  const email = buildNotificationEmail({ template, recipientName: recipients[0].member_name || recipients[0].email, tasks, projectName: body.projectName, baseUrl: process.env.APP_URL || "https://timeline-dashboard-rose.vercel.app", viewAllPath: "/?view=my", customMessage: body.customMessage.trim() })
  const ownerEmails = new Set(tasks.flatMap((task) => task.ownerEmails))
  return send(response, 200, {
    email,
    summary: { projectName: body.projectName, taskCount: tasks.length, recipientCount: recipients.length, recipients: recipients.map((entry) => entry.email) },
    unrelatedRecipients: recipients.filter((entry) => !ownerEmails.has(entry.email)).map((entry) => entry.email),
  })
}

async function handleWrite(request, response, context, action, body) {
  if (request.method === "PUT" && action === "settings") return saveSettings(response, context, body)
  if (request.method !== "POST") return send(response, 405, { error: "Method not allowed" })
  if (action === "preview") return previewOrTest(response, context, body, false)
  if (action === "test-email") return previewOrTest(response, context, body, true)
  if (action === "manual-preview") return previewManual(response, context, body)
  if (action === "manual") return manualNotification(response, context, body)
  if (action === "snooze") return snoozeTask(response, context, body)
  return send(response, 400, { error: "Unknown notification action" })
}

export default async function handler(request, response) {
  try {
    const context = await userContext(request)
    if (context.error) return send(response, context.status, { error: context.error })
    const action = String(request.query?.action || "")
    if (request.method === "GET") return await handleGet(request, response, context, action)
    if (!sameOrigin(request)) return send(response, 403, { error: "Cross-origin write blocked" })
    const body = typeof request.body === "string" ? JSON.parse(request.body) : request.body || {}
    return await handleWrite(request, response, context, action, body)
  } catch (error) {
    console.error("[notifications]", error)
    return send(response, 502, { error: error.message || "Notification request failed" })
  }
}
