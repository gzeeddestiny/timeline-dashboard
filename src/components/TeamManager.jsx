import { Dialog } from "@base-ui/react/dialog"
import { XIcon } from "@phosphor-icons/react/dist/csr/X"
import { CameraIcon } from "@phosphor-icons/react/dist/csr/Camera"
import { ImageIcon } from "@phosphor-icons/react/dist/csr/Image"
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash"
import { useEffect, useState, useRef } from "react"
import { listPendingGoogleAccounts } from "../lib/fullSystem"
import { ROLE_CONFIG, ROLES } from "../lib/teamConfig"
import ImageCropper from "./ImageCropper"

/**
 * Team management panel — add/edit/remove members + upload avatar photos.
 *
 * @param {Array} members — current team members
 * @param {function} onUpdate — (newMembers) => void
 * @param {boolean} open — show/hide panel
 * @param {function} onClose — close panel
 */
export default function TeamManager({ members, onUpdate, onAddMember, onUploadAvatar, onRemoveAvatar, open, onClose }) {
  const [newName, setNewName] = useState("")
  const [newEmail, setNewEmail] = useState("")
  const [pendingAccounts, setPendingAccounts] = useState([])
  const [newRole, setNewRole] = useState("creative")
  const [cropData, setCropData] = useState(null) // { memberName, src }
  const [error, setError] = useState("")
  const [savingAvatar, setSavingAvatar] = useState(false)
  const [avatarMessage, setAvatarMessage] = useState("")
  const [savingMember, setSavingMember] = useState(false)
  const fileInputRefs = useRef({})

  useEffect(() => {
    if (!open) return
    let active = true
    listPendingGoogleAccounts().then((accounts) => { if (active) setPendingAccounts(accounts) }).catch(() => {})
    return () => { active = false }
  }, [open])

  if (!open) return null

  const addMember = async (event) => {
    event?.preventDefault()
    const name = newName.trim()
    const email = newEmail.trim().toLowerCase()
    if (!name || !email) return
    if (members.some((m) => m.name.toLowerCase() === name.toLowerCase())) {
      setError(`"${name}" มีอยู่แล้ว`)
      return
    }
    setSavingMember(true)
    setError("")
    try {
      await onAddMember({ email, name, teamRole: newRole })
      setNewName("")
      setNewEmail("")
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setSavingMember(false)
    }
  }

  const removeMember = (idx) => {
    if (!confirm(`ลบ "${members[idx].name}" ออกจากทีม?`)) return
    onUpdate(members.filter((_, i) => i !== idx))
  }

  const changeRole = (idx, role) => {
    const updated = [...members]
    updated[idx] = { ...updated[idx], role }
    onUpdate(updated)
  }

  const handleAvatarUpload = (memberName, e) => {
    setAvatarMessage("")
    const file = e.target.files?.[0]
    if (!file) return
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 10_000_000) {
      setError("เลือกรูป JPEG, PNG หรือ WebP ขนาดไม่เกิน 10 MB")
      e.target.value = ""
      return
    }

    const reader = new FileReader()
    reader.onload = (ev) => {
      // Open cropper with the raw image
      setCropData({ memberName, src: ev.target.result })
    }
    reader.readAsDataURL(file)
    // Reset input so same file can be re-selected
    e.target.value = ""
  }

  const handleCropDone = async (croppedBlob) => {
    if (!cropData) return
    setSavingAvatar(true)
    setError("")
    setAvatarMessage("")
    try {
      const saved = await onUploadAvatar(cropData.memberName, croppedBlob)
      if (!saved) throw new Error("บันทึกรูปไม่สำเร็จ กรุณาลองใหม่")
      setCropData(null)
      setAvatarMessage(`บันทึกรูป Profile ของ ${cropData.memberName} เรียบร้อย และตรวจสอบข้อมูลแล้ว`)
    } catch (saveError) {
      setError(saveError.message)
      throw saveError
    } finally {
      setSavingAvatar(false)
    }
  }

  const removeAvatar = async (memberName) => {
    setError("")
    setAvatarMessage("")
    if (!await onRemoveAvatar(memberName)) setError("ลบรูปไม่สำเร็จ กรุณาลองใหม่")
    else setAvatarMessage(`ลบรูป Profile ของ ${memberName} เรียบร้อย`)
  }

  // Group by role
  const grouped = {}
  ROLES.forEach((r) => { grouped[r] = [] })
  members.forEach((m, i) => {
    if (!grouped[m.role]) grouped[m.role] = []
    grouped[m.role].push({ ...m, _idx: i })
  })
  const unsupportedMembers = members.map((member, index) => ({ ...member, _idx: index })).filter((member) => !ROLE_CONFIG[member.role])

  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose() }}>
      <Dialog.Portal>
        <Dialog.Backdrop className="ui-overlay-enter fixed inset-0 z-[var(--z-overlay)] bg-black/35" />
        <Dialog.Popup className="ui-popover ui-modal-enter fixed left-1/2 top-1/2 z-[var(--z-modal)] max-h-[85dvh] w-[min(32rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-purple-100 bg-white px-6 py-4 rounded-t-2xl">
          <div>
            <Dialog.Title id="team-manager-title" className="text-base font-bold text-[var(--ui-text)]">Team Members</Dialog.Title>
            <p className="text-[11px] text-purple-300">จัดการสมาชิก เปลี่ยนรูป เพิ่มคน</p>
          </div>
          <Dialog.Close type="button" aria-label="ปิดหน้าจัดการทีม" className="ui-icon-button"><XIcon aria-hidden="true" size={19} weight="bold" /></Dialog.Close>
        </div>

        <div className="p-6 space-y-5">
          {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-600">{error}</div>}
          {avatarMessage && <div role="status" aria-live="polite" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700">{avatarMessage}</div>}
          {unsupportedMembers.length > 0 && <div role="alert" className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700"><p>สมาชิกต่อไปนี้มี role ที่ระบบไม่รองรับ จึงยัง Assign ไม่ได้ กรุณาเลือก role ใหม่</p>{unsupportedMembers.map((member) => <label key={member.name} className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate font-semibold">{member.name}</span><select defaultValue="" onChange={(event) => changeRole(member._idx, event.target.value)} className="ui-field px-2 py-1 text-xs"><option value="" disabled>เลือก role</option>{ROLES.map((role) => <option key={role} value={role}>{ROLE_CONFIG[role].label}</option>)}</select></label>)}</div>}
          {/* Members by role */}
          {ROLES.map((role) => {
            const rc = ROLE_CONFIG[role]
            const group = grouped[role] || []
            return (
              <div key={role}>
                <div className="flex items-center gap-2 mb-2">
                  <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ${rc.bg}`}>
                    {rc.label}
                  </span>
                  <span className="text-[10px] text-gray-300">{group.length} คน</span>
                </div>

                {group.length === 0 ? (
                  <p className="text-[11px] text-gray-300 ml-2">ยังไม่มีสมาชิก</p>
                ) : (
                  <div className="space-y-2">
                    {group.map((m) => (
                      <div key={m._idx} className="ui-task-row flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50/50 px-3 py-2">
                        {/* Avatar */}
                        <div className="relative">
                          <button type="button" onClick={() => fileInputRefs.current[m.name]?.click()} aria-label={`เปลี่ยนรูป ${m.name}`} className="group relative block rounded-full">
                          {m.avatar ? (
                            <img
                              src={m.avatar}
                              alt={m.name}
                              className={`${rc.sizeClass} rounded-full object-cover ring-2 ${rc.ring} ring-offset-1`}
                            />
                          ) : (
                            <span
                              className={`${rc.sizeClass} ${rc.bg} ${rc.textClass} rounded-full ring-2 ${rc.ring} ring-offset-1 flex items-center justify-center font-bold`}
                            >
                              {m.name[0]?.toUpperCase()}
                            </span>
                          )}
                          {/* Upload overlay */}
                          <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                            <CameraIcon aria-hidden="true" className="text-white" size={14} weight="bold" />
                          </span>
                          </button>
                          <input
                            ref={(el) => { fileInputRefs.current[m.name] = el }}
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            className="hidden"
                            onChange={(e) => handleAvatarUpload(m.name, e)}
                          />
                        </div>

                        {/* Name */}
                        <span className="text-sm font-medium text-gray-700 flex-1">{m.name}</span>

                        {/* Role selector */}
                        <select
                          value={m.role}
                          onChange={(e) => changeRole(m._idx, e.target.value)}
                          className="ui-field px-2 py-1 text-[11px] font-medium text-gray-600"
                        >
                          {ROLES.map((r) => (
                            <option key={r} value={r}>{ROLE_CONFIG[r].label}</option>
                          ))}
                        </select>

                        {/* Remove avatar */}
                        {m.avatar && (
                          <button
                            onClick={() => removeAvatar(m.name)}
                            className="ui-action-icon text-gray-300 hover:bg-red-50 hover:text-red-400"
                            aria-label={`ลบรูป ${m.name}`}
                            title="ลบรูป"
                          >
                            <ImageIcon aria-hidden="true" size={15} />
                          </button>
                        )}

                        {/* Delete member */}
                        <button
                          onClick={() => removeMember(m._idx)}
                          className="ui-action-icon text-gray-300 hover:bg-red-50 hover:text-red-500"
                          aria-label={`ลบสมาชิก ${m.name}`}
                          title="ลบสมาชิก"
                        >
                          <TrashIcon aria-hidden="true" size={15} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}

          {/* Add new member */}
          <form onSubmit={addMember} className="border-t border-purple-100 pt-4">
            <div className="text-[10px] font-bold uppercase tracking-wider text-purple-400 mb-2">เพิ่มสมาชิกใหม่</div>
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="ชื่อ..."
                aria-label="ชื่อสมาชิกใหม่"
                required
                className="ui-field text-sm text-gray-700"
              />
              <input
                type="email"
                list="team-pending-google-account-emails"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="อีเมล Google ที่ใช้ Sign in"
                aria-label="อีเมล Google ของสมาชิกใหม่"
                required
                className="ui-field text-sm text-gray-700"
              />
              <datalist id="team-pending-google-account-emails">{pendingAccounts.map((account) => <option key={account.email} value={account.email}>{account.name}</option>)}</datalist>
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value)}
                className="ui-field px-2 text-xs font-medium text-gray-600"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>{ROLE_CONFIG[r].label}</option>
                ))}
              </select>
              <button
                type="submit"
                disabled={savingMember}
                className="ui-button ui-button-primary shrink-0 text-xs"
              >
                {savingMember ? "กำลังเพิ่ม…" : "เพิ่มพร้อมสิทธิ์ใช้งาน"}
              </button>
            </div>
            <p className="mt-2 text-[10px] text-amber-600">อีเมลต้องตรงกับบัญชี Google ที่พนักงานใช้ Sign in ทุกตัว</p>
          </form>
        </div>
        </Dialog.Popup>
      </Dialog.Portal>

      {/* Image Cropper */}
      {cropData && (
        <ImageCropper
          imageSrc={cropData.src}
          onCrop={handleCropDone}
          onCancel={() => setCropData(null)}
          saving={savingAvatar}
        />
      )}
    </Dialog.Root>
  )
}
