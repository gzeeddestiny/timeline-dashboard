import { useMemo, useState, useRef, useEffect, useCallback } from "react"
import { ROLE_CONFIG, ROLES, matchMembers } from "../lib/teamConfig"
import { extractBrandName } from "../lib/sheetsApi"
import { filterDashboardTasks } from "../lib/dashboardFilters"
import { normalizeBrandKey, tabKey, taskKey } from "../lib/sharedState"
import { daysFrom } from "../lib/dates"
import AssignTeam from "./AssignTeam"

// ─── Helpers ────────────────────────────────────────────────────────────────────

function daysFromToday(dueDate) {
  return daysFrom(dueDate)
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

function StatCard({ icon, label, value, sub, color, animDelay = 0, glowClass = "", onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-2xl border text-left ${color.border} ${color.bg} p-5 transition-all duration-300 hover:shadow-md hover:-translate-y-0.5 animate-magic-enter ${glowClass}`}
      style={{ animationDelay: `${animDelay}ms` }}
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
      className="flex h-11 w-11 items-center justify-center rounded-full animate-magic-scale"
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={onClose}>
      <div className="relative w-full max-w-lg max-h-[80vh] overflow-y-auto rounded-2xl border border-purple-200 bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-purple-100 bg-white px-5 py-4 rounded-t-2xl">
          <div>
            <h2 className="text-base font-bold text-purple-900">จัดการรายชื่อลูกค้า</h2>
            <p className="text-[11px] text-purple-300">ยืนยัน แก้ชื่อ รวม หรือลบแบรนด์</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-purple-300 transition hover:bg-purple-50 hover:text-purple-600">
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
                        <span
                          className="flex-1 text-sm font-semibold text-gray-800 cursor-pointer hover:text-purple-600 truncate"
                          onClick={() => startEdit(brand)}
                          title="คลิกเพื่อแก้ชื่อ"
                        >
                          {brand}
                          <svg className="inline-block ml-1 h-2.5 w-2.5 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                          </svg>
                        </span>
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

function ClientHealthRow({ name, rawTabNames, assignmentKey, legacyKey, stats, overdueCount, nextTask, assignments, teamMembers, onUpdateAssignment, onRename, onOpen, animDelay = 0 }) {
  const pct = stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0
  const barWidth = stats.total > 0 ? (stats.done / stats.total) * 100 : 0

  return (
    <div className="flex items-center gap-3 rounded-xl border border-gray-100 bg-white px-4 py-3 transition-all duration-300 hover:shadow-sm hover:border-purple-200 hover:-translate-y-0.5 animate-magic-enter" style={{ animationDelay: `${animDelay}ms` }}>
      {/* Client name — editable */}
      <div className="w-56 shrink-0">
        <EditableClientName name={name} rawTabNames={rawTabNames} onRename={onRename} />
        <button type="button" onClick={onOpen} className="mt-1 text-[9px] font-semibold text-purple-400 hover:text-purple-600">ดูงานทั้งหมด</button>
      </div>

      {/* Progress bar */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
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
      <div className="w-16 text-center">
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
      <div className="w-24 text-center">
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
      <div className="w-28 flex justify-end">
        <AssignTeam
          displayName={name}
          assignmentKey={assignmentKey}
          legacyKey={legacyKey}
          assignments={assignments}
          members={teamMembers}
          onUpdate={onUpdateAssignment}
          compact
        />
      </div>
    </div>
  )
}

function MemberCard({ member, stats, maxOverdue, onOpen, animDelay = 0 }) {
  const rc = ROLE_CONFIG[member.role]
  const total = stats.done + stats.pending + stats.overdue
  const isHighOverdue = stats.overdue > 0 && stats.overdue >= maxOverdue

  return (
    <button type="button"
      onClick={onOpen}
      className={`rounded-2xl border bg-white p-4 transition-all duration-300 hover:shadow-md hover:-translate-y-0.5 animate-magic-enter ${
        isHighOverdue ? "border-red-200 animate-overdue-glow" : "border-gray-100"
      } text-left`}
      style={{ animationDelay: `${animDelay}ms` }}
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
                className="bg-green-400 transition-all duration-500"
                style={{ width: `${(stats.done / total) * 100}%` }}
              />
            )}
            {stats.pending > 0 && (
              <div
                className="bg-purple-300 transition-all duration-500"
                style={{ width: `${(stats.pending / total) * 100}%` }}
              />
            )}
            {stats.overdue > 0 && (
              <div
                className="bg-red-400 transition-all duration-500"
                style={{ width: `${(stats.overdue / total) * 100}%` }}
              />
            )}
          </div>
          <div className="flex items-center gap-3 mt-2 text-[10px] font-medium">
            {stats.done > 0 && <span className="text-green-600">✓ {stats.done} done</span>}
            {stats.pending > 0 && <span className="text-purple-500">{stats.pending} pending</span>}
            {stats.overdue > 0 && <span className="text-red-500">⚠ {stats.overdue} overdue</span>}
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
        <div className="text-[11px] text-gray-300 mt-1">ไม่มีงาน</div>
      )}
    </button>
  )
}

function OverdueItem({ task, brandName, animDelay = 0 }) {
  const days = daysFromToday(task.dueDate)
  const absDays = Math.abs(days ?? 0)
  const { cls, label } = overdueConfig(absDays)

  return (
    <a href={`https://docs.google.com/spreadsheets/d/${task.spreadsheetId}/edit#gid=${task.sheetGid}`} target="_blank" rel="noreferrer" className="flex items-center gap-2.5 rounded-lg px-3 py-2 transition hover:bg-red-50/50 animate-magic-enter" style={{ animationDelay: `${animDelay}ms` }}>
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

// ─── Gantt Timeline ──────────────────────────────────────────────────────────────

const GANTT_COLORS = [
  { bg: "rgb(147,51,234)", light: "rgb(233,213,255)" },   // purple
  { bg: "rgb(59,130,246)", light: "rgb(191,219,254)" },   // blue
  { bg: "rgb(20,184,166)", light: "rgb(153,246,228)" },   // teal
  { bg: "rgb(245,158,11)", light: "rgb(253,230,138)" },   // amber
  { bg: "rgb(244,63,94)",  light: "rgb(254,205,211)" },   // rose
  { bg: "rgb(99,102,241)", light: "rgb(199,210,254)" },   // indigo
  { bg: "rgb(34,197,94)",  light: "rgb(187,247,208)" },   // green
  { bg: "rgb(236,72,153)", light: "rgb(251,207,232)" },   // pink
]

function ganttColor(i) { return GANTT_COLORS[i % GANTT_COLORS.length] }

const ZOOM_LEVELS = [
  { label: "1M", days: 30 },
  { label: "3M", days: 90 },
  { label: "6M", days: 180 },
  { label: "All", days: 0 },
]

function GanttTimeline({ allTasks, brandNameForTask }) {
  const scrollRef = useRef(null)
  const containerRef = useRef(null)
  const [tooltip, setTooltip] = useState(null)
  const [zoomIdx, setZoomIdx] = useState(1) // default 3M
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

  const tasks = useMemo(() => {
    return allTasks.filter((t) => t.dueDate && !isNaN(new Date(t.dueDate).getTime()))
  }, [allTasks])

  // Group by client + compute layout
  const { clients, markers, dateRange, dayWidth, totalWidth } = useMemo(() => {
    if (tasks.length === 0) return { clients: [], markers: [], dateRange: null, dayWidth: 0, totalWidth: 0 }

    const groups = {}
    tasks.forEach((t) => {
      const brandName = brandNameForTask(t)
      if (!groups[brandName]) groups[brandName] = []
      groups[brandName].push(t)
    })

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
      const today = new Date(); today.setHours(0, 0, 0, 0)
      const halfDays = Math.floor(zoom.days / 2)
      minDate = new Date(today); minDate.setDate(minDate.getDate() - Math.floor(halfDays * 0.4))
      maxDate = new Date(today); maxDate.setDate(maxDate.getDate() + Math.ceil(halfDays * 1.6))
      // Extend to cover data if needed
      if (dataMin < minDate) minDate = new Date(dataMin.getTime() - 7 * 86_400_000)
      if (dataMax > maxDate) maxDate = new Date(dataMax.getTime() + 7 * 86_400_000)
    }

    minDate.setHours(0, 0, 0, 0)
    maxDate.setHours(0, 0, 0, 0)

    const totalDays = Math.ceil((maxDate - minDate) / 86_400_000)
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
      weekCursor.setDate(weekCursor.getDate() + (dow === 0 ? 1 : 8 - dow))
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
      .map(([name, clientTasks], idx) => {
        clientTasks.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))
        const earliest = new Date(clientTasks[0].dueDate)
        const latest = new Date(clientTasks[clientTasks.length - 1].dueDate)
        const startOffset = (earliest - minDate) / 86_400_000
        const endOffset = (latest - minDate) / 86_400_000
        const done = clientTasks.filter((t) => t.done).length
        const total = clientTasks.length
        const maxDaysLate = Math.max(...clientTasks.filter((task) => !task.done).map((task) => Math.max(0, -daysFromToday(task.dueDate))), 0)

        return {
          name, tasks: clientTasks,
          startOffset, endOffset, colorIdx: idx,
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
  }, [tasks, zoomIdx, containerWidth, brandNameForTask])

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
    return <div className="text-center py-8 text-sm text-gray-300">ไม่มีข้อมูลสำหรับแสดง Timeline</div>
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
                ? "bg-purple-600 text-white shadow-sm"
                : "bg-gray-100 text-gray-400 hover:bg-purple-50 hover:text-purple-500"
            }`}
          >
            {z.label}
          </button>
        ))}
        <div className="flex-1" />
        <span className="text-[9px] text-gray-400">← เลื่อน / ลากเพื่อดูช่วงอื่น →</span>
      </div>

      <div className="flex rounded-xl overflow-hidden border border-purple-100 bg-white">
        {/* Fixed left labels */}
        <div className="shrink-0 bg-gray-50/80 border-r border-gray-100 z-10" style={{ width: LABEL_WIDTH }}>
          <div className="h-8 border-b border-gray-100 px-2 flex items-center">
            <span className="text-[9px] font-bold uppercase tracking-wider text-gray-400">Client</span>
          </div>
          {weekMarkers.length > 0 && (
            <div className="h-5 border-b border-gray-50" />
          )}
          {clients.map((c) => {
            const color = ganttColor(c.colorIdx)
            return (
              <div
                key={c.name}
                className="flex items-center gap-1.5 px-2 border-b border-gray-50 hover:bg-purple-50/50 transition"
                style={{ height: ROW_HEIGHT }}
              >
                <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ backgroundColor: color.bg }} />
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
              const color = ganttColor(c.colorIdx)
              const barLeft = c.startOffset * dayWidth
              const barWidth = Math.max((c.endOffset - c.startOffset) * dayWidth, 6)
              const doneWidth = c.total > 0 ? (c.done / c.total) * barWidth : 0

              return (
                <div key={c.name} className="relative border-b border-gray-50" style={{ height: ROW_HEIGHT }}>
                  {/* Grid lines */}
                  {monthMarkers.map((m) => (
                    <div key={`gl-${m.date.getTime()}`} className="absolute top-0 h-full border-l border-gray-100/40" style={{ left: m.left }} />
                  ))}
                  {weekMarkers.map((w) => (
                    <div key={`wl-${w.date.getTime()}`} className="absolute top-0 h-full border-l border-gray-50" style={{ left: w.left }} />
                  ))}

                  {/* Bar */}
                  <div
                    className="absolute top-1.5 rounded-md cursor-pointer transition-opacity hover:opacity-90"
                    style={{ left: barLeft, width: barWidth, height: ROW_HEIGHT - 12, backgroundColor: color.light }}
                    onMouseEnter={(e) => setTooltip({ name: c.name, done: c.done, total: c.total, pct: c.pct, x: e.clientX, y: e.clientY })}
                    onMouseLeave={() => setTooltip(null)}
                  >
                    {doneWidth > 0 && (
                      <div className="h-full rounded-md" style={{ width: doneWidth, backgroundColor: color.bg, opacity: 0.85 }} />
                    )}
                    {barWidth > 60 && (
                      <span
                        className="absolute inset-0 flex items-center pointer-events-none"
                        style={{ paddingLeft: Math.min(doneWidth + 4, barWidth - 20) > 20 ? 0 : undefined }}
                      >
                        <span
                          className="rounded px-1.5 py-px text-[9px] font-bold truncate"
                          style={{
                            backgroundColor: "rgba(255,255,255,0.85)",
                            color: color.bg,
                            marginLeft: 4,
                          }}
                        >
                          {c.name}
                        </span>
                      </span>
                    )}
                  </div>

                  {/* Task dots */}
                  {c.tasks.map((t, ti) => {
                    const taskOffset = ((new Date(t.dueDate) - dateRange.min) / 86_400_000) * dayWidth
                    const dotSize = dayWidth >= 4 ? 10 : 8
                    return (
                      <div
                        key={taskKey(t) || ti}
                        className="absolute top-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-sm"
                        style={{
                          left: taskOffset - dotSize / 2,
                          width: dotSize, height: dotSize,
                          backgroundColor: t.done ? color.bg : (daysFromToday(t.dueDate) < 0 ? "#ef4444" : color.light),
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

        {/* Tooltip */}
        {tooltip && (
          <div
            className="fixed z-50 rounded-lg bg-gray-900 px-3 py-2 text-white shadow-xl pointer-events-none"
            style={{ left: tooltip.x + 12, top: tooltip.y - 10 }}
          >
            <div className="text-xs font-bold">{tooltip.name}</div>
            <div className="text-[10px] text-gray-300 mt-0.5">{tooltip.done}/{tooltip.total} tasks done ({tooltip.pct}%)</div>
          </div>
        )}
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
    <div className="rounded-2xl border border-purple-100 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold uppercase tracking-widest text-purple-400">Recent Activity</h3>
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
      </div> : <p className="mt-4 text-xs text-gray-400">Activity appears after the first saved change.</p>}
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
  preferenceOwner = "local",
}) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])
  const [showBrandManager, setShowBrandManager] = useState(false)
  const [healthShowAll, setHealthShowAll] = useState(false)
  const [drilldown, setDrilldown] = useState(null)
  const filterStorageKey = `magic-dashboard-filters:${preferenceOwner}`
  const [filters, setFilters] = useState(() => {
    try { return JSON.parse(localStorage.getItem(filterStorageKey)) || { status: "all", month: "all", member: "all" } }
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
    const responsibility = matchMembers(task.responsibility).map((member) => member.name)
    return [...new Set([...Object.values(assignment), ...responsibility])]
  }, [assignments, assignmentKeyForTask])

  const tasksWithWorkflow = useMemo(() => allTasks.map((task) => ({
    ...task,
    workflowStatus: workflow[taskKey(task)] || "not_started",
  })), [allTasks, workflow])
  const months = useMemo(() => [...new Set(tasksWithWorkflow.map((task) => task.month).filter(Boolean))].sort(), [tasksWithWorkflow])
  const filteredTasks = useMemo(
    () => filterDashboardTasks(tasksWithWorkflow, filters, assignedNames),
    [tasksWithWorkflow, filters, assignedNames],
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
    const dimension = filters.member !== "all" && filters.month !== "all"
      ? ["month_person", `${filters.month}:${filters.member}`]
      : filters.member !== "all"
        ? ["person", filters.member]
        : filters.month !== "all"
          ? ["month", filters.month]
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
  }, [dailyMetrics, filters.member, filters.month])
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
    upcoming.forEach((t) => {
      if (!grouped[t.dueDate]) grouped[t.dueDate] = []
      grouped[t.dueDate].push(t)
    })
    return Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b))
  }, [upcoming])

  return (
    <div className="space-y-6">

      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-purple-100 bg-white p-4 shadow-sm">
        <div className="mr-1">
          <div className="text-[10px] font-bold uppercase tracking-widest text-purple-500">Dashboard Filters</div>
          <div className="text-[10px] text-gray-400">{filteredTasks.length} of {allTasks.length} tasks</div>
        </div>
        <label className="text-[10px] font-semibold text-gray-500">
          Status
          <select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))} className="ml-1.5 rounded-lg border border-purple-100 bg-white px-2.5 py-1.5 text-xs text-gray-700 outline-none focus:border-purple-400">
            <option value="all">All</option>
            <option value="overdue">Overdue</option>
            <option value="upcoming">Upcoming</option>
            <option value="done">Done</option>
            <option value="not_started">Not started</option>
            <option value="in_progress">In progress</option>
            <option value="waiting_client">Waiting client</option>
            <option value="blocked">Blocked</option>
            <option value="unscheduled">Unscheduled</option>
          </select>
        </label>
        <label className="text-[10px] font-semibold text-gray-500">
          Month
          <select value={filters.month} onChange={(event) => setFilters((current) => ({ ...current, month: event.target.value }))} className="ml-1.5 rounded-lg border border-purple-100 bg-white px-2.5 py-1.5 text-xs text-gray-700 outline-none focus:border-purple-400">
            <option value="all">All</option>
            {months.map((month) => <option key={month} value={month}>{month}</option>)}
          </select>
        </label>
        <label className="text-[10px] font-semibold text-gray-500">
          Person
          <select value={filters.member} onChange={(event) => setFilters((current) => ({ ...current, member: event.target.value }))} className="ml-1.5 rounded-lg border border-purple-100 bg-white px-2.5 py-1.5 text-xs text-gray-700 outline-none focus:border-purple-400">
            <option value="all">All</option>
            {teamMembers.map((member) => <option key={member.name} value={member.name}>{member.name}</option>)}
          </select>
        </label>
        <button onClick={() => setFilters({ status: "all", month: "all", member: "all" })} disabled={Object.values(filters).every((value) => value === "all")} className="ml-auto rounded-lg border border-purple-200 px-3 py-1.5 text-[10px] font-semibold text-purple-500 transition hover:bg-purple-50 disabled:cursor-not-allowed disabled:opacity-40">
          Reset
        </button>
      </div>

      {/* ── ① Summary Stat Cards (top of dashboard) ─────────────────── */}
      {lastSynced && <div className={`rounded-xl border px-4 py-3 text-xs ${now - lastSynced.getTime() > 24 * 60 * 60 * 1000 ? "border-red-200 bg-red-50 text-red-700" : "border-green-100 bg-green-50 text-green-700"}`}>
        Data freshness: {lastSynced.toLocaleString("th-TH")}
      </div>}

      <div className={`rounded-2xl border p-4 text-xs ${syncStatus?.status === "failed" ? "border-red-200 bg-red-50" : syncStatus?.status === "running" ? "border-amber-200 bg-amber-50" : "border-purple-100 bg-white"}`}>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <strong className="uppercase tracking-wider text-purple-700">Data Health</strong>
          <span>Status: <strong>{syncStatus?.status || "not synced"}</strong></span>
          <span>Source tasks: <strong>{syncStatus?.task_count ?? allTasks.length}</strong></span>
          <button type="button" onClick={() => openDrilldown("Unscheduled", unscheduled)} className="underline decoration-purple-200 underline-offset-2">Unscheduled: <strong>{unscheduled.length}</strong></button>
          <span>Invalid rows: <strong>{syncStatus?.invalid_row_count || 0}</strong></span>
        </div>
        {syncStatus?.error && <p className="mt-2 text-red-600">{syncStatus.error}</p>}
        {syncStatus?.issues?.length > 0 && <div className="mt-2 max-h-24 overflow-y-auto text-[10px] text-amber-700">{syncStatus.issues.slice(0, 5).map((issue, index) => <div key={`${issue.spreadsheetId}:${issue.sheetGid}:${issue.rowIndex}:${index}`}>{issue.clientName} row {issue.rowIndex}: {issue.message}</div>)}</div>}
      </div>

      {drilldown && <div className="rounded-2xl border border-purple-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between"><h3 className="text-sm font-bold text-purple-800">{drilldown.label} · {drilldown.tasks.length} tasks</h3><button onClick={() => setDrilldown(null)} className="text-xs text-gray-400">Close</button></div>
        <div className="mt-3 max-h-64 divide-y divide-gray-50 overflow-y-auto">{drilldown.tasks.map((task) => <a key={taskKey(task)} href={`https://docs.google.com/spreadsheets/d/${task.spreadsheetId}/edit#gid=${task.sheetGid}`} target="_blank" rel="noreferrer" className="flex gap-3 py-2 text-xs hover:bg-purple-50"><span className="w-28 truncate font-semibold text-purple-600">{brandNameForTask(task)}</span><span className="flex-1 text-gray-600">{task.topic}</span><span className="text-gray-400">{fmtDate(task.dueDate)}</span></a>)}</div>
      </div>}

      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <StatCard
          label="Overdue"
          value={overdue.length}
          sub={overdue.length > 0 ? `${overdue.length} tasks past deadline` : "All clear!"}
          animDelay={0}
          onClick={() => openDrilldown("Overdue", overdue)}
          glowClass={overdue.length > 0 ? "animate-overdue-glow" : ""}
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
          animDelay={120}
          onClick={() => openDrilldown("Blocked", blocked)}
          color={{ bg: "bg-red-50", border: "border-red-200", iconBg: "bg-red-100", text: "text-red-700" }}
          icon={<span className="text-lg font-black text-red-500">!</span>}
        />

        <StatCard
          label="Waiting Client"
          value={waitingClient.length}
          sub="Pending external response"
          animDelay={160}
          onClick={() => openDrilldown("Waiting Client", waitingClient)}
          color={{ bg: "bg-blue-50", border: "border-blue-200", iconBg: "bg-blue-100", text: "text-blue-700" }}
          icon={<span className="text-lg font-black text-blue-500">…</span>}
        />

        <StatCard
          label="Due This Week"
          value={metrics.dueThisWeek.length}
          sub="Next 7 days"
          animDelay={80}
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

        <button type="button" onClick={() => openDrilldown("Completed", filteredTasks.filter((task) => task.done))} className="rounded-2xl border border-purple-200 bg-purple-50 p-5 text-left transition-all duration-300 hover:shadow-md hover:-translate-y-0.5 animate-magic-enter" style={{ animationDelay: "160ms" }}>
          <div className="flex items-center gap-3">
            <CompletionRing pct={metrics.completionPct} />
            <div>
              <div className="text-2xl font-black tabular-nums text-purple-700">{Math.round(metrics.completionPct)}%</div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Completion</div>
            </div>
          </div>
          <div className="mt-2 text-[11px] text-gray-500">{metrics.totalDone} of {metrics.totalAll} tasks done</div>
        </button>

        <div className="rounded-2xl border border-purple-100 bg-purple-50/50 p-5 transition-all duration-300 hover:shadow-md hover:-translate-y-0.5 animate-magic-enter" style={{ animationDelay: "240ms" }}>
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
            className="mt-2 mr-1 rounded-lg border border-purple-200 bg-white px-2 py-1 text-[10px] font-semibold text-purple-500 transition hover:bg-purple-50"
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
        <div className="rounded-2xl border border-purple-100 bg-white p-5 shadow-sm">
          <h3 className="text-xs font-bold uppercase tracking-widest text-purple-400">Overdue Aging</h3>
          <div className="mt-4 grid grid-cols-4 gap-2">
            {Object.entries(aging).map(([label, count]) => <button key={label} onClick={() => openDrilldown(`Overdue ${label} days`, agingTasks(label))} className="rounded-xl bg-red-50 p-3 text-center transition hover:bg-red-100"><div className="text-xl font-black text-red-600">{count}</div><div className="text-[10px] text-red-400">{label} days</div></button>)}
          </div>
        </div>
        <div className="rounded-2xl border border-purple-100 bg-white p-5 shadow-sm">
          <h3 className="text-xs font-bold uppercase tracking-widest text-purple-400">12-Month Trend</h3>
          {monthlyTrend.length ? <div className="mt-3 overflow-x-auto"><table className="w-full text-[10px]"><thead className="text-left text-gray-400"><tr><th>Month</th><th>Completion</th><th>Created</th><th>Resolved</th><th>Blocked</th><th>{filters.status === "all" ? "Workload" : filters.status.replaceAll("_", " ")}</th></tr></thead><tbody>{monthlyTrend.map(([month, row]) => { const metrics = row.metrics || {}; const completion = metrics.total ? Math.round((metrics.done / metrics.total) * 100) : 0; return <tr key={month} className="border-t border-gray-50"><td className="py-1.5 font-semibold text-gray-600">{month}</td><td>{completion}%</td><td>{metrics.overdueCreated || 0}</td><td>{metrics.overdueResolved || 0}</td><td>{metrics.blocked || 0}</td><td>{trendCount(metrics, filters.status)}</td></tr> })}</tbody></table><p className="mt-2 text-[9px] text-gray-300">Historical snapshot metrics; task-level history is not available.</p></div> : <p className="mt-4 text-xs text-gray-400">Trend starts after the first successful sync.</p>}
        </div>
      </div>

      <RecentActivity events={taskEvents} tasks={allTasks} />

      {/* ── Gantt Timeline ──────────────────────────────────────────── */}
      <div className="rounded-2xl border border-purple-100 bg-white shadow-sm animate-magic-enter" style={{ animationDelay: "100ms" }}>
        <div className="px-5 py-4 border-b border-purple-50">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-purple-400" />
            <h3 className="text-xs font-bold uppercase tracking-widest text-purple-400">Timeline Overview</h3>
          </div>
        </div>
        <div className="p-3 relative">
          <GanttTimeline
            allTasks={filteredTasks}
            brandNameForTask={brandNameForTask}
          />
        </div>
      </div>

      {/* ── ② Client Health + ③ Overdue ──────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

        {/* Client Health Table — show worst first, expandable */}
        <div className="xl:col-span-2 rounded-2xl border border-purple-100 bg-white shadow-sm">
          <div className="px-5 py-4 border-b border-purple-50">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-purple-400" />
              <h3 className="text-xs font-bold uppercase tracking-widest text-purple-400">Client Health</h3>
              <span className="text-[10px] text-gray-400 ml-1">{clientHealth.length} active</span>
            </div>
          </div>
          <div className="p-3 space-y-1.5">
            {/* Header */}
            <div className="flex items-center gap-3 px-4 py-1 text-[9px] font-bold uppercase tracking-widest text-gray-400">
              <div className="w-56 shrink-0">Client</div>
              <div className="flex-1">Progress</div>
              <div className="w-16 text-center">Overdue</div>
              <div className="w-24 text-center">Next Due</div>
              <div className="w-28 text-right">Team</div>
            </div>
            {clientHealth.length > 0 ? (
              <>
                {(healthShowAll ? clientHealth : clientHealth.slice(0, HEALTH_PREVIEW_COUNT)).map((c, hi) => (
                  <ClientHealthRow
                    key={c.name}
                    animDelay={Math.min(hi, 10) * 60}
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
              <div className="text-center py-8 text-sm text-gray-300">ไม่มี active clients</div>
            )}
          </div>
        </div>

        {/* Overdue Urgent List */}
        <div className={`rounded-2xl border border-red-100 bg-white shadow-sm ${overdue.length > 0 ? "animate-overdue-glow" : ""}`}>
          <div className="px-5 py-4 border-b border-red-50">
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full bg-red-400 ${overdue.length > 0 ? "animate-overdue-pulse" : ""}`} />
              <h3 className="text-xs font-bold uppercase tracking-widest text-red-400">Overdue</h3>
              {overdue.length > 0 && (
                <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-600">{overdue.length}</span>
              )}
            </div>
          </div>
          <div className="p-2">
            {overdue.length > 0 ? (
              <div className="space-y-0.5">
                {overdue.slice(0, 10).map((t, oi) => (
                  <OverdueItem key={taskKey(t)} task={t} brandName={brandNameForTask(t)} animDelay={oi * 50} />
                ))}
                {overdue.length > 10 && (
                  <div className="text-center py-2 text-[10px] text-gray-400">
                    +{overdue.length - 10} more overdue tasks
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-8">
                <div className="mt-1 text-sm text-gray-400">No overdue tasks</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── ④ Team Workload ──────────────────────────────────────────── */}
      <div className="rounded-2xl border border-purple-100 bg-white shadow-sm">
        <div className="px-5 py-4 border-b border-purple-50">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-purple-400" />
            <h3 className="text-xs font-bold uppercase tracking-widest text-purple-400">Team Workload</h3>
            <span className="text-[10px] text-gray-400 ml-1">{teamMembers.length} members</span>
          </div>
        </div>
        <div className="p-4 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
          {teamWorkload.memberStats.map(({ member, stats }, mi) => (
            <MemberCard
              key={member.name}
              member={member}
              stats={stats}
              maxOverdue={teamWorkload.maxOverdue}
              onOpen={() => openDrilldown(`งานของ ${member.name}`, filteredTasks.filter((task) => assignedNames(task).includes(member.name)))}
              animDelay={mi * 80}
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
      <div className="rounded-2xl border border-purple-100 bg-white shadow-sm">
        <div className="px-5 py-4 border-b border-purple-50">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-amber-400" />
            <h3 className="text-xs font-bold uppercase tracking-widest text-purple-400">Upcoming</h3>
            <span className="text-[10px] text-gray-400 ml-1">{upcoming.length} tasks</span>
          </div>
        </div>
        <div className="p-4 space-y-4">
          {upcomingByDay.length > 0 ? (
            upcomingByDay.map(([dateKey, tasks], di) => (
              <div key={dateKey} className="animate-magic-enter" style={{ animationDelay: `${di * 60}ms` }}>
                <UpcomingDayGroup dateKey={dateKey} tasks={tasks} brandNameForTask={brandNameForTask} />
              </div>
            ))
          ) : (
            <div className="text-center py-6 text-sm text-gray-300">ไม่มีงาน upcoming</div>
          )}
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
