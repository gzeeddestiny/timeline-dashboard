import { useEffect, useState } from "react"
import { ArrowRightIcon } from "@phosphor-icons/react/dist/csr/ArrowRight"
import { CheckCircleIcon } from "@phosphor-icons/react/dist/csr/CheckCircle"
import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/csr/MagnifyingGlass"
import { WarningCircleIcon } from "@phosphor-icons/react/dist/csr/WarningCircle"
import TaskTable from "./TimelineTable"
import { DEFAULT_MY_WORK_FILTERS, filterMyWorkTasks, myWorkMonths, normalizeMyWorkFilters, partitionMyWorkTasks, selectNextAction } from "../lib/workViews"
import { daysFrom, formatThaiDate } from "../lib/dates"
import { taskKey } from "../lib/sharedState"
import Emoji from "./Emoji"
import { Banner, Button, Card, EmptyState } from "./ui"
import WorkflowSelect from "./WorkflowSelect"
import { WORKFLOW_FILTER_OPTIONS } from "../lib/workflowConfig"
import { useLiveResource } from "../lib/useLiveResource"
import { fetchFollowUp, snoozeTaskNotification } from "../lib/fullSystem"
import TaskIdentity from "./TaskIdentity"

export default function MyWorkView({ tasks, memberName, workflow, tableProps, preferenceOwner = "local" }) {
  const storageKey = `magic-my-work-filters:${preferenceOwner}`
  const [filters, setFilters] = useState(() => {
    try { return normalizeMyWorkFilters(JSON.parse(localStorage.getItem(storageKey) || "{}")) }
    catch { return DEFAULT_MY_WORK_FILTERS }
  })
  const [noActivityOnly, setNoActivityOnly] = useState(() => new URLSearchParams(window.location.search).get("attention") === "no_activity")
  const { data: followUp, reload: refreshNoActivity, error: activityError } = useLiveResource(fetchFollowUp, { items: [] })
  const noActivityItems = followUp.items.filter((item) => item.noActivity)
  const noActivityKeys = new Set(noActivityItems.map((item) => item.taskKey))
  const snooze = async (item) => {
    const until = window.prompt("Snooze ถึงวันที่ (YYYY-MM-DD, ไม่เกิน 30 วัน)")
    if (!until) return
    const reason = window.prompt("เหตุผลที่ Snooze")
    if (!reason?.trim()) return
    try { await snoozeTaskNotification({ taskKey: item.taskKey, until, reason }); await refreshNoActivity() }
    catch (error) { window.alert(error.message) }
  }
  const months = myWorkMonths(tasks)
  const effectiveFilters = filters.month === "all" || months.includes(filters.month) ? filters : { ...filters, month: "all" }
  useEffect(() => { localStorage.setItem(storageKey, JSON.stringify(filters)) }, [filters, storageKey])

  if (!memberName) return (
    <Banner tone="warning" icon={<WarningCircleIcon size={22} weight="duotone" />}>
      <h1 className="font-bold text-amber-800">บัญชียังไม่ได้ผูกกับชื่อพนักงาน</h1>
      <p className="mt-1 text-sm text-amber-600">กรุณาให้ Admin เลือก Member ในหน้า Admin Settings</p>
    </Banner>
  )
  const scopedTasks = noActivityOnly ? tasks.filter((task) => noActivityKeys.has(taskKey(task))) : tasks
  const filtered = filterMyWorkTasks(scopedTasks, effectiveFilters, workflow, tableProps.remarks, tableProps.brandNameForTask)
  const groups = partitionMyWorkTasks(filtered.active, workflow)
  const nextAction = selectNextAction(groups)
  const sections = [
    ["Hold", "blocked", "bg-rose-500", groups.blocked],
    ["Overdue", "overdue", "bg-red-500", groups.overdue],
    ["Due Today", "dueToday", "bg-amber-400", groups.today],
    ["Next 7 Days", "next7", "bg-blue-500", groups.next7],
    ["Later", "later", "bg-gray-300", groups.later],
    ["Unscheduled", "unscheduled", "bg-slate-400", groups.unscheduled],
  ]
  const isDefault = JSON.stringify(effectiveFilters) === JSON.stringify(DEFAULT_MY_WORK_FILTERS)
  return (
    <div>
      <Card className="mb-5 overflow-hidden border-[var(--ui-brand-border)]">
        <div className="border-b border-[var(--ui-border)] bg-gradient-to-r from-[var(--ui-brand-tint)] to-white p-5 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.16em] text-[var(--ui-brand)]">My Work</p>
            <h1 className="mt-1 text-2xl font-extrabold tracking-[-.025em] text-[var(--ui-text)]">งานของ {memberName}</h1>
          </div>
          <div className="text-xs text-[var(--ui-muted)]">แสดง <strong className="text-[var(--ui-brand)]">{filtered.active.length}</strong> งานค้าง จาก {tasks.filter((task) => !task.done).length}</div>
        </div>
        </div>

        <div className="grid gap-2 p-4 sm:grid-cols-[minmax(220px,1fr)_160px_170px_auto_auto] sm:p-5">
          <label className="relative"><span className="sr-only">ค้นหางาน</span><MagnifyingGlassIcon aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ui-muted)]" size={17} /><input type="search" value={filters.query} onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))} placeholder="ค้นหาแบรนด์, topic, คน หรือ note..." className="ui-field pl-9 text-sm" /></label>
          <select aria-label="กรองตามเดือน" value={effectiveFilters.month} onChange={(event) => setFilters((current) => ({ ...current, month: event.target.value }))} className="ui-field text-sm text-[var(--ui-muted)]">
            <option value="all">All months</option>
            {months.map((month) => <option key={month} value={month}>{month}</option>)}
          </select>
          <WorkflowSelect ariaLabel="กรองตาม Workflow" value={filters.workflow} options={WORKFLOW_FILTER_OPTIONS} onValueChange={(next) => setFilters((current) => ({ ...current, workflow: next }))} className="w-full text-[var(--ui-muted)]" />
          <label data-active={filters.showCompleted} className="ui-chip flex cursor-pointer items-center gap-2 px-3 py-2 text-xs font-semibold">
            <input type="checkbox" checked={filters.showCompleted} onChange={(event) => setFilters((current) => ({ ...current, showCompleted: event.target.checked }))} />
            Completed ({filtered.completed.length})
          </label>
          <label data-active={noActivityOnly} className="ui-chip flex cursor-pointer items-center gap-2 px-3 py-2 text-xs font-semibold"><input type="checkbox" checked={noActivityOnly} onChange={(event) => setNoActivityOnly(event.target.checked)} />No Activity ({noActivityKeys.size})</label>
          <Button size="sm" disabled={isDefault} onClick={() => setFilters(DEFAULT_MY_WORK_FILTERS)}>Reset</Button>
        </div>
        <div className="flex flex-wrap gap-2 border-t border-[var(--ui-border)] px-4 py-3 text-xs sm:px-5">
          {sections.map(([label, emoji,, items]) => <span key={label} className="ui-chip px-3 py-1.5"><Emoji name={emoji} /> {label}: <strong key={items.length} className="ui-data-change">{items.length}</strong></span>)}
        </div>
      </Card>
      {activityError && <p role="alert" className="text-xs text-red-600">โหลด No Activity ไม่สำเร็จ: {activityError}</p>}
      {noActivityOnly && noActivityItems.length > 0 && <Card className="mb-5 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-sm font-bold text-purple-900">No Activity follow-up</h2><p className="text-xs text-gray-400">Activity ใหม่จะล้าง Snooze อัตโนมัติ</p></div></div><div className="mt-3 divide-y divide-gray-100">{noActivityItems.map((item) => <div key={item.taskKey} className="flex flex-wrap items-center justify-between gap-3 py-2 text-xs"><button type="button" onClick={() => tableProps.onOpenTask?.(tasks.find((task) => taskKey(task) === item.taskKey))} className="min-w-0"><TaskIdentity brand={item.brandName || item.projectName} task={item.taskName} /><span className="text-gray-400">Last Action {item.activity?.lastActivityKind !== "task_discovered" && item.activity?.lastActivityAt ? formatThaiDate(item.activity.lastActivityAt) : "ยังไม่มี action ที่บันทึกไว้"}</span></button><button type="button" onClick={() => snooze(item)} className="ui-button ui-button-secondary ui-button-sm">Snooze</button></div>)}</div></Card>}
      {nextAction && (
        <button type="button" onClick={() => tableProps.onOpenTask?.(nextAction)} className="ui-next-action mb-5 flex w-full items-center justify-between gap-4 rounded-[var(--radius-card)] p-5 text-left text-white sm:p-6">
          <span className="min-w-0">
            <span className="text-xs font-bold uppercase tracking-[.16em] text-purple-200">Next Action</span>
            <span className="mt-1 block truncate text-lg font-extrabold">{tableProps.brandNameForTask(nextAction)}</span>
            <span className="block truncate text-sm font-medium text-purple-100">{nextAction.topic}</span>
            <span className="mt-1 block text-xs text-purple-200">{workflow[taskKey(nextAction)] === "blocked" ? <><Emoji name="blocked" /> Hold — ต้องจัดการก่อน</> : daysFrom(nextAction.dueDate) < 0 ? <><Emoji name="overdue" /> เกินกำหนด {Math.abs(daysFrom(nextAction.dueDate))} วัน</> : nextAction.dueDate ? <><Emoji name="upcoming" /> กำหนด {formatThaiDate(nextAction.dueDate)}</> : <><Emoji name="unscheduled" /> ยังไม่มีกำหนดส่ง</>}</span>
          </span>
          <span className="flex shrink-0 items-center gap-1.5 rounded-lg bg-white/15 px-3 py-2 text-xs font-bold">เปิดรายละเอียด <ArrowRightIcon aria-hidden="true" size={16} /></span>
        </button>
      )}
      {sections.map(([title, emoji, badge, sectionTasks]) => sectionTasks.length > 0 && (
        <TaskTable key={title} {...tableProps} title={title} titleEmoji={emoji} badge={badge} tasks={sectionTasks} workflow={workflow} />
      ))}
      {filters.showCompleted && filtered.completed.length > 0 && <TaskTable {...tableProps} title="Completed" titleEmoji="done" badge="bg-green-500" tasks={filtered.completed} workflow={workflow} />}
      {Object.values(groups).every((items) => items.length === 0) && (!filters.showCompleted || filtered.completed.length === 0) && (
        <EmptyState icon={<CheckCircleIcon size={32} weight="duotone" />} title={tasks.length ? "ไม่พบงานตามตัวกรอง" : "ไม่มีงานค้าง"} description={tasks.length ? "ลองปรับคำค้นหา เดือน หรือ Workflow" : "งานทั้งหมดได้รับการจัดการแล้ว"} />
      )}
    </div>
  )
}
