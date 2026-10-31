import { actionLabel, actionValue } from "./activity.js"
import { bangkokDate } from "./dates.js"
import { daysFrom, formatThaiDate, formatThaiDateTime } from "./dates.js"
import { daysSinceActivity, escapeHtml, renderTemplateText } from "./notifications.js"

const STATUS_LABELS = {
  not_started: "Not Started",
  in_progress: "In Progress",
  waiting_client: "Waiting Client",
  blocked: "Blocked",
}
const STATUS_COLORS = { not_started: "#64748b", in_progress: "#2563eb", waiting_client: "#b45309", blocked: "#be123c" }

function absoluteUrl(baseUrl, path) {
  try { return new URL(path, baseUrl).toString() }
  catch { return path }
}

export function taskDeepLink(baseUrl, taskKey) {
  return absoluteUrl(baseUrl, `/?task=${encodeURIComponent(taskKey)}`)
}

export function notificationVariables({ recipientName = "", projectName = "", tasks = [], employeeCount = 0, attentionCount = tasks.length, staleCount = 0, digestDate = "" } = {}) {
  const first = tasks[0] || {}
  const overdue = daysFrom(first.dueDate)
  return {
    employee_name: recipientName,
    employee_count: employeeCount,
    attention_count: attentionCount,
    stale_count: staleCount,
    project_name: projectName || first.projectName || "—",
    task_name: first.topic || "—",
    task_count: tasks.length,
    deadline: first.dueDate ? formatThaiDate(first.dueDate) : "—",
    days_overdue: overdue !== null && overdue < 0 ? Math.abs(overdue) : 0,
    days_since_update: first.activity?.lastActivityAt ? daysSinceActivity(first.activity.lastActivityAt) : 0,
    digest_date: digestDate || formatThaiDate(new Date()),
  }
}

function taskCard(task, { baseUrl, now = new Date() }) {
  const due = daysFrom(task.dueDate)
  const overdue = due !== null && due < 0
  const lastActivity = task.activity?.lastActivityAt
  const since = lastActivity ? daysSinceActivity(lastActivity, now) : null
  const deadline = task.dueDate
    ? overdue ? `${formatThaiDate(task.dueDate)} · เกิน ${Math.abs(due)} วัน` : `${formatThaiDate(task.dueDate)}${due !== null ? ` · เหลือ ${due} วัน` : ""}`
    : "ยังไม่มี Deadline"
  const activity = lastActivity
    ? task.activity?.lastActivityKind === "task_discovered" ? `ยังไม่เคย Update · พบงานครั้งแรก ${formatThaiDateTime(lastActivity)} · ${since} วันที่แล้ว` : `${formatThaiDateTime(lastActivity)} · ${since} วันที่แล้ว`
    : "ยังไม่เคย Update"
  return `<article style="border:1px solid #e9e2ff;border-radius:12px;padding:16px;margin:0 0 12px;background:#fff">
    <div style="font-size:12px;color:#7254c7;font-weight:700">${escapeHtml(task.projectName || task.clientName || "—")}${task.shared ? " · Shared" : ""}${task.noActivity ? " · No Activity" : ""}</div>
    <h3 style="font-size:16px;line-height:1.4;margin:5px 0 12px;color:#241c36">${escapeHtml(task.topic || "—")}</h3>
    <table role="presentation" style="width:100%;border-collapse:collapse;font-size:12px;color:#514961">
      <tr><td style="padding:4px 8px 4px 0;color:#8a8198;width:34%">Status</td><td style="padding:4px 0;font-weight:700;color:${STATUS_COLORS[task.status] || "#64748b"}">${escapeHtml(STATUS_LABELS[task.status] || task.status || "Not Started")}</td></tr>
      <tr><td style="padding:4px 8px 4px 0;color:#8a8198">ผู้รับผิดชอบ</td><td style="padding:4px 0">${escapeHtml((task.ownerNames || []).join(", ") || "—")}</td></tr>
      <tr><td style="padding:4px 8px 4px 0;color:#8a8198">Deadline</td><td style="padding:4px 0;${overdue ? "color:#c62828;font-weight:700" : ""}">${escapeHtml(deadline)}</td></tr>
      <tr><td style="padding:4px 8px 4px 0;color:#8a8198">Last Update</td><td style="padding:4px 0">${escapeHtml(activity)}</td></tr>
      <tr><td style="padding:4px 8px 4px 0;color:#8a8198">Next Action</td><td style="padding:4px 0;font-weight:600">${escapeHtml(task.nextAction || "—")}</td></tr>
    </table>
    <a href="${escapeHtml(taskDeepLink(baseUrl, task.taskKey))}" style="display:inline-block;margin-top:13px;padding:8px 12px;border-radius:8px;background:#6f4bd8;color:#fff;text-decoration:none;font-size:12px;font-weight:700">Open Task</a>
  </article>`
}

