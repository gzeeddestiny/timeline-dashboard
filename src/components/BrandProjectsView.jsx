import { ArchiveIcon } from "@phosphor-icons/react/dist/csr/Archive"
import { BuildingsIcon } from "@phosphor-icons/react/dist/csr/Buildings"
import { CalendarBlankIcon } from "@phosphor-icons/react/dist/csr/CalendarBlank"
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight"
import { ChartBarIcon } from "@phosphor-icons/react/dist/csr/ChartBar"
import { CheckCircleIcon } from "@phosphor-icons/react/dist/csr/CheckCircle"
import { FileTextIcon } from "@phosphor-icons/react/dist/csr/FileText"
import { FlagIcon } from "@phosphor-icons/react/dist/csr/Flag"
import { FolderOpenIcon } from "@phosphor-icons/react/dist/csr/FolderOpen"
import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/csr/MagnifyingGlass"
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/csr/PencilSimple"
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus"
import { SparkleIcon } from "@phosphor-icons/react/dist/csr/Sparkle"
import { WarningCircleIcon } from "@phosphor-icons/react/dist/csr/WarningCircle"
import { useEffect, useMemo, useRef, useState } from "react"
import { Button, EmptyState } from "./ui"
import { ContractForm, ModalShell, ProjectForm, ProjectSection } from "./BrandView"
import { extractBrandName } from "../lib/sheetsApi"
import { normalizeBrandKey } from "../lib/sharedState"
import { bangkokDate, formatThaiDate } from "../lib/dates"
import {
  contractDaysRemaining,
  contractRadarRank,
  contractState,
  contractTypeLabel,
  formatRemainingDays,
  groupTasksBySource,
  isContractVisibleInRadar,
  projectDeliveryState,
  projectNameFromTab,
  projectDatesFromTab,
  renewalStatusLabel,
  RENEWAL_STATUSES,
  sourceTabKey,
  sourceTabRecords,
  timelinePosition,
  timelineRangeDates,
  timelineTodayOffset,
  TIMELINE_RANGES,
} from "../lib/brandTimeline"

function brandToken(brand) { return brand?.id || brand?.key || "" }

function contractTone(contract, today) {
  const state = contractState(contract, today)
  const remaining = contractDaysRemaining(contract, today)
  if (state === "expired") return "brand-contract-expired"
  if (state === "upcoming" || state === "future") return "brand-contract-upcoming"
  if (remaining !== null && remaining <= 7) return "brand-contract-critical"
  if (remaining !== null && remaining <= 14) return "brand-contract-alert"
  if (remaining !== null && remaining <= 30) return "brand-contract-watch"
  return "brand-contract-active"
}

function ContractBadge({ contract, today }) {
  const state = contractState(contract, today)
  const remaining = contractDaysRemaining(contract, today)
  const label = state === "upcoming" || state === "future" ? `เริ่ม ${formatThaiDate(contract.startDate)}` : formatRemainingDays(remaining)
  return <span className={`brand-contract-badge ${contractTone(contract, today)}`}><CalendarBlankIcon aria-hidden="true" size={13} />{label}</span>
}

function BrandForm({ open, brand, onClose, onSave }) {
  const [name, setName] = useState(brand?.name || "")
  const [saving, setSaving] = useState(false)
  const submit = async (event) => {
    event.preventDefault()
    if (!name.trim() || saving) return
    setSaving(true)
    const saved = await onSave?.({ id: brand?.id, name: name.trim() })
    setSaving(false)
    if (saved) onClose()
  }
  return <ModalShell open={open} onClose={onClose} title={brand ? "แก้ชื่อ Brand" : "สร้าง Brand"} description="สร้าง Brand ก่อนมี Contract หรือ Project ได้">
    <form className="mt-5 grid gap-4" onSubmit={submit}><label className="text-xs font-semibold text-[var(--ui-text-secondary)]">ชื่อ Brand<input autoFocus className="ui-field mt-1 block w-full" value={name} onChange={(event) => setName(event.target.value)} maxLength={300} placeholder="ชื่อแบรนด์หรือลูกค้า" required /></label><div className="flex justify-end gap-2"><button type="button" className="ui-button ui-button-secondary" onClick={onClose}>ยกเลิก</button><button type="submit" className="ui-button ui-button-primary" disabled={saving || !name.trim()}>{saving ? "กำลังบันทึก…" : "บันทึก Brand"}</button></div></form>
  </ModalShell>
}

