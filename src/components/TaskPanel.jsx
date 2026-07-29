import { useCallback, useEffect, useRef, useState } from "react"
import { listTaskEvents } from "../lib/fullSystem"
import { taskSheetUrl } from "../lib/sharedState"

const WORKFLOWS = [
  ["not_started", "Not started"],
  ["in_progress", "In progress"],
  ["waiting_client", "Waiting client"],
  ["blocked", "Blocked"],
]

function statusLabel(status) {
  if (status === "saving") return <span className="text-[10px] text-purple-500">Saving…</span>
  if (status === "saved") return <span className="text-[10px] text-green-600">Saved</span>
  if (status === "failed") return <span className="text-[10px] font-semibold text-red-500">Save failed</span>
  return null
}

export default function TaskPanel({
  taskKey,
  task,
  brandName,
  note = "",
  priority = "",
  workflow = "not_started",
  saveStatus = {},
  configured,
  onUpdateNote,
  onUpdatePriority,
  onUpdateWorkflow,
  onToggleDone,
  onRefresh,
  onClose,
}) {
  const [draft, setDraft] = useState(note)
  const [activity, setActivity] = useState({ loading: configured, error: "", items: [] })
  const [completion, setCompletion] = useState({ saving: false, error: "" })
  const closeRef = useRef(null)
  const previousFocus = useRef(null)
  const noteStatus = saveStatus[`remarks:${taskKey}`]
  const hasUnsavedNote = draft.trim() !== note || noteStatus === "saving" || noteStatus === "failed"
  const sheetUrl = taskSheetUrl(task, taskKey)

  const loadActivity = useCallback(async () => {
    if (!configured) return setActivity({ loading: false, error: "", items: [] })
    setActivity((current) => ({ ...current, loading: true, error: "" }))
    try { setActivity({ loading: false, error: "", items: await listTaskEvents(taskKey) }) }
    catch (error) { setActivity((current) => ({ ...current, loading: false, error: error.message })) }
  }, [configured, taskKey])

  const requestClose = useCallback(() => {
    if (hasUnsavedNote && !window.confirm("Note ยังบันทึกไม่สำเร็จ ต้องการปิด panel หรือไม่?")) return
    onClose()
  }, [hasUnsavedNote, onClose])

  useEffect(() => {
    previousFocus.current = document.activeElement
    closeRef.current?.focus()
    return () => { previousFocus.current?.focus?.() }
  }, [])

  useEffect(() => {
    const timer = setTimeout(loadActivity, 0)
    return () => clearTimeout(timer)
  }, [loadActivity])

  useEffect(() => {
    const keydown = (event) => { if (event.key === "Escape") requestClose() }
    document.addEventListener("keydown", keydown)
    return () => {
      document.removeEventListener("keydown", keydown)
    }
  }, [requestClose])

  const saveNote = async () => {
    if (draft.trim() === note && noteStatus !== "failed") return
    if (await onUpdateNote(taskKey, draft.trim())) await loadActivity()
  }
  const updateAndReload = async (callback) => { if (await callback()) await loadActivity() }
  const toggleDone = async () => {
    setCompletion({ saving: true, error: "" })
    const saved = await onToggleDone(task, !task.done)
    setCompletion(saved ? { saving: false, error: "" } : { saving: false, error: "บันทึก Done ไม่สำเร็จ กรุณาลองใหม่" })
    if (saved) await loadActivity()
  }

  return (
    <div className="fixed inset-0 z-[11000] flex justify-end bg-black/35" onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose() }}>
      <section role="dialog" aria-modal="true" aria-labelledby="task-panel-title" className="h-full w-full max-w-xl overflow-y-auto bg-white p-5 shadow-2xl sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-purple-400">Task details</p>
            <h2 id="task-panel-title" className="mt-1 text-xl font-black text-purple-900">{task?.topic || "Task unavailable"}</h2>
            {task && <p className="mt-1 text-sm text-gray-500">{brandName} · {task.month || "No month"}</p>}
          </div>
          <button ref={closeRef} type="button" onClick={requestClose} aria-label="Close task panel" className="rounded-lg p-2 text-gray-400 hover:bg-gray-100">✕</button>
        </div>

        {!task ? (
          <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
            งานนี้อาจถูกปิดใช้งานหรือข้อมูลยัง sync ไม่สำเร็จ
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={onRefresh} className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold">Refresh</button>
              {sheetUrl && <a href={sheetUrl} target="_blank" rel="noreferrer" className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white">Open Sheet</a>}
            </div>
          </div>
        ) : (
          <>
            <div className="mt-6 grid grid-cols-2 gap-3 rounded-xl border border-gray-100 bg-gray-50 p-4 text-xs">
              <div><span className="text-gray-400">Responsibility</span><div className="mt-1 font-semibold text-gray-700">{task.responsibility || "—"}</div></div>
              <div><span className="text-gray-400">Due date</span><div className="mt-1 font-semibold text-gray-700">{task.dueDate || "Unscheduled"}</div></div>
              <div><span className="text-gray-400">Actual submit</span><div className="mt-1 font-semibold text-gray-700">{task.actualSubmit || "—"}</div></div>
              <div><span className="text-gray-400">Task ID</span><div className="mt-1 truncate font-mono text-[10px] text-gray-500">{task.taskId}</div></div>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="text-xs font-semibold text-gray-600">Workflow
                <select value={workflow} onChange={(event) => updateAndReload(() => onUpdateWorkflow(taskKey, event.target.value))} className="mt-1 block w-full rounded-lg border border-purple-100 bg-white px-3 py-2 text-sm">
                  {WORKFLOWS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
                {statusLabel(saveStatus[`workflow:${taskKey}`])}
                {saveStatus[`workflow:${taskKey}`] === "failed" && <button type="button" onClick={() => updateAndReload(() => onUpdateWorkflow(taskKey, workflow))} className="ml-2 text-[10px] font-semibold text-red-500">Retry</button>}
              </label>
              <label className="text-xs font-semibold text-gray-600">Priority
                <select value={priority || ""} onChange={(event) => updateAndReload(() => onUpdatePriority(taskKey, event.target.value))} className="mt-1 block w-full rounded-lg border border-purple-100 bg-white px-3 py-2 text-sm">
                  <option value="">None</option><option value="fire">Fire</option><option value="think">Think</option>
                </select>
                {statusLabel(saveStatus[`priorities:${taskKey}`])}
                {saveStatus[`priorities:${taskKey}`] === "failed" && <button type="button" onClick={() => updateAndReload(() => onUpdatePriority(taskKey, priority))} className="ml-2 text-[10px] font-semibold text-red-500">Retry</button>}
              </label>
            </div>

            <label className="mt-5 block text-xs font-semibold text-gray-600">Note
              <textarea value={draft} maxLength={5000} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); saveNote() } }} rows={5} className="mt-1 block w-full resize-y rounded-xl border border-purple-100 px-3 py-2 text-sm outline-none focus:border-purple-400" placeholder="เพิ่มรายละเอียดหรือสิ่งที่ต้องติดตาม..." />
            </label>
            <div className="mt-2 flex items-center gap-2">
              <button type="button" onClick={saveNote} disabled={!hasUnsavedNote || noteStatus === "saving"} className="rounded-lg bg-purple-700 px-4 py-2 text-xs font-bold text-white disabled:opacity-40">Save note</button>
              {statusLabel(noteStatus)}
              {noteStatus === "failed" && <button type="button" onClick={saveNote} className="text-xs font-semibold text-red-500">Retry</button>}
              <span className="ml-auto text-[10px] text-gray-300">⌘/Ctrl + Enter</span>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-5">
              <button type="button" disabled={completion.saving} onClick={toggleDone} className={`rounded-lg px-4 py-2 text-xs font-bold text-white ${task.done ? "bg-gray-500" : "bg-green-600"} disabled:opacity-50`}>{completion.saving ? "Saving…" : task.done ? "Mark not done" : "Mark done"}</button>
              {completion.error && <><span className="text-xs text-red-500">{completion.error}</span><button type="button" onClick={toggleDone} className="text-xs font-semibold text-red-600">Retry</button></>}
              {sheetUrl && <a href={sheetUrl} target="_blank" rel="noreferrer" className="ml-auto rounded-lg border border-purple-200 px-4 py-2 text-xs font-semibold text-purple-600 hover:bg-purple-50">Open Google Sheet</a>}
            </div>
          </>
        )}

        <div className="mt-7 border-t border-gray-100 pt-5">
          <div className="flex items-center justify-between"><h3 className="text-xs font-bold uppercase tracking-widest text-purple-400">Activity</h3><button type="button" onClick={loadActivity} className="text-[10px] font-semibold text-purple-500">Refresh</button></div>
          {activity.loading ? <p className="mt-3 text-xs text-gray-400">Loading activity…</p> : activity.error ? <p className="mt-3 text-xs text-red-500">{activity.error} <button type="button" onClick={loadActivity} className="font-semibold underline">Retry</button></p> : activity.items.length ? (
            <div className="mt-3 divide-y divide-gray-50">{activity.items.map((event) => <div key={event.id} className="py-2 text-xs"><div className="font-medium text-gray-700">{event.event_type} · {event.resource.replaceAll("_", " ")}</div><div className="mt-0.5 text-[10px] text-gray-400">{event.actor_email || "System"} · {new Date(event.created_at).toLocaleString("th-TH")}</div></div>)}</div>
          ) : <p className="mt-3 text-xs text-gray-400">ยังไม่มี activity สำหรับงานนี้</p>}
        </div>
      </section>
    </div>
  )
}