function dailyContent({ tasks, groups, changes, attentionCount, digestDate, baseUrl, now, audience }) {
  const e = escapeHtml
  const text = [`ประจำวันที่ ${formatThaiDate(digestDate || now)}`, `งานต้องติดตาม ${attentionCount} งาน · แก้ไขเมื่อวาน ${changes?.taskCount || 0} งาน`, `เมื่อวานแก้ไขอะไรบ้าง${changes?.date ? ` · ${formatThaiDate(changes.date)}` : ""}`]
  const grouped = new Map()
  for (const event of changes?.events || []) for (const task of event.tasks) {
    if (!grouped.has(task.taskKey)) grouped.set(task.taskKey, { ...task, events: [] })
    grouped.get(task.taskKey).events.push(event)
  }
  let changeHtml = ''
  const value = (field, value) => field === 'status' ? ({ not_started: 'ยังไม่เริ่ม', in_progress: 'กำลังดำเนินการ', waiting_client: 'รอลูกค้า', blocked: 'ติดปัญหา' }[value] || actionValue(value)) : actionValue(value)
  for (const task of [...grouped.values()].sort((a, b) => a.projectName.localeCompare(b.projectName, 'th') || a.taskName.localeCompare(b.taskName, 'th'))) {
    text.push(`${task.projectName} — ${task.taskName}`)
    changeHtml += `<div style="padding:12px 0;border-bottom:1px solid #eee8f8"><strong>${e(task.projectName)}</strong><br><a href="${e(taskDeepLink(baseUrl, task.taskKey))}">${e(task.taskName)}</a>`
    for (const event of task.events) {
      const when = event.timePrecision === 'version' ? `${formatThaiDate(event.occurredAt)} (เวลาตามเวอร์ชัน)` : formatThaiDateTime(event.occurredAt)
      const who = `${event.actor} · ${when}`
      text.push(who)
      changeHtml += `<div style="margin-top:8px;color:#62576f;font-size:13px">${e(who)}</div>`
      for (const [field, change] of Object.entries(event.changes)) {
        const label = ({ status: 'สถานะ', note: 'บันทึก', next_action: 'สิ่งที่ต้องทำต่อ', due_date: 'กำหนดส่ง', actual_submit: 'วันที่ส่งจริง', priority: 'ความสำคัญ' })[field] || actionLabel(field)
        const line = `${label}: ${value(field, change.before)} → ${value(field, change.after)}`
        text.push(line)
        changeHtml += `<div style="margin-top:4px;white-space:pre-wrap;overflow-wrap:anywhere">${e(label)}: ${e(value(field, change.before))} → <strong>${e(value(field, change.after))}</strong></div>`
      }
    }
    text.push(taskDeepLink(baseUrl, task.taskKey))
    changeHtml += '</div>'
  }
  if (!grouped.size) { changeHtml = '<p>ไม่มีการแก้ไขงานที่บันทึกไว้เมื่อวาน</p>'; text.push('ไม่มีการแก้ไขงานที่บันทึกไว้เมื่อวาน') }
  const historyUrl = absoluteUrl(baseUrl, audience === 'owner' ? '/?view=follow_up' : '/?view=my')
  if (changes?.remaining) {
    const remaining = `ยังมีอีก ${changes.remaining} เหตุการณ์ · เปิด Dashboard เพื่อดูประวัติในรายละเอียดงาน`
    changeHtml += `<p><a href="${e(historyUrl)}">${e(remaining)}</a></p>`
    text.push(remaining, historyUrl)
  }
  text.push('งานที่ต้องติดตามวันนี้')
  let taskHtml = ''
  const sections = groups || [{ name: '', tasks, total: attentionCount }]
  for (const group of sections) {
    if (group.name) { taskHtml += `<h3 style="margin:18px 0 4px;font-size:16px">${e(group.name)} · ${group.total} งาน</h3>`; text.push(`${group.name} · ${group.total} งาน`) }
    for (const task of group.tasks) {
      const due = daysFrom(task.dueDate, bangkokDate(now))
      const deadline = task.dueDate ? `${formatThaiDate(task.dueDate)}${due < 0 ? ` · เกินกำหนด ${Math.abs(due)} วัน` : due === 0 ? ' · วันนี้' : ''}` : 'ยังไม่กำหนดวันส่ง'
      const status = value('status', task.status || 'not_started')
      const owners = (task.ownerNames || []).join(', ')
      taskHtml += `<div style="padding:12px 0;border-bottom:1px solid #eee8f8"><div style="font-size:13px;color:#62576f">${e(task.projectName || task.clientName || '—')}${owners ? ` · ${e(owners)}` : ''}</div><a style="font-weight:bold;color:#5133a1" href="${e(taskDeepLink(baseUrl, task.taskKey))}">${e(task.topic || '—')}</a><div>${e(status)} · <span style="color:${due !== null && due < 0 ? '#b42318' : '#514961'}">${e(deadline)}</span></div><div style="white-space:pre-wrap">ทำต่อ: ${e(task.nextAction || 'ยังไม่ระบุ')}</div></div>`
      text.push(`${task.projectName || task.clientName} — ${task.topic}`, `ผู้รับผิดชอบ: ${owners || '—'} · ${status}`, `กำหนดส่ง: ${deadline}`, `ทำต่อ: ${task.nextAction || 'ยังไม่ระบุ'}`, taskDeepLink(baseUrl, task.taskKey))
    }
    if (group.truncated || group.total > group.tasks.length) { taskHtml += '<p>รายละเอียดที่เหลือดูได้ใน Dashboard</p>'; text.push('รายละเอียดที่เหลือดูได้ใน Dashboard') }
  }
  if (!tasks.length) { taskHtml = '<p>ไม่มีงานที่ต้องติดตามวันนี้</p>'; text.push('ไม่มีงานที่ต้องติดตามวันนี้') }
  const summary = `<div style="font-size:15px;line-height:1.7;overflow-wrap:anywhere"><p style="font-size:18px;font-weight:bold">ประจำวันที่ ${e(formatThaiDate(digestDate || now))}</p><div style="background:#f3effc;padding:14px;border-radius:8px">งานต้องติดตาม <strong>${attentionCount}</strong> งาน · แก้ไขเมื่อวาน <strong>${changes?.taskCount || 0}</strong> งาน</div></div>`
  const html = `<div style="font-size:15px;line-height:1.7;overflow-wrap:anywhere"><h2 style="font-size:18px;margin:24px 0 4px">เมื่อวานแก้ไขอะไรบ้าง${changes?.date ? ` · ${e(formatThaiDate(changes.date))}` : ''}</h2>${changeHtml}<h2 style="font-size:18px;margin:24px 0 4px">งานที่ต้องติดตามวันนี้</h2>${taskHtml}</div>`
  return { html, text, summary }
}

