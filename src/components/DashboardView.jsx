import { useMemo, useState, useRef, useEffect, useCallback } from "react"
import { ROLE_CONFIG, ROLES, taskOwnerNames } from "../lib/teamConfig"
import { extractBrandName } from "../lib/sheetsApi"
import { filterDashboardTasks } from "../lib/dashboardFilters"
import { normalizeBrandKey, tabKey, taskKey } from "../lib/sharedState"
import { bangkokDate, daysFrom } from "../lib/dates"
import { sortMonthLabels } from "../lib/workViews"
import AssignTeam from "./AssignTeam"
import Emoji from "./Emoji"
import { emojiText } from "../lib/uiEmoji"

// ─── Helpers ────────────────────────────────────────────────────────────────────

let cachedToday = ""
let cachedTodayAt = 0
function daysFromToday(dueDate) {
  if (!cachedToday || Date.now() - cachedTodayAt > 60_000) {
    cachedToday = bangkokDate()
    cachedTodayAt = Date.now()
  }
  return daysFrom(dueDate, cachedToday)
}

function fmtDate(iso) {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })
}

function fmtDayHeader(iso) {
  const d = daysFromToday(iso)
  if (d === 0) return "Today"
  if (d === 1) return "Tomorrow"
  return new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" })
}

function progressColor(pct) {
  const hue = Math.round(pct * 1.2)
  return `hsl(${hue}, 65%, 46%)`
}

function overdueConfig(absDays) {
  if (absDays >= 15) return { cls: "bg-red-600 text-white", label: "Critical" }
  if (absDays >= 8) return { cls: "bg-red-200 text-red-800", label: "High" }
  if (absDays >= 4) return { cls: "bg-orange-100 text-orange-700", label: "Medium" }
  return { cls: "bg-amber-50 text-amber-700", label: "Low" }
}

function trendCount(metrics, status) {
  const fields = {
    overdue: "overdue", upcoming: "upcoming", done: "done", not_started: "notStarted",
    in_progress: "inProgress", waiting_client: "waitingClient", blocked: "blocked", unscheduled: "unscheduled",
  }
  return status === "all" ? metrics.total || 0 : metrics[fields[status]] || 0
}

// ─── Sub-components ─────────────────────────────────────────────────────────────

function StatCard({ icon, label, value, sub, color, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`ui-card ui-interactive rounded-2xl text-left ${color.border} ${color.bg} p-5`}
    >
      <div className="flex items-center gap-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${color.iconBg}`}>
          {icon}
        </div>
        <div>
          <div className={`text-2xl font-black tabular-nums ${color.text}`}>{value}</div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-gray-500">{label}</div>
        </div>
      </div>
      {sub && <div className="mt-2 text-[11px] text-gray-500">{sub}</div>}
    </button>
  )
}

function CompletionRing({ pct }) {
  const roundedPct = Math.round(pct)
  return (
    <div
      className="flex h-11 w-11 items-center justify-center rounded-full"
      style={{
        background: `conic-gradient(${progressColor(roundedPct)} ${roundedPct * 3.6}deg, #f3e8ff ${roundedPct * 3.6}deg)`,
      }}
    >
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-[11px] font-black text-purple-700">
        {roundedPct}%
      </div>
    </div>
  )
}

// ── Editable Client Name (inline in health row) ─────────────────────────────

function EditableClientName({ name, rawTabNames, onRename }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(name)

  const commit = () => {
    const trimmed = value.trim()
    if (trimmed && trimmed !== name) onRename(name, rawTabNames, trimmed)
    setEditing(false)
  }

  if (!onRename) return <span className="block truncate text-sm font-semibold text-gray-800">{name}</span>

  if (editing) {
    return (
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false) }}
        className="w-full rounded-md border border-purple-300 px-1.5 py-0.5 text-sm font-semibold text-gray-800 outline-none focus:ring-1 focus:ring-purple-400"
      />
    )
  }

  return (
    <span
      className="text-sm font-semibold text-gray-800 truncate block cursor-pointer hover:text-purple-600 transition"
      onClick={() => { setValue(name); setEditing(true) }}
      title="คลิกเพื่อแก้ชื่อแบรนด์"
    >
      {name}
      <svg className="inline-block ml-1 h-2.5 w-2.5 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
      </svg>
    </span>
  )
}

// ── Brand Manager Popup ──────────────────────────────────────────────────────

