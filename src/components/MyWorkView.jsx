import { useEffect, useState } from "react"
import TaskTable from "./TimelineTable"
import { DEFAULT_MY_WORK_FILTERS, filterMyWorkTasks, myWorkMonths, partitionMyWorkTasks } from "../lib/workViews"

const WORKFLOWS = [
  ["all", "All workflow"],
  ["not_started", "Not started"],
  ["in_progress", "In progress"],
  ["waiting_client", "Waiting client"],
  ["blocked", "Blocked"],
]

export default function MyWorkView({ tasks, memberName, workflow, tableProps, preferenceOwner = "local" }) {
  const storageKey = `magic-my-work-filters:${preferenceOwner}`
  const [filters, setFilters] = useState(() => {
    try { return { ...DEFAULT_MY_WORK_FILTERS, ...JSON.parse(localStorage.getItem(storageKey) || "{}") } }
    catch { return DEFAULT_MY_WORK_FILTERS }
  })
  useEffect(() => { localStorage.setItem(storageKey, JSON.stringify(filters)) }, [filters, storageKey])

  if (!memberName) return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-8 text-center">
      <h2 className="font-bold text-amber-800">บัญชียังไม่ได้ผูกกับชื่อพนักงาน</h2>
      <p className="mt-1 text-sm text-amber-600">กรุณาให้ Admin เลือก Member ในหน้า Admin Settings</p>
    </div>
  )
  const filtered = filterMyWorkTasks(tasks, filters, workflow, tableProps.remarks, tableProps.brandNameForTask)
  const groups = partitionMyWorkTasks(filtered.active, workflow)
  const sections = [
    ["Blocked", "bg-red-500", groups.blocked],
    ["Overdue", "bg-orange-500", groups.overdue],
    ["Due Today", "bg-amber-400", groups.today],
    ["Next 7 Days", "bg-purple-400", groups.next7],
    ["Later", "bg-gray-300", groups.later],
    ["Unscheduled", "bg-slate-400", groups.unscheduled],
  ]
  const isDefault = JSON.stringify(filters) === JSON.stringify(DEFAULT_MY_WORK_FILTERS)
  return (
    <div>
      <div className="mb-5 rounded-2xl border border-purple-100 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-purple-400">My Work</p>
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
            className="rounded-xl border border-purple-100 px-3 py-2 text-sm outline-none focus:border-purple-400"
          />
          <select value={filters.month} onChange={(event) => setFilters((current) => ({ ...current, month: event.target.value }))} className="rounded-xl border border-purple-100 bg-white px-3 py-2 text-sm text-gray-600">
            <option value="all">All months</option>
            {myWorkMonths(tasks).map((month) => <option key={month} value={month}>{month}</option>)}
          </select>
          <select value={filters.workflow} onChange={(event) => setFilters((current) => ({ ...current, workflow: event.target.value }))} className="rounded-xl border border-purple-100 bg-white px-3 py-2 text-sm text-gray-600">
            {WORKFLOWS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-purple-100 px-3 py-2 text-xs font-semibold text-purple-600">
            <input type="checkbox" checked={filters.showCompleted} onChange={(event) => setFilters((current) => ({ ...current, showCompleted: event.target.checked }))} />
            Completed ({filtered.completed.length})
          </label>
          <button type="button" disabled={isDefault} onClick={() => setFilters(DEFAULT_MY_WORK_FILTERS)} className="rounded-xl border border-purple-200 px-3 py-2 text-xs font-semibold text-purple-500 hover:bg-purple-50 disabled:opacity-40">Reset</button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {sections.map(([label,, items]) => <span key={label} className="rounded-full bg-purple-50 px-3 py-1 text-purple-600">{label}: <strong>{items.length}</strong></span>)}
        </div>
      </div>
      {sections.map(([title, badge, sectionTasks]) => sectionTasks.length > 0 && (
        <TaskTable key={title} {...tableProps} title={title} badge={badge} tasks={sectionTasks} workflow={workflow} />
      ))}
      {filters.showCompleted && filtered.completed.length > 0 && <TaskTable {...tableProps} title="Completed" badge="bg-green-500" tasks={filtered.completed} workflow={workflow} />}
      {Object.values(groups).every((items) => items.length === 0) && (!filters.showCompleted || filtered.completed.length === 0) && (
        <div className="rounded-2xl border border-green-100 bg-green-50 p-10 text-center text-sm font-semibold text-green-600">
          {tasks.length ? "ไม่พบงานตามตัวกรอง" : "ไม่มีงานค้าง"}
        </div>
      )}
    </div>
  )
}
