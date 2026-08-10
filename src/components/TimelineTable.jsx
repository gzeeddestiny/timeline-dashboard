import { useState, Fragment, useMemo, useRef } from "react"
import { buildFileColorMap } from "../lib/sheetsApi"
import { taskKey as sharedTaskKey } from "../lib/sharedState"
import { daysFrom } from "../lib/dates"
import AssignTeam from "./AssignTeam"

// ─── Helpers ──────────────────────────────────────────────────────────────────

function daysFromToday(dueDate) {
  return daysFrom(dueDate)
}

function groupByClient(tasks) {
  return tasks.reduce((acc, task) => {
    const key = `${task.clientName}::${task.spreadsheetId}::${task.sheetGid}`
    if (!acc[key]) acc[key] = []
    acc[key].push(task)
    return acc
  }, {})
}

function fmtDate(iso) {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
}

/** Smooth red→yellow→green color based on completion % */
function progressColor(pct) {
  const hue = Math.round(pct * 1.2) // 0 = red (0°), 100 = green (120°)
  return `hsl(${hue}, 65%, 46%)`
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function SheetTabIcon() {
  return (
    <svg className="h-3 w-3 shrink-0 text-purple-400" viewBox="0 0 24 24" fill="currentColor">
      <path d="M19 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V5a2 2 0 00-2-2zm-7 14H7v-2h5v2zm5-4H7v-2h10v2zm0-4H7V7h10v2z"/>
    </svg>
  )
}

function TaskDetailButton({ task, onOpen }) {
  if (!onOpen) return null
  return (
    <button type="button" onClick={(event) => { event.stopPropagation(); onOpen(task) }} title="Open task details" className="ml-1.5 rounded-md border border-purple-100 bg-white/70 px-1.5 py-0.5 text-[9px] font-semibold text-purple-500 hover:bg-purple-100">
      Details
    </button>
  )
}

function ChevronIcon({ open }) {
  return (
    <svg
      className={`h-3.5 w-3.5 shrink-0 text-purple-300 transition-transform duration-200 ${open ? "rotate-90" : ""}`}
      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  )
}

// ─── Cell Components ──────────────────────────────────────────────────────────

function MonthCell({ month, compact }) {
  const pad = compact ? "px-5 py-2.5" : "px-5 py-4"
  if (!month) return <td className={`${pad} text-gray-400`}>—</td>
  const isInternal = month.toLowerCase() === "internal"
  return (
    <td className={pad}>
      <span className={`inline-block rounded-lg px-2.5 py-1 text-[11px] font-black tracking-widest uppercase ${
        isInternal ? "bg-[var(--ui-brand)] text-white" : "bg-[var(--ui-brand-soft)] text-[var(--ui-brand)]"
      }`}>
        {month}
      </span>
    </td>
  )
}

function StatusToggleCell({ task, onToggle, compact, editable = true }) {
  const size = compact ? "h-6 w-6" : "h-7 w-7"
  const icon = compact ? "h-3.5 w-3.5" : "h-4 w-4"
  const handleClick = (e) => {
    e.stopPropagation()
    if (editable && onToggle) onToggle(task, !task.done)
  }
  return (
    <td className={compact ? "px-4 py-2.5" : "px-4 py-4"}>
      <button
        type="button"
        onClick={handleClick}
        disabled={!editable}
        aria-label={task.done ? "Mark task not done" : "Mark task done"}
        title={!editable ? "Task editing is unavailable" : task.done ? "คลิกเพื่อยกเลิก" : "คลิกเพื่อ Mark Done"}
        className={`inline-flex items-center justify-center rounded-full transition-colors duration-150 cursor-pointer ${size} ${
          task.done ? "bg-green-100 hover:bg-green-200" : "bg-red-100 hover:bg-red-200"
        }`}
      >
        {task.done ? (
          <svg className={`text-green-600 ${icon}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <svg className={`text-red-400 ${icon}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        )}
      </button>
    </td>
  )
}

function ActualSubmitCell({ actualSubmit, compact }) {
  const pad = compact ? "px-5 py-2.5" : "px-5 py-4"
  if (!actualSubmit) return <td className={`${pad} text-gray-200 text-xs`}>—</td>
  return (
    <td className={pad}>
      <span className="text-xs font-medium text-green-600">{fmtDate(actualSubmit)}</span>
    </td>
  )
}

function overdueConfig(absDays) {
  if (absDays >= 15) return { cls: "bg-red-600 text-white", label: "Critical" }
  if (absDays >= 8) return { cls: "bg-red-200 text-red-800", label: "High" }
  if (absDays >= 4) return { cls: "bg-orange-100 text-orange-700", label: "Medium" }
  return { cls: "bg-amber-50 text-amber-700", label: "Low" }
}

function DaysLateCell({ dueDate, done, compact }) {
  const pad = compact ? "px-6 py-2.5" : "px-6 py-4"
  if (!dueDate) return <td className={`${pad} text-gray-300`}>—</td>
  if (done)     return <td className={pad}><span className="text-xs font-medium text-gray-400">Done</span></td>

  const days = daysFromToday(dueDate)
  if (days === null) return <td className={`${pad} text-gray-300`}>—</td>

  if (days < 0) {
    const { cls, label } = overdueConfig(Math.abs(days))
    return (
      <td className={pad}>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${cls}`}>
          <span>{Math.abs(days)} days late</span><span className="text-[9px] uppercase opacity-70">{label}</span>
        </span>
      </td>
    )
  }
  if (days === 0) return (
    <td className={pad}>
      <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-3 py-1 text-xs font-semibold text-orange-600">
        <span>Due today</span>
      </span>
    </td>
  )
  if (days <= 3) return (
    <td className={pad}>
      <span className="inline-block rounded-full bg-yellow-100 px-3 py-1 text-xs font-semibold text-yellow-700">+{days} days</span>
    </td>
  )
  return (
    <td className={pad}>
      <span className="inline-block rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-700">+{days} days</span>
    </td>
  )
}

const WORKFLOW_OPTIONS = [
  ["not_started", "Not started"],
  ["in_progress", "In progress"],
  ["waiting_client", "Waiting client"],
  ["blocked", "Blocked"],
]

function WorkflowCell({ task, workflow, onUpdate, saveStatus, compact, editable = true }) {
  const key = sharedTaskKey(task)
  const value = workflow[key] || "not_started"
  return (
    <td className={compact ? "px-3 py-2.5" : "px-3 py-4"} onClick={(event) => event.stopPropagation()}>
      {task.done ? <span className="text-xs font-semibold text-green-600">Done</span> : (
        <div className="flex items-center gap-1">
          <select
            value={value}
            disabled={!editable}
            onChange={(event) => onUpdate?.(key, event.target.value)}
            className={`ui-field min-h-0 px-2 py-1 text-[11px] font-medium text-gray-600 ${saveStatus === "failed" ? "border-red-300" : ""}`}
          >
            {WORKFLOW_OPTIONS.map(([option, label]) => <option key={option} value={option}>{label}</option>)}
          </select>
          {saveStatus === "saving" && <span className="text-[9px] text-purple-700">Saving…</span>}
          {saveStatus === "failed" && <button type="button" onClick={() => onUpdate?.(key, value)} className="text-[9px] font-semibold text-red-500">Retry</button>}
        </div>
      )}
    </td>
  )
}

// ─── Priority Toggle Button ──────────────────────────────────────────────────
// Compact business priority control. Legacy values are normalized on read.

const PRIORITY_ORDER = ["normal", "high", "urgent"]

function normalizePriority(value) {
  if (value === "fire") return "urgent"
  if (value === "think") return "high"
  return value || "normal"
}

function PriorityToggle({ taskKey, legacyKey, priorities, onUpdate, editable = true }) {
  const value = normalizePriority(priorities[taskKey] || priorities[legacyKey])

  const cycle = (e) => {
    e.stopPropagation()
    const idx = PRIORITY_ORDER.indexOf(value)
    const nextVal = PRIORITY_ORDER[(idx + 1) % PRIORITY_ORDER.length]
    if (editable) onUpdate(taskKey, nextVal)
  }

  return (
    <button
      onClick={cycle}
      disabled={!editable}
      className={`ml-1 shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase transition ${value === "urgent" ? "border-red-200 bg-red-50 text-red-600" : value === "high" ? "border-amber-200 bg-amber-50 text-amber-600" : "border-gray-200 bg-white text-gray-400"}`}
      title={`Priority: ${value}. Click to change.`}
    >
      {value}
    </button>
  )
}

/** Get priority CSS class for a row */
function getPriorityClass(taskKey, legacyKey, priorities) {
  const v = normalizePriority(priorities[taskKey] || priorities[legacyKey])
  if (v === "urgent") return "priority-urgent"
  if (v === "high") return "priority-high"
  return ""
}

// ─── Remark Cell ──────────────────────────────────────────────────────────────

function RemarkCell({ taskKey, legacyKey, remarks, onUpdate, saveStatus, compact, editable = true }) {
  const value = remarks[taskKey] ?? remarks[legacyKey] ?? ""
  const [editing, setEditing] = useState(false)
  const [draft,   setDraft  ] = useState("")
  const cancelRef = useRef(false)

  const startEdit = () => { if (!editable) return; cancelRef.current = false; setDraft(value); setEditing(true) }
  const save = () => {
    if (!cancelRef.current && draft.trim() !== value) onUpdate(taskKey, draft.trim())
    cancelRef.current = false
    setEditing(false)
  }
  const cancel = () => { cancelRef.current = true; setEditing(false) }
  const clear     = (e) => { e.stopPropagation(); onUpdate(taskKey, "") }

  const pad = compact ? "px-4 py-2.5" : "px-4 py-4"

  if (editing) {
    return (
      <td className={pad}>
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur() }
            if (e.key === "Escape") { e.preventDefault(); cancel() }
          }}
          placeholder="เพิ่ม note..."
          className="ui-field w-36 min-h-0 px-2.5 py-1.5 text-xs text-gray-700"
        />
      </td>
    )
  }

  return (
    <td className={pad}>
      <div className="group flex min-w-[80px] items-center gap-1.5">
        {value ? (
          <>
            <button type="button" onClick={startEdit} disabled={!editable} className="max-w-[140px] flex-1 text-left text-xs text-gray-500 line-clamp-2 hover:text-purple-700 disabled:cursor-default">{value}</button>
            <button
              type="button"
              onClick={clear}
              disabled={!editable}
              aria-label="Clear note"
              className="shrink-0 rounded p-1 text-gray-300 hover:text-red-500 focus-visible:text-red-500 disabled:hidden"
            >
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </>
        ) : (
          <button type="button" onClick={startEdit} disabled={!editable} className="text-xs italic text-gray-400 hover:text-purple-700 disabled:cursor-default">
            + note
          </button>
        )}
        {saveStatus === "saving" && <span className="text-[9px] text-purple-700">Saving…</span>}
        {saveStatus === "saved" && value && <span className="text-[9px] text-green-500">Saved</span>}
        {saveStatus === "failed" && (
          <button onClick={(e) => { e.stopPropagation(); onUpdate(taskKey, value) }} className="text-[9px] font-semibold text-red-500 hover:text-red-700">
            Retry
          </button>
        )}
      </div>
    </td>
  )
}

// ─── Progress Bar ─────────────────────────────────────────────────────────────

function ProgressBar({ stats }) {
  if (!stats || stats.total === 0) return null
  const pct   = Math.round((stats.done / stats.total) * 100)
  const color = progressColor(pct)
  return (
    <div className="mt-1.5 flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-gray-100">
        <div
          className="h-full rounded-full transition-[width] duration-150"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <span className="text-[10px] font-bold tabular-nums" style={{ color }}>
        {pct}%
      </span>
      <span className="text-[10px] text-gray-300">{stats.done}/{stats.total}</span>
    </div>
  )
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <tr>
      <td className="px-4 py-4"><div className="h-7 w-7 rounded-full bg-red-100" /></td>
      <td className="px-5 py-4"><div className="h-6 w-16 rounded-lg bg-purple-100" /></td>
      <td className="px-6 py-4"><div className="h-5 w-32 rounded-full bg-purple-100" /></td>
      <td className="px-6 py-4"><div className="h-4 w-48 rounded bg-gray-200" /></td>
      <td className="px-6 py-4"><div className="h-4 w-32 rounded bg-gray-200" /></td>
      <td className="px-6 py-4"><div className="h-4 w-24 rounded bg-gray-200" /></td>
      <td className="px-5 py-4"><div className="h-4 w-24 rounded bg-gray-100" /></td>
      <td className="px-6 py-4"><div className="h-6 w-20 rounded-full bg-gray-200" /></td>
      <td className="px-4 py-4"><div className="h-4 w-24 rounded bg-gray-100" /></td>
    </tr>
  )
}

function MobileTaskCard({ task, brandName, onOpen, onToggle, workflow, priorities, editable }) {
  const key = sharedTaskKey(task)
  const priority = normalizePriority(priorities[key])
  const late = daysFromToday(task.dueDate)
  return (
    <article className={`ui-card rounded-2xl p-4 ${priority === "urgent" ? "priority-urgent border-red-200" : priority === "high" ? "priority-high border-amber-200" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-purple-500">
            <span>{brandName}</span><span>·</span><span>{task.month || "No month"}</span>
            {priority !== "normal" && <span className={priority === "urgent" ? "text-red-600" : "text-amber-600"}>{priority}</span>}
          </div>
          <h3 className="mt-1 text-sm font-bold text-gray-800">{task.topic}</h3>
          <p className="mt-1 text-xs text-gray-500">{task.responsibility || "ยังไม่ระบุผู้รับผิดชอบ"}</p>
        </div>
        <button type="button" disabled={!editable} onClick={() => onToggle?.(task, !task.done)} aria-label={task.done ? "Mark not done" : "Mark done"} className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold disabled:opacity-40 ${task.done ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-400"}`}>{task.done ? "✓" : "○"}</button>
      </div>
      <div className="mt-3 flex items-center gap-2 text-[11px]">
        <span className="rounded-full bg-white/80 px-2 py-1 font-semibold text-gray-600">{(workflow[key] || "not_started").replaceAll("_", " ")}</span>
        <span className={late !== null && late < 0 && !task.done ? "font-bold text-red-600" : "text-gray-400"}>{task.dueDate ? late < 0 && !task.done ? `${Math.abs(late)} days late` : `Due ${fmtDate(task.dueDate)}` : "Unscheduled"}</span>
        <button type="button" onClick={() => onOpen?.(task)} className="ui-button ui-button-primary ml-auto px-3 py-2 font-bold">รายละเอียด</button>
      </div>
    </article>
  )
}

// ─── TaskTable ────────────────────────────────────────────────────────────────

export default function TaskTable({ title, badge, tasks, isLoading, clientStats = {}, remarks = {}, onUpdateRemark, priorities = {}, onUpdatePriority, assignments = {}, onUpdateAssignment, teamMembers = [], brandNameForTask = (task) => task.clientName, assignmentKeyForTask = (task) => task.clientName, saveStatus = {}, onToggle, onOpenTask, workflow = {}, onUpdateWorkflow, canManageAssignments = true, canEditTask = () => true }) {
  const [expanded, setExpanded] = useState(new Set())
  const fileColorMap = useMemo(() => buildFileColorMap(tasks), [tasks])

  const toggle = (name) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(name) ? next.delete(name) : next.add(name)
      return next
    })

  const grouped   = groupByClient(tasks)
  const groupList = Object.entries(grouped)

  const handleRemark = onUpdateRemark || (() => {})

  return (
    <div className="mb-6">
      <div className="mb-3 flex items-center gap-2">
        {badge && <span className={`h-2 w-2 rounded-full ${badge}`} />}
        <h2 className="text-xs font-bold uppercase tracking-widest text-[var(--ui-brand)]">{title}</h2>
      </div>

      <div className="space-y-2 sm:hidden">
        {isLoading ? <div className="ui-card rounded-2xl p-6 text-center text-sm text-[var(--ui-muted)]">Loading…</div> : tasks.length ? tasks.map((task) => <MobileTaskCard key={sharedTaskKey(task)} task={task} brandName={brandNameForTask(task)} onOpen={onOpenTask} onToggle={onToggle} workflow={workflow} priorities={priorities} editable={canEditTask(task)} />) : <div className="ui-card rounded-2xl p-6 text-center text-sm text-[var(--ui-muted)]">No tasks found</div>}
      </div>

      <div className="ui-card hidden overflow-x-auto rounded-2xl sm:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--ui-border)] bg-[var(--ui-surface-subtle)] text-left text-[11px] font-bold uppercase tracking-wider text-[var(--ui-muted)]">
              <th className="px-4 py-4">Status</th>
              <th className="px-3 py-4">Workflow</th>
              <th className="px-5 py-4">Month</th>
              <th className="px-6 py-4">
                <span className="flex items-center gap-1.5"><SheetTabIcon />Client Name</span>
              </th>
              <th className="px-6 py-4">Content / Topic</th>
              <th className="px-6 py-4">Responsibility</th>
              <th className="px-6 py-4">Due Date</th>
              <th className="px-5 py-4">Actual Submit</th>
              <th className="px-6 py-4">Days Late</th>
              <th className="px-4 py-4">Remark</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-[var(--ui-border)]">
            {isLoading ? (
              Array.from({ length: 3 }).map((_, i) => <SkeletonRow key={i} />)

            ) : tasks.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-6 py-10 text-center text-sm text-[var(--ui-muted)]">
                  No tasks found — sync a Google Sheet to load data
                </td>
              </tr>

            ) : groupList.map(([groupKey, clientTasks], groupIdx) => {
              const rawClientName = clientTasks[0].clientName
              const isOpen  = expanded.has(groupKey)
              const first   = clientTasks[0]
              const clientName = brandNameForTask(first)
              const assignmentKey = assignmentKeyForTask(first)
              const hasMore = clientTasks.length > 1
              const stats   = clientStats[groupKey]

              // File-level background color + left stripe
              const fc = fileColorMap[first.spreadsheetId || first.month || "unknown"]
              const rowBg    = fc ? `${fc.bg} border-l-4 ${fc.stripe}` : (groupIdx % 2 === 0 ? "bg-white" : "bg-purple-50/40")
              const rowHover = "ui-interactive"
              const subBg    = fc ? `${fc.sub} border-l-4 ${fc.stripe}` : (groupIdx % 2 === 0 ? "bg-purple-50/30" : "bg-purple-100/30")
              const subHover = "ui-interactive"
              const firstPriorityKey = sharedTaskKey(first)
              const firstLegacyKey = `${rawClientName}::${first.topic}`
              const firstPriorityCls = getPriorityClass(firstPriorityKey, firstLegacyKey, priorities)
              const firstEditable = canEditTask(first)

              return (
                <Fragment key={groupKey}>
                  {/* Group summary row */}
                  <tr
                    className={`transition-colors duration-150 ${firstPriorityCls || rowBg} ${rowHover}`}
                  >
                    <StatusToggleCell task={first} onToggle={onToggle} editable={firstEditable} />
                    <WorkflowCell task={first} workflow={workflow} onUpdate={onUpdateWorkflow} saveStatus={saveStatus[`workflow:${firstPriorityKey}`]} editable={firstEditable} />
                    <MonthCell month={first.month} />

                    {/* Client Name + Progress Bar */}
                    <td className="px-6 py-4">
                      <div className="flex items-start gap-2">
                        {hasMore ? <button type="button" onClick={() => toggle(groupKey)} aria-label={`${isOpen ? "Collapse" : "Expand"} ${clientName}`} aria-expanded={isOpen} className="rounded p-1 hover:bg-purple-100 focus:outline-none focus:ring-2 focus:ring-purple-300"><ChevronIcon open={isOpen} /></button> : <span className="w-5 shrink-0" />}
                        <div className="min-w-0">
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-purple-200 bg-purple-50 px-2.5 py-1 text-xs font-medium text-purple-700">
                            <SheetTabIcon />
                            {clientName}
                            {hasMore && (
                              <span className="ml-0.5 rounded-full bg-purple-200 px-1.5 py-0.5 text-[10px] font-bold text-purple-800">
                                {clientTasks.length}
                              </span>
                            )}
                          </span>
                          <ProgressBar stats={stats} />
                        </div>
                        {canManageAssignments && <AssignTeam
                          displayName={clientName}
                          assignmentKey={assignmentKey}
                          legacyKey={rawClientName}
                          assignments={assignments}
                          members={teamMembers}
                          onUpdate={onUpdateAssignment || (() => {})}
                          compact
                        />}
                        <PriorityToggle
                          taskKey={firstPriorityKey}
                          legacyKey={firstLegacyKey}
                          priorities={priorities}
                          onUpdate={onUpdatePriority || (() => {})}
                          editable={firstEditable}
                        />
                      </div>
                    </td>

                    <td className="px-6 py-4 font-medium text-gray-800">
                      {first.topic}
                      <TaskDetailButton task={first} onOpen={onOpenTask} />
                      <a
                        href={`https://docs.google.com/spreadsheets/d/${first.spreadsheetId}/edit#gid=${first.sheetGid}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-1.5 inline-block text-gray-300 hover:text-blue-500 transition-colors"
                        title="Open in Google Sheets"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <svg className="w-3.5 h-3.5 inline" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101" /><path strokeLinecap="round" strokeLinejoin="round" d="M10.172 13.828a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.102 1.101" /></svg>
                      </a>
                    </td>
                    <td className="px-6 py-4 text-gray-500">{first.responsibility}</td>
                    <td className="px-6 py-4 text-gray-500">{fmtDate(first.dueDate)}</td>
                    <ActualSubmitCell actualSubmit={first.actualSubmit} />
                    <DaysLateCell dueDate={first.dueDate} done={first.done} />
                    <RemarkCell
                      taskKey={firstPriorityKey}
                      legacyKey={firstLegacyKey}
                      remarks={remarks}
                      onUpdate={handleRemark}
                      saveStatus={saveStatus[`remarks:${firstPriorityKey}`]}
                      editable={firstEditable}
                    />
                  </tr>

                  {/* Expanded sub-rows */}
                  {isOpen && clientTasks.slice(1).map((task) => {
                    const subPriorityKey = sharedTaskKey(task)
                    const subLegacyKey = `${task.clientName}::${task.topic}`
                    const subPriorityCls = getPriorityClass(subPriorityKey, subLegacyKey, priorities)
                    const subEditable = canEditTask(task)
                    return (
                    <tr key={subPriorityKey} className={`${subPriorityCls || subBg} transition-colors duration-150 ${subHover}`}>
                      <StatusToggleCell task={task} onToggle={onToggle} compact editable={subEditable} />
                      <WorkflowCell task={task} workflow={workflow} onUpdate={onUpdateWorkflow} saveStatus={saveStatus[`workflow:${subPriorityKey}`]} compact editable={subEditable} />
                      <MonthCell month={task.month} compact />
                      <td className="py-2.5 pl-14 pr-6">
                        <span className="text-xs text-purple-200">└</span>
                      </td>
                      <td className="px-6 py-2.5 text-gray-600">
                        {task.topic}
                        <TaskDetailButton task={task} onOpen={onOpenTask} />
                        <a
                          href={`https://docs.google.com/spreadsheets/d/${task.spreadsheetId}/edit#gid=${task.sheetGid}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ml-1.5 inline-block text-gray-300 hover:text-blue-500 transition-colors"
                          title="Open in Google Sheets"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <svg className="w-3 h-3 inline" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101" /><path strokeLinecap="round" strokeLinejoin="round" d="M10.172 13.828a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.102 1.101" /></svg>
                        </a>
                      </td>
                      <td className="px-6 py-2.5 text-gray-400">{task.responsibility}</td>
                      <td className="px-6 py-2.5 text-gray-400">{fmtDate(task.dueDate)}</td>
                      <ActualSubmitCell actualSubmit={task.actualSubmit} compact />
                      <DaysLateCell dueDate={task.dueDate} done={task.done} compact />
                      <RemarkCell
                        taskKey={subPriorityKey}
                        legacyKey={subLegacyKey}
                        remarks={remarks}
                        onUpdate={handleRemark}
                        saveStatus={saveStatus[`remarks:${subPriorityKey}`]}
                        compact
                        editable={subEditable}
                      />
                    </tr>
                  )})}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      {!isLoading && (
        <p className="mt-2 text-right text-xs text-[var(--ui-muted)]">
          {groupList.length} {groupList.length === 1 ? "client" : "clients"} · {tasks.length} {tasks.length === 1 ? "task" : "tasks"}
        </p>
      )}
    </div>
  )
}

// ─── Completed Clients Section ───────────────────────────────────────────────

export function CompletedClients({ allTasks, assignments = {}, onUpdateAssignment, teamMembers = [], brandNameForTask = (task) => task.clientName, assignmentKeyForTask = (task) => task.clientName, canManageAssignments = true }) {
  if (!allTasks || allTasks.length === 0) return null

  // Calculate stats from allTasks directly (not from clientStats which may be stale)
  const statsMap = {}
  allTasks.forEach((t) => {
    const brandName = brandNameForTask(t)
    if (!statsMap[brandName]) statsMap[brandName] = { total: 0, done: 0, tasks: [] }
    statsMap[brandName].total++
    statsMap[brandName].tasks.push(t)
    if (t.done) statsMap[brandName].done++
  })

  // Find clients where 100% tasks are done
  const completedClients = Object.entries(statsMap)
    .filter(([, s]) => s.total > 0 && s.done >= s.total)
    .map(([name, stats]) => {
      const tasks = stats.tasks
      const dates = tasks.filter((t) => t.dueDate).map((t) => new Date(t.dueDate)).sort((a, b) => a - b)
      return {
        name,
        taskCount: stats.total,
        startDate: dates[0] || null,
        endDate: dates[dates.length - 1] || null,
        month: tasks[0]?.month || "",
        assignmentKey: assignmentKeyForTask(tasks[0]),
        legacyKey: tasks[0]?.clientName,
      }
    })

  if (completedClients.length === 0) return null

  const fmt = (d) => d ? d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : "—"
  const handleAssign = onUpdateAssignment || (() => {})

  return (
    <div className="mb-6">
      <div className="mb-3 flex items-center gap-2">
        <svg className="h-4 w-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <h2 className="text-xs font-bold uppercase tracking-widest text-green-500">Completed</h2>
        <span className="text-[10px] text-green-400">{completedClients.length} clients · 100% done</span>
      </div>

      <div className="space-y-2">
        {completedClients.map((client) => (
          <div
            key={client.assignmentKey}
            className="flex flex-wrap items-center gap-3 rounded-xl border border-green-100 bg-green-50/40 px-4 py-2.5 opacity-75 transition-opacity hover:opacity-100 sm:flex-nowrap"
          >
            {/* Check icon */}
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-green-500 shadow-sm">
              <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </span>

            {/* Client name */}
            <span className="inline-flex items-center gap-1.5 rounded-full border border-green-200 bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700">
              <SheetTabIcon />
              {client.name}
            </span>

            {/* Assign team */}
            {canManageAssignments && <AssignTeam
              displayName={client.name}
              assignmentKey={client.assignmentKey}
              legacyKey={client.legacyKey}
              assignments={assignments}
              members={teamMembers}
              onUpdate={handleAssign}
              compact
            />}

            {/* Task count */}
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-bold text-green-600">
              {client.taskCount} tasks
            </span>

            {/* Month tag */}
            {client.month && (
              <span className="rounded-md bg-green-100 px-2 py-0.5 text-[9px] font-black tracking-wider uppercase text-green-600">
                {client.month}
              </span>
            )}

            {/* Date range */}
            <span className="w-full text-[10px] text-green-400 sm:ml-auto sm:w-auto">
              {fmt(client.startDate)} — {fmt(client.endDate)}
            </span>

            {/* 100% badge */}
            <span className="rounded-full bg-green-500 px-2.5 py-0.5 text-[10px] font-bold text-white shadow-sm">
              100% ✓
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