function monthTicks(startDate, endDate) {
  const ticks = []
  const cursor = new Date(`${startDate}T00:00:00Z`)
  if (Number.isNaN(cursor.getTime())) return ticks
  cursor.setUTCDate(1)
  while (cursor.toISOString().slice(0, 10) <= endDate && ticks.length < 80) {
    const date = cursor.toISOString().slice(0, 10)
    const position = timelinePosition(date, startDate, endDate)
    if (position !== null) ticks.push({ date, position, label: cursor.toLocaleDateString("th-TH-u-ca-gregory", { month: "short", year: "2-digit", timeZone: "UTC" }) })
    cursor.setUTCMonth(cursor.getUTCMonth() + 1)
  }
  return ticks
}

function ContractGantt({ cards, today, range, onRangeChange, onSelectBrand }) {
  const rangeDates = useMemo(() => timelineRangeDates({ contracts: cards.map((card) => card.contract), range, today }), [cards, range, today])
  const ticks = useMemo(() => monthTicks(rangeDates.startDate, rangeDates.endDate), [rangeDates])
  const todayOffset = timelineTodayOffset(rangeDates.startDate, rangeDates.endDate, today)
  return <section className="brand-contract-overview" aria-labelledby="contract-overview-title">
    <div className="flex flex-wrap items-end justify-between gap-3 px-5 pb-4 pt-5"><div><div className="flex items-center gap-2"><ChartBarIcon className="text-[var(--ui-brand)]" size={20} weight="duotone" /><h2 id="contract-overview-title" className="text-base font-black tracking-tight text-[var(--ui-text)]">Contract Gantt</h2></div><p className="mt-1 text-[11px] text-[var(--ui-muted)]">หนึ่งแถวต่อหนึ่งสัญญา · กดแถวเพื่อดูรายละเอียด Brand ด้านล่าง</p></div><div className="flex gap-1">{TIMELINE_RANGES.map((item) => <button key={item.value} type="button" className="ui-chip px-2.5 py-1 text-[10px] font-bold" data-active={range === item.value} onClick={() => onRangeChange(item.value)}>{item.label}</button>)}</div></div>
    {cards.length ? <div className="brand-contract-gantt-scroll overflow-x-auto border-t border-[var(--ui-border)]"><div className="min-w-[64rem]">
      <div className="brand-contract-gantt-grid brand-contract-gantt-axis"><div className="sticky left-0 z-20 bg-[var(--ui-surface-muted)] px-4 py-2 text-[10px] font-bold text-[var(--ui-muted)]">BRAND / CONTRACT</div><div className="relative h-10 bg-[var(--ui-surface-muted)]">{ticks.map((tick) => <span key={tick.date} className="absolute top-3 border-l border-[var(--ui-border-strong)] pl-1 text-[9px] font-semibold text-[var(--ui-muted)]" style={{ left: `${tick.position * 100}%` }}>{tick.label}</span>)}{todayOffset !== null && <span className="absolute inset-y-0 z-20 w-px bg-[var(--ui-danger)]" style={{ left: `${todayOffset * 100}%` }}><span className="absolute left-1 top-0 text-[8px] font-black text-[var(--ui-danger)]">TODAY</span></span>}</div><div className="bg-[var(--ui-surface-muted)] px-3 py-2 text-right text-[10px] font-bold text-[var(--ui-muted)]">STATUS</div></div>
      {cards.map(({ contract, brand, delayedCount }) => {
        const left = (timelinePosition(contract.startDate, rangeDates.startDate, rangeDates.endDate) || 0) * 100
        const right = (timelinePosition(contract.endDate, rangeDates.startDate, rangeDates.endDate) || 0) * 100
        const elapsed = Math.max(0, Math.min(100, (timelinePosition(today, contract.startDate, contract.endDate) || 0) * 100))
        return <button type="button" className="brand-contract-gantt-grid group w-full text-left" key={contract.id} onClick={() => onSelectBrand(brandToken(brand), contract.id)}><div className="sticky left-0 z-10 min-w-0 border-t border-[var(--ui-border)] bg-white px-4 py-3 group-hover:bg-[var(--ui-brand-tint)]"><span className="block truncate text-xs font-black text-[var(--ui-text)]">{brand.name}</span><span className="mt-0.5 block truncate text-[10px] text-[var(--ui-muted)]">{contract.name} · {contractTypeLabel(contract.type)}</span></div><div className="relative min-h-14 border-t border-[var(--ui-border)] bg-white group-hover:bg-[var(--ui-brand-tint)]">{ticks.map((tick) => <span aria-hidden="true" key={tick.date} className="absolute inset-y-0 border-l border-[var(--ui-border)] opacity-50" style={{ left: `${tick.position * 100}%` }} />)}{todayOffset !== null && <span aria-hidden="true" className="absolute inset-y-0 z-10 w-px bg-[var(--ui-danger)] opacity-40" style={{ left: `${todayOffset * 100}%` }} />}<span className={`brand-contract-gantt-bar ${contractTone(contract, today)}`} style={{ left: `${left}%`, width: `${Math.max(1.5, right - left)}%` }}><span className="brand-contract-gantt-progress" style={{ width: `${elapsed}%` }} /><span className="relative z-10 truncate">{formatThaiDate(contract.startDate)} — {formatThaiDate(contract.endDate)}</span></span></div><div className="flex flex-col items-end justify-center gap-1 border-t border-[var(--ui-border)] bg-white px-3 group-hover:bg-[var(--ui-brand-tint)]"><ContractBadge contract={contract} today={today} />{delayedCount > 0 && <span className="text-[9px] font-bold text-[var(--ui-danger)]">{delayedCount} Projects ล่าช้า</span>}</div></button>
      })}
    </div></div> : <EmptyState icon={<FlagIcon size={26} weight="duotone" />} title="ยังไม่มี Contract สำหรับติดตาม" description="เลือก Brand ด้านล่างแล้วสร้าง Contract แรก" className="border-t border-[var(--ui-border)] py-10" />}
  </section>
}

