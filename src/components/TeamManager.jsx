import { useEffect, useState, useRef } from "react"
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
export default function TeamManager({ members, onUpdate, onUploadAvatar, onRemoveAvatar, open, onClose }) {
  const [newName, setNewName] = useState("")
  const [newRole, setNewRole] = useState("creative")
  const [cropData, setCropData] = useState(null) // { idx, src }
  const [error, setError] = useState("")
  const [savingAvatar, setSavingAvatar] = useState(false)
  const fileInputRefs = useRef({})
  const closeRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const previousFocus = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    closeRef.current?.focus()
    const keydown = (event) => { if (event.key === "Escape") onClose() }
    document.addEventListener("keydown", keydown)
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener("keydown", keydown); previousFocus?.focus?.() }
  }, [onClose, open])

  if (!open) return null

  const addMember = () => {
    const name = newName.trim()
    if (!name) return
    if (members.some((m) => m.name.toLowerCase() === name.toLowerCase())) {
      alert(`"${name}" มีอยู่แล้ว`)
      return
    }
    onUpdate([...members, { name, role: newRole, avatar: "" }])
    setNewName("")
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

  const handleAvatarUpload = (idx, e) => {
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
      setCropData({ idx, src: ev.target.result })
    }
    reader.readAsDataURL(file)
    // Reset input so same file can be re-selected
    e.target.value = ""
  }

  const handleCropDone = async (croppedBase64) => {
    if (!cropData) return
    setSavingAvatar(true)
    setError("")
    const saved = await onUploadAvatar(cropData.idx, croppedBase64)
    setSavingAvatar(false)
    if (saved) setCropData(null)
    else setError("บันทึกรูปไม่สำเร็จ กรุณาลองใหม่")
  }

  const removeAvatar = async (idx) => {
    setError("")
    if (!await onRemoveAvatar(idx)) setError("ลบรูปไม่สำเร็จ กรุณาลองใหม่")
  }

  // Group by role
  const grouped = {}
  ROLES.forEach((r) => { grouped[r] = [] })
  members.forEach((m, i) => {
    if (!grouped[m.role]) grouped[m.role] = []
    grouped[m.role].push({ ...m, _idx: i })
  })

  return (
    <div className="ui-overlay-enter fixed inset-0 z-50 flex items-center justify-center bg-black/35" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="team-manager-title"
        className="ui-popover ui-modal-enter relative w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-purple-100 bg-white px-6 py-4 rounded-t-2xl">
          <div>
            <h2 id="team-manager-title" className="text-base font-bold text-purple-900">Team Members</h2>
            <p className="text-[11px] text-purple-300">จัดการสมาชิก เปลี่ยนรูป เพิ่มคน</p>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="ปิดหน้าจัดการทีม" className="ui-button ui-button-secondary min-h-0 p-1.5 text-purple-400">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-5">
          {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-600">{error}</div>}
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
                          <button type="button" onClick={() => fileInputRefs.current[m._idx]?.click()} aria-label={`เปลี่ยนรูป ${m.name}`} className="group relative block rounded-full">
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
                            <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                              <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                          </span>
                          </button>
                          <input
                            ref={(el) => { fileInputRefs.current[m._idx] = el }}
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            className="hidden"
                            onChange={(e) => handleAvatarUpload(m._idx, e)}
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
                            onClick={() => removeAvatar(m._idx)}
                            className="rounded-md p-1 text-gray-300 transition hover:bg-red-50 hover:text-red-400"
                            title="ลบรูป"
                          >
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                          </button>
                        )}

                        {/* Delete member */}
                        <button
                          onClick={() => removeMember(m._idx)}
                          className="rounded-md p-1 text-gray-300 transition hover:bg-red-50 hover:text-red-500"
                          title="ลบสมาชิก"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}

          {/* Add new member */}
          <div className="border-t border-purple-100 pt-4">
            <div className="text-[10px] font-bold uppercase tracking-wider text-purple-400 mb-2">เพิ่มสมาชิกใหม่</div>
            <div className="flex items-center gap-2">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addMember()}
                placeholder="ชื่อ..."
                className="ui-field flex-1 text-sm text-gray-700"
              />
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
                onClick={addMember}
                className="shrink-0 rounded-lg bg-purple-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-purple-700 active:scale-95"
              >
                เพิ่ม
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Image Cropper */}
      {cropData && (
        <ImageCropper
          imageSrc={cropData.src}
          onCrop={handleCropDone}
          onCancel={() => setCropData(null)}
          saving={savingAvatar}
        />
      )}
    </div>
  )
}
