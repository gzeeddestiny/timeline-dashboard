import { Dialog } from "@base-ui/react/dialog"
import { XIcon } from "@phosphor-icons/react/dist/csr/X"
import { useEffect, useMemo, useState } from "react"
import { fetchManualNotificationOptions, previewManualNotification, sendManualNotification } from "../lib/fullSystem"
import TaskIdentity from "./TaskIdentity"

export default function ManualNotificationComposer({ open, prefillTaskKey = "", onClose, onSent }) {
  const [options, setOptions] = useState({ tasks: [], recipients: [], enabled: true })
  const [projectName, setProjectName] = useState("")
  const [taskKeys, setTaskKeys] = useState([])
  const [recipientEmails, setRecipientEmails] = useState([])
  const [customMessage, setCustomMessage] = useState("")
  const [preview, setPreview] = useState(null)
  const [status, setStatus] = useState({ loading: false, sending: false, error: "", duplicate: false })
  useEffect(() => {
    if (!open) return
    setStatus({ loading: true, sending: false, error: "", duplicate: false })
    fetchManualNotificationOptions().then((data) => {
      setOptions(data)
      const prefill = data.tasks.find((task) => task.taskKey === prefillTaskKey)
      if (prefill) { setProjectName(prefill.projectName); setTaskKeys([prefill.taskKey]); setRecipientEmails(prefill.ownerEmails || []) }
      else { setProjectName(""); setTaskKeys([]); setRecipientEmails([]) }
      setCustomMessage("")
      setPreview(null)
      setStatus({ loading: false, sending: false, error: "", duplicate: false })
    }).catch((error) => setStatus({ loading: false, sending: false, error: error.message, duplicate: false }))
  }, [open, prefillTaskKey])
  const projects = useMemo(() => [...new Set(options.tasks.map((task) => task.projectName))].sort((a, b) => a.localeCompare(b, "th")), [options.tasks])
  const projectTasks = options.tasks.filter((task) => task.projectName === projectName)
  const toggle = (items, value) => items.includes(value) ? items.filter((item) => item !== value) : [...items, value]
  const suggestOwners = () => { setPreview(null); setRecipientEmails([...new Set(projectTasks.filter((task) => taskKeys.includes(task.taskKey)).flatMap((task) => task.ownerEmails || []))]) }
  const prepare = async () => {
    if (!projectName || !taskKeys.length || !recipientEmails.length) return setStatus((current) => ({ ...current, error: "เลือก Project, Task และผู้รับอย่างน้อยหนึ่งคน" }))
    setStatus((current) => ({ ...current, sending: true, error: "", duplicate: false }))
    try {
      setPreview(await previewManualNotification({ projectName, taskKeys, recipientEmails, customMessage: customMessage.trim() }))
      setStatus((current) => ({ ...current, sending: false }))
    } catch (error) { setStatus((current) => ({ ...current, sending: false, error: error.message })) }
  }
  const submit = async (forceDuplicate = false) => {
    if (!projectName || !taskKeys.length || !recipientEmails.length) return setStatus((current) => ({ ...current, error: "เลือก Project, Task และผู้รับอย่างน้อยหนึ่งคน" }))
    setStatus((current) => ({ ...current, sending: true, error: "", duplicate: false }))
    try {
      await sendManualNotification({ projectName, taskKeys, recipientEmails, customMessage: customMessage.trim(), forceDuplicate })
      onSent?.(); onClose()
    } catch (error) { setStatus((current) => ({ ...current, sending: false, error: error.message, duplicate: error.status === 409 && error.data?.duplicate })) }
  }
  if (!open) return null
  return <Dialog.Root open onOpenChange={(next) => { if (!next && !status.sending) onClose() }}><Dialog.Portal><Dialog.Backdrop className="ui-overlay-enter fixed inset-0 z-[var(--z-overlay)] bg-black/35" /><Dialog.Popup className="ui-popover ui-modal-enter fixed left-1/2 top-1/2 z-[var(--z-modal)] max-h-[88dvh] w-[min(44rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto p-6">
    <div className="flex items-start justify-between"><div><Dialog.Title className="text-lg font-bold text-[var(--ui-text)]">Send Manual Notification</Dialog.Title><p className="mt-1 text-xs text-gray-400">ส่ง Email และ Notification Center แยกต่อผู้รับ</p></div><button type="button" onClick={onClose} className="ui-icon-button"><XIcon size={18} /></button></div>
    {status.loading ? <p className="mt-6 text-sm text-gray-400">Loading tasks…</p> : !options.enabled ? <p className="mt-6 rounded-lg bg-amber-50 p-3 text-sm text-amber-700">Manual Notification ถูกปิดใน Setup</p> : <>
      <label className="mt-5 block text-xs font-semibold text-gray-600">Project<select value={projectName} onChange={(event) => { setPreview(null); setProjectName(event.target.value); setTaskKeys([]); setRecipientEmails([]) }} className="ui-field mt-1 w-full"><option value="">เลือก Project</option>{projects.map((project) => <option key={project}>{project}</option>)}</select></label>
      <fieldset className="mt-4"><legend className="text-xs font-semibold text-gray-600">Task · เลือกได้สูงสุด 20</legend><div className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-lg border border-gray-100 p-2">{projectTasks.map((task) => <label key={task.taskKey} className="flex items-start gap-2 rounded-md p-2 text-xs hover:bg-purple-50"><input type="checkbox" disabled={!taskKeys.includes(task.taskKey) && taskKeys.length >= 20} checked={taskKeys.includes(task.taskKey)} onChange={() => { setPreview(null); setTaskKeys((current) => toggle(current, task.taskKey)) }} /><span><TaskIdentity brand={task.brandName || task.projectName} task={task.taskName} detail={task.projectName !== task.brandName ? task.projectName : ""} /><span className="mt-0.5 block text-gray-400">{task.status} · {task.ownerNames.join(", ") || "ไม่มีผู้รับผิดชอบ"}</span></span></label>)}</div></fieldset>
      <fieldset className="mt-4"><div className="flex items-center justify-between"><legend className="text-xs font-semibold text-gray-600">Recipients</legend><button type="button" onClick={suggestOwners} className="text-xs font-semibold text-purple-700">Suggest owners</button></div><div className="mt-2 flex flex-wrap gap-2">{options.recipients.map((recipient) => <label key={recipient.email} className="ui-chip flex items-center gap-2 px-2 py-1 text-xs"><input type="checkbox" checked={recipientEmails.includes(recipient.email)} onChange={() => { setPreview(null); setRecipientEmails((current) => toggle(current, recipient.email)) }} />{recipient.memberName}</label>)}</div></fieldset>
      {recipientEmails.some((email) => !projectTasks.filter((task) => taskKeys.includes(task.taskKey)).some((task) => task.ownerEmails.includes(email))) && <p className="mt-2 text-xs text-amber-700">มีผู้รับที่ไม่ใช่ผู้รับผิดชอบของ Task ที่เลือก กรุณาตรวจ Preview ก่อนส่ง</p>}
      <label className="mt-4 block text-xs font-semibold text-gray-600">ข้อความเพิ่มเติม<textarea value={customMessage} maxLength={1000} rows={3} onChange={(event) => { setPreview(null); setCustomMessage(event.target.value) }} className="ui-field mt-1 w-full resize-y" placeholder="เหตุผลหรือสิ่งที่ต้องการให้ติดตาม..." /></label>
      <div className="mt-4 rounded-lg bg-purple-50 p-3 text-xs text-purple-800">Preview summary: {taskKeys.length} Task · {recipientEmails.length} recipients · ระบบส่งแยก {recipientEmails.length} ฉบับ</div>
      {preview && <div className="mt-4 overflow-hidden rounded-xl border border-purple-200"><div className="bg-purple-50 px-3 py-2 text-xs font-bold text-purple-900">ยืนยันก่อนส่ง · Subject: {preview.email.subject}</div><iframe title="Manual notification preview" sandbox="" srcDoc={preview.email.html} className="h-80 w-full bg-white" />{preview.unrelatedRecipients.length > 0 && <p className="border-t border-amber-100 bg-amber-50 p-3 text-xs text-amber-700">ผู้รับที่ไม่เกี่ยวข้อง: {preview.unrelatedRecipients.join(", ")}</p>}</div>}
      {status.error && <p className="mt-3 text-xs text-red-600">{status.error}</p>}
      <div className="mt-5 flex justify-end gap-2"><button type="button" disabled={status.sending} onClick={onClose} className="ui-button ui-button-secondary text-xs">Cancel</button>{status.duplicate && <button type="button" disabled={status.sending} onClick={() => submit(true)} className="ui-button ui-button-danger text-xs">Send anyway</button>}{preview && !status.duplicate ? <button type="button" disabled={status.sending} onClick={() => submit(false)} className="ui-button ui-button-primary text-xs">{status.sending ? "Sending…" : "Confirm & Send"}</button> : !preview ? <button type="button" disabled={status.sending || !taskKeys.length || !recipientEmails.length} onClick={prepare} className="ui-button ui-button-primary text-xs">{status.sending ? "Preparing…" : "Preview & Confirm"}</button> : null}</div>
    </>}
  </Dialog.Popup></Dialog.Portal></Dialog.Root>
}
