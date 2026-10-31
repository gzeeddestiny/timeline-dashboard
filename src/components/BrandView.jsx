import { Dialog } from "@base-ui/react/dialog"
import { ArchiveIcon } from "@phosphor-icons/react/dist/csr/Archive"
import { CalendarBlankIcon } from "@phosphor-icons/react/dist/csr/CalendarBlank"
import { CheckCircleIcon } from "@phosphor-icons/react/dist/csr/CheckCircle"
import { ClockCountdownIcon } from "@phosphor-icons/react/dist/csr/ClockCountdown"
import { LinkIcon } from "@phosphor-icons/react/dist/csr/Link"
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/csr/PencilSimple"
import { WarningCircleIcon } from "@phosphor-icons/react/dist/csr/WarningCircle"
import { XIcon } from "@phosphor-icons/react/dist/csr/X"
import { useMemo, useState } from "react"
import TaskTable from "./TimelineTable"
import { EmptyState } from "./ui"
import { assignmentMemberNames, ROLE_CONFIG, ROLES } from "../lib/teamConfig"
import { bangkokDate, formatThaiDate } from "../lib/dates"
import { calculateContractEnd, CONTRACT_TYPES, projectDeliveryState, RENEWAL_STATUSES } from "../lib/brandTimeline"

function addDays(value, days) {
  if (!value) return ""
  const date = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return ""
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function ModalShell({ open, onClose, title, description, children }) {
  return <Dialog.Root open={open} onOpenChange={(value) => !value && onClose()}><Dialog.Portal>
    <Dialog.Backdrop className="ui-overlay-enter fixed inset-0 z-[var(--z-overlay)] bg-[#24182c]/40 backdrop-blur-[2px]" />
    <Dialog.Popup className="ui-modal-enter fixed left-1/2 top-1/2 z-[var(--z-modal)] max-h-[90dvh] w-[min(42rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[var(--radius-overlay)] border border-[var(--ui-border)] bg-white p-5 shadow-[var(--shadow-overlay)] sm:p-6">
      <div className="flex items-start justify-between gap-4"><div><Dialog.Title className="text-lg font-black tracking-tight text-[var(--ui-text)]">{title}</Dialog.Title>{description && <Dialog.Description className="mt-1 max-w-xl text-xs leading-5 text-[var(--ui-muted)]">{description}</Dialog.Description>}</div><Dialog.Close className="ui-icon-button" aria-label="ปิด"><XIcon aria-hidden="true" size={18} /></Dialog.Close></div>
      {children}
    </Dialog.Popup>
  </Dialog.Portal></Dialog.Root>
}

export function ProjectForm({ open, onClose, brand, project, tabOptions = [], contracts = [], teamMembers = [], onSave, initialName = "", initialSourceTabKey = "", initialStartDate = "", initialEndDate = "" }) {
  const [name, setName] = useState(project?.name || initialName)
  const [sourceTabKey, setSourceTabKey] = useState(project?.sourceTabKey || project?.sourceTabKeys?.[0] || initialSourceTabKey)
  const [contractId, setContractId] = useState(project?.contractId || "")
  const [startDate, setStartDate] = useState(project?.startDate || initialStartDate)
  const [endDate, setEndDate] = useState(project?.endDate || initialEndDate)
  const [selectedMembers, setSelectedMembers] = useState(() => assignmentMemberNames(project?.assignment || {}))
  const [saving, setSaving] = useState(false)
  const selectedContract = contracts.find((contract) => contract.id === contractId) || null
  const dateError = Boolean(startDate && endDate && endDate < startDate)
  const outsideContract = Boolean(selectedContract && startDate && endDate && (startDate < selectedContract.startDate || endDate > selectedContract.endDate))
  const buildAssignment = () => selectedMembers.reduce((result, memberName) => {
    const member = teamMembers.find((candidate) => candidate.name === memberName)
    if (member) result[member.role] = [...(result[member.role] || []), member.name]
    return result
  }, {})
  const submit = async (event) => {
    event.preventDefault()
    if (!name.trim() || !sourceTabKey || saving || dateError || outsideContract || (contractId && (!startDate || !endDate))) return
    setSaving(true)
    const saved = await onSave?.({ id: project?.id, brandId: brand.id || project?.brandId, contractId: contractId || null, name: name.trim(), startDate: startDate || null, endDate: endDate || null, assignment: buildAssignment(), sourceTabKey })
    setSaving(false)
    if (saved) onClose()
  }
  const toggleMember = (memberName) => setSelectedMembers((current) => current.includes(memberName) ? current.filter((value) => value !== memberName) : [...current, memberName])
  return <ModalShell open={open} onClose={onClose} title={project ? "แก้ไข Project" : "ยืนยัน Project"} description={`Project หนึ่งรายการใช้ Google Sheet tab เพียงหนึ่งอัน · ${brand.name}`}>
    <form className="mt-5 grid gap-4" onSubmit={submit}>
      <label className="text-xs font-semibold text-[var(--ui-text-secondary)]">ชื่อ Project<input autoFocus className="ui-field mt-1 block w-full" value={name} onChange={(event) => setName(event.target.value)} placeholder="เช่น Always-on Sep 2026" required /></label>
      <label className="text-xs font-semibold text-[var(--ui-text-secondary)]">Google Sheet tab<select className="ui-field mt-1 block w-full" value={sourceTabKey} onChange={(event) => setSourceTabKey(event.target.value)} required><option value="">เลือก source tab</option>{tabOptions.map((tab) => <option key={tab.key} value={tab.key} disabled={tab.assignedTo && tab.assignedTo !== project?.id}>{tab.title}{tab.assignedTo && tab.assignedTo !== project?.id ? ` · อยู่ใน ${tab.assignedToName}` : ` · ${tab.count} tasks`}</option>)}</select></label>
      <label className="text-xs font-semibold text-[var(--ui-text-secondary)]">Contract <span className="font-normal text-[var(--ui-muted)]">(ผูกภายหลังได้)</span><select className="ui-field mt-1 block w-full" value={contractId} onChange={(event) => {
        const next = contracts.find((contract) => contract.id === event.target.value)
        setContractId(event.target.value)
        if (next) {
          if (!startDate || startDate < next.startDate) setStartDate(next.startDate)
          if (!endDate || endDate > next.endDate) setEndDate(next.endDate)
        }
      }}><option value="">ยังไม่ผูก Contract</option>{contracts.filter((contract) => contract.status !== "cancelled").map((contract) => <option key={contract.id} value={contract.id}>{contract.name} · {formatThaiDate(contract.startDate)}–{formatThaiDate(contract.endDate)}</option>)}</select></label>
      <div className="grid gap-4 sm:grid-cols-2"><label className="text-xs font-semibold text-[var(--ui-text-secondary)]">Project start<input type="date" className="ui-field mt-1 block w-full" min={selectedContract?.startDate} max={selectedContract?.endDate} value={startDate} onChange={(event) => setStartDate(event.target.value)} required={Boolean(contractId)} /></label><label className="text-xs font-semibold text-[var(--ui-text-secondary)]">Project end<input type="date" className="ui-field mt-1 block w-full" min={startDate || selectedContract?.startDate} max={selectedContract?.endDate} value={endDate} onChange={(event) => setEndDate(event.target.value)} required={Boolean(contractId)} /></label></div>
      {(dateError || outsideContract) && <p className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700"><WarningCircleIcon size={16} />{outsideContract ? "ช่วง Project ต้องอยู่ภายใน Contract ที่เลือก" : "วันจบต้องไม่ก่อนวันเริ่ม"}</p>}
      {!contractId && <p className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-800"><WarningCircleIcon size={15} />สร้างได้ชั่วคราว แต่ระบบจะขึ้นเตือนจนกว่าจะผูก Contract และกรอกช่วงเวลา</p>}
      <fieldset className="rounded-xl bg-[var(--ui-surface-muted)] p-3"><legend className="px-1 text-xs font-semibold text-[var(--ui-text-secondary)]">ทีม Project · {selectedMembers.length} คน</legend><div className="mt-2 grid max-h-44 gap-3 overflow-y-auto sm:grid-cols-2">{ROLES.map((role) => { const members = teamMembers.filter((member) => member.role === role); if (!members.length) return null; const config = ROLE_CONFIG[role]; return <div key={role}><div className={`mb-1 inline-flex rounded px-1.5 py-0.5 text-[9px] font-bold ${config.bg}`}>{config.label}</div><div className="grid gap-1">{members.map((member) => <label key={member.name} className="flex min-h-9 items-center gap-2 rounded-lg px-2 text-xs hover:bg-white"><input type="checkbox" checked={selectedMembers.includes(member.name)} onChange={() => toggleMember(member.name)} /><span className="truncate">{member.name}</span></label>)}</div></div> })}</div></fieldset>
      <div className="flex justify-end gap-2"><button type="button" className="ui-button ui-button-secondary" onClick={onClose}>ยกเลิก</button><button type="submit" className="ui-button ui-button-primary" disabled={saving || !name.trim() || !sourceTabKey || dateError || outsideContract}>{saving ? "กำลังบันทึก…" : project ? "บันทึก Project" : "ยืนยันและสร้าง"}</button></div>
    </form>
  </ModalShell>
}

export function ContractForm({ open, onClose, brand, contract, onSave }) {
  const initialType = contract?.type || "always_on"
  const initialTerm = String(contract?.termMonths || 3)
  const initialStart = contract?.startDate || bangkokDate()
  const [name, setName] = useState(contract?.name || "")
  const [type, setType] = useState(initialType)
  const [termMonths, setTermMonths] = useState(initialTerm)
  const [startDate, setStartDate] = useState(initialStart)
  const [endDate, setEndDate] = useState(contract?.endDate || (initialType === "always_on" ? calculateContractEnd(initialStart, Number(initialTerm)) : addDays(initialStart, 44)))
  const [renewalStatus, setRenewalStatus] = useState(contract?.renewalStatus || "not_contacted")
  const [notes, setNotes] = useState(contract?.notes || "")
  const [documentUrl, setDocumentUrl] = useState(contract?.documentUrl || "")
  const [saving, setSaving] = useState(false)
  const invalidDates = !startDate || !endDate || endDate < startDate
  const invalidUrl = documentUrl.trim() && !/^https:\/\//i.test(documentUrl.trim())
  const submit = async (event) => {
    event.preventDefault()
    if (!name.trim() || invalidDates || invalidUrl || saving) return
    setSaving(true)
    const saved = await onSave?.({ id: contract?.id, brandId: brand.id, name: name.trim(), type, startDate, endDate, termMonths: type === "always_on" ? Number(termMonths) : null, renewalStatus, notes, documentUrl })
    setSaving(false)
    if (saved) onClose()
  }
  return <ModalShell open={open} onClose={onClose} title={contract ? "แก้ไข Contract" : "สร้าง Contract"} description={`สัญญาใหญ่ของ ${brand.name} สามารถมีหลาย Projects ได้`}>
    <form className="mt-5 grid gap-4" onSubmit={submit}>
      <div className="grid gap-4 sm:grid-cols-[1fr_11rem]"><label className="text-xs font-semibold text-[var(--ui-text-secondary)]">ชื่อ Contract<input autoFocus className="ui-field mt-1 block w-full" value={name} onChange={(event) => setName(event.target.value)} placeholder="เช่น Always-on Sep 2026 – Feb 2027" required /></label><label className="text-xs font-semibold text-[var(--ui-text-secondary)]">รูปแบบ<select className="ui-field mt-1 block w-full" value={type} onChange={(event) => { const next = event.target.value; setType(next); setEndDate(next === "always_on" ? calculateContractEnd(startDate, Number(termMonths)) : addDays(startDate, 44)) }}>{CONTRACT_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label></div>
      {type === "always_on" && <label className="text-xs font-semibold text-[var(--ui-text-secondary)]">ระยะสัญญา<select className="ui-field mt-1 block w-full" value={termMonths} onChange={(event) => { setTermMonths(event.target.value); setEndDate(calculateContractEnd(startDate, Number(event.target.value))) }}>{[3, 6, 12].map((month) => <option key={month} value={month}>{month} เดือน</option>)}</select></label>}
      <div className="grid gap-4 sm:grid-cols-2"><label className="text-xs font-semibold text-[var(--ui-text-secondary)]">เริ่มสัญญา<input type="date" className="ui-field mt-1 block w-full" value={startDate} onChange={(event) => { const next = event.target.value; setStartDate(next); setEndDate(type === "always_on" ? calculateContractEnd(next, Number(termMonths)) : addDays(next, 44)) }} required /></label><label className="text-xs font-semibold text-[var(--ui-text-secondary)]">จบสัญญา<input type="date" className="ui-field mt-1 block w-full" min={startDate || undefined} value={endDate} onChange={(event) => setEndDate(event.target.value)} readOnly={type === "always_on"} required /><span className="mt-1 block text-[10px] text-[var(--ui-muted)]">{type === "always_on" ? "คำนวณจากระยะสัญญาอัตโนมัติ" : "ตั้งต้น 45 วัน และแก้ตามสัญญาจริงได้"}</span></label></div>
      <label className="text-xs font-semibold text-[var(--ui-text-secondary)]">สถานะต่อสัญญา<select className="ui-field mt-1 block w-full" value={renewalStatus} onChange={(event) => setRenewalStatus(event.target.value)}>{RENEWAL_STATUSES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      <label className="text-xs font-semibold text-[var(--ui-text-secondary)]">ลิงก์เอกสาร<input type="url" className="ui-field mt-1 block w-full" value={documentUrl} onChange={(event) => setDocumentUrl(event.target.value)} placeholder="https://…" />{invalidUrl && <span className="mt-1 block text-[10px] font-semibold text-red-600">ใช้ลิงก์ https เท่านั้น</span>}</label>
      <label className="text-xs font-semibold text-[var(--ui-text-secondary)]">หมายเหตุ<textarea className="ui-field mt-1 block min-h-20 w-full resize-y" value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={5000} /></label>
      <div className="flex justify-end gap-2"><button type="button" className="ui-button ui-button-secondary" onClick={onClose}>ยกเลิก</button><button type="submit" className="ui-button ui-button-primary" disabled={saving || !name.trim() || invalidDates || invalidUrl}>{saving ? "กำลังบันทึก…" : "บันทึก Contract"}</button></div>
    </form>
  </ModalShell>
}

function projectStateCopy(status) {
  if (status.state === "overdue") return { label: `ล่าช้า ${status.days} วัน`, tone: "danger", icon: <WarningCircleIcon size={14} /> }
  if (status.state === "completed_late") return { label: `เสร็จช้า ${status.days} วัน`, tone: "warning", icon: <ClockCountdownIcon size={14} /> }
  if (status.state === "complete") return { label: "เสร็จตามเวลา", tone: "success", icon: <CheckCircleIcon size={14} /> }
  if (status.state === "due_soon") return { label: `เหลือ ${status.days} วัน`, tone: "warning", icon: <ClockCountdownIcon size={14} /> }
  if (status.state === "missing_dates") return { label: "ข้อมูลไม่ครบ", tone: "neutral", icon: <WarningCircleIcon size={14} /> }
  return { label: `เหลือ ${status.days} วัน`, tone: "brand", icon: <CalendarBlankIcon size={14} /> }
}

export function ProjectSection({ project, onEdit, onArchive, onOpenTask, tableProps = {}, canAdmin = false }) {
  const status = useMemo(() => projectDeliveryState(project), [project])
  const stateCopy = projectStateCopy(status)
  const team = assignmentMemberNames(project.assignment || {})
  const owners = [...new Set(project.tasks.filter((task) => !task.done).flatMap((task) => String(task.responsibility || "").split(/[,/&]+/u).map((name) => name.trim()).filter(Boolean)))].slice(0, 5)
  return <article className={`brand-project-row brand-project-${status.state}`} aria-labelledby={`project-${project.id}`}>
    <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_12rem_auto] lg:items-center">
      <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h4 id={`project-${project.id}`} className="truncate text-sm font-bold text-[var(--ui-text)]">{project.name}</h4><span className={`ui-badge ui-badge-${stateCopy.tone}`}>{stateCopy.icon}{stateCopy.label}</span>{!project.contractId && <span className="ui-badge ui-badge-warning">ยังไม่ผูก Contract</span>}</div><p className="mt-1 truncate text-[11px] text-[var(--ui-muted)]">{project.sourceTab?.title || project.sourceTabKey || "ยังไม่มี source tab"} · {status.completed}/{status.total} tasks</p>{status.incomplete > 0 && <p className="mt-1 text-[10px] font-semibold text-[var(--ui-text-secondary)]">ค้าง {status.incomplete} งาน · {owners.length ? owners.join(", ") : team.length ? team.join(", ") : "ยังไม่พบผู้รับผิดชอบ"}</p>}</div>
      <div><div className="flex items-center justify-between text-[10px] font-semibold text-[var(--ui-muted)]"><span>{status.percent}%</span><span>{project.endDate ? formatThaiDate(project.endDate) : "ยังไม่มีวันจบ"}</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--ui-surface-muted)]"><span className="block h-full rounded-full bg-[var(--ui-brand)] transition-[width] duration-300" style={{ width: `${status.percent}%` }} /></div></div>
      {canAdmin && <div className="flex justify-end gap-1"><button type="button" className="ui-icon-button" aria-label={`แก้ไข ${project.name}`} onClick={() => onEdit?.(project)}><PencilSimpleIcon size={15} /></button><button type="button" className="ui-icon-button text-[var(--ui-danger)]" aria-label={`Archive ${project.name}`} onClick={() => onArchive?.(project)}><ArchiveIcon size={15} /></button></div>}
    </div>
    <details className="border-t border-[var(--ui-border)]"><summary className="cursor-pointer px-4 py-2 text-[10px] font-semibold text-[var(--ui-muted)] hover:text-[var(--ui-brand)]">ดู Tasks และรายละเอียด Project</summary><div className="p-3 pt-1">{project.tasks.length ? <TaskTable title="" tasks={project.tasks} isLoading={false} {...tableProps} onOpenTask={onOpenTask || tableProps.onOpenTask} /> : <EmptyState icon={<LinkIcon size={22} />} title="Project นี้ยังไม่มี Task" description="เมื่อ sync Google Sheet แล้ว Tasks จะปรากฏที่นี่" className="py-6" />}</div></details>
  </article>
}