function BrandManager({ confirmed, newTabs, onConfirm, onRename, onRemove, onClose }) {
  const [editingBrand, setEditingBrand] = useState(null)
  const [editValue, setEditValue] = useState("")
  const [newConfirmName, setNewConfirmName] = useState({})
  const [expandedBrand, setExpandedBrand] = useState(null)
  const closeRef = useRef(null)

  useEffect(() => {
    const previousFocus = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    closeRef.current?.focus()
    const keydown = (event) => { if (event.key === "Escape") onClose() }
    document.addEventListener("keydown", keydown)
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener("keydown", keydown); previousFocus?.focus?.() }
  }, [onClose])

  const existingBrands = Object.keys(confirmed)

  const startEdit = (name) => { setEditingBrand(name); setEditValue(name) }
  const commitEdit = () => {
    const trimmed = editValue.trim()
    if (trimmed && trimmed !== editingBrand) {
      onRename(editingBrand, trimmed)
    }
    setEditingBrand(null)
  }

  const handleConfirmNew = (tab) => {
    const name = (newConfirmName[tab.key] || extractBrandName(tab.title)).trim()
    if (name) onConfirm(name, [tab])
  }

  // Merge new tab into existing confirmed brand
  const handleMerge = (tab, brandName) => {
    onConfirm(brandName, [tab])
  }

  return (
    <div className="ui-overlay-enter fixed inset-0 z-50 flex items-center justify-center bg-black/35" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="brand-manager-title" className="ui-popover ui-panel-enter relative w-full max-w-lg max-h-[80vh] overflow-y-auto rounded-2xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-purple-100 bg-white px-5 py-4 rounded-t-2xl">
          <div>
            <h2 id="brand-manager-title" className="text-base font-bold text-purple-900">จัดการรายชื่อลูกค้า</h2>
            <p className="text-[11px] text-purple-300">ยืนยัน แก้ชื่อ รวม หรือลบแบรนด์</p>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="ปิดหน้าจัดการแบรนด์" className="rounded-lg p-1.5 text-purple-300 transition hover:bg-purple-50 hover:text-purple-600">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* New / unconfirmed tabs */}
          {newTabs.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="rounded-md bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-700">ใหม่</span>
                <span className="text-[10px] text-gray-400">{newTabs.length} tabs ยังไม่ได้ยืนยัน</span>
              </div>
              <div className="space-y-2">
                {newTabs.map((tab) => {
                  const suggested = newConfirmName[tab.key] ?? extractBrandName(tab.title)
                  return (
                    <div key={tab.key} className="rounded-xl border border-amber-200 bg-amber-50/50 px-3 py-2.5 space-y-2">
                      <div className="text-[10px] text-gray-400 truncate" title={tab.title}>Tab: {tab.title}</div>
                      <div className="flex items-center gap-2">
                        <input
                          value={suggested}
                          onChange={(e) => setNewConfirmName((p) => ({ ...p, [tab.key]: e.target.value }))}
                          onKeyDown={(e) => e.key === "Enter" && handleConfirmNew(tab)}
                          className="flex-1 rounded-lg border border-amber-200 px-2.5 py-1.5 text-sm font-medium text-gray-700 outline-none focus:border-purple-400 focus:ring-1 focus:ring-purple-200"
                          placeholder="ชื่อแบรนด์..."
                        />
                        <button
                          onClick={() => handleConfirmNew(tab)}
                          className="shrink-0 rounded-lg bg-purple-600 px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-purple-700 active:scale-95"
                        >
                          ยืนยัน
                        </button>
                      </div>
                      {/* Quick merge buttons — merge into existing confirmed brand */}
                      {existingBrands.length > 0 && (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[9px] text-gray-400 shrink-0">รวมเข้า:</span>
                          {existingBrands.map((b) => (
                            <button
                              key={b}
                              onClick={() => handleMerge(tab, b)}
                              className="rounded-full border border-purple-200 bg-white px-2 py-0.5 text-[9px] font-medium text-purple-600 transition hover:bg-purple-100 active:scale-95"
                            >
                              {b}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Confirmed brands */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="rounded-md bg-green-100 px-2 py-0.5 text-[10px] font-bold uppercase text-green-700">ยืนยันแล้ว</span>
              <span className="text-[10px] text-gray-400">{existingBrands.length} brands</span>
            </div>
            {existingBrands.length === 0 ? (
              <p className="text-[11px] text-gray-300 ml-2">ยังไม่มีแบรนด์ที่ยืนยัน — กด "ยืนยัน" ด้านบน</p>
            ) : (
              <div className="space-y-1.5">
                {Object.entries(confirmed).map(([brand, data]) => (
                  <div key={brand} className="rounded-xl border border-gray-100 bg-gray-50/50 overflow-hidden">
                    <div className="flex items-center gap-2 px-3 py-2">
                      {editingBrand === brand ? (
                        <input
                          autoFocus
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onBlur={commitEdit}
                          onKeyDown={(e) => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") setEditingBrand(null) }}
                          className="flex-1 rounded-md border border-purple-300 px-2 py-0.5 text-sm font-semibold text-gray-800 outline-none focus:ring-1 focus:ring-purple-400"
                        />
                      ) : (
                        <button type="button"
                          className="flex-1 truncate text-left text-sm font-semibold text-gray-800 hover:text-purple-600"
                          onClick={() => startEdit(brand)}
                          title="คลิกเพื่อแก้ชื่อ"
                        >
                          {brand}
                          <svg className="inline-block ml-1 h-2.5 w-2.5 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                          </svg>
                        </button>
                      )}
                      {/* Tab count — click to expand */}
                      <button
                        onClick={() => setExpandedBrand(expandedBrand === brand ? null : brand)}
                        className="text-[9px] text-gray-400 shrink-0 rounded px-1.5 py-0.5 hover:bg-purple-50 hover:text-purple-500 transition"
                        title="ดู tabs"
                      >
                        {data.tabs.length} tabs {expandedBrand === brand ? "▲" : "▼"}
                      </button>
                      {/* Delete */}
                      <button
                        onClick={() => { if (confirm(`ลบ "${brand}"? (tabs จะกลับเป็น "ใหม่")`)) onRemove(brand) }}
                        className="shrink-0 rounded-md p-1 text-gray-300 transition hover:bg-red-50 hover:text-red-500"
                        title="ลบแบรนด์"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                    {/* Expanded: show individual tabs */}
                    {expandedBrand === brand && (
                      <div className="border-t border-gray-100 bg-white px-3 py-2 space-y-1">
                        <div className="text-[9px] font-bold uppercase tracking-wider text-gray-300 mb-1">Google Sheet Tabs</div>
                        {data.tabs.map((tab) => (
                          <div key={tab.key} className="flex items-center gap-2 text-[10px] text-gray-500 py-0.5">
                            <span className="flex-1 truncate" title={tab.title}>{tab.title}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function ClientHealthRow({ name, rawTabNames, assignmentKey, legacyKey, stats, overdueCount, nextTask, assignments, teamMembers, onUpdateAssignment, onRename, onOpen, canManageAssignments }) {
  const pct = stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0
  const barWidth = stats.total > 0 ? (stats.done / stats.total) * 100 : 0

  return (
    <div className="ui-card ui-interactive flex flex-col items-stretch gap-3 rounded-xl px-4 py-3 md:flex-row md:items-center">
      {/* Client name — editable */}
      <div className="w-full shrink-0 md:w-56">
        <EditableClientName name={name} rawTabNames={rawTabNames} onRename={onRename} />
        <button type="button" onClick={onOpen} className="mt-1 min-h-11 text-[9px] font-semibold text-purple-700 hover:text-purple-900 md:min-h-0">ดูงานทั้งหมด</button>
      </div>

      {/* Progress bar */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
            <div
              className="h-full rounded-full transition-[width] duration-150"
              style={{ width: `${barWidth}%`, backgroundColor: progressColor(pct) }}
            />
          </div>
          <span className="text-[11px] font-bold tabular-nums w-12 text-right" style={{ color: progressColor(pct) }}>
            {pct}%
          </span>
          <span className="text-[10px] text-gray-400 tabular-nums w-10">
            {stats.done}/{stats.total}
          </span>
        </div>
      </div>

      {/* Overdue badge */}
      <div className="flex w-full items-center justify-between text-center md:block md:w-16"><span className="text-[9px] font-bold uppercase text-gray-300 md:hidden">Overdue</span>
        {overdueCount > 0 ? (
          <span className="inline-flex items-center gap-0.5 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-600">
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            {overdueCount}
          </span>
        ) : (
          <span className="text-[10px] text-green-400 font-medium">✓ OK</span>
        )}
      </div>

      {/* Next deadline */}
      <div className="flex w-full items-center justify-between text-center md:block md:w-24"><span className="text-[9px] font-bold uppercase text-gray-300 md:hidden">Next due</span>
        {nextTask ? (
          <span className="text-[11px] text-gray-500">
            {fmtDate(nextTask.dueDate)}
            <span className="text-[9px] text-gray-300 ml-1">
              ({daysFromToday(nextTask.dueDate)}d)
            </span>
          </span>
        ) : (
          <span className="text-[10px] text-gray-300">—</span>
        )}
      </div>

      {/* Team */}
      <div className="flex w-full items-center justify-between md:w-28 md:justify-end"><span className="text-[9px] font-bold uppercase text-gray-300 md:hidden">Team</span>
        {canManageAssignments && <AssignTeam
          displayName={name}
          assignmentKey={assignmentKey}
          legacyKey={legacyKey}
          assignments={assignments}
          members={teamMembers}
          onUpdate={onUpdateAssignment}
          compact
        />}
      </div>
    </div>
  )
}

function MemberCard({ member, stats, maxOverdue, onOpen }) {
  const rc = ROLE_CONFIG[member.role]
  const total = stats.done + stats.pending + stats.overdue
  const isHighOverdue = stats.overdue > 0 && stats.overdue >= maxOverdue

  return (
    <button type="button"
      onClick={onOpen}
      className={`ui-card ui-interactive rounded-2xl p-4 ${
        isHighOverdue ? "border-red-200" : "border-gray-100"
      } text-left`}
    >
      <div className="flex items-center gap-3 mb-3">
        {/* Avatar */}
        {member.avatar ? (
          <img
            src={member.avatar}
            alt={member.name}
            className={`${rc.smSizeClass} rounded-full object-cover ring-2 ${rc.ring} ring-offset-1`}
          />
        ) : (
          <span className={`${rc.smSizeClass} ${rc.bg} rounded-full ring-2 ${rc.ring} ring-offset-1 flex items-center justify-center font-bold ${rc.smTextClass}`}>
            {member.name[0]?.toUpperCase()}
          </span>
        )}
        <div className="min-w-0">
          <div className="text-sm font-semibold text-gray-800 truncate">{member.name}</div>
          <span className={`inline-block rounded px-1.5 py-0.5 text-[8px] font-bold uppercase ${rc.bg} text-gray-700`}>
            {rc.label}
          </span>
        </div>
        {total > 0 && (
          <span className="ml-auto text-lg font-black tabular-nums text-gray-300">{total}</span>
        )}
      </div>

      {/* Stacked bar */}
      {total > 0 ? (
        <>
          <div className="flex h-2.5 rounded-full overflow-hidden bg-gray-100">
            {stats.done > 0 && (
              <div
                className="bg-green-400 transition-[width] duration-150"
                style={{ width: `${(stats.done / total) * 100}%` }}
              />
            )}
            {stats.pending > 0 && (
              <div
                className="bg-blue-300 transition-[width] duration-150"
                style={{ width: `${(stats.pending / total) * 100}%` }}
              />
            )}
            {stats.overdue > 0 && (
              <div
                className="bg-red-400 transition-[width] duration-150"
                style={{ width: `${(stats.overdue / total) * 100}%` }}
              />
            )}
          </div>
          <div className="flex items-center gap-3 mt-2 text-[10px] font-medium">
            {stats.done > 0 && <span className="text-green-600">✓ {stats.done} done</span>}
            {stats.pending > 0 && <span className="text-purple-500">{stats.pending} pending</span>}
            {stats.overdue > 0 && <span className="text-red-500"><Emoji name="overdue" /> {stats.overdue} overdue</span>}
          </div>
          {/* Client badges */}
          {stats.clients.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {stats.clients.map((c) => (
                <span key={c} className="rounded-full bg-purple-50 px-2 py-0.5 text-[9px] font-medium text-purple-500">
                  {c}
                </span>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="text-[11px] text-gray-300 mt-1"><Emoji name="celebration" /> ไม่มีงาน</div>
      )}
    </button>
  )
}

function OverdueItem({ task, brandName }) {
  const days = daysFromToday(task.dueDate)
  const absDays = Math.abs(days ?? 0)
  const { cls, label } = overdueConfig(absDays)

  return (
    <a href={`https://docs.google.com/spreadsheets/d/${task.spreadsheetId}/edit#gid=${task.sheetGid}`} target="_blank" rel="noreferrer" className="ui-interactive flex items-center gap-2.5 rounded-lg px-3 py-2">
      {/* Severity */}
      <span className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums ${cls}`}>
        {absDays}d late <span className="text-[8px] uppercase opacity-70">{label}</span>
      </span>
      {/* Client */}
      <span className="shrink-0 rounded-full bg-purple-50 px-2 py-0.5 text-[9px] font-medium text-purple-500 max-w-20 truncate">
        {brandName}
      </span>
      {/* Topic */}
      <span className="text-[11px] text-gray-600 truncate flex-1 min-w-0">{task.topic}</span>
      {/* Person */}
      <span className="text-[10px] text-gray-400 shrink-0 max-w-16 truncate">{task.responsibility}</span>
    </a>
  )
}

function UpcomingDayGroup({ dateKey, tasks, brandNameForTask }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-1.5">
        <span className={`text-[11px] font-bold ${
          daysFromToday(dateKey) === 0 ? "text-orange-500" : daysFromToday(dateKey) === 1 ? "text-amber-500" : "text-gray-500"
        }`}>
          {fmtDayHeader(dateKey)}
        </span>
        <div className="flex-1 h-px bg-gray-100" />
        <span className="text-[10px] text-gray-400">{tasks.length} tasks</span>
      </div>
      <div className="space-y-1 ml-1">
        {tasks.map((t) => {
          const d = daysFromToday(t.dueDate)
          const dotColor = d === 0 ? "bg-orange-400" : d <= 2 ? "bg-amber-400" : "bg-green-400"
          return (
            <a key={taskKey(t)} href={`https://docs.google.com/spreadsheets/d/${t.spreadsheetId}/edit#gid=${t.sheetGid}`} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition hover:bg-purple-50/50">
              <span className={`h-2 w-2 rounded-full shrink-0 ${dotColor}`} />
              <span className="shrink-0 rounded-full bg-purple-50 px-2 py-0.5 text-[9px] font-medium text-purple-500 max-w-20 truncate">
                {brandNameForTask(t)}
              </span>
              <span className="text-[11px] text-gray-600 truncate flex-1 min-w-0">{t.topic}</span>
              <span className="text-[10px] text-gray-400 shrink-0">{t.responsibility}</span>
            </a>
          )
        })}
      </div>
    </div>
  )
}

// ─── Deadline Roadmap ───────────────────────────────────────────────────────────

function milestoneColor(task) {
  if (task.done) return "#15803d"
  if (task.workflowStatus === "blocked") return "#9f1239"
  if (task.workflowStatus === "waiting_client") return "#b54708"
  if (daysFromToday(task.dueDate) < 0) return "#b42318"
  if (task.workflowStatus === "in_progress") return "#1d4ed8"
  return "#480174"
}

const ZOOM_LEVELS = [
  { label: "4W", days: 28, past: 7 },
  { label: "12W", days: 84, past: 14 },
  { label: "6M", days: 180 },
  { label: "All", days: 0 },
]

function DeadlineRoadmap({ allTasks, brandNameForTask, assignedNames, onOpenTask, preferenceOwner }) {
  const scrollRef = useRef(null)
  const containerRef = useRef(null)
  const [zoomIdx, setZoomIdx] = useState(1) // default 3M
  const [roadmapNow] = useState(Date.now)
  const [windowOffset, setWindowOffset] = useState(0)
  const [groupMode, setGroupMode] = useState(() => localStorage.getItem(`magic-roadmap-group:${preferenceOwner}`) || "brand")
  const [containerWidth, setContainerWidth] = useState(800)
  const [isDragging, setIsDragging] = useState(false)
  const dragState = useRef({ startX: 0, scrollLeft: 0 })

  // Measure container width
  useEffect(() => {
    if (!containerRef.current) return
    const ro = new ResizeObserver(([entry]) => {
      setContainerWidth(entry.contentRect.width)
    })
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [])

  useEffect(() => { localStorage.setItem(`magic-roadmap-group:${preferenceOwner}`, groupMode) }, [groupMode, preferenceOwner])

  const tasks = useMemo(() => {
    const cutoff = roadmapNow - 30 * 86_400_000
    return allTasks.filter((task) => task.dueDate && !isNaN(new Date(task.dueDate).getTime()) && (!task.done || new Date(task.actualSubmit || task.dueDate).getTime() >= cutoff))
  }, [allTasks, roadmapNow])

  // Group by client + compute layout
  const { clients, markers, dateRange, dayWidth, totalWidth } = useMemo(() => {
    if (tasks.length === 0) return { clients: [], markers: [], dateRange: null, dayWidth: 0, totalWidth: 0 }

    // Find global date range from data
    const allDates = tasks.map((t) => new Date(t.dueDate))
    const dataMin = new Date(Math.min(...allDates))
    const dataMax = new Date(Math.max(...allDates))

    const zoom = ZOOM_LEVELS[zoomIdx]
    let minDate, maxDate

    if (zoom.days === 0) {
      // "All" — show entire data range with padding
      minDate = new Date(dataMin); minDate.setDate(minDate.getDate() - 7)
      maxDate = new Date(dataMax); maxDate.setDate(maxDate.getDate() + 7)
    } else {
      // Fixed window centered on today
      const today = new Date(); today.setHours(0, 0, 0, 0); today.setDate(today.getDate() + windowOffset)
      const pastDays = zoom.past ?? Math.floor(zoom.days / 6)
      minDate = new Date(today); minDate.setDate(minDate.getDate() - pastDays)
      maxDate = new Date(minDate); maxDate.setDate(maxDate.getDate() + zoom.days)
    }

    minDate.setHours(0, 0, 0, 0)
    maxDate.setHours(0, 0, 0, 0)

    const groups = {}
    tasks.filter((task) => {
      const due = new Date(task.dueDate)
      return due >= minDate && due <= maxDate
    }).forEach((task) => {
      const names = groupMode === "person" ? assignedNames(task) : [brandNameForTask(task)]
      ;(names.length ? names : ["Unassigned"]).forEach((name) => {
        if (!groups[name]) groups[name] = []
        groups[name].push(task)
      })
    })

    const totalDays = Math.max(1, Math.ceil((maxDate - minDate) / 86_400_000))
    const LABEL_W = 140
    const availableWidth = containerWidth - LABEL_W

    // Calculate dayWidth: for fixed zoom, fit the zoom.days into the available width
    // For "All", fit everything
    let dw
    if (zoom.days === 0) {
      dw = Math.max(availableWidth / totalDays, 2)
    } else {
      dw = Math.max(availableWidth / zoom.days, 2)
    }

    const tw = totalDays * dw

    // Build time markers (weeks if zoomed in, months if zoomed out)
    const mkrs = []
    const showWeeks = dw >= 4 // show week lines when zoomed in enough

    // Always show month markers
    const monthCursor = new Date(minDate)
    monthCursor.setDate(1)
    while (monthCursor <= maxDate) {
      const ms = new Date(monthCursor)
      const dayOff = Math.max(0, (ms - minDate) / 86_400_000)
      mkrs.push({
        type: "month",
        label: ms.toLocaleDateString("en-GB", { month: "short", year: "2-digit" }),
        left: dayOff * dw,
        date: ms,
      })
      monthCursor.setMonth(monthCursor.getMonth() + 1)
    }

    // Add week markers if zoomed in
    if (showWeeks) {
      const weekCursor = new Date(minDate)
      // Align to Monday
      const dow = weekCursor.getDay()
      weekCursor.setDate(weekCursor.getDate() + (dow === 1 ? 0 : dow === 0 ? 1 : 8 - dow))
      while (weekCursor <= maxDate) {
        const dayOff = (weekCursor - minDate) / 86_400_000
        mkrs.push({
          type: "week",
          label: weekCursor.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }),
          left: dayOff * dw,
          date: new Date(weekCursor),
        })
        weekCursor.setDate(weekCursor.getDate() + 7)
      }
    }

    // Build client rows
    const clientList = Object.entries(groups)
      .map(([name, clientTasks]) => {
        clientTasks.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))
        const earliest = new Date(clientTasks[0].dueDate)
        const startOffset = (earliest - minDate) / 86_400_000
        const done = clientTasks.filter((t) => t.done).length
        const total = clientTasks.length
        const maxDaysLate = Math.max(...clientTasks.filter((task) => !task.done).map((task) => Math.max(0, -daysFromToday(task.dueDate))), 0)

        return {
          name, tasks: clientTasks,
          startOffset,
          done, total, maxDaysLate,
          pct: total > 0 ? Math.round((done / total) * 100) : 0,
        }
      })
      .sort((a, b) => b.maxDaysLate - a.maxDaysLate || a.startOffset - b.startOffset || a.name.localeCompare(b.name, "th"))

    return {
      clients: clientList,
      markers: mkrs,
      dateRange: { min: minDate, max: maxDate },
      dayWidth: dw,
      totalWidth: tw,
    }
  }, [tasks, zoomIdx, windowOffset, containerWidth, brandNameForTask, assignedNames, groupMode])

  // Today marker position
  const todayOffset = useMemo(() => {
    if (!dateRange) return null
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const offset = (today - dateRange.min) / 86_400_000
    return offset * dayWidth
  }, [dateRange, dayWidth])

  // Scroll to today on mount or zoom change
  useEffect(() => {
    if (scrollRef.current && todayOffset !== null) {
      const scrollArea = scrollRef.current
      scrollArea.scrollLeft = Math.max(0, todayOffset - scrollArea.clientWidth * 0.35)
    }
  }, [todayOffset, clients.length, zoomIdx])

  // Drag to scroll
  const handleMouseDown = useCallback((e) => {
    if (!scrollRef.current) return
    setIsDragging(true)
    dragState.current = { startX: e.clientX, scrollLeft: scrollRef.current.scrollLeft }
  }, [])
  const handleMouseMove = useCallback((e) => {
    if (!isDragging || !scrollRef.current) return
    const dx = e.clientX - dragState.current.startX
    scrollRef.current.scrollLeft = dragState.current.scrollLeft - dx
  }, [isDragging])
  const handleMouseUp = useCallback(() => setIsDragging(false), [])

  useEffect(() => {
    if (isDragging) {
      window.addEventListener("mousemove", handleMouseMove)
      window.addEventListener("mouseup", handleMouseUp)
      return () => { window.removeEventListener("mousemove", handleMouseMove); window.removeEventListener("mouseup", handleMouseUp) }
    }
  }, [isDragging, handleMouseMove, handleMouseUp])

  if (tasks.length === 0) {
    return <div className="text-center py-8 text-sm text-gray-300"><Emoji name="search" /> ไม่มีข้อมูลสำหรับแสดง Timeline</div>
  }

  const ROW_HEIGHT = 32
  const LABEL_WIDTH = 140
  const monthMarkers = markers.filter((m) => m.type === "month")
  const weekMarkers = markers.filter((m) => m.type === "week")

  return (
    <div ref={containerRef}>
      {/* Zoom controls */}
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-[9px] font-bold uppercase tracking-wider text-gray-400 mr-1">ช่วงเวลา</span>
        {ZOOM_LEVELS.map((z, i) => (
          <button
            key={z.label}
            onClick={() => setZoomIdx(i)}
            className={`rounded-md px-2.5 py-1 text-[10px] font-bold transition ${
              zoomIdx === i
                ? "bg-[var(--ui-brand)] text-white"
                : "bg-gray-100 text-gray-400 hover:bg-purple-50 hover:text-purple-500"
            }`}
          >
            {z.label}
          </button>
        ))}
        <button type="button" onClick={() => setWindowOffset((value) => value - (ZOOM_LEVELS[zoomIdx].days || 30))} className="rounded-md border border-gray-200 px-2 py-1 text-[10px] font-bold text-gray-500" aria-label="Previous period">←</button>
        <button type="button" onClick={() => setWindowOffset(0)} className="rounded-md border border-purple-200 px-2 py-1 text-[10px] font-bold text-purple-600">Today</button>
        <button type="button" onClick={() => setWindowOffset((value) => value + (ZOOM_LEVELS[zoomIdx].days || 30))} className="rounded-md border border-gray-200 px-2 py-1 text-[10px] font-bold text-gray-500" aria-label="Next period">→</button>
        <div className="flex-1" />
        <div className="flex rounded-lg bg-gray-100 p-0.5">{[["brand", "Brand"], ["person", "Person"]].map(([value, label]) => <button type="button" key={value} onClick={() => setGroupMode(value)} className={`rounded-md px-2 py-1 text-[9px] font-bold ${groupMode === value ? "bg-[var(--ui-brand-soft)] text-[var(--ui-brand)]" : "text-gray-400"}`}>{label}</button>)}</div>
        <span className="text-[9px] text-gray-400">← เลื่อน / ลากเพื่อดูช่วงอื่น →</span>
      </div>

      <div className="flex rounded-xl overflow-hidden border border-purple-100 bg-white">
        {/* Fixed left labels */}
        <div className="shrink-0 bg-gray-50/80 border-r border-gray-100 z-10" style={{ width: LABEL_WIDTH }}>
          <div className="h-8 border-b border-gray-100 px-2 flex items-center">
            <span className="text-[9px] font-bold uppercase tracking-wider text-gray-400">{groupMode === "person" ? "Person" : "Brand"}</span>
          </div>
          {weekMarkers.length > 0 && (
            <div className="h-5 border-b border-gray-50" />
          )}
          {clients.map((c) => {
            return (
              <div
                key={c.name}
                className="flex items-center gap-1.5 px-2 border-b border-gray-50 hover:bg-purple-50/50 transition"
                style={{ height: ROW_HEIGHT }}
              >
                <span className="h-2.5 w-2.5 rounded-sm shrink-0 bg-slate-300" />
                <span className="text-[10px] font-medium text-gray-700 truncate flex-1" title={c.name}>{c.name}</span>
                <span className="text-[8px] text-gray-400 tabular-nums shrink-0">{c.pct}%</span>
              </div>
            )
          })}
        </div>

        {/* Scrollable timeline area */}
        <div
          ref={scrollRef}
          className={`flex-1 overflow-x-auto overflow-y-hidden ${isDragging ? "cursor-grabbing" : "cursor-grab"}`}
          onMouseDown={handleMouseDown}
          tabIndex={0}
          aria-label="Deadline roadmap. Use left and right arrow keys to move through time."
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
              event.preventDefault()
              event.currentTarget.scrollBy({ left: event.key === "ArrowLeft" ? -240 : 240, behavior: "smooth" })
            }
          }}
          style={{ scrollBehavior: isDragging ? "auto" : "smooth" }}
        >
          <div className="relative select-none" style={{ width: totalWidth, minWidth: "100%" }}>
            {/* Month headers */}
            <div className="relative h-8 border-b border-gray-100 bg-gray-50/50">
              {monthMarkers.map((m) => (
                <div
                  key={`m-${m.date.getTime()}`}
                  className="absolute top-0 h-full flex items-end pb-0.5 border-l border-gray-200"
                  style={{ left: m.left }}
                >
                  <span className="px-2 text-[9px] font-bold uppercase tracking-wider text-gray-400">{m.label}</span>
                </div>
              ))}
            </div>

            {/* Week sub-headers (if zoomed in) */}
            {weekMarkers.length > 0 && (
              <div className="relative h-5 border-b border-gray-50 bg-gray-50/30">
                {weekMarkers.map((w) => (
                  <div
                    key={`w-${w.date.getTime()}`}
                    className="absolute top-0 h-full flex items-center border-l border-gray-100/60"
                    style={{ left: w.left }}
                  >
                    <span className="px-1 text-[8px] text-gray-400">{w.label}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Task rows */}
            {clients.map((c) => {
              return (
                <div key={c.name} className="relative border-b border-gray-50" style={{ height: ROW_HEIGHT }}>
                  {/* Grid lines */}
                  {monthMarkers.map((m) => (
                    <div key={`gl-${m.date.getTime()}`} className="absolute top-0 h-full border-l border-gray-100/40" style={{ left: m.left }} />
                  ))}
                  {weekMarkers.map((w) => (
                    <div key={`wl-${w.date.getTime()}`} className="absolute top-0 h-full border-l border-gray-50" style={{ left: w.left }} />
                  ))}

                  {/* Due-date milestones. No start date exists in the source, so no duration bar is shown. */}
                  {c.tasks.map((t, ti) => {
                    const taskOffset = ((new Date(t.dueDate) - dateRange.min) / 86_400_000) * dayWidth
                    const dotSize = dayWidth >= 4 ? 10 : 8
                    return (
                      <button
                        type="button"
                        key={taskKey(t) || ti}
                        onClick={(event) => { event.stopPropagation(); onOpenTask?.(t) }}
                        className="absolute top-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-1"
                        style={{
                          left: taskOffset - dotSize / 2,
                          width: dotSize, height: dotSize,
                          backgroundColor: milestoneColor(t),
                        }}
                        title={`${t.topic} — ${t.done ? "Done" : "Pending"} (${new Date(t.dueDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })})`}
                      />
                    )
                  })}
                </div>
              )
            })}

            {/* Today line */}
            {todayOffset !== null && todayOffset > 0 && (
              <div
                className="absolute top-0 w-px bg-red-400 z-20 pointer-events-none"
                style={{ left: todayOffset, height: "100%" }}
              >
                <div className="absolute top-0 -translate-x-1/2 rounded-b bg-red-500 px-1.5 py-0.5 text-[7px] font-bold text-white whitespace-nowrap">
                  TODAY
                </div>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}

function activityDescription(event, task) {
  const before = event.before_value || {}
  const after = event.after_value || {}
  if (event.resource === "task_workflow") {
    const changes = []
    if (before.status !== after.status) changes.push(`workflow → ${(after.status || "not_started").replaceAll("_", " ")}`)
    if (before.note !== after.note) changes.push("note")
    if (before.priority !== after.priority) changes.push("priority")
    return `updated ${changes.join(", ") || "task"}${task ? ` · ${task.topic}` : ""}`
  }
  if (event.resource === "assignments") return `updated assignment · ${after.brand_key || before.brand_key || event.record_key}`
  if (event.resource === "brands") return `updated brand mapping · ${after.brand_name || before.brand_name || event.record_key}`
  if (event.resource === "tasks_current") return `${after.done ? "marked Done" : "reopened task"}${task ? ` · ${task.topic}` : ""}`
  return `${event.event_type} ${event.resource}`
}

function RecentActivity({ events, tasks }) {
  const taskMap = new Map(tasks.map((task) => [taskKey(task), task]))
  return (
    <div className="ui-card rounded-2xl p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold uppercase tracking-widest text-[var(--ui-brand)]"><Emoji name="activity" /> Recent Activity</h3>
        <span className="text-[10px] text-gray-400">who changed what and when</span>
      </div>
      {events.length ? <div className="mt-3 divide-y divide-gray-50">
        {events.slice(0, 10).map((event) => (
          <div key={event.id} className="flex items-start gap-3 py-2.5 text-xs">
            <div className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-purple-300" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-gray-700">{activityDescription(event, taskMap.get(event.record_key))}</div>
              <div className="mt-0.5 text-[10px] text-gray-400">{event.actor_email || "System"}</div>
            </div>
            <time className="shrink-0 text-[10px] text-gray-400">{new Date(event.created_at).toLocaleString("th-TH")}</time>
          </div>
        ))}
      </div> : <p className="mt-4 text-xs text-gray-400"><Emoji name="inbox" /> Activity appears after the first saved change.</p>}
    </div>
  )
}

// ─── Main Dashboard ─────────────────────────────────────────────────────────────

export default function DashboardView({
  allTasks = [],
  assignments = {},
  onUpdateAssignment,
  teamMembers = [],
  brands = {},
  onUpdateBrand,
  onRenameBrand,
  brandNameForTask = (task) => task.clientName,
  assignmentKeyForTask = (task) => normalizeBrandKey(task.clientName),
  workflow = {},
  dailyMetrics = [],
  taskEvents = [],
  syncStatus = null,
  lastSynced = null,
  canAdmin = false,
  canManageAssignments = false,
  preferenceOwner = "local",
  onOpenTask,
}) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])
  const [showBrandManager, setShowBrandManager] = useState(false)
  const [healthShowAll, setHealthShowAll] = useState(false)
  const [upcomingLimit, setUpcomingLimit] = useState(50)
  const [drilldown, setDrilldown] = useState(null)
  const filterStorageKey = `magic-dashboard-filters:${preferenceOwner}`
  const [filters, setFilters] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(filterStorageKey)) || {}
      const statuses = new Set(["all", "overdue", "upcoming", "done", "unscheduled", "not_started", "in_progress", "waiting_client", "blocked"])
      return { status: statuses.has(saved.status) ? saved.status : "all", month: typeof saved.month === "string" ? saved.month : "all", member: typeof saved.member === "string" ? saved.member : "all" }
    }
    catch { return { status: "all", month: "all", member: "all" } }
  })
  const HEALTH_PREVIEW_COUNT = 5
  useEffect(() => { localStorage.setItem(filterStorageKey, JSON.stringify(filters)) }, [filterStorageKey, filters])

  const tabRecords = useMemo(() => {
    const records = new Map()
    allTasks.forEach((task) => records.set(tabKey(task), { key: tabKey(task), title: task.clientName }))
    return [...records.values()]
  }, [allTasks])

  const confirmed = useMemo(() => {
    const grouped = {}
    tabRecords.forEach((tab) => {
      const brand = brands[tab.key]
      if (!brand) return
      if (!grouped[brand]) grouped[brand] = { tabs: [] }
      grouped[brand].tabs.push(tab)
    })
    return grouped
  }, [brands, tabRecords])
  const newTabs = useMemo(() => tabRecords.filter((tab) => !brands[tab.key]), [brands, tabRecords])

  const handleConfirmBrand = (name, tabs) => Promise.all(tabs.map((tab) => onUpdateBrand(tab.key, name)))
  const handleRenameBrand = async (oldName, newName) => {
    const tabs = confirmed[oldName]?.tabs || []
    if (onRenameBrand) await onRenameBrand(oldName, newName, tabs)
  }
  const handleRemoveBrand = (name) => (confirmed[name]?.tabs || []).forEach((tab) => onUpdateBrand(tab.key, null))
  const handleInlineRename = async (oldName, tabs, newName) => {
    if (onRenameBrand) await onRenameBrand(oldName, newName, tabs)
  }

  const assignedNames = useCallback((task) => {
    const assignment = assignments[assignmentKeyForTask(task)] || assignments[task.clientName] || {}
    return taskOwnerNames(task, teamMembers, assignment)
  }, [assignments, assignmentKeyForTask, teamMembers])

  const tasksWithWorkflow = useMemo(() => allTasks.map((task) => ({
    ...task,
    workflowStatus: workflow[taskKey(task)] || "not_started",
  })), [allTasks, workflow])
  const months = useMemo(() => sortMonthLabels(new Set(tasksWithWorkflow.map((task) => task.month).filter(Boolean))), [tasksWithWorkflow])
  const effectiveFilters = useMemo(() => ({
    ...filters,
    month: filters.month === "all" || months.includes(filters.month) ? filters.month : "all",
    member: filters.member === "all" || teamMembers.some((member) => member.name === filters.member) ? filters.member : "all",
  }), [filters, months, teamMembers])
  const filteredTasks = useMemo(
    () => filterDashboardTasks(tasksWithWorkflow, effectiveFilters, assignedNames),
    [tasksWithWorkflow, effectiveFilters, assignedNames],
  )
  const overdue = useMemo(() => filteredTasks.filter((task) => !task.done && daysFromToday(task.dueDate) < 0), [filteredTasks])
  const upcoming = useMemo(() => filteredTasks.filter((task) => !task.done && daysFromToday(task.dueDate) >= 0), [filteredTasks])
  const unscheduled = useMemo(() => filteredTasks.filter((task) => !task.done && daysFromToday(task.dueDate) === null), [filteredTasks])
  const blocked = useMemo(() => filteredTasks.filter((task) => !task.done && task.workflowStatus === "blocked"), [filteredTasks])
  const waitingClient = useMemo(() => filteredTasks.filter((task) => !task.done && task.workflowStatus === "waiting_client"), [filteredTasks])
  const aging = useMemo(() => {
    const buckets = { "1–3": 0, "4–7": 0, "8–14": 0, "15+": 0 }
    overdue.forEach((task) => {
      const days = Math.abs(daysFromToday(task.dueDate))
      if (days <= 3) buckets["1–3"]++
      else if (days <= 7) buckets["4–7"]++
      else if (days <= 14) buckets["8–14"]++
      else buckets["15+"]++
    })
    return buckets
  }, [overdue])
  const monthlyTrend = useMemo(() => {
    const dimension = effectiveFilters.member !== "all" && effectiveFilters.month !== "all"
      ? ["month_person", `${effectiveFilters.month}:${effectiveFilters.member}`]
      : effectiveFilters.member !== "all"
        ? ["person", effectiveFilters.member]
        : effectiveFilters.month !== "all"
          ? ["month", effectiveFilters.month]
          : ["overall", "all"]
    const monthly = new Map()
    dailyMetrics.filter((row) => row.dimension === dimension[0] && row.dimension_key === dimension[1]).forEach((row) => {
      const month = row.snapshot_date.slice(0, 7)
      const current = monthly.get(month) || { latest: row, created: 0, resolved: 0 }
      if (current.latest.snapshot_date < row.snapshot_date) current.latest = row
      current.created += row.metrics?.overdueCreated || 0
      current.resolved += row.metrics?.overdueResolved || 0
      monthly.set(month, current)
    })
    return [...monthly.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-12).map(([month, value]) => [month, {
      ...value.latest,
      metrics: { ...value.latest.metrics, overdueCreated: value.created, overdueResolved: value.resolved },
    }])
  }, [dailyMetrics, effectiveFilters.member, effectiveFilters.month])
  const openDrilldown = (label, tasks) => setDrilldown({ label, tasks })
  const agingTasks = (label) => overdue.filter((task) => {
    const days = Math.abs(daysFromToday(task.dueDate))
    if (label === "1–3") return days <= 3
    if (label === "4–7") return days >= 4 && days <= 7
    if (label === "8–14") return days >= 8 && days <= 14
    return days >= 15
  })

  const brandData = useMemo(() => {
    const grouped = {}
    filteredTasks.forEach((task) => {
      const name = brandNameForTask(task)
      if (!grouped[name]) grouped[name] = { total: 0, done: 0, tasks: [], rawTabNames: new Map() }
      grouped[name].total++
      if (task.done) grouped[name].done++
      grouped[name].tasks.push(task)
      grouped[name].rawTabNames.set(tabKey(task), { key: tabKey(task), title: task.clientName })
    })
    return { brands: grouped, confirmed, newTabs }
  }, [filteredTasks, brandNameForTask, confirmed, newTabs])

  // ── Computed metrics (use filtered allTasks for accurate per-person stats) ──
  const metrics = useMemo(() => {
    const totalAll = filteredTasks.length
    const totalDone = filteredTasks.filter((t) => t.done).length
    const completionPct = totalAll > 0 ? (totalDone / totalAll) * 100 : 0
    const activeClientNames = Object.entries(brandData.brands)
      .filter(([, c]) => c.done < c.total)
      .map(([n]) => n)
      .sort((a, b) => a.localeCompare(b, "th"))
    const completedClientNames = Object.entries(brandData.brands)
      .filter(([, c]) => c.done >= c.total && c.total > 0)
      .map(([n]) => n)
      .sort((a, b) => a.localeCompare(b, "th"))
    const dueThisWeek = upcoming.filter((t) => {
      const d = daysFromToday(t.dueDate)
      return d !== null && d >= 0 && d <= 7
    })

    return { totalAll, totalDone, completionPct, activeClientNames, completedClientNames, dueThisWeek }
  }, [filteredTasks, brandData, upcoming])

  // ── Client health data sorted by risk (raw tab names, not brand-resolved) ──
  const clientHealth = useMemo(() => {
    return Object.entries(brandData.brands)
      .map(([name, data]) => {
        const stats = { total: data.total, done: data.done }
        const pct = stats.total > 0 ? (stats.done / stats.total) * 100 : 0
        const clientOverdue = data.tasks.filter((task) => !task.done && daysFromToday(task.dueDate) < 0)
        const clientUpcoming = data.tasks.filter((task) => !task.done && daysFromToday(task.dueDate) >= 0)
        const blockedCount = data.tasks.filter((task) => !task.done && task.workflowStatus === "blocked").length
        const nextTask = clientUpcoming[0] || null
        const maxDaysLate = Math.max(...clientOverdue.map((task) => Math.abs(daysFromToday(task.dueDate))), 0)
        const firstTask = data.tasks[0]
        return {
          name,
          rawTabNames: [...data.rawTabNames.values()],
          assignmentKey: assignmentKeyForTask(firstTask),
          legacyKey: firstTask.clientName,
          stats,
          overdueCount: clientOverdue.length, blockedCount,
          nextTask, maxDaysLate, pct,
        }
      })
      .filter((c) => c.pct < 100)
      .sort((a, b) => b.blockedCount - a.blockedCount || b.maxDaysLate - a.maxDaysLate || b.overdueCount - a.overdueCount || a.name.localeCompare(b.name, "th"))
  }, [brandData, assignmentKeyForTask])

  // ── Team workload ──
  const teamWorkload = useMemo(() => {
    const memberStats = teamMembers.map((member) => {
      const myTasks = filteredTasks.filter((task) => assignedNames(task).includes(member.name))

      const done = myTasks.filter((t) => t.done).length
      const overdueCount = myTasks.filter((t) => !t.done && daysFromToday(t.dueDate) < 0).length
      const pending = myTasks.length - done - overdueCount
      const clients = [...new Set(myTasks.map(brandNameForTask))]

      return { member, stats: { done, pending, overdue: overdueCount, clients } }
    })

    const maxOverdue = Math.max(...memberStats.map((m) => m.stats.overdue), 0)
    return { memberStats, maxOverdue }
  }, [filteredTasks, assignedNames, teamMembers, brandNameForTask])

  // ── All future work grouped by day ──
  const upcomingByDay = useMemo(() => {
    const grouped = {}
    upcoming.slice(0, upcomingLimit).forEach((t) => {
      if (!grouped[t.dueDate]) grouped[t.dueDate] = []
      grouped[t.dueDate].push(t)
    })
    return Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b))
  }, [upcoming, upcomingLimit])

  return (
    <div className="space-y-6">

      <div className="ui-card flex flex-wrap items-center gap-3 rounded-2xl p-4">
        <div className="mr-1">
          <div className="text-[10px] font-bold uppercase tracking-widest text-purple-500">Dashboard Filters</div>
          <div className="text-[10px] text-gray-400">{filteredTasks.length} of {allTasks.length} tasks</div>
        </div>
        <label className="text-[10px] font-semibold text-gray-500">
          Status
          <select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))} className="ui-field ml-1.5 min-h-0 px-2.5 py-1.5 text-xs text-gray-700">
            <option value="all">All</option>
            <option value="overdue">{emojiText("overdue", "Overdue")}</option>
            <option value="upcoming">{emojiText("upcoming", "Upcoming")}</option>
            <option value="done">{emojiText("done", "Done")}</option>
            <option value="not_started">{emojiText("notStarted", "Not started")}</option>
            <option value="in_progress">{emojiText("inProgress", "In progress")}</option>
            <option value="waiting_client">{emojiText("waitingClient", "Waiting client")}</option>
            <option value="blocked">{emojiText("blocked", "Blocked")}</option>
            <option value="unscheduled">{emojiText("unscheduled", "Unscheduled")}</option>
          </select>
        </label>
        <label className="text-[10px] font-semibold text-gray-500">
          Month
          <select value={effectiveFilters.month} onChange={(event) => setFilters((current) => ({ ...current, month: event.target.value }))} className="ui-field ml-1.5 min-h-0 px-2.5 py-1.5 text-xs text-gray-700">
            <option value="all">All</option>
            {months.map((month) => <option key={month} value={month}>{month}</option>)}
          </select>
        </label>
        <label className="text-[10px] font-semibold text-gray-500">
          Person
          <select value={effectiveFilters.member} onChange={(event) => setFilters((current) => ({ ...current, member: event.target.value }))} className="ui-field ml-1.5 min-h-0 px-2.5 py-1.5 text-xs text-gray-700">
            <option value="all">All</option>
            {teamMembers.map((member) => <option key={member.name} value={member.name}>{member.name}</option>)}
          </select>
        </label>
        <button onClick={() => setFilters({ status: "all", month: "all", member: "all" })} disabled={Object.values(filters).every((value) => value === "all")} className="ui-button ui-button-secondary ml-auto min-h-0 px-3 py-1.5 text-[10px] font-semibold disabled:opacity-40">
          Reset
        </button>
      </div>

      {/* ── ① Summary Stat Cards (top of dashboard) ─────────────────── */}
      {lastSynced && <div className={`rounded-xl border px-4 py-3 text-xs ${now - lastSynced.getTime() > 24 * 60 * 60 * 1000 ? "border-red-200 bg-red-50 text-red-700" : "border-green-100 bg-green-50 text-green-700"}`}>
        Data freshness: {lastSynced.toLocaleString("th-TH")}
      </div>}

      <div className={`rounded-2xl border p-4 text-xs ${syncStatus?.status === "failed" ? "border-red-200 bg-red-50" : syncStatus?.status === "running" ? "border-amber-200 bg-amber-50" : "border-purple-100 bg-white"}`}>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <strong className="uppercase tracking-wider text-purple-700"><Emoji name="dataHealth" /> Data Health</strong>
          <span>Status: <strong>{syncStatus?.status || "not synced"}</strong></span>
          <span>Source tasks: <strong>{syncStatus?.task_count ?? allTasks.length}</strong></span>
          <button type="button" onClick={() => openDrilldown("Unscheduled", unscheduled)} className="min-h-11 underline decoration-purple-200 underline-offset-2 sm:min-h-0"><Emoji name="unscheduled" /> Unscheduled: <strong>{unscheduled.length}</strong></button>
          <span>Invalid rows: <strong>{syncStatus?.invalid_row_count || 0}</strong></span>
          <span>Skipped tabs: <strong>{syncStatus?.issues?.filter((issue) => issue.type === "skipped_tab").length || 0}</strong></span>
        </div>
        {syncStatus?.error && <p className="mt-2 text-red-600">{syncStatus.error}</p>}
        {syncStatus?.issues?.length > 0 && <div className="mt-2 max-h-24 overflow-y-auto text-[10px] text-amber-700">{syncStatus.issues.slice(0, 5).map((issue, index) => <div key={`${issue.spreadsheetId}:${issue.sheetGid}:${issue.rowIndex}:${index}`}>{issue.clientName} row {issue.rowIndex}: {issue.message}</div>)}</div>}
      </div>

      {drilldown && <div className="ui-card rounded-2xl border-purple-200 p-5">
        <div className="flex items-center justify-between"><h3 className="text-sm font-bold text-purple-800">{drilldown.label} · {drilldown.tasks.length} tasks</h3><button onClick={() => setDrilldown(null)} className="text-xs text-gray-400">Close</button></div>
        <div className="mt-3 max-h-64 divide-y divide-gray-50 overflow-y-auto">{drilldown.tasks.map((task) => <button type="button" onClick={() => onOpenTask?.(task)} key={taskKey(task)} className="flex w-full gap-3 py-2 text-left text-xs hover:bg-purple-50 focus:outline-none focus:ring-2 focus:ring-purple-300"><span className="w-28 truncate font-semibold text-purple-600">{brandNameForTask(task)}</span><span className="flex-1 text-gray-600">{task.topic}</span><span className="text-gray-400">{fmtDate(task.dueDate)}</span></button>)}</div>
      </div>}

      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <StatCard
          label="Overdue"
          value={overdue.length}
          sub={overdue.length > 0 ? `${overdue.length} tasks past deadline` : "All clear!"}
          onClick={() => openDrilldown("Overdue", overdue)}
          color={{
            bg: overdue.length > 0 ? "bg-red-50" : "bg-green-50",
            border: overdue.length > 0 ? "border-red-200" : "border-green-200",
            iconBg: overdue.length > 0 ? "bg-red-100" : "bg-green-100",
            text: overdue.length > 0 ? "text-red-600" : "text-green-600",
          }}
          icon={
            <svg className={`h-5 w-5 ${overdue.length > 0 ? "text-red-500" : "text-green-500"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          }
        />

        <StatCard
          label="Blocked"
          value={blocked.length}
          sub="Requires intervention"
          onClick={() => openDrilldown("Blocked", blocked)}
          color={{ bg: "bg-rose-50", border: "border-rose-200", iconBg: "bg-rose-100", text: "text-rose-700" }}
          icon={<span className="text-lg"><Emoji name="blocked" /></span>}
        />

        <StatCard
          label="Waiting Client"
          value={waitingClient.length}
          sub="Pending external response"
          onClick={() => openDrilldown("Waiting Client", waitingClient)}
          color={{ bg: "bg-amber-50", border: "border-amber-200", iconBg: "bg-amber-100", text: "text-amber-700" }}
          icon={<span className="text-lg"><Emoji name="waitingClient" /></span>}
        />

        <StatCard
          label="Due This Week"
          value={metrics.dueThisWeek.length}
          sub="Next 7 days"
          onClick={() => openDrilldown("Due This Week", metrics.dueThisWeek)}
          color={{
            bg: "bg-amber-50", border: "border-amber-200",
            iconBg: "bg-amber-100", text: "text-amber-600",
          }}
          icon={
            <svg className="h-5 w-5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          }
        />

        <button type="button" onClick={() => openDrilldown("Completed", filteredTasks.filter((task) => task.done))} className="ui-card ui-interactive rounded-2xl border-green-200 bg-green-50 p-5 text-left">
          <div className="flex items-center gap-3">
            <CompletionRing pct={metrics.completionPct} />
            <div>
              <div className="text-2xl font-black tabular-nums text-purple-700">{Math.round(metrics.completionPct)}%</div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Completion</div>
            </div>
          </div>
          <div className="mt-2 text-[11px] text-gray-500">{metrics.totalDone} of {metrics.totalAll} tasks done</div>
        </button>

        <div className="ui-card rounded-2xl p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-100">
              <svg className="h-5 w-5 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
            </div>
            <div>
              <div className="text-2xl font-black tabular-nums text-purple-700">{metrics.activeClientNames.length}</div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Active Clients</div>
            </div>
          </div>
          {/* Client name badges: confirmed only, sorted A-Z with numbers */}
          <div className="mt-2.5 flex flex-wrap gap-1">
            {metrics.activeClientNames.map((n, i) => (
              <span key={n} className="rounded-full bg-purple-100 px-2 py-0.5 text-[9px] font-medium text-purple-600">
                <span className="text-purple-400">{i + 1}.</span> {n}
              </span>
            ))}
          </div>
          {metrics.completedClientNames.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {metrics.completedClientNames.map((n, i) => (
                <span key={n} className="rounded-full bg-green-50 px-2 py-0.5 text-[9px] font-medium text-green-500 line-through">
                  <span className="text-green-300">{metrics.activeClientNames.length + i + 1}.</span> {n}
                </span>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => openDrilldown("Active Clients", filteredTasks.filter((task) => metrics.activeClientNames.includes(brandNameForTask(task))))}
            className="mt-2 mr-1 min-h-11 rounded-lg border border-purple-200 bg-white px-2 py-1 text-[10px] font-semibold text-purple-500 transition-colors hover:bg-purple-50 sm:min-h-0"
          >
            ดูงานทั้งหมด
          </button>
          {/* จัดการ button */}
          {canAdmin && <button
            onClick={() => setShowBrandManager(true)}
            className="mt-2 flex items-center gap-1 rounded-lg border border-purple-200 bg-white px-2 py-1 text-[10px] font-semibold text-purple-500 transition hover:bg-purple-50 active:scale-95"
          >
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            จัดการรายชื่อ
          </button>}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="ui-card rounded-2xl p-5">
          <h3 className="text-xs font-bold uppercase tracking-widest text-[var(--ui-brand)]"><Emoji name="aging" /> Overdue Aging</h3>
          <div className="mt-4 grid grid-cols-4 gap-2">
            {Object.entries(aging).map(([label, count]) => <button key={label} onClick={() => openDrilldown(`Overdue ${label} days`, agingTasks(label))} className="rounded-xl bg-red-50 p-3 text-center transition hover:bg-red-100"><div className="text-xl font-black text-red-600">{count}</div><div className="text-[10px] text-red-400">{label} days</div></button>)}
          </div>
        </div>
        <div className="ui-card rounded-2xl p-5">
          <h3 className="text-xs font-bold uppercase tracking-widest text-[var(--ui-brand)]"><Emoji name="trend" /> 12-Month Trend</h3>
          {monthlyTrend.length ? <div className="mt-3 overflow-x-auto"><table className="w-full text-[10px]"><thead className="text-left text-gray-400"><tr><th>Month</th><th>Completion</th><th>Created</th><th>Resolved</th><th>Blocked</th><th>{filters.status === "all" ? "Workload" : filters.status.replaceAll("_", " ")}</th></tr></thead><tbody>{monthlyTrend.map(([month, row]) => { const metrics = row.metrics || {}; const completion = metrics.total ? Math.round((metrics.done / metrics.total) * 100) : 0; return <tr key={month} className="border-t border-gray-50"><td className="py-1.5 font-semibold text-gray-600">{month}</td><td>{completion}%</td><td>{metrics.overdueCreated || 0}</td><td>{metrics.overdueResolved || 0}</td><td>{metrics.blocked || 0}</td><td>{trendCount(metrics, filters.status)}</td></tr> })}</tbody></table><p className="mt-2 text-[9px] text-gray-300">Historical snapshot metrics; task-level history is not available.</p></div> : <p className="mt-4 text-xs text-gray-400">Trend starts after the first successful sync.</p>}
        </div>
      </div>

      <RecentActivity events={taskEvents} tasks={allTasks} />

      {/* The source has due dates but no start dates: render a deadline roadmap, not a Gantt duration. */}
      <div className="ui-card rounded-2xl">
        <div className="px-5 py-4 border-b border-purple-50">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-purple-400" />
            <h3 className="text-xs font-bold uppercase tracking-widest text-[var(--ui-brand)]"><Emoji name="roadmap" /> Deadline Roadmap</h3>
          </div>
        </div>
        <div className="p-3 relative">
          <DeadlineRoadmap
            allTasks={filteredTasks}
            brandNameForTask={brandNameForTask}
            onOpenTask={onOpenTask}
            assignedNames={assignedNames}
            preferenceOwner={preferenceOwner}
          />
        </div>
      </div>

      {/* ── ② Client Health + ③ Overdue ──────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

        {/* Client Health Table — show worst first, expandable */}
        <div className="ui-card xl:col-span-2 rounded-2xl">
          <div className="px-5 py-4 border-b border-purple-50">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-purple-400" />
              <h3 className="text-xs font-bold uppercase tracking-widest text-[var(--ui-brand)]"><Emoji name="clientHealth" /> Client Health</h3>
              <span className="text-[10px] text-gray-400 ml-1">{clientHealth.length} active</span>
            </div>
          </div>
          <div className="p-3 space-y-1.5">
            {/* Header */}
            <div className="hidden items-center gap-3 px-4 py-1 text-[9px] font-bold uppercase tracking-widest text-gray-400 md:flex">
              <div className="w-56 shrink-0">Client</div>
              <div className="flex-1">Progress</div>
              <div className="w-16 text-center">Overdue</div>
              <div className="w-24 text-center">Next Due</div>
              <div className="w-28 text-right">Team</div>
            </div>
            {clientHealth.length > 0 ? (
              <>
                {(healthShowAll ? clientHealth : clientHealth.slice(0, HEALTH_PREVIEW_COUNT)).map((c) => (
                  <ClientHealthRow
                    key={c.name}
                    name={c.name}
                    rawTabNames={c.rawTabNames}
                    assignmentKey={c.assignmentKey}
                    legacyKey={c.legacyKey}
                    stats={c.stats}
                    overdueCount={c.overdueCount}
                    nextTask={c.nextTask}
                    assignments={assignments}
                    teamMembers={teamMembers}
                    onUpdateAssignment={onUpdateAssignment}
                    canManageAssignments={canManageAssignments}
                    onRename={canAdmin ? handleInlineRename : null}
                    onOpen={() => openDrilldown(c.name, filteredTasks.filter((task) => brandNameForTask(task) === c.name))}
                  />
                ))}
                {clientHealth.length > HEALTH_PREVIEW_COUNT && (
                  <button
                    onClick={() => setHealthShowAll((v) => !v)}
                    className="w-full rounded-xl border border-purple-100 py-2 text-[11px] font-semibold text-purple-400 transition hover:bg-purple-50 active:scale-[0.99]"
                  >
                    {healthShowAll
                      ? "ย่อ"
                      : `แสดงทั้งหมด (+${clientHealth.length - HEALTH_PREVIEW_COUNT} clients)`
                    }
                  </button>
                )}
              </>
            ) : (
              <div className="text-center py-8 text-sm text-gray-300"><Emoji name="search" /> ไม่มี active clients</div>
            )}
          </div>
        </div>

        {/* Overdue Urgent List */}
        <div className="ui-card rounded-2xl border-red-100">
          <div className="px-5 py-4 border-b border-red-50">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-red-400" />
              <h3 className="text-xs font-bold uppercase tracking-widest text-red-400">Overdue</h3>
              {overdue.length > 0 && (
                <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-600">{overdue.length}</span>
              )}
            </div>
          </div>
          <div className="p-2">
            {overdue.length > 0 ? (
              <div className="space-y-0.5">
                {overdue.slice(0, 10).map((t) => (
                  <OverdueItem key={taskKey(t)} task={t} brandName={brandNameForTask(t)} />
                ))}
                {overdue.length > 10 && (
                  <div className="text-center py-2 text-[10px] text-gray-400">
                    +{overdue.length - 10} more overdue tasks
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-8">
                <div className="mt-1 text-sm text-gray-400"><Emoji name="celebration" /> No overdue tasks</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── ④ Team Workload ──────────────────────────────────────────── */}
      <div className="ui-card rounded-2xl">
        <div className="px-5 py-4 border-b border-purple-50">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-purple-400" />
            <h3 className="text-xs font-bold uppercase tracking-widest text-[var(--ui-brand)]"><Emoji name="team" /> Team Workload</h3>
            <span className="text-[10px] text-gray-400 ml-1">{teamMembers.length} members</span>
          </div>
        </div>
        <div className="p-4 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
          {teamWorkload.memberStats.map(({ member, stats }) => (
            <MemberCard
              key={member.name}
              member={member}
              stats={stats}
              maxOverdue={teamWorkload.maxOverdue}
              onOpen={() => openDrilldown(`งานของ ${member.name}`, filteredTasks.filter((task) => assignedNames(task).includes(member.name)))}
            />
          ))}
        </div>
        {/* Legend */}
        <div className="px-5 pb-4 flex items-center gap-4 text-[10px] text-gray-400">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-green-400" /> Done</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-purple-300" /> Pending</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-400" /> Overdue</span>
        </div>
      </div>

      {/* ── ⑤ Upcoming ───────────────────────────────────────────────── */}
      <div className="ui-card rounded-2xl">
        <div className="px-5 py-4 border-b border-purple-50">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-amber-400" />
            <h3 className="text-xs font-bold uppercase tracking-widest text-[var(--ui-brand)]"><Emoji name="upcoming" /> Upcoming</h3>
            <span className="text-[10px] text-gray-400 ml-1">{upcoming.length} tasks</span>
          </div>
        </div>
        <div className="p-4 space-y-4">
          {upcomingByDay.length > 0 ? (
            upcomingByDay.map(([dateKey, tasks]) => (
              <div key={dateKey}>
                <UpcomingDayGroup dateKey={dateKey} tasks={tasks} brandNameForTask={brandNameForTask} />
              </div>
            ))
          ) : (
            <div className="text-center py-6 text-sm text-gray-300"><Emoji name="celebration" /> ไม่มีงาน upcoming</div>
          )}
          {upcoming.length > upcomingLimit && <button type="button" onClick={() => setUpcomingLimit((value) => value + 50)} className="ui-button ui-button-secondary mx-auto block text-xs">Show 50 more</button>}
        </div>
      </div>

      {/* ── Brand Manager Modal ─────────────────────────────────────── */}
      {canAdmin && showBrandManager && (
        <BrandManager
          confirmed={brandData.confirmed}
          newTabs={brandData.newTabs}
          onConfirm={handleConfirmBrand}
          onRename={handleRenameBrand}
          onRemove={handleRemoveBrand}
          onClose={() => setShowBrandManager(false)}
        />
      )}
    </div>
  )
}