export function buildNotificationEmail({ template, recipientName, tasks = [], baseUrl, viewAllPath = "/", projectName = "", employeeCount = 0, attentionCount = tasks.length, staleCount = 0, digestDate = "", customMessage = "", groups = null, dataIssues = [], changes = null, now = new Date() }) {
  const variables = notificationVariables({ recipientName, projectName, tasks, employeeCount, attentionCount, staleCount, digestDate })
  const render = (field) => escapeHtml(renderTemplateText(template?.[field] || "", variables))
  let remainingDetails = 80
  const displayedGroups = groups?.map((group) => {
    const visible = group.tasks.slice(0, Math.max(0, remainingDetails))
    remainingDetails -= visible.length
    return { ...group, tasks: visible, truncated: group.truncated || visible.length < group.tasks.length }
  })
  const displayedTasks = displayedGroups ? displayedGroups.flatMap((group) => group.tasks) : tasks.slice(0, 80)
  const groupHtml = displayedGroups?.length
    ? displayedGroups.map((group) => `<section style="margin-top:20px"><h2 style="font-size:15px;color:#382866;margin:0 0 10px">${escapeHtml(group.name)} · ${group.total} งาน</h2>${group.tasks.map((task) => taskCard(task, { baseUrl, now })).join("")}${group.truncated ? `<p style="font-size:12px;color:#746b80">รายละเอียดที่เหลือดูได้ใน Dashboard</p>` : ""}</section>`).join("")
    : displayedTasks.map((task) => taskCard(task, { baseUrl, now })).join("")
  const daily = template?.templateType === "daily_digest" ? dailyContent({ tasks: displayedTasks, groups: displayedGroups, changes, attentionCount, digestDate, baseUrl, now, audience: template.audience }) : null
  const html = `<!doctype html><html lang="th"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;background:#f7f5fb;font-family:Arial,'Noto Sans Thai',sans-serif;color:#241c36">
    <div style="max-width:680px;margin:0 auto;padding:24px 14px">
      <div style="background:#6542c7;color:white;border-radius:14px 14px 0 0;padding:20px"><div style="font-size:12px;opacity:.8">MAGIC Timeline</div><h1 style="font-size:21px;margin:5px 0 0">${render("greeting")}</h1></div>
      <main style="background:#fff;border:1px solid #e9e2ff;border-top:0;border-radius:0 0 14px 14px;padding:20px">
        ${daily?.summary || ""}
        ${template?.intro ? `<p style="font-size:14px;line-height:1.65;margin:0 0 8px">${render("intro")}</p>` : ""}
        ${template?.reminder ? `<p style="font-size:13px;line-height:1.6;color:#7254c7;margin:0 0 8px">${render("reminder")}</p>` : ""}
        ${template?.description ? `<p style="font-size:12px;line-height:1.6;color:#746b80;margin:0 0 18px">${render("description")}</p>` : ""}
        ${customMessage ? `<div style="padding:12px;border-radius:10px;background:#fff8df;font-size:13px;line-height:1.6;margin-bottom:18px"><strong>ข้อความเพิ่มเติม</strong><br>${escapeHtml(customMessage).replaceAll("\n", "<br>")}</div>` : ""}
        ${daily ? daily.html : groupHtml}
        ${dataIssues.length ? `<section style="margin-top:20px;padding:14px;border-radius:10px;background:#fff8df"><h2 style="font-size:14px;color:#8a5a00;margin:0 0 8px">Data Issues · ${dataIssues.length}</h2>${dataIssues.slice(0, 20).map((issue) => `<div style="font-size:12px;line-height:1.55;margin-top:6px"><strong>${escapeHtml(issue.projectName)} · ${escapeHtml(issue.taskName)}</strong><br>${escapeHtml(issue.issues.join(" · "))}</div>`).join("")}${dataIssues.length > 20 ? `<div style="font-size:12px;margin-top:8px">ยังมีอีก ${dataIssues.length - 20} รายการใน Follow-up</div>` : ""}</section>` : ""}
        <a href="${escapeHtml(absoluteUrl(baseUrl, viewAllPath))}" style="display:inline-block;margin-top:8px;color:#6542c7;font-size:13px;font-weight:700">ดูทั้งหมดใน Dashboard →</a>
        ${template?.closing ? `<p style="font-size:12px;line-height:1.6;color:#746b80;border-top:1px solid #eee8f8;margin:20px 0 0;padding-top:16px">${render("closing")}</p>` : ""}
      </main>
    </div></body></html>`
  const text = [
    renderTemplateText(template?.greeting || "", variables),
    ...(daily ? daily.text.slice(0, 2) : []),
    renderTemplateText(template?.intro || "", variables),
    renderTemplateText(template?.reminder || "", variables),
    renderTemplateText(template?.description || "", variables),
    customMessage,
    ...(daily ? daily.text.slice(2) : displayedTasks.map((task) => `${task.projectName || task.clientName} — ${task.topic}\nStatus: ${STATUS_LABELS[task.status] || task.status}\nDeadline: ${task.dueDate || "—"}\nNext Action: ${task.nextAction || "—"}\n${taskDeepLink(baseUrl, task.taskKey)}`)),
    ...dataIssues.map((issue) => `Data Issue: ${issue.projectName} — ${issue.taskName}: ${issue.issues.join(", ")}`),
    absoluteUrl(baseUrl, viewAllPath),
    renderTemplateText(template?.closing || "", variables),
  ].filter(Boolean).join("\n\n")
  return { subject: renderTemplateText(template?.subject || "Notification", variables), html, text, variables }
}
