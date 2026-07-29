import { useState, useRef, useEffect, useCallback } from "react"
import { createPortal } from "react-dom"
import { ROLE_CONFIG, ROLES } from "../lib/teamConfig"

function MemberOption({ member, isSelected, onToggle }) {
  const rc = ROLE_CONFIG[member.role]
  const initial = member.name[0].toUpperCase()
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onToggle(member.name) }}
      className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 transition-all w-full text-left ${
        isSelected
          ? `${rc.bg} ring-1 ${rc.ring}`
          : "hover:bg-gray-50 active:bg-gray-100"
      }`}
    >
      {member.avatar ? (
        <img src={member.avatar} alt={member.name} className={`h-6 w-6 rounded-full object-cover ring-1 ${isSelected ? rc.ring : "ring-gray-200"} sm:h-6 sm:w-6`} />
      ) : (
        <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold ring-1 ${
          isSelected ? `${rc.bg} ${rc.ring}` : "bg-gray-100 text-gray-400 ring-gray-200"
        }`}>
          {initial}
        </span>
      )}
      <span className={`text-xs font-medium ${isSelected ? "text-gray-800" : "text-gray-500"}`}>
        {member.name}
      </span>
      {isSelected && (
        <svg className="ml-auto h-3.5 w-3.5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      )}
    </button>
  )
}

/** Shared popup content used by both desktop dropdown and mobile bottom sheet */
function PopupContent({ displayName, assignmentKey, current, allMembers, hasAssignment, toggleMember, onUpdate, onClose }) {
  return (
    <>
      <div className="text-[10px] font-bold uppercase tracking-wider text-purple-400 mb-1">
        Assign Team — {displayName}
      </div>

      {ROLES.map((role) => {
        const rc = ROLE_CONFIG[role]
        const members = allMembers.filter((m) => m.role === role)
        return (
          <div key={role}>
            <div className="flex items-center gap-1.5 mb-1">
              <span className={`inline-block rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${rc.bg}`}>
                {rc.label}
              </span>
            </div>
            <div className="space-y-0.5">
              {members.map((m) => (
                <MemberOption
                  key={m.name}
                  member={m}
                  isSelected={current[role] === m.name}
                  onToggle={(name) => toggleMember(role, name)}
                />
              ))}
              {members.length === 0 && <div className="px-2 py-1 text-[10px] text-gray-300">ยังไม่มีสมาชิกใน role นี้</div>}
            </div>
          </div>
        )
      })}

      {hasAssignment && (
        <button
          onClick={(e) => { e.stopPropagation(); onUpdate(assignmentKey, {}); onClose() }}
          className="w-full rounded-lg border border-red-100 px-2 py-1.5 text-[10px] font-medium text-red-400 transition hover:bg-red-50 hover:text-red-600 active:bg-red-100"
        >
          Clear all
        </button>
      )}
    </>
  )
}

/**
 * Inline assignment display + popup editor.
 * Desktop: positioned dropdown via portal.
 * Mobile (<640px): bottom sheet with backdrop.
 */
