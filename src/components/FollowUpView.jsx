import { useMemo, useState } from "react"
import { fetchFollowUp, snoozeTaskNotification, setupActivityTracking } from "../lib/fullSystem"
import { formatThaiDate, formatThaiDateTime } from "../lib/dates"
import ActivityHistory from "./ActivityHistory"
import EmployeeActivity from "./EmployeeActivity"
import LastAction from "./LastAction"
import { useLiveResource } from "../lib/useLiveResource"
import { Card, EmptyState, Skeleton } from "./ui"
import TaskIdentity from "./TaskIdentity"
import { newestActivityFirst } from "../lib/activity"

export default function FollowUpView({ onOpenTask, onManualNotification }) {
  const { data, loading, error, reload: load, fetchedAt } = useLiveResource(fetchFollowUp, { items: [], dataIssues: [], trackingIssues: [] })
  const [actionError, setActionError] = useState("")
  const status = { loading, error: actionError || error }
  const [setupBusy, setSetupBusy] = useState(false)
  const [setupMessage, setSetupMessage] = useState("")
  const [query, setQuery] = useState("")
  const [actor, setActor] = useState("")
  const selectActor = (email) => {
    setActor(email)
    if (email) document.getElementById("follow-up-history")?.scrollIntoView({ behavior: "smooth", block: "start" })
  }
  const [filters, setFilters] = useState({ employee: "all", project: "all", status: "all", age: "all", snooze: "all" })
  const employees = useMemo(() => [...new Set(data.items.flatMap((item) => item.ownerNames))].sort((a, b) => a.localeCompare(b, "th")), [data.items])
  const projects = useMemo(() => [...new Set(data.items.map((item) => item.projectName))].sort((a, b) => a.localeCompare(b, "th")), [data.items])
  const statuses = useMemo(() => [...new Set(data.items.map((item) => item.status))].sort(), [data.items])
  const items = useMemo(() => data.items.filter((item) => {
    const matchesQuery = !query || [item.projectName, item.taskName, item.ownerNames.join(" "), item.status].join(" ").toLocaleLowerCase("th-TH").includes(query.toLocaleLowerCase("th-TH"))
    const snoozed = Boolean(item.activity?.snoozedUntil)
    return matchesQuery
      && (filters.employee === "all" || item.ownerNames.includes(filters.employee))
      && (filters.project === "all" || item.projectName === filters.project)
      && (filters.status === "all" || item.status === filters.status)
      && (filters.age === "all" || (item.daysSinceUpdate ?? 0) >= Number(filters.age))
      && (filters.snooze === "all" || (filters.snooze === "snoozed" ? snoozed : !snoozed))
  }).sort(newestActivityFirst), [data.items, filters, query])
  const setupTracking = async () => {
    setSetupBusy(true)
    setSetupMessage('')
    try {
      let index = 0
      const installed = new Set(), errors = []
      do {
        const result = await setupActivityTracking(index)
        result.installed.forEach((id) => installed.add(id))
        errors.push(...(result.errors || []))
        setSetupMessage(`ตรวจแล้ว ${result.pending ? index : index + 1}/${result.total} Sheet · เปิดรับเหตุการณ์ ${installed.size} Sheet${result.pending ? ' · กำลังตรวจแท็บเพิ่มเติม…' : ''}`)
        index = result.nextIndex
      } while (index != null)
      setSetupMessage(errors.length ? errors.map((item) => `${item.spreadsheetId}: ${item.error}`).join(' · ') : `เปิดรับเหตุการณ์แล้ว ${installed.size} Sheet`)
      await load()
    } catch (error) { setSetupMessage(error.message) }
    finally { setSetupBusy(false) }
  }
  const snooze = async (item) => {
    const until = window.prompt("Snooze ถึงวันที่ (YYYY-MM-DD), ไม่เกิน 30 วัน")
    if (!until) return
    const reason = window.prompt("เหตุผลที่ Snooze")
    if (!reason) return
    try { await snoozeTaskNotification({ taskKey: item.taskKey, until, reason }); await load() }
    catch (error) { setActionError(error.message) }
  }
  return <div>
    <Card className="mb-5 p-5 sm:p-6"><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[.16em] text-[var(--ui-brand)]">Owner Follow-up</p><h1 className="mt-1 text-2xl font-extrabold">No Activity และ Data Issues</h1><p className="mt-1 text-sm text-[var(--ui-muted)]">ติดตามงานที่เงียบครบ 120 ชั่วโมง รวมรายการ Snoozed</p></div><div className="flex gap-2"><span className="ui-badge ui-badge-danger">{data.items.filter((item) => item.noActivity).length} No Activity</span><span className="ui-badge ui-badge-success">{data.items.filter((item) => item.updatedRecently).length} อัพเดทแล้ว</span></div></div><div className="mt-4 grid gap-2 sm:grid-cols-6"><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหา Project หรือ Task" className="ui-field text-sm sm:col-span-2" /><select value={filters.employee} onChange={(event) => setFilters((current) => ({ ...current, employee: event.target.value }))} className="ui-field text-xs"><option value="all">พนักงานทั้งหมด</option>{employees.map((name) => <option key={name}>{name}</option>)}</select><select value={filters.project} onChange={(event) => setFilters((current) => ({ ...current, project: event.target.value }))} className="ui-field text-xs"><option value="all">Project ทั้งหมด</option>{projects.map((name) => <option key={name}>{name}</option>)}</select><select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))} className="ui-field text-xs"><option value="all">Status ทั้งหมด</option>{statuses.map((value) => <option key={value}>{value}</option>)}</select><select value={filters.age} onChange={(event) => setFilters((current) => ({ ...current, age: event.target.value }))} className="ui-field text-xs"><option value="all">ทุก Activity age</option><option value="5">≥ 5 วัน</option><option value="10">≥ 10 วัน</option><option value="20">≥ 20 วัน</option></select><select value={filters.snooze} onChange={(event) => setFilters((current) => ({ ...current, snooze: event.target.value }))} className="ui-field text-xs"><option value="all">Snooze ทั้งหมด</option><option value="active">ไม่ Snooze</option><option value="snoozed">Snoozed</option></select></div></Card>
    <div className="mb-3 flex items-center justify-between text-xs text-gray-500"><span>ดึงข้อมูลล่าสุด {formatThaiDateTime(fetchedAt)} · อัปเดตทุก 2 นาที</span><button type="button" onClick={load} className="ui-button ui-button-secondary ui-button-sm">Refresh</button></div>
    {data.canSetupTracking && <div className="mb-3 text-xs"><button type="button" disabled={setupBusy} onClick={setupTracking} className="ui-button ui-button-secondary ui-button-sm">{setupBusy ? 'กำลังตั้งค่า…' : 'เปิด / ตรวจการติดตาม Sheet'}</button>{setupMessage && <p role="status" className="mt-2 text-amber-700">{setupMessage}</p>}</div>}
    <EmployeeActivity actor={actor} onSelectActor={selectActor} />
    {(data.trackingIssues || []).length > 0 && <Card className="mb-4 p-4"><h2 className="font-bold text-amber-800">การรับข้อมูล Sheet</h2>{data.trackingIssues.map((issue, index) => <p key={index} className="mt-2 text-xs text-amber-700">{issue}</p>)}</Card>}
    {status.error && <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-600">{status.error} <button type="button" onClick={load} className="font-semibold underline">Retry</button></p>}
    {status.loading ? <Card className="space-y-3 p-4" aria-label="กำลังโหลด Follow-up"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /><span className="sr-only">กำลังโหลด Follow-up</span></Card> : items.length ? <div className="ui-card ui-data-table-shell overflow-x-auto"><table className="ui-data-table w-full min-w-[960px] text-left text-xs"><thead className="bg-gray-50 text-gray-400"><tr><th className="px-4 py-3">Project / Task</th><th>Status</th><th>ผู้รับผิดชอบ</th><th>Deadline</th><th>Last Action</th><th>Next Action</th><th /></tr></thead><tbody className="divide-y divide-gray-100">{items.map((item) => <tr key={item.taskKey} className="ui-task-row"><td className="px-4 py-3"><button type="button" onClick={() => onOpenTask(item.taskKey)}><TaskIdentity brand={item.brandName || item.projectName} task={item.taskName} detail={item.projectName !== item.brandName ? item.projectName : ''} /></button>{item.activity?.snoozedUntil && <span className="mt-1 block text-[10px] text-amber-600">Snoozed ถึง {formatThaiDate(item.activity.snoozedUntil)} · {item.activity.snoozeReason}</span>}</td><td>{item.status}</td><td>{item.ownerNames.join(", ") || "-"}</td><td>{item.dueDate ? formatThaiDate(item.dueDate) : "-"}{item.daysOverdue > 0 && <span className="block font-semibold text-red-600">เกิน {item.daysOverdue} วัน</span>}</td><td><LastAction activity={item.activity} /><span className="block text-gray-400">{item.daysSinceUpdate ?? 0} วันที่แล้ว</span>{item.noActivity && <span className="block font-semibold text-red-600">No Activity</span>}{item.updatedRecently && <span className="ui-badge ui-badge-success mt-1">อัพเดทแล้ว</span>}</td><td className="max-w-52">{item.nextAction || "-"}</td><td className="px-4 py-3"><div className="flex gap-1">{!item.updatedRecently && <button type="button" onClick={() => snooze(item)} className="ui-button ui-button-secondary ui-button-sm">Snooze</button>}<button type="button" onClick={() => onManualNotification(item.taskKey)} className="ui-button ui-button-primary ui-button-sm">Notify</button></div></td></tr>)}</tbody></table></div> : <EmptyState title="ไม่มีรายการ Follow-up" description="Task ทั้งหมดมี Activity ใหม่หรือยังไม่ครบ 120 ชั่วโมง" />}
    <div id="follow-up-history"><ActivityHistory options={data.historyOptions} actor={actor} /></div>
    {data.dataIssues.length > 0 && <Card className="mt-5 p-5"><h2 className="font-bold text-amber-800">Data Issues · {data.dataIssues.length}</h2><div className="mt-3 divide-y divide-gray-100">{data.dataIssues.map((item) => <button type="button" key={item.taskKey} onClick={() => onOpenTask(item.taskKey)} className="block w-full py-2"><TaskIdentity brand={item.brandName || item.projectName} task={item.taskName} /><span className="mt-1 block text-left text-amber-700">{item.issues.join(" · ")}</span></button>)}</div></Card>}
  </div>
}
