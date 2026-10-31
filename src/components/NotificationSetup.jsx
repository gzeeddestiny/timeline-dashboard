import { useCallback, useEffect, useState } from "react"
import { DEFAULT_NOTIFICATION_TEMPLATES, templateTokensForField } from "../lib/notifications"
import { fetchNotificationHistory, fetchNotificationSettings, previewNotificationTemplate, saveNotificationSettings, sendNotificationTestEmail } from "../lib/fullSystem"
import { formatThaiDateTime } from "../lib/dates"

const TEMPLATE_LABELS = {
  "daily_digest:employee": "Daily · Employee",
  "daily_digest:owner": "Daily · Owner",
  "no_activity:employee": "No Activity",
  "manual:employee": "Manual",
}

function cloneDefaults() {
  return DEFAULT_NOTIFICATION_TEMPLATES.map((template) => ({ ...template }))
}

export default function NotificationSetup({ currentEmail }) {
  const [data, setData] = useState(null)
  const [history, setHistory] = useState([])
  const [selectedTemplate, setSelectedTemplate] = useState("daily_digest:employee")
  const [preview, setPreview] = useState(null)
  const [historyFilters, setHistoryFilters] = useState({ type: "all", status: "all", recipient: "", from: "", to: "" })
  const [status, setStatus] = useState({ loading: true, saving: false, error: "", message: "" })

  const load = useCallback(async () => {
    setStatus((current) => ({ ...current, loading: true, error: "" }))
    try {
      const [settings, log] = await Promise.all([fetchNotificationSettings(), fetchNotificationHistory()])
      setData({ ...settings, settings: { ...settings.settings, ownerDigestEmails: settings.ownerDigestEmails } })
      setHistory(log.items || [])
      setStatus({ loading: false, saving: false, error: "", message: "" })
    } catch (error) { setStatus({ loading: false, saving: false, error: error.message, message: "" }) }
  }, [])
  useEffect(() => { load() }, [load])

  if (status.loading) return <section className="mt-6 border-t border-purple-100 pt-5 text-sm text-gray-400">Loading Notification Setup…</section>
  if (!data) return <section className="mt-6 border-t border-purple-100 pt-5"><p className="text-sm text-red-600">{status.error}</p><button type="button" onClick={load} className="ui-button ui-button-secondary mt-2 text-xs">Retry</button></section>
  const template = data.templates.find((item) => `${item.templateType}:${item.audience}` === selectedTemplate)
  const filteredHistory = history.filter((item) => {
    const deliveryStatuses = item.notification_deliveries?.map((delivery) => delivery.status) || []
    const day = String(item.created_at || "").slice(0, 10)
    return (historyFilters.type === "all" || item.type === historyFilters.type)
      && (historyFilters.status === "all" || deliveryStatuses.includes(historyFilters.status))
      && (!historyFilters.recipient || item.recipient_email.toLowerCase().includes(historyFilters.recipient.toLowerCase()))
      && (!historyFilters.from || day >= historyFilters.from)
      && (!historyFilters.to || day <= historyFilters.to)
  })
  const updateSetting = (patch) => setData((current) => ({ ...current, settings: { ...current.settings, ...patch } }))
  const updateTemplate = (field, value) => setData((current) => ({ ...current, templates: current.templates.map((item) => `${item.templateType}:${item.audience}` === selectedTemplate ? { ...item, [field]: value } : item) }))

  const save = async () => {
    setStatus((current) => ({ ...current, saving: true, error: "", message: "" }))
    try {
      const saved = await saveNotificationSettings({ settings: data.settings, templates: data.templates })
      setData({ ...saved, settings: { ...saved.settings, ownerDigestEmails: saved.ownerDigestEmails } })
      setStatus({ loading: false, saving: false, error: "", message: "บันทึก Notification Setup แล้ว" })
    } catch (error) { setStatus((current) => ({ ...current, saving: false, error: error.message })) }
  }
  const runPreview = async () => {
    try { setPreview((await previewNotificationTemplate({ templateKey: selectedTemplate, templates: data.templates })).email); setStatus((current) => ({ ...current, error: "" })) }
    catch (error) { setStatus((current) => ({ ...current, error: error.message })) }
  }
  const testEmail = async () => {
    setStatus((current) => ({ ...current, saving: true, error: "", message: "" }))
    try {
      const result = await sendNotificationTestEmail({ templateKey: selectedTemplate, templates: data.templates })
      updateSetting({ testEmailSentAt: new Date().toISOString() })
      setStatus({ loading: false, saving: false, error: "", message: `ส่ง Test email ไป ${currentEmail} แล้ว · quota เหลือ ${result.quotaRemaining}` })
    } catch (error) { setStatus((current) => ({ ...current, saving: false, error: error.message })) }
  }

  return <section className="mt-6 border-t border-purple-100 pt-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h3 className="font-bold text-purple-900">Notification Setup</h3><p className="text-xs text-gray-400">Schedule, Owner Digest, Workspace MailApp และข้อความมาตรฐาน</p></div>
      <span className={`ui-badge ${data.health.status === "ready" ? "ui-badge-success" : "ui-badge-danger"}`}>{data.health.status === "ready" ? `Mail ready · quota ${data.health.quotaRemaining}` : "Mail unavailable"}</span>
    </div>
    {data.health.error && <p className="mt-2 text-xs text-red-600">{data.health.error}</p>}
    {data.health.status === "ready" && <p className="mt-2 text-xs text-gray-500">Sender: {data.health.senderEmail} · Apps Script authorized · failed {data.health.deliveryCounts.failed || 0} · unknown {data.health.deliveryCounts.unknown || 0} (24h)</p>}
    <div className="mt-3 grid gap-2 sm:grid-cols-4">
      <div className="rounded-xl border border-gray-100 p-3 text-xs"><span className="text-gray-400">Daily preflight</span><strong className="mt-1 block text-purple-900">{data.preflight.daily.recipients} ผู้รับ · {data.preflight.daily.tasks} งานต้องติดตาม · {data.preflight.daily.changedTasks || 0} งานแก้ไขเมื่อวาน</strong></div>
      <div className="rounded-xl border border-gray-100 p-3 text-xs"><span className="text-gray-400">No Activity preflight</span><strong className="mt-1 block text-purple-900">{data.preflight.noActivity.recipients} ผู้รับ · {data.preflight.noActivity.tasks} งาน</strong></div>
      <div className="rounded-xl border border-gray-100 p-3 text-xs"><span className="text-gray-400">Owner / Data Issues</span><strong className="mt-1 block text-purple-900">{data.preflight.ownerRecipients} ผู้รับ · {data.preflight.dataIssues} issues</strong></div>
      <div className="rounded-xl border border-gray-100 p-3 text-xs"><span className="text-gray-400">Last successful email</span><strong className="mt-1 block text-purple-900">{data.health.lastSuccessfulRun ? formatThaiDateTime(data.health.lastSuccessfulRun) : "ยังไม่มี"}</strong></div>
    </div>
    <div className="mt-4 grid gap-3 rounded-xl border border-purple-100 bg-purple-50/30 p-4 sm:grid-cols-3">
      {[["dailyEnabled", "Daily Digest"], ["noActivityEnabled", "No Activity"], ["manualEnabled", "Manual"]].map(([key, label]) => <label key={key} className="flex items-center gap-2 text-xs font-semibold text-gray-700"><input type="checkbox" checked={data.settings[key]} onChange={(event) => updateSetting({ [key]: event.target.checked })} />{label}</label>)}
      <label className="text-xs font-semibold text-gray-600">Daily time<input type="time" step="900" value={data.settings.dailyTime} onChange={(event) => updateSetting({ dailyTime: event.target.value })} className="ui-field mt-1 w-full" /></label>
      <label className="text-xs font-semibold text-gray-600">No Activity time<input type="time" step="900" value={data.settings.noActivityTime} onChange={(event) => updateSetting({ noActivityTime: event.target.value })} className="ui-field mt-1 w-full" /></label>
      <label className="text-xs font-semibold text-gray-600">Sender name<input value={data.settings.senderName} maxLength={100} onChange={(event) => updateSetting({ senderName: event.target.value })} className="ui-field mt-1 w-full" /></label>
      <div className="sm:col-span-3"><p className="text-xs font-semibold text-gray-600">Owner Digest Recipients</p><div className="mt-2 flex flex-wrap gap-2">{data.adminOptions.map((admin) => <label key={admin.email} className="ui-chip flex items-center gap-2 px-2 py-1 text-xs"><input type="checkbox" checked={data.settings.ownerDigestEmails.includes(admin.email)} onChange={(event) => updateSetting({ ownerDigestEmails: event.target.checked ? [...data.settings.ownerDigestEmails, admin.email] : data.settings.ownerDigestEmails.filter((email) => email !== admin.email), ...(event.target.checked || data.settings.primaryOwnerEmail !== admin.email ? {} : { primaryOwnerEmail: null }) })} />{admin.memberName}</label>)}</div></div>
      <label className="text-xs font-semibold text-gray-600 sm:col-span-2">Primary Owner / Reply-To<select value={data.settings.primaryOwnerEmail || ""} onChange={(event) => updateSetting({ primaryOwnerEmail: event.target.value || null })} className="ui-field mt-1 w-full"><option value="">เลือก Primary Owner</option>{data.adminOptions.filter((admin) => data.settings.ownerDigestEmails.includes(admin.email)).map((admin) => <option key={admin.email} value={admin.email}>{admin.memberName} · {admin.email}</option>)}</select></label>
      <div className="rounded-lg bg-white p-3 text-[11px] text-gray-500">Threshold คงที่: No Activity 120 ชั่วโมง · Near Deadline 3 วัน · Timezone Asia/Bangkok</div>
    </div>

    <div className="mt-4 rounded-xl border border-gray-100 p-4">
      <div className="flex flex-wrap gap-2">{Object.entries(TEMPLATE_LABELS).map(([key, label]) => <button key={key} type="button" data-active={selectedTemplate === key} onClick={() => { setSelectedTemplate(key); setPreview(null) }} className="ui-chip px-3 py-1.5 text-xs font-semibold">{label}</button>)}</div>
      {template && <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {["subject", "greeting", "intro", "reminder", "description", "closing"].map((field) => <label key={field} className={`text-xs font-semibold capitalize text-gray-600 ${["subject", "intro", "reminder", "description", "closing"].includes(field) ? "sm:col-span-2" : ""}`}>{field}{["intro", "reminder", "description", "closing"].includes(field) ? <textarea rows={2} value={template[field]} onChange={(event) => updateTemplate(field, event.target.value)} className="ui-field mt-1 w-full resize-y text-sm" /> : <input value={template[field]} onChange={(event) => updateTemplate(field, event.target.value)} className="ui-field mt-1 w-full text-sm" />}<span className="mt-1 block text-[10px] font-normal normal-case text-gray-400">Tokens: {[...templateTokensForField(selectedTemplate, field)].map((token) => `{{${token}}}`).join(", ") || "ไม่มี"}</span></label>)}
        <p className="sm:col-span-2 text-[11px] text-gray-400">แก้ล่าสุด {template.updatedBy || "ค่าเริ่มต้นระบบ"} · {template.updatedAt ? formatThaiDateTime(template.updatedAt) : "—"}</p>
      </div>}
      <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={runPreview} className="ui-button ui-button-secondary text-xs">Preview</button><button type="button" disabled={status.saving} onClick={testEmail} className="ui-button ui-button-secondary text-xs">Test email</button><button type="button" onClick={() => setData((current) => ({ ...current, templates: cloneDefaults() }))} className="ui-button ui-button-secondary text-xs">Reset defaults</button><button type="button" disabled={status.saving} onClick={save} className="ui-button ui-button-primary ml-auto text-xs">{status.saving ? "Saving…" : "Save Notification Setup"}</button></div>
      {status.error && <p className="mt-2 text-xs text-red-600">{status.error}</p>}{status.message && <p className="mt-2 text-xs text-green-700">{status.message}</p>}
      {preview && <div className="mt-4 overflow-hidden rounded-xl border border-gray-200"><div className="bg-gray-50 px-3 py-2 text-xs font-semibold">Subject: {preview.subject}</div><iframe title="Notification preview" sandbox="" srcDoc={preview.html} className="h-[460px] w-full bg-white" /></div>}
    </div>

    <details className="mt-4 rounded-xl border border-gray-100 p-4"><summary className="cursor-pointer text-sm font-bold text-purple-900">Delivery history · 90 วัน</summary><div className="mt-3 grid gap-2 sm:grid-cols-5"><select value={historyFilters.type} onChange={(event) => setHistoryFilters((current) => ({ ...current, type: event.target.value }))} className="ui-field text-xs"><option value="all">All types</option><option value="daily_digest">Daily</option><option value="no_activity">No Activity</option><option value="manual">Manual</option></select><select value={historyFilters.status} onChange={(event) => setHistoryFilters((current) => ({ ...current, status: event.target.value }))} className="ui-field text-xs"><option value="all">All statuses</option>{["queued", "sending", "sent", "failed", "unknown"].map((value) => <option key={value}>{value}</option>)}</select><input type="search" value={historyFilters.recipient} onChange={(event) => setHistoryFilters((current) => ({ ...current, recipient: event.target.value }))} placeholder="Recipient email" className="ui-field text-xs" /><input type="date" value={historyFilters.from} onChange={(event) => setHistoryFilters((current) => ({ ...current, from: event.target.value }))} className="ui-field text-xs" /><input type="date" value={historyFilters.to} onChange={(event) => setHistoryFilters((current) => ({ ...current, to: event.target.value }))} className="ui-field text-xs" /></div><div className="mt-3 max-h-64 overflow-auto"><table className="w-full text-left text-xs"><thead className="text-gray-400"><tr><th className="py-2">Type</th><th>Recipient</th><th>Status</th><th>Created</th></tr></thead><tbody className="divide-y divide-gray-100">{filteredHistory.map((item) => <tr key={item.id}><td className="py-2">{item.type}</td><td>{item.recipient_email}</td><td>{item.notification_deliveries?.map((delivery) => `${delivery.channel}:${delivery.status}`).join(", ")}</td><td>{formatThaiDateTime(item.created_at)}</td></tr>)}</tbody></table></div></details>
  </section>
}
