import { useEffect, useState } from "react"
import TaskTable from "./TimelineTable"
import { DEFAULT_MY_WORK_FILTERS, filterMyWorkTasks, myWorkMonths, normalizeMyWorkFilters, partitionMyWorkTasks, selectNextAction } from "../lib/workViews"
import { daysFrom } from "../lib/dates"
import { taskKey } from "../lib/sharedState"
import Emoji from "./Emoji"
import { emojiText } from "../lib/uiEmoji"

const WORKFLOWS = [
  ["all", "All workflow"],
  ["not_started", emojiText("notStarted", "Not started")],
  ["in_progress", emojiText("inProgress", "In progress")],
  ["waiting_client", emojiText("waitingClient", "Waiting client")],
  ["blocked", emojiText("blocked", "Blocked")],
]

export default function MyWorkView({ tasks, memberName, workflow, tableProps, preferenceOwner = "local" }) {
  const storageKey = `magic-my-work-filters:${preferenceOwner}`
  const [filters, setFilters] = useState(() => {
    try { return normalizeMyWorkFilters(JSON.parse(localStorage.getItem(storageKey) || "{}")) }
    catch { return DEFAULT_MY_WORK_FILTERS }
  })
  const months = myWorkMonths(tasks)
  const effectiveFilters = filters.month === "all" || months.includes(filters.month) ? filters : { ...filters, month: "all" }
  useEffect(() => { localStorage.setItem(storageKey, JSON.stringify(filters)) }, [filters, storageKey])

  if (!memberName) return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-8 text-center">
      <h2 className="font-bold text-amber-800"><Emoji name="warning" /> บัญชียังไม่ได้ผูกกับชื่อพนักงาน</h2>
      <p className="mt-1 text-sm text-amber-600">กรุณาให้ Admin เลือก Member ในหน้า Admin Settings</p>
    </div>
  )
  const filtered = filterMyWorkTasks(tasks, effectiveFilters, workflow, tableProps.remarks, tableProps.brandNameForTask)
  const groups = partitionMyWorkTasks(filtered.active, workflow)
  const nextAction = selectNextAction(groups)
  const sections = [
    ["Blocked", "blocked", "bg-rose-500", groups.blocked],
    ["Overdue", "overdue", "bg-red-500", groups.overdue],
    ["Due Today", "dueToday", "bg-amber-400", groups.today],
    ["Next 7 Days", "next7", "bg-blue-500", groups.next7],
    ["Later", "later", "bg-gray-300", groups.later],
    ["Unscheduled", "unscheduled", "bg-slate-400", groups.unscheduled],
  ]
  const isDefault = JSON.stringify(effectiveFilters) === JSON.stringify(DEFAULT_MY_WORK_FILTERS)
  return (
    <div>
      <div className="ui-card mb-5 rounded-2xl border-[var(--ui-brand-border)] p-5">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--ui-brand)]">My Work</p>
            <h1 className="mt-1 text-xl font-black text-purple-900">งานของ {memberName}</h1>
          </div>
          <div className="text-xs text-gray-400">แสดง <strong className="text-purple-600">{filtered.active.length}</strong> งานค้าง จาก {tasks.filter((task) => !task.done).length}</div>
        </div>

        <div className="mt-4 grid gap-2 md:grid-cols-[minmax(220px,1fr)_160px_170px_auto_auto]">
          <input
            type="search"
            value={filters.query}
            onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))}
            placeholder="ค้นหาแบรนด์, topic, คน หรือ note..."
            className="ui-field text-sm"
          />
          <select value={effectiveFilters.month} onChange={(event) => setFilters((current) => ({ ...current, month: event.target.value }))} className="ui-field text-sm text-gray-600">
            <option value="all">All months</option>
            {months.map((month) => <option key={month} value={month}>{month}</option>)}
          </select>
          <select value={filters.workflow} onChange={(event) => setFilters((current) => ({ ...current, workflow: event.target.value }))} className="ui-field text-sm text-gray-600">
            {WORKFLOWS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <label data-active={filters.showCompleted} className="ui-chip flex cursor-pointer items-center gap-2 rounded-xl border border-purple-100 px-3 py-2 text-xs font-semibold text-purple-600">
            <input type="checkbox" checked={filters.showCompleted} onChange={(event) => setFilters((current) => ({ ...current, showCompleted: event.target.checked }))} />
            Completed ({filtered.completed.length})
          </label>
          <button type="button" disabled={isDefault} onClick={() => setFilters(DEFAULT_MY_WORK_FILTERS)} className="ui-button ui-button-secondary text-xs disabled:opacity-40">Reset</button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {sections.map(([label, emoji,, items]) => <span key={label} className="ui-chip rounded-full bg-purple-50 px-3 py-1 text-purple-600"><Emoji name={emoji} /> {label}: <strong key={items.length} className="ui-data-change">{items.length}</strong></span>)}
        </div>
      </div>
      {nextAction && (
        <button type="button" onClick={() => tableProps.onOpenTask?.(nextAction)} className="ui-next-action mb-5 flex w-full items-center justify-between gap-4 rounded-2xl p-5 text-left text-white">
          <span className="min-w-0">
            <span className="text-[10px] font-bold uppercase tracking-widest text-purple-200">Next Action</span>
            <span className="mt-1 block truncate text-base font-bold">{tableProps.brandNameForTask(nextAction)} · {nextAction.topic}</span>
            <span className="mt-1 block text-xs text-purple-200">{workflow[taskKey(nextAction)] === "blocked" ? <><Emoji name="blocked" /> Blocked — ต้องจัดการก่อน</> : daysFrom(nextAction.dueDate) < 0 ? <><Emoji name="overdue" /> {Math.abs(daysFrom(nextAction.dueDate))} days late</> : nextAction.dueDate ? <><Emoji name="upcoming" /> Due {nextAction.dueDate}</> : <><Emoji name="unscheduled" /> ยังไม่มีกำหนดส่ง</>}</span>
          </span>
          <span className="shrink-0 rounded-lg bg-white/15 px-3 py-2 text-xs font-bold">เปิดรายละเอียด</span>
        </button>
      )}
      {sections.map(([title, emoji, badge, sectionTasks]) => sectionTasks.length > 0 && (
        <TaskTable key={title} {...tableProps} title={title} titleEmoji={emoji} badge={badge} tasks={sectionTasks} workflow={workflow} />
      ))}
      {filters.showCompleted && filtered.completed.length > 0 && <TaskTable {...tableProps} title="Completed" titleEmoji="done" badge="bg-green-500" tasks={filtered.completed} workflow={workflow} />}
      {Object.values(groups).every((items) => items.length === 0) && (!filters.showCompleted || filtered.completed.length === 0) && (
        <div className="rounded-2xl border border-green-100 bg-green-50 p-10 text-center text-sm font-semibold text-green-600">
          {tasks.length ? <><Emoji name="search" /> ไม่พบงานตามตัวกรอง</> : <><Emoji name="celebration" /> ไม่มีงานค้าง</>}
        </div>
      )}
    </div>
  )
}
