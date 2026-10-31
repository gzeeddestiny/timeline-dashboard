import { Popover } from "@base-ui/react/popover"
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check"
import { UserPlusIcon } from "@phosphor-icons/react/dist/csr/UserPlus"
import { useState } from "react"
import { assignmentRoleMembers, ROLE_CONFIG, ROLES } from "../lib/teamConfig"

function MemberOption({ member, selected, onToggle }) {
  const rc = ROLE_CONFIG[member.role]
  return (
    <button type="button" onClick={() => onToggle(member.name)} data-active={selected} className={`ui-chip flex min-h-11 w-full items-center gap-2 px-2.5 py-1.5 text-left ${selected ? `${rc.bg} ring-1 ${rc.ring}` : ""}`}>
      {member.avatar ? <img src={member.avatar} alt="" className={`h-7 w-7 rounded-full object-cover ring-1 ${selected ? rc.ring : "ring-gray-200"}`} /> : <span className={`flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold ring-1 ${selected ? `${rc.bg} ${rc.ring}` : "bg-gray-100 text-gray-500 ring-gray-200"}`}>{member.name[0]?.toUpperCase()}</span>}
      <span className="min-w-0 flex-1 truncate text-xs font-medium">{member.name}</span>
      {selected && <CheckIcon aria-hidden="true" className="text-[var(--ui-success)]" size={16} weight="bold" />}
    </button>
  )
}

function AssignedAvatars({ current, members, compact }) {
  return (
    <span className="flex items-center -space-x-1">
      {ROLES.flatMap((role) => assignmentRoleMembers(current, role).map((name) => {
        const member = members.find((candidate) => candidate.name === name)
        if (!member) return null
        const rc = ROLE_CONFIG[role]
        const size = compact ? rc.xsSizeClass : rc.smSizeClass
        return member.avatar ? <img key={`${role}:${name}`} src={member.avatar} alt={member.name} title={`${rc.label}: ${member.name}`} className={`${size} rounded-full object-cover ring-1 ${rc.ring} ring-offset-1`} /> : <span key={`${role}:${name}`} title={`${rc.label}: ${member.name}`} className={`${size} ${compact ? rc.xsTextClass : rc.smTextClass} ${rc.bg} flex items-center justify-center rounded-full font-bold ring-1 ${rc.ring} ring-offset-1`}>{member.name[0]?.toUpperCase()}</span>
      }))}
    </span>
  )
}

export default function AssignTeam({ displayName, assignmentKey, legacyKey, assignments, members = [], onUpdate, compact = false }) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const current = assignments[assignmentKey] || assignments[legacyKey] || {}
  const hasAssignment = ROLES.some((role) => assignmentRoleMembers(current, role).length)
  const unsupportedMembers = members.filter((member) => !ROLE_CONFIG[member.role])

  const commit = async (...args) => {
    setSaving(true)
    setError("")
    try {
      const saved = await onUpdate(...args)
      if (saved === false) {
        setError("บันทึกไม่สำเร็จ — กรุณาลองใหม่")
        return false
      }
      return true
    } catch {
      setError("บันทึกไม่สำเร็จ — กรุณาลองใหม่")
      return false
    } finally {
      setSaving(false)
    }
  }

  const toggleMember = (role, name) => {
    const updated = { ...current }
    const selected = assignmentRoleMembers(current, role)
    const membersForRole = selected.includes(name) ? selected.filter((member) => member !== name) : [...selected, name]
    if (membersForRole.length) updated[role] = membersForRole
    else delete updated[role]
    commit(assignmentKey, updated, { role, members: membersForRole })
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger disabled={saving} aria-busy={saving} className={`ui-chip flex items-center gap-1 ${compact ? "px-1 py-0.5" : "px-1.5 py-1"}`} aria-label={`Assign team for ${displayName}`}>
        {hasAssignment ? <AssignedAvatars current={current} members={members} compact={compact} /> : <span className={`flex items-center gap-1 ${compact ? "text-[9px]" : "text-[10px]"} text-[var(--ui-muted)]`}><UserPlusIcon aria-hidden="true" size={15} />Assign</span>}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Backdrop className="assign-team-backdrop ui-overlay-enter fixed inset-0 z-[var(--z-overlay)] bg-black/35" />
        <Popover.Positioner className="assign-team-positioner z-[var(--z-popover)]" sideOffset={6} align="start">
          <Popover.Popup className="assign-team-popup ui-popover ui-popover-enter max-h-[70dvh] w-64 space-y-3 overflow-y-auto p-3">
            <div className="flex items-start justify-between gap-2"><div><Popover.Title className="text-xs font-bold text-[var(--ui-brand)]">Assign Team</Popover.Title><Popover.Description className="mt-0.5 max-w-44 truncate text-[11px] text-[var(--ui-muted)]">{displayName}</Popover.Description></div><Popover.Close className="ui-button ui-button-secondary ui-button-sm">เสร็จ</Popover.Close></div>
            {unsupportedMembers.length > 0 && <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-700">สมาชิกที่ยัง Assign ไม่ได้เพราะ role ไม่ถูกต้อง: {unsupportedMembers.map((member) => member.name).join(", ")} — กรุณาแก้ role ในจัดการทีม</p>}
            {ROLES.map((role) => {
              const rc = ROLE_CONFIG[role]
              const roleMembers = members.filter((member) => member.role === role)
              return <section key={role} aria-label={rc.label}><div className={`mb-1 inline-flex rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${rc.bg}`}>{rc.label}</div><div className="space-y-1">{roleMembers.map((member) => <MemberOption key={member.name} member={member} selected={assignmentRoleMembers(current, role).includes(member.name)} onToggle={(name) => { if (!saving) toggleMember(role, name) }} />)}{roleMembers.length === 0 && <p className="px-2 py-1 text-[11px] text-[var(--ui-muted)]">ยังไม่มีสมาชิกใน role นี้</p>}</div></section>
            })}
            {error && <p role="alert" className="text-[11px] font-medium text-[var(--ui-danger)]">{error}</p>}
            {hasAssignment && <button type="button" disabled={saving} onClick={async () => { if (await commit(assignmentKey, {}, { clear: true })) setOpen(false) }} className="ui-button ui-button-secondary w-full text-[var(--ui-danger)] disabled:opacity-50">{saving ? "กำลังบันทึก…" : "Clear all"}</button>}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
