// ─── Team Member Configuration ────────────────────────────────────────────────
//
// ข้อมูลสมาชิก cache ต่อ browser session; Supabase เป็น source of truth
// ROLE_CONFIG เป็น static — แก้ที่นี่ถ้าต้องการเพิ่ม role ใหม่
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_MEMBERS = []

const STORAGE_KEY = "magic-team-members"

/** Load team members from sessionStorage (or defaults) */
export function loadTeamMembers() {
  if (typeof window === "undefined") return DEFAULT_MEMBERS
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY) || localStorage.getItem(STORAGE_KEY)
    if (stored && !sessionStorage.getItem(STORAGE_KEY)) sessionStorage.setItem(STORAGE_KEY, stored)
    localStorage.removeItem(STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored)
      if (Array.isArray(parsed) && parsed.length > 0) return parsed
    }
  } catch { /* ignore */ }
  return DEFAULT_MEMBERS
}

export const ROLES = ["creative", "graphic_editor", "cameraman", "ae", "media_planner", "media", "ads_optimizer", "pm"]

export const ROLE_CONFIG = {
  creative: {
    sizeClass: "h-16 w-16",   // ใหญ่สุด (+30%)
    smSizeClass: "h-[52px] w-[52px]",
    xsSizeClass: "h-12 w-12",
    textClass: "text-xl",
    smTextClass: "text-base",
    xsTextClass: "text-sm",
    ring: "ring-purple-400",
    bg: "bg-purple-100 text-purple-700",
    label: "Creative",
  },
  graphic_editor: {
    sizeClass: "h-[52px] w-[52px]",
    smSizeClass: "h-10 w-10",
    xsSizeClass: "h-9 w-9",
    textClass: "text-base",
    smTextClass: "text-sm",
    xsTextClass: "text-xs",
    ring: "ring-pink-400",
    bg: "bg-pink-100 text-pink-700",
    label: "Graphic/Editor",
  },
  cameraman: {
    sizeClass: "h-[52px] w-[52px]",
    smSizeClass: "h-10 w-10",
    xsSizeClass: "h-9 w-9",
    textClass: "text-base",
    smTextClass: "text-sm",
    xsTextClass: "text-xs",
    ring: "ring-orange-400",
    bg: "bg-orange-100 text-orange-700",
    label: "Cameraman",
  },
  ae: {
    sizeClass: "h-[52px] w-[52px]",   // กลาง (+30%)
    smSizeClass: "h-10 w-10",
    xsSizeClass: "h-9 w-9",
    textClass: "text-base",
    smTextClass: "text-sm",
    xsTextClass: "text-xs",
    ring: "ring-blue-400",
    bg: "bg-blue-100 text-blue-700",
    label: "AE",
  },
  media_planner: {
    sizeClass: "h-[52px] w-[52px]",
    smSizeClass: "h-10 w-10",
    xsSizeClass: "h-9 w-9",
    textClass: "text-base",
    smTextClass: "text-sm",
    xsTextClass: "text-xs",
    ring: "ring-cyan-400",
    bg: "bg-cyan-100 text-cyan-700",
    label: "Media Planner",
  },
  media: {
    sizeClass: "h-[52px] w-[52px]",   // กลาง (เท่า AE +30%)
    smSizeClass: "h-10 w-10",
    xsSizeClass: "h-9 w-9",
    textClass: "text-base",
    smTextClass: "text-sm",
    xsTextClass: "text-xs",
    ring: "ring-teal-400",
    bg: "bg-teal-100 text-teal-700",
    label: "Media Buyer",
  },
  ads_optimizer: {
    sizeClass: "h-[52px] w-[52px]",
    smSizeClass: "h-10 w-10",
    xsSizeClass: "h-9 w-9",
    textClass: "text-base",
    smTextClass: "text-sm",
    xsTextClass: "text-xs",
    ring: "ring-indigo-400",
    bg: "bg-indigo-100 text-indigo-700",
    label: "Ads Optimizer",
  },
  pm: {
    sizeClass: "h-10 w-10",     // เล็กสุด (+30%)
    smSizeClass: "h-8 w-8",
    xsSizeClass: "h-7 w-7",
    textClass: "text-sm",
    smTextClass: "text-xs",
    xsTextClass: "text-[10px]",
    ring: "ring-amber-400",
    bg: "bg-amber-100 text-amber-700",
    label: "PM",
  },
}

export function findMemberByName(members = [], name = "") {
  const normalized = String(name).trim().toLocaleLowerCase()
  return normalized ? members.find((member) => member.name.trim().toLocaleLowerCase() === normalized) : undefined
}

export function mergeSavedTeamMember(members = [], savedMember) {
  const name = String(savedMember?.name || "").trim()
  const role = String(savedMember?.role || "").trim()
  if (!name || !role || findMemberByName(members, name)) return members
  return [...members, { name, role, avatar: savedMember?.avatar || "" }]
}

export function mergeRemoteTeamMembers(localMembers = [], remoteMembers = [], hasPendingChanges = false) {
  if (!hasPendingChanges) return remoteMembers
  return remoteMembers.reduce((members, remoteMember) => mergeSavedTeamMember(members, remoteMember), localMembers)
}

export function applyMemberAvatar(members = [], memberName, avatar) {
  const target = findMemberByName(members, memberName)
  if (!target) return members
  return members.map((member) => member === target ? { ...member, avatar: avatar || "" } : member)
}

export function responsibilityMentions(responsibility, name) {
  const escaped = String(name || "").trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  if (!responsibility || !escaped) return false
  return new RegExp(`(^|[^\\p{L}\\p{N}\\p{M}])${escaped}($|[^\\p{L}\\p{N}\\p{M}])`, "iu").test(responsibility)
}

export function matchMembersFromList(str, members = []) {
  if (!str) return []
  const order = { creative: 0, graphic_editor: 1, cameraman: 2, ae: 3, media_planner: 4, media: 5, ads_optimizer: 6, pm: 7 }
  return members
    .filter((member) => responsibilityMentions(str, member.name))
    .sort((a, b) => (order[a.role] ?? 9) - (order[b.role] ?? 9))
}

export function assignmentRoleMembers(assignment = {}, role) {
  const value = assignment?.[role]
  return (Array.isArray(value) ? value : value ? [value] : []).filter((name) => typeof name === "string" && name)
}

export function assignmentMemberNames(assignment = {}) {
  return [...new Set(Object.values(assignment || {}).flatMap((value) => Array.isArray(value) ? value : value ? [value] : []).filter((name) => typeof name === "string" && name))]
}

// Responsibility is the explicit owner. Brand assignment is only a fallback
// for tasks whose Responsibility does not name a known team member.
export function taskOwnerNames(task, members = [], assignment = {}) {
  const explicit = matchMembersFromList(task?.responsibility, members).map((member) => member.name)
  return explicit.length ? explicit : assignmentMemberNames(assignment)
}