function ProjectIntake({ tabs, catalog, canAdmin, onReview }) {
  const [open, setOpen] = useState(true)
  const [choices, setChoices] = useState({})
  const [names, setNames] = useState({})
  const [loadingKey, setLoadingKey] = useState(null)
  const activeBrands = catalog.filter((brand) => brand.active !== false)
  if (!tabs.length) return <section className="brand-intake-shell"><div className="flex items-center gap-3 p-5"><CheckCircleIcon className="text-[var(--ui-success)]" size={22} weight="duotone" /><div><h2 className="text-sm font-black text-[var(--ui-text)]">Project intake เรียบร้อย</h2><p className="mt-0.5 text-[11px] text-[var(--ui-muted)]">ทุก Google Sheet tab ถูกจัดเป็น Project แล้ว</p></div></div></section>
  return <section className="brand-intake-shell" aria-labelledby="project-intake-title"><button type="button" className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left" onClick={() => setOpen((value) => !value)} aria-expanded={open}><span className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-lg bg-amber-100 text-amber-800"><SparkleIcon size={18} weight="duotone" /></span><span><span id="project-intake-title" className="block text-sm font-black text-[var(--ui-text)]">เพิ่ม Project จาก Google Sheet</span><span className="mt-0.5 block text-[11px] text-[var(--ui-muted)]">{tabs.length} tabs รอการยืนยัน · หนึ่ง tab จะสร้างหนึ่ง Project</span></span></span><span className="ui-badge ui-badge-warning">ตรวจสอบก่อนสร้าง</span></button>{open && <div className="grid gap-2 border-t border-[var(--ui-border)] p-3">{tabs.map((tab) => {
    const normalizedTitle = normalizeBrandKey(tab.title)
    const catalogMatch = [...activeBrands]
      .filter((brand) => normalizedTitle.includes(brand.key))
      .sort((left, right) => right.key.length - left.key.length)[0]
    const suggestedName = names[tab.key] ?? catalogMatch?.name ?? extractBrandName(tab.title)
    const matched = activeBrands.find((brand) => brand.key === normalizeBrandKey(suggestedName))
    const choice = choices[tab.key] ?? catalogMatch?.id ?? matched?.id ?? "__new__"
    return <div key={tab.key} className="grid gap-3 rounded-xl bg-white p-3 ring-1 ring-[var(--ui-border)] lg:grid-cols-[minmax(0,1.2fr)_minmax(13rem,.75fr)_auto] lg:items-center"><div className="min-w-0"><div className="truncate text-xs font-bold text-[var(--ui-text)]" title={tab.title}>{tab.title}</div><div className="mt-1 text-[10px] text-[var(--ui-muted)]">{tab.count} tasks · Project: {projectNameFromTab(tab.title, suggestedName)}</div></div><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2"><label className="text-[10px] font-semibold text-[var(--ui-muted)]">Brand<select className="ui-field mt-1 block w-full min-h-9 py-1 text-xs" value={choice} disabled={!canAdmin} onChange={(event) => setChoices((current) => ({ ...current, [tab.key]: event.target.value }))}><option value="__new__">สร้าง Brand ใหม่</option>{activeBrands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}</select></label>{choice === "__new__" && <label className="text-[10px] font-semibold text-[var(--ui-muted)]">ชื่อ Brand<input className="ui-field mt-1 block w-full min-h-9 py-1 text-xs" value={suggestedName} disabled={!canAdmin} onChange={(event) => setNames((current) => ({ ...current, [tab.key]: event.target.value }))} /></label>}</div>{canAdmin ? <button type="button" className="ui-button ui-button-primary ui-button-sm" disabled={loadingKey === tab.key || (choice === "__new__" && !suggestedName.trim())} onClick={async () => { setLoadingKey(tab.key); await onReview(tab, choice, suggestedName); setLoadingKey(null) }}><CheckCircleIcon size={14} />{loadingKey === tab.key ? "กำลังเตรียม…" : "ตรวจและสร้าง"}</button> : <span className="text-[10px] text-[var(--ui-muted)]">Admin เป็นผู้ยืนยัน</span>}</div>
  })}</div>}</section>
}