export default function AssignTeam({ displayName, assignmentKey, legacyKey, assignments, members = [], onUpdate, compact = false }) {
  const [showPopup, setShowPopup] = useState(false)
  const btnRef = useRef(null)
  const popupRef = useRef(null)
  const [popupPos, setPopupPos] = useState({ top: 0, left: 0 })
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 640)

  const current = assignments[assignmentKey] || assignments[legacyKey] || {}

  // Track viewport size
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 640)
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

  // Position popup relative to the button (desktop only)
  // Checks vertical overflow: if no room below, show above
  const updatePos = useCallback(() => {
    if (!btnRef.current || isMobile) return
    const r = btnRef.current.getBoundingClientRect()
    const popupW = 224 // w-56 = 14rem = 224px
    const popupH = popupRef.current?.offsetHeight || 320

    let left = r.left
    if (left + popupW > window.innerWidth - 8) left = window.innerWidth - popupW - 8
    if (left < 8) left = 8

    // Prefer below; if not enough room, show above
    const spaceBelow = window.innerHeight - r.bottom
    const spaceAbove = r.top
    let top
    if (spaceBelow >= popupH + 8 || spaceBelow >= spaceAbove) {
      top = r.bottom + 4
    } else {
      top = r.top - popupH - 4
    }
    // Clamp to viewport
    top = Math.max(8, Math.min(top, window.innerHeight - popupH - 8))

    setPopupPos({ top, left })
  }, [isMobile])

  // Close on outside click (desktop) or backdrop tap (mobile handled inline)
  // Also reposition on scroll/resize so popup tracks the button
  useEffect(() => {
    if (!showPopup) return
    // Delay first position calc so popupRef.current has rendered (for height measurement)
    requestAnimationFrame(updatePos)
    if (isMobile) return // mobile uses backdrop onClick

    const handler = (e) => {
      if (popupRef.current?.contains(e.target)) return
      if (btnRef.current?.contains(e.target)) return
      setShowPopup(false)
    }
    document.addEventListener("pointerdown", handler, true)
    const onKeyDown = (event) => { if (event.key === "Escape") setShowPopup(false) }
    document.addEventListener("keydown", onKeyDown)

    // Reposition on scroll/resize so it doesn't drift
    const reposition = () => updatePos()
    window.addEventListener("scroll", reposition, true)
    window.addEventListener("resize", reposition)

    return () => {
      document.removeEventListener("pointerdown", handler, true)
      document.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("scroll", reposition, true)
      window.removeEventListener("resize", reposition)
    }
  }, [showPopup, updatePos, isMobile])

  // Lock body scroll on mobile when popup is open
  useEffect(() => {
    if (!showPopup || !isMobile) return
    document.body.style.overflow = "hidden"
    return () => { document.body.style.overflow = "" }
  }, [showPopup, isMobile])

  const toggleMember = (role, name) => {
    const updated = { ...current }
    if (updated[role] === name) {
      delete updated[role]
    } else {
      updated[role] = name
    }
    onUpdate(assignmentKey, updated)
  }

  const allMembers = members
  const hasAssignment = ROLES.some((r) => current[r])

  const popupContent = (
    <PopupContent
      displayName={displayName}
      assignmentKey={assignmentKey}
      current={current}
      allMembers={allMembers}
      hasAssignment={hasAssignment}
      toggleMember={toggleMember}
      onUpdate={onUpdate}
      onClose={() => setShowPopup(false)}
    />
  )

  return (
    <div className="relative">
      {/* Display assigned members or assign button */}
      <button
        ref={btnRef}
        onClick={(e) => { e.stopPropagation(); setShowPopup((open) => !open) }}
        className={`flex items-center gap-1 rounded-lg transition-all ${
          compact ? "px-1 py-0.5" : "px-1.5 py-1"
        } ${showPopup ? "bg-purple-100 ring-1 ring-purple-300" : "hover:bg-purple-50"}`}
        title="Assign team"
      >
        {hasAssignment ? (
          <div className="flex items-center -space-x-1">
            {ROLES.map((role) => {
              const name = current[role]
              if (!name) return null
              const member = allMembers.find((m) => m.name === name)
              if (!member) return null
              const rc = ROLE_CONFIG[role]
              const initial = member.name[0].toUpperCase()
              const size = compact ? rc.xsSizeClass : rc.smSizeClass
              const text = compact ? rc.xsTextClass : rc.smTextClass
              return member.avatar ? (
                <img key={role} src={member.avatar} alt={member.name} className={`${size} rounded-full object-cover ring-1 ${rc.ring} ring-offset-1`} />
              ) : (
                <span key={role} className={`${size} ${text} ${rc.bg} rounded-full ring-1 ${rc.ring} ring-offset-1 flex items-center justify-center font-bold`}>
                  {initial}
                </span>
              )
            })}
          </div>
        ) : (
          <span className={`flex items-center gap-1 ${compact ? "text-[9px]" : "text-[10px]"} text-purple-300 hover:text-purple-500`}>
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
            </svg>
            Assign
          </span>
        )}
      </button>

      {/* Popup via portal */}
      {showPopup && createPortal(
        isMobile ? (
          /* ── Mobile: bottom sheet + backdrop ── */
          <div
            className="fixed inset-0 z-[9999] flex flex-col justify-end"
            onClick={(e) => { e.stopPropagation(); setShowPopup(false) }}
          >
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/30" />
            {/* Sheet */}
            <div
              ref={popupRef}
              className="relative rounded-t-2xl border-t border-purple-200 bg-white shadow-2xl px-4 pb-6 pt-3 space-y-3 max-h-[75vh] overflow-y-auto animate-magic-enter"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Drag handle */}
              <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-gray-300" />
              {/* Done button */}
              <div className="flex items-center justify-between mb-1">
                <div className="text-xs font-bold uppercase tracking-wider text-purple-400">
                  Assign Team — {displayName}
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); setShowPopup(false) }}
                  className="rounded-lg bg-purple-100 px-3 py-1 text-xs font-bold text-purple-600 active:bg-purple-200"
                >
                  Done
                </button>
              </div>

              {ROLES.map((role) => {
                const rc = ROLE_CONFIG[role]
                const members = allMembers.filter((m) => m.role === role)
                return (
                  <div key={role}>
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <span className={`inline-block rounded px-2 py-0.5 text-[10px] font-bold uppercase ${rc.bg}`}>
                        {rc.label}
                      </span>
                    </div>
                    <div className="space-y-1">
                      {members.map((m) => (
                        <MemberOption
                          key={m.name}
                          member={m}
                          isSelected={current[role] === m.name}
                          onToggle={(name) => toggleMember(role, name)}
                        />
                      ))}
                      {members.length === 0 && <div className="px-2 py-1 text-[10px] text-gray-300">ยังไม่มีสมาชิกใน role นี้</div>}
                    </div>
                  </div>
                )
              })}

              {hasAssignment && (
                <button
                  onClick={(e) => { e.stopPropagation(); onUpdate(assignmentKey, {}); setShowPopup(false) }}
                  className="w-full rounded-lg border border-red-200 px-3 py-2.5 text-xs font-medium text-red-500 transition active:bg-red-100"
                >
                  Clear all
                </button>
              )}
            </div>
          </div>
        ) : (
          /* ── Desktop: positioned dropdown ── */
          <div
            ref={popupRef}
            className="fixed z-[9999] w-56 rounded-xl border border-purple-200 bg-white shadow-lg p-3 space-y-3 max-h-[70vh] overflow-y-auto"
            style={{ top: popupPos.top, left: popupPos.left }}
            onClick={(e) => e.stopPropagation()}
          >
            {popupContent}
          </div>
        ),
        document.body
      )}
    </div>
  )
}
