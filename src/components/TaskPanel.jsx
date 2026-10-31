import { AlertDialog } from "@base-ui/react/alert-dialog"
import { Dialog } from "@base-ui/react/dialog"
import { XIcon } from "@phosphor-icons/react/dist/csr/X"
import { useCallback, useEffect, useState } from "react"
import ActivityHistory from "./ActivityHistory"
import { taskSheetUrl } from "../lib/sharedState"
import Emoji from "./Emoji"
import { emojiText } from "../lib/uiEmoji"
import { formatThaiDate } from "../lib/dates"
import WorkflowSelect from "./WorkflowSelect"
import { MILESTONE_TYPES, completedLateDays, milestoneForTask, milestoneNeedsDate } from "../lib/brandTimeline"

function statusLabel(status) {
  if (status === "saving") return <span className="text-[10px] text-purple-500"><Emoji name="save" /> Saving…</span>
  if (status === "saved") return <span className="text-[10px] text-green-600"><Emoji name="done" /> Saved</span>
  if (status === "failed") return <span className="text-[10px] font-semibold text-red-500"><Emoji name="warning" /> Save failed</span>
  return null
}

function normalizedPriority(value) {
  if (value === "fire") return "urgent"
  if (value === "think") return "high"
  return value || "normal"
}

export default function TaskPanel({
  taskKey,
  task,
  brandName,
  note = "",
  noteVersion = 0,
  noteConflict = null,
  priority = "",
  workflow = "not_started",
  nextAction = "",
  milestoneOverrides = {},
  saveStatus = {},
  configured,
  editable = true,
  onUpdateNote,
  onDiscardNoteConflict,
  onUpdatePriority,
  onUpdateWorkflow,
  onUpdateNextAction,
  canManualNotify = false,
  onManualNotify,
  onToggleDone,
  onRefresh,
  onClose,
}) {
  const [draft, setDraft] = useState(note)
  const [draftDirty, setDraftDirty] = useState(false)
  const [baseNote, setBaseNote] = useState(note)
  const [baseVersion, setBaseVersion] = useState(noteVersion)
  const [actionDraft, setActionDraft] = useState(nextAction)
  const [actionDirty, setActionDirty] = useState(false)
  const [actionError, setActionError] = useState("")
  const [completion, setCompletion] = useState({ saving: false, error: "" })
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false)
  const noteStatus = saveStatus[`remarks:${taskKey}`]
  const remoteChanged = draftDirty && noteVersion !== baseVersion
  const conflict = noteConflict || (remoteChanged ? { currentNote: note, noteVersion } : null)
  const hasUnsavedNote = draftDirty || actionDirty || noteStatus === "saving" || noteStatus === "failed"
  const sheetUrl = taskSheetUrl(task, taskKey)

  const loadActivity = useCallback(() => { window.dispatchEvent(new Event('timeline:activity')) }, [])

  const requestClose = useCallback(() => {
    if (hasUnsavedNote) { setCloseConfirmOpen(true); return }
    onClose()
  }, [hasUnsavedNote, onClose])

  useEffect(() => {
    const timer = setTimeout(loadActivity, 0)
    return () => clearTimeout(timer)
  }, [loadActivity])

  // Synchronize remote values during render only while the editor is clean.
  // Dirty drafts retain their base version so concurrent edits surface a conflict.
  if (!draftDirty && (baseNote !== note || baseVersion !== noteVersion)) {
    setDraft(note)
    setBaseNote(note)
    setBaseVersion(noteVersion)
  }
  if (!actionDirty && actionDraft !== nextAction) setActionDraft(nextAction)

  const saveNote = async (forceNote = false) => {
    if (!draftDirty && noteStatus !== "failed") return
    const expectedNoteVersion = forceNote ? conflict?.noteVersion ?? noteVersion : baseVersion
    if (await onUpdateNote(taskKey, draft.trim(), { expectedNoteVersion, forceNote })) {
      setDraftDirty(false)
      setBaseNote(draft.trim())
      await loadActivity()
    }
  }
  const loadLatestNote = () => {
    const latest = conflict?.currentNote ?? note
    const version = conflict?.noteVersion ?? noteVersion
    setDraft(latest)
    setBaseNote(latest)
    setBaseVersion(version)
    setDraftDirty(false)
    onDiscardNoteConflict(taskKey, latest, version)
  }
  const updateAndReload = async (callback) => { if (await callback()) await loadActivity() }
  const changeWorkflow = async (next) => {
    setActionError("")
    if (await onUpdateWorkflow(taskKey, next, actionDirty ? actionDraft.trim() : undefined)) {
      setActionDirty(false)
      await loadActivity()
    }
  }
  const saveNextAction = async () => {
    setActionError("")
    if (await onUpdateNextAction(taskKey, actionDraft.trim())) { setActionDirty(false); await loadActivity() }
  }
  const toggleDone = async () => {
    setCompletion({ saving: true, error: "" })
    const saved = await onToggleDone(task, !task.done)
    setCompletion(saved ? { saving: false, error: "" } : { saving: false, error: "บันทึก Done ไม่สำเร็จ กรุณาลองใหม่" })
    if (saved) await loadActivity()
  }

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) requestClose() }}>
      <Dialog.Portal>
        <Dialog.Backdrop className="ui-overlay-enter fixed inset-0 z-[var(--z-overlay)] bg-black/35" />
          <Dialog.Popup className="ui-panel-enter fixed inset-y-0 right-0 z-[var(--z-modal)] h-[100dvh] w-full max-w-[600px] overflow-y-auto border-l border-[var(--ui-border)] bg-white p-5 shadow-[var(--shadow-overlay)] sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--ui-brand)]">Task details</p>
            <Dialog.Title id="task-panel-title" className="mt-1 text-2xl font-black text-purple-900">{brandName || "Task unavailable"}</Dialog.Title>
            {task && <p className="mt-1 text-lg font-semibold text-[var(--ui-text)]">{milestoneForTask(task, milestoneOverrides) && <span className={`brand-milestone-badge ${MILESTONE_TYPES[milestoneForTask(task, milestoneOverrides)].className} mr-2 align-middle`}><span aria-hidden="true">{MILESTONE_TYPES[milestoneForTask(task, milestoneOverrides)].icon}</span>{MILESTONE_TYPES[milestoneForTask(task, milestoneOverrides)].label}</span>}{task.topic}</p>}
            {task && <p className="mt-1 text-xs text-gray-500">{task.month || "No month"}</p>}
          </div>
          <button type="button" onClick={requestClose} aria-label="Close task panel" className="ui-icon-button"><XIcon aria-hidden="true" size={19} weight="bold" /></button>
        </div>

        {!task ? (
          <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
            <Emoji name="warning" /> งานนี้อาจถูกปิดใช้งานหรือข้อมูลยัง sync ไม่สำเร็จ
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={onRefresh} className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold">Refresh</button>
              {sheetUrl && <a href={sheetUrl} target="_blank" rel="noreferrer" className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white">Open Sheet</a>}
            </div>
          </div>
        ) : (
          <>
            <div className="mt-6 grid grid-cols-2 gap-3 rounded-xl border border-[var(--ui-brand-border)] bg-[var(--ui-brand-tint)] p-4 text-xs">
              <div><span className="text-gray-400">Responsibility</span><div className="mt-1 font-semibold text-gray-700">{task.responsibility || "—"}</div></div>
              <div><span className="text-gray-400">Due date</span><div className="mt-1 font-semibold text-gray-700">{task.dueDate ? formatThaiDate(task.dueDate) : <><Emoji name="unscheduled" /> Unscheduled</>}{milestoneNeedsDate(task, milestoneOverrides) && <span className="brand-milestone-missing-date ml-1">Missing date</span>}</div></div>
              <div><span className="text-gray-400">Actual submit</span><div className="mt-1 font-semibold text-gray-700">{formatThaiDate(task.actualSubmit)}</div></div>
              {Object.entries(task.sourceDates || {}).map(([name, value]) => <div key={name}><span className="text-gray-400">{name}</span><div className="mt-1 font-semibold text-gray-700">{formatThaiDate(value, value || '-')}</div></div>)}
              {task.actualSubmit && task.dueDate && completedLateDays(task) > 0 && <div><span className="text-gray-400">Late by</span><div className="mt-1 font-semibold text-red-600">{completedLateDays(task)} days</div></div>}
              <div><span className="text-gray-400">Task ID</span><div className="mt-1 truncate font-mono text-[10px] text-gray-500">{task.taskId}</div></div>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="text-xs font-semibold text-gray-600">Workflow
                <div className="mt-1"><WorkflowSelect disabled={!editable} value={workflow} onValueChange={changeWorkflow} className="w-full" /></div>
                {statusLabel(saveStatus[`workflow:${taskKey}`])}
                {saveStatus[`workflow:${taskKey}`] === "failed" && <button type="button" onClick={() => updateAndReload(() => onUpdateWorkflow(taskKey, workflow, actionDraft.trim()))} className="ml-2 text-[10px] font-semibold text-red-500"><Emoji name="retry" /> Retry</button>}
              </label>
              <label className="text-xs font-semibold text-gray-600">Priority
                <select disabled={!editable} value={normalizedPriority(priority)} onChange={(event) => updateAndReload(() => onUpdatePriority(taskKey, event.target.value))} className="ui-field mt-1 block w-full text-sm disabled:bg-gray-100">
                  <option value="normal">Normal</option><option value="high">{emojiText("high", "High")}</option><option value="urgent">{emojiText("urgent", "Urgent")}</option>
                </select>
                {statusLabel(saveStatus[`priorities:${taskKey}`])}
                {saveStatus[`priorities:${taskKey}`] === "failed" && <button type="button" onClick={() => updateAndReload(() => onUpdatePriority(taskKey, priority))} className="ml-2 text-[10px] font-semibold text-red-500"><Emoji name="retry" /> Retry</button>}
              </label>
            </div>

            <label className="mt-5 block text-xs font-semibold text-gray-600">Next Action <span className="font-normal text-gray-400">(ไม่บังคับ)</span>
              <textarea disabled={!editable} value={actionDraft} maxLength={2000} rows={3} onChange={(event) => { setActionDraft(event.target.value); setActionDirty(event.target.value.trim() !== nextAction); setActionError("") }} className={`ui-field mt-1 block w-full resize-y text-sm disabled:bg-gray-100 ${actionError ? "border-red-300" : ""}`} placeholder="ระบุสิ่งที่ต้องทำต่อให้ชัดเจน..." />
            </label>
            <div className="mt-2 flex items-center gap-2"><button type="button" disabled={!editable || !actionDirty} onClick={saveNextAction} className="ui-button ui-button-primary text-xs disabled:opacity-40"><Emoji name="save" /> Save Next Action</button>{statusLabel(saveStatus[`nextActions:${taskKey}`])}{actionError && <span className="text-xs text-red-600">{actionError}</span>}</div>

            <label className="mt-5 block text-xs font-semibold text-gray-600"><Emoji name="remark" /> Note
              <textarea disabled={!editable} value={draft} maxLength={5000} onChange={(event) => { setDraft(event.target.value); setDraftDirty(event.target.value.trim() !== baseNote) }} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); saveNote() } }} rows={5} className="ui-field mt-1 block w-full resize-y text-sm disabled:bg-gray-100" placeholder="เพิ่มรายละเอียดหรือสิ่งที่ต้องติดตาม..." />
            </label>
            {conflict && <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800"><p>Note นี้มีข้อมูลใหม่จากอีกหน้าจอ</p><div className="mt-2 flex gap-2"><button type="button" onClick={loadLatestNote} className="ui-button ui-button-secondary text-xs">โหลดค่าล่าสุด</button><button type="button" onClick={() => saveNote(true)} className="ui-button ui-button-primary text-xs">บันทึกทับ</button></div></div>}
            <div className="mt-2 flex items-center gap-2">
              <button type="button" onClick={() => saveNote(false)} disabled={!editable || !hasUnsavedNote || noteStatus === "saving" || Boolean(conflict)} className="ui-button ui-button-primary text-xs disabled:opacity-40"><Emoji name="save" /> Save note</button>
              {statusLabel(noteStatus)}
              {noteStatus === "failed" && !conflict && <button type="button" onClick={() => saveNote(false)} className="text-xs font-semibold text-red-500"><Emoji name="retry" /> Retry</button>}
              <span className="ml-auto text-[10px] text-gray-300">⌘/Ctrl + Enter</span>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-5">
              <button type="button" disabled={!editable || completion.saving} onClick={toggleDone} className={`ui-button rounded-lg px-4 py-2 text-xs font-bold text-white ${task.done ? "bg-gray-500" : "bg-green-600"} disabled:opacity-50`}>{completion.saving ? <><Emoji name="save" /> Saving…</> : task.done ? <><Emoji name="notStarted" /> Mark not done</> : <><Emoji name="done" /> Mark done</>}</button>
              {!editable && <span className="text-xs text-gray-400">ดูได้อย่างเดียว</span>}
              {completion.error && <><span className="text-xs text-red-500">{completion.error}</span><button type="button" onClick={toggleDone} className="text-xs font-semibold text-red-600"><Emoji name="retry" /> Retry</button></>}
              {sheetUrl && <a href={sheetUrl} target="_blank" rel="noreferrer" className="ml-auto rounded-lg border border-purple-200 px-4 py-2 text-xs font-semibold text-purple-600 hover:bg-purple-50">Open Google Sheet</a>}
              {canManualNotify && <button type="button" onClick={onManualNotify} className="ui-button ui-button-secondary text-xs">Send Notification</button>}
            </div>
          </>
        )}

        <div className="mt-7 border-t border-gray-100 pt-5">
          {configured && <ActivityHistory key={taskKey} taskKey={taskKey} />}
        </div>
          </Dialog.Popup>
      </Dialog.Portal>
      <AlertDialog.Root open={closeConfirmOpen} onOpenChange={setCloseConfirmOpen}>
        <AlertDialog.Portal>
          <AlertDialog.Backdrop className="ui-overlay-enter fixed inset-0 z-[var(--z-alert)] bg-black/45" />
          <AlertDialog.Popup className="ui-popover ui-modal-enter fixed left-1/2 top-1/2 z-[calc(var(--z-alert)+1)] w-[min(26rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 p-5">
            <AlertDialog.Title className="text-base font-bold text-[var(--ui-text)]">ปิดโดยยังไม่บันทึกข้อมูล?</AlertDialog.Title>
            <AlertDialog.Description className="mt-2 text-sm text-[var(--ui-muted)]">Note หรือ Next Action ที่แก้ล่าสุดอาจหายไป คุณต้องการปิดรายละเอียดงานต่อหรือไม่</AlertDialog.Description>
            <div className="mt-5 flex justify-end gap-2"><AlertDialog.Close className="ui-button ui-button-secondary ui-button-md">กลับไปแก้ไข</AlertDialog.Close><button type="button" className="ui-button ui-button-danger ui-button-md" onClick={onClose}>ปิดโดยไม่บันทึก</button></div>
          </AlertDialog.Popup>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </Dialog.Root>
  )
}