export default function BrandProjectsView({
  allTasks = [], assignments = {}, teamMembers = [], brands = {}, brandCatalog = [], projects = [], contracts = [], tableProps = {}, canAdmin = false, focusContractId = null,
  onOpenTask, onSaveBrand, onSetBrandActive, onSetProjectActive, onSaveProject, onSaveContract, onSetContractStatus, onSetContractRenewalStatus,
}) {
  const today = bangkokDate()
  const [query, setQuery] = useState("")
  const [showArchived, setShowArchived] = useState(false)
  const [selectedBrandToken, setSelectedBrandToken] = useState(null)
  const [timelineRange, setTimelineRange] = useState("12m")
  const [brandEditor, setBrandEditor] = useState(null)
  const [projectEditor, setProjectEditor] = useState(null)
  const [contractEditor, setContractEditor] = useState(null)
  const detailRef = useRef(null)
  const contractRefs = useRef(new Map())

  const tabRecords = useMemo(() => {
    const records = new Map(sourceTabRecords(allTasks).map((tab) => [tab.key, { ...tab, count: 0 }]))
    allTasks.forEach((task) => { const record = records.get(sourceTabKey(task)); if (record) record.count += 1 })
    Object.keys(brands).forEach((key) => { if (!records.has(key)) records.set(key, { key, title: key, count: 0 }) })
    return [...records.values()]
  }, [allTasks, brands])
  const tabByKey = useMemo(() => new Map(tabRecords.map((tab) => [tab.key, tab])), [tabRecords])
  const tasksByTab = useMemo(() => groupTasksBySource(allTasks), [allTasks])
  const catalog = useMemo(() => {
    if (brandCatalog.length) return brandCatalog
    const fallback = new Map()
    Object.values(brands).forEach((name) => fallback.set(normalizeBrandKey(name), { id: null, key: normalizeBrandKey(name), name, active: true }))
    projects.forEach((project) => fallback.set(project.brandKey || normalizeBrandKey(project.brandName), { id: project.brandId || null, key: project.brandKey || normalizeBrandKey(project.brandName), name: project.brandName, active: true }))
    return [...fallback.values()]
  }, [brandCatalog, brands, projects])
  const tabAssignments = useMemo(() => {
    const result = new Map()
    projects.forEach((project) => {
      const key = project.sourceTabKey || project.sourceTabKeys?.[0]
      if (key) result.set(key, { id: project.id, name: project.name })
    })
    return result
  }, [projects])
  const records = useMemo(() => catalog.map((brand) => {
    const matchesProject = (project) => project.brandId && brand.id ? project.brandId === brand.id : (project.brandKey || normalizeBrandKey(project.brandName)) === brand.key
    const brandProjects = projects.filter(matchesProject).map((project) => {
      const key = project.sourceTabKey || project.sourceTabKeys?.[0] || ""
      const tasks = key ? tasksByTab[key] || [] : []
      return { ...project, assignment: project.assignment || assignments[project.id] || {}, sourceTabKey: key, sourceTab: key ? { ...(tabByKey.get(key) || { key, title: key, count: tasks.length }), tasks } : null, tasks }
    })
    const brandContracts = contracts.filter((contract) => contract.brandId ? contract.brandId === brand.id : brandProjects.some((project) => project.id === contract.projectId))
    const activeProjects = brandProjects.filter((project) => project.active !== false)
    const delayedProjects = activeProjects.filter((project) => projectDeliveryState(project, today).state === "overdue")
    const openContracts = brandContracts.filter((contract) => contract.status === "open")
    const nearestContract = openContracts.slice().sort((a, b) => contractRadarRank(a, today) - contractRadarRank(b, today) || String(a.endDate).localeCompare(String(b.endDate)))[0] || null
    return { ...brand, projects: activeProjects, archivedProjects: brandProjects.filter((project) => project.active === false), contracts: brandContracts, openContracts, delayedProjects, nearestContract }
  }), [assignments, catalog, contracts, projects, tabByKey, tasksByTab, today])
  const visibleRecords = useMemo(() => records.filter((record) => {
    const matchesQuery = !query.trim() || `${record.name} ${record.contracts.map((contract) => contract.name).join(" ")} ${record.projects.map((project) => project.name).join(" ")}`.toLocaleLowerCase("th-TH").includes(query.trim().toLocaleLowerCase("th-TH"))
    return matchesQuery && (showArchived ? record.active === false : record.active !== false)
  }).sort((a, b) => Number(Boolean(b.delayedProjects.length)) - Number(Boolean(a.delayedProjects.length)) || (a.nearestContract ? contractRadarRank(a.nearestContract, today) : 9) - (b.nearestContract ? contractRadarRank(b.nearestContract, today) : 9) || a.name.localeCompare(b.name, "th")), [query, records, showArchived, today])
  const ganttCards = useMemo(() => records.filter((brand) => brand.active !== false).flatMap((brand) => brand.contracts.filter((contract) => contract.status === "open" && isContractVisibleInRadar(contract, today)).map((contract) => ({ brand, contract, delayedCount: brand.projects.filter((project) => project.contractId === contract.id && projectDeliveryState(project, today).state === "overdue").length }))).sort((a, b) => contractRadarRank(a.contract, today) - contractRadarRank(b.contract, today) || a.contract.endDate.localeCompare(b.contract.endDate)), [records, today])
  const selectedBrand = records.find((brand) => brandToken(brand) === selectedBrandToken) || null
  const unassignedTabs = useMemo(() => tabRecords.filter((tab) => !tabAssignments.has(tab.key)), [tabAssignments, tabRecords])
  const tabOptions = useMemo(() => tabRecords.map((tab) => ({ ...tab, assignedTo: tabAssignments.get(tab.key)?.id, assignedToName: tabAssignments.get(tab.key)?.name })), [tabAssignments, tabRecords])

  const selectBrand = (token, contractId = null) => {
    setSelectedBrandToken(token)
    window.setTimeout(() => {
      const target = contractId ? contractRefs.current.get(contractId) : detailRef.current
      target?.scrollIntoView({ behavior: "smooth", block: "start" })
    }, 0)
  }
  useEffect(() => {
    if (!focusContractId) return
    const brand = records.find((record) => record.contracts.some((contract) => contract.id === focusContractId))
    if (!brand) return
    const timer = window.setTimeout(() => selectBrand(brandToken(brand), focusContractId), 0)
    return () => window.clearTimeout(timer)
  }, [focusContractId, records])

  const reviewIntake = async (tab, choice, suggestedBrandName) => {
    let brand = catalog.find((item) => item.id === choice)
    if (choice === "__new__") {
      const id = await onSaveBrand?.({ name: suggestedBrandName.trim() })
      if (!id) return false
      brand = { id, key: normalizeBrandKey(suggestedBrandName), name: suggestedBrandName.trim(), active: true }
    }
    if (!brand) return false
    const dates = projectDatesFromTab(tab.title)
    setSelectedBrandToken(brandToken(brand))
    setProjectEditor({ brand, project: null, suggestion: { name: projectNameFromTab(tab.title, brand.name), sourceTabKey: tab.key, ...dates } })
    return true
  }
  const overdueCount = records.reduce((total, brand) => total + brand.delayedProjects.length, 0)
  const expiringCount = ganttCards.filter(({ contract }) => { const days = contractDaysRemaining(contract, today); return days !== null && days >= 0 && days <= 30 }).length
  const unresolvedExpired = ganttCards.filter(({ contract }) => contractState(contract, today) === "expired").length

  return <div className="space-y-6">
    <header className="brand-page-header"><div><div className="flex items-center gap-2"><BuildingsIcon className="text-[var(--ui-brand)]" size={24} weight="duotone" /><h1 className="text-[var(--text-page)] font-black tracking-tight text-[var(--ui-text)]">Brands & Contracts</h1></div><p className="mt-1 max-w-2xl text-xs leading-5 text-[var(--ui-muted)]">ติดตามว่าสัญญาไหนใกล้จบ และ Project ไหนทำงานไม่เสร็จภายในช่วงเวลาที่กำหนด</p></div><div className="flex gap-2">{canAdmin && <Button size="sm" onClick={() => setBrandEditor({ brand: null })}><PlusIcon size={14} />สร้าง Brand</Button>}</div></header>
    <div className="brand-kpi-strip"><div><span>{unresolvedExpired}</span><small>หมดแล้ว ยังไม่ตัดสินใจ</small></div><div><span>{expiringCount}</span><small>หมดภายใน 30 วัน</small></div><div><span>{overdueCount}</span><small>Projects ล่าช้า</small></div><div><span>{records.filter((record) => record.active !== false).length}</span><small>Brands ที่ใช้งาน</small></div></div>
    <ContractGantt cards={ganttCards} today={today} range={timelineRange} onRangeChange={setTimelineRange} onSelectBrand={selectBrand} />

    <section aria-labelledby="brand-directory-title"><div className="mb-3 flex flex-wrap items-end justify-between gap-3"><div><h2 id="brand-directory-title" className="text-base font-black tracking-tight text-[var(--ui-text)]">Brand directory</h2><p className="mt-1 text-[11px] text-[var(--ui-muted)]">เลือก Brand เพื่อดู Contract และ Projects ในหน้าเดียว</p></div>{canAdmin && <label className="flex items-center gap-2 text-[10px] text-[var(--ui-muted)]"><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />Archived</label>}</div><label className="relative mb-3 block"><span className="sr-only">ค้นหา Brand, Contract หรือ Project</span><MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ui-muted)]" size={17} /><input type="search" className="ui-field w-full pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหา Brand, Contract หรือ Project…" /></label>
      {visibleRecords.length ? <div className="brand-directory-grid grid gap-3 md:grid-cols-2">{visibleRecords.map((record) => <article key={brandToken(record)} className={`brand-directory-card ${record.delayedProjects.length ? "has-delay" : ""} ${selectedBrandToken === brandToken(record) ? "is-selected" : ""}`}><button type="button" className="flex min-h-40 w-full flex-col p-5 text-left" onClick={() => selectBrand(brandToken(record))}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="truncate text-base font-black tracking-tight text-[var(--ui-text)]">{record.name}</h3><p className="mt-1 text-[10px] text-[var(--ui-muted)]">{record.contracts.length} Contracts · {record.projects.length} Projects</p></div><CaretRightIcon className="text-[var(--ui-brand)]" size={18} /></div><div className="mt-auto flex flex-wrap items-end justify-between gap-3 pt-5"><div className="flex flex-wrap gap-1.5">{record.nearestContract ? <ContractBadge contract={record.nearestContract} today={today} /> : <span className="ui-badge ui-badge-neutral">ยังไม่มี Contract</span>}{record.delayedProjects.length > 0 && <span className="ui-badge ui-badge-danger">{record.delayedProjects.length} ล่าช้า</span>}{record.projects.some((project) => !project.contractId) && <span className="ui-badge ui-badge-warning">มี Project ไม่ผูกสัญญา</span>}</div><span className="text-[10px] font-semibold text-[var(--ui-muted)]">{record.nearestContract?.name || "เริ่มตั้งค่า Contract"}</span></div></button>{record.active === false && canAdmin && <div className="border-t border-[var(--ui-border)] p-2 text-right"><button type="button" className="ui-button ui-button-secondary ui-button-sm" onClick={() => onSetBrandActive?.(record.id, true)}>Restore</button></div>}</article>)}</div> : <EmptyState icon={<BuildingsIcon size={26} weight="duotone" />} title="ไม่พบ Brand" description="ลองเปลี่ยนคำค้น หรือสร้าง Brand ใหม่" className="ui-card" />}
    </section>

    {selectedBrand && <section ref={detailRef} className="brand-inline-detail scroll-mt-24" aria-labelledby="selected-brand-title"><div className="brand-detail-heading"><div className="min-w-0"><span className="text-[10px] font-bold uppercase tracking-[.16em] text-[var(--ui-brand)]">Brand detail</span><h2 id="selected-brand-title" className="mt-1 truncate text-2xl font-black tracking-tight text-[var(--ui-text)]">{selectedBrand.name}</h2><p className="mt-1 text-xs text-[var(--ui-muted)]">Contract เป็นกรอบใหญ่ ส่วน Project คือหนึ่ง Google Sheet tab</p></div>{canAdmin && <div className="flex flex-wrap gap-2"><button type="button" className="ui-button ui-button-secondary ui-button-sm" onClick={() => setBrandEditor({ brand: selectedBrand })}><PencilSimpleIcon size={14} />แก้ชื่อ</button><button type="button" className="ui-button ui-button-primary ui-button-sm" onClick={() => setContractEditor({ brand: selectedBrand, contract: null })}><PlusIcon size={14} />สร้าง Contract</button><button type="button" className="ui-icon-button text-[var(--ui-danger)]" aria-label={`Archive ${selectedBrand.name}`} onClick={async () => { if (window.confirm(`Archive Brand “${selectedBrand.name}”?`)) { const saved = await onSetBrandActive?.(selectedBrand.id, false); if (saved) setSelectedBrandToken(null) } }}><ArchiveIcon size={16} /></button></div>}</div>
      <div className="grid gap-4 p-4 sm:p-5">{selectedBrand.contracts.filter((contract) => contract.status !== "cancelled").length ? selectedBrand.contracts.filter((contract) => contract.status !== "cancelled").sort((a, b) => String(a.endDate).localeCompare(String(b.endDate))).map((contract) => {
        const linkedProjects = selectedBrand.projects.filter((project) => project.contractId === contract.id)
        return <article key={contract.id} ref={(node) => { if (node) contractRefs.current.set(contract.id, node) }} className="brand-contract-detail scroll-mt-24"><div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><FlagIcon className="text-[var(--ui-brand)]" size={17} weight="duotone" /><h3 className="truncate text-sm font-black text-[var(--ui-text)]">{contract.name}</h3><span className="ui-badge ui-badge-brand">{contractTypeLabel(contract.type)}</span><ContractBadge contract={contract} today={today} /></div><p className="mt-2 text-[11px] text-[var(--ui-muted)]">{formatThaiDate(contract.startDate)} — {formatThaiDate(contract.endDate)} · {linkedProjects.length} Projects</p>{contract.documentUrl && <a href={contract.documentUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-[10px] font-semibold text-[var(--ui-brand)]"><FileTextIcon size={13} />เปิดเอกสารสัญญา</a>}</div>{canAdmin && <div className="flex flex-wrap items-center gap-2"><label className="text-[10px] font-semibold text-[var(--ui-muted)]">การต่อสัญญา<select className="ui-field ml-1 min-h-8 py-1 text-[10px]" value={contract.renewalStatus || "not_contacted"} onChange={(event) => onSetContractRenewalStatus?.(contract.id, event.target.value)}>{RENEWAL_STATUSES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><button type="button" className="ui-icon-button" aria-label={`แก้ไข ${contract.name}`} onClick={() => setContractEditor({ brand: selectedBrand, contract })}><PencilSimpleIcon size={15} /></button><select className="ui-field min-h-8 py-1 text-[10px]" aria-label={`สถานะ ${contract.name}`} value={contract.status} onChange={(event) => onSetContractStatus?.(contract.id, event.target.value)}><option value="open">ใช้งาน</option><option value="closed">ปิดแล้ว</option><option value="cancelled">ยกเลิก</option></select></div>}</div><div className="border-t border-[var(--ui-border)] bg-[var(--ui-surface-muted)] p-3"><div className="mb-2 flex items-center justify-between gap-2"><h4 className="text-[10px] font-black uppercase tracking-wider text-[var(--ui-muted)]">Projects ใน Contract</h4><span className="text-[10px] text-[var(--ui-muted)]">ต่อสัญญา: {renewalStatusLabel(contract.renewalStatus)}</span></div>{linkedProjects.length ? <div className="grid gap-2">{linkedProjects.map((project) => <ProjectSection key={project.id} project={project} canAdmin={canAdmin} tableProps={tableProps} onOpenTask={onOpenTask} onEdit={(item) => setProjectEditor({ brand: selectedBrand, project: item, suggestion: null })} onArchive={async (item) => { if (window.confirm(`Archive Project “${item.name}”?`)) await onSetProjectActive?.(item.id, false) }} />)}</div> : <p className="rounded-lg bg-white px-3 py-4 text-center text-xs text-[var(--ui-muted)]">ยังไม่มี Project ใน Contract นี้</p>}</div></article>
      }) : <EmptyState icon={<FlagIcon size={25} weight="duotone" />} title="Brand นี้ยังไม่มี Contract" description={canAdmin ? "สร้าง Contract เพื่อเริ่มติดตามวันหมดสัญญา" : "Admin กำลังตั้งค่าข้อมูลสัญญา"} />}
      {selectedBrand.projects.some((project) => !project.contractId) && <section className="brand-unlinked-projects"><div className="mb-2 flex items-center gap-2"><WarningCircleIcon className="text-amber-700" size={17} /><h3 className="text-xs font-black text-amber-900">Projects ที่ยังไม่ผูก Contract</h3></div><div className="grid gap-2">{selectedBrand.projects.filter((project) => !project.contractId).map((project) => <ProjectSection key={project.id} project={project} canAdmin={canAdmin} tableProps={tableProps} onOpenTask={onOpenTask} onEdit={(item) => setProjectEditor({ brand: selectedBrand, project: item, suggestion: null })} onArchive={async (item) => { if (window.confirm(`Archive Project “${item.name}”?`)) await onSetProjectActive?.(item.id, false) }} />)}</div></section>}
      {selectedBrand.archivedProjects.length > 0 && <details className="rounded-xl bg-[var(--ui-surface-muted)] p-3"><summary className="cursor-pointer text-xs font-semibold text-[var(--ui-muted)]">Archived Projects ({selectedBrand.archivedProjects.length})</summary><div className="mt-2 grid gap-2">{selectedBrand.archivedProjects.map((project) => <div key={project.id} className="flex items-center justify-between rounded-lg bg-white px-3 py-2"><span className="text-xs font-semibold">{project.name}</span>{canAdmin && <button className="ui-button ui-button-secondary ui-button-sm" onClick={() => onSetProjectActive?.(project.id, true)}>Restore</button>}</div>)}</div></details>}
      </div>
    </section>}

    <ProjectIntake tabs={unassignedTabs} catalog={catalog} canAdmin={canAdmin} onReview={reviewIntake} />
    {brandEditor && <BrandForm open brand={brandEditor.brand} onClose={() => setBrandEditor(null)} onSave={onSaveBrand} />}
    {projectEditor && <ProjectForm open onClose={() => setProjectEditor(null)} brand={projectEditor.brand} project={projectEditor.project} contracts={(records.find((record) => brandToken(record) === brandToken(projectEditor.brand))?.contracts || []).filter((contract) => contract.status !== "cancelled")} tabOptions={tabOptions} teamMembers={teamMembers} onSave={onSaveProject} initialName={projectEditor.suggestion?.name || ""} initialSourceTabKey={projectEditor.suggestion?.sourceTabKey || ""} initialStartDate={projectEditor.suggestion?.startDate || ""} initialEndDate={projectEditor.suggestion?.endDate || ""} />}
    {contractEditor && <ContractForm open onClose={() => setContractEditor(null)} brand={contractEditor.brand} contract={contractEditor.contract} onSave={onSaveContract} />}
  </div>
}
