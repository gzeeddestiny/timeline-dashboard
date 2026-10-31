import { bangkokDate, daysFrom, validIsoDate } from "./dates.js"
import { normalizeBrandKey, tabKey, taskKey } from "./sharedState.js"

export const CONTRACT_TYPES = [
  { value: "always_on", label: "Always-on" },
  { value: "one_time", label: "One-time" },
]

export const RENEWAL_STATUSES = [
  { value: "not_contacted", label: "ยังไม่ติดต่อ" },
  { value: "contacted", label: "ติดต่อแล้ว" },
  { value: "awaiting_response", label: "รอคำตอบ" },
  { value: "renewed", label: "ต่อแล้ว" },
  { value: "not_renewing", label: "ไม่ต่อ" },
]

export const CONTRACT_STATUSES = [
  { value: "open", label: "Open" },
  { value: "closed", label: "Closed" },
  { value: "cancelled", label: "Cancelled" },
]

export const MILESTONE_TYPES = {
  present_idea: {
    value: "present_idea",
    label: "Present Idea",
    shortLabel: "Present",
    icon: "◆",
    className: "brand-milestone-present",
  },
  draft_1: {
    value: "draft_1",
    label: "Draft 1",
    shortLabel: "Draft 1",
    icon: "◇",
    className: "brand-milestone-draft",
  },
  contract_end: {
    value: "contract_end",
    label: "Contract End",
    shortLabel: "Contract End",
    icon: "⚑",
    className: "brand-milestone-contract-end",
  },
}

export const TIMELINE_RANGES = [
  { value: "3m", label: "3M", pastMonths: 1, futureMonths: 2 },
  { value: "6m", label: "6M", pastMonths: 3, futureMonths: 3 },
  { value: "12m", label: "12M", pastMonths: 6, futureMonths: 6 },
  { value: "all", label: "All", all: true },
]

const DAY_MS = 86_400_000

function isoParts(value) {
  if (!validIsoDate(value)) return null
  const [year, month, day] = value.split("-").map(Number)
  return { year, month, day }
}

function isoDate(date) {
  return date.toISOString().slice(0, 10)
}

/** Add calendar months while clamping to the last day of the target month. */
export function addCalendarMonths(value, months) {
  const parts = isoParts(value)
  const count = Number(months)
  if (!parts || !Number.isInteger(count)) return ""
  const targetMonth = parts.month - 1 + count
  const target = new Date(Date.UTC(parts.year, targetMonth, 1))
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(parts.day, lastDay))
  return isoDate(target)
}

export function subtractOneDay(value) {
  const parts = isoParts(value)
  if (!parts) return ""
  return isoDate(new Date(Date.UTC(parts.year, parts.month - 1, parts.day - 1)))
}

export function calculateContractEnd(startDate, termMonths) {
  const months = Number(termMonths)
  if (!validIsoDate(startDate) || ![3, 6, 12].includes(months)) return ""
  return subtractOneDay(addCalendarMonths(startDate, months))
}

export function normalizeTopic(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/[–—‐‑]/g, "-")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
}

export function detectMilestone(topic) {
  const normalized = normalizeTopic(topic)
  if (!normalized) return null
  if (
    /\bpresent\s+idea\b/u.test(normalized) ||
    /\bidea\s+present(?:ation)?\b/u.test(normalized) ||
    normalized.includes("นำเสนอไอเดีย")
  ) return "present_idea"
  // The negative lookahead prevents Draft 10/11 from being treated as Draft 1.
  if (/\bdraft\s*1(?!\s*\d)/u.test(normalized) || /\bdraft\s+one\b/u.test(normalized)) return "draft_1"
  return null
}

export function milestoneForTask(task, overrides = {}) {
  const key = task?.taskKey || taskKey(task || {})
  const override = overrides[key]
  if (override === "none") return null
  if (MILESTONE_TYPES[override]) return override
  return detectMilestone(task?.topic)
}

export function milestoneLabel(value) {
  return MILESTONE_TYPES[value]?.label || ""
}

export function milestoneNeedsDate(task, overrides = {}) {
  return Boolean(milestoneForTask(task, overrides) && !task?.dueDate)
}

export function completedLateDays(task) {
  if (!taskIsCompletedLate(task)) return 0
  return Math.max(0, daysFrom(task.actualSubmit, task.dueDate) || 0)
}

export function contractState(contract, today = bangkokDate()) {
  if (!contract) return "none"
  if (contract.status === "closed") return "closed"
  if (contract.status === "cancelled") return "cancelled"
  const untilStart = daysFrom(contract.startDate, today)
  const untilEnd = daysFrom(contract.endDate, today)
  if (untilStart === null || untilEnd === null) return "invalid"
  if (untilStart > 0) return untilStart <= 45 ? "upcoming" : "future"
  if (untilEnd < 0) return "expired"
  return "active"
}

export function contractDaysRemaining(contract, today = bangkokDate()) {
  return contract?.endDate ? daysFrom(contract.endDate, today) : null
}

export function isContractVisibleInRadar(contract, today = bangkokDate()) {
  const state = contractState(contract, today)
  if (state === "expired") return !["renewed", "not_renewing"].includes(contract.renewalStatus)
  return state === "active" || state === "upcoming" || state === "future"
}

export function contractRadarRank(contract, today = bangkokDate()) {
  const state = contractState(contract, today)
  const remaining = contractDaysRemaining(contract, today)
  if (state === "expired" && !["renewed", "not_renewing"].includes(contract.renewalStatus)) return 0
  if (state === "active" && remaining !== null && remaining <= 7) return 1
  if (state === "active" && remaining !== null && remaining <= 14) return 2
  if (state === "active" && remaining !== null && remaining <= 30) return 3
  if (state === "upcoming") return 5
  if (state === "future") return 6
  return 4
}

export function taskIsOverdue(task, today = bangkokDate()) {
  return !task?.done && Boolean(task?.dueDate) && daysFrom(task.dueDate, today) < 0
}

export function taskIsCompletedLate(task) {
  if (!task?.done || !task?.dueDate || !task?.actualSubmit) return false
  return daysFrom(task.actualSubmit, task.dueDate) > 0
}

export function contractTypeLabel(type) {
  return CONTRACT_TYPES.find((item) => item.value === type)?.label || "One-time"
}

export function renewalStatusLabel(status) {
  return RENEWAL_STATUSES.find((item) => item.value === status)?.label || "ยังไม่ติดต่อ"
}

export function sourceTabKey(task) {
  return tabKey(task)
}

export function taskBrandKey(task, brandNameForTask) {
  return normalizeBrandKey(brandNameForTask?.(task) || task?.clientName || "")
}

export function sourceTabRecords(tasks = []) {
  const records = new Map()
  tasks.forEach((task) => {
    const key = sourceTabKey(task)
    if (!records.has(key)) records.set(key, { key, title: task.clientName, spreadsheetId: task.spreadsheetId, sheetGid: task.sheetGid })
  })
  return [...records.values()]
}

/**
 * Return source tabs that are already mapped to a brand plus conservative
 * name-based suggestions for an Admin setup preview. Suggestions never write
 * anything; the RPC remains the final source-tab exclusivity guard.
 */
export function suggestSourceTabsForBrand({ tabs = [], tasksByTab = {}, tabBrands = {}, brandKey = "", brandNameForTask = (task) => task?.clientName || "" } = {}) {
  const normalizedBrand = normalizeBrandKey(brandKey)
  if (!normalizedBrand) return []
  return tabs
    .map((tab) => {
      const tabTasks = tasksByTab[tab.key] || []
      const mapped = normalizeBrandKey(tabBrands[tab.key]) === normalizedBrand || tabTasks.some((task) => normalizeBrandKey(brandNameForTask(task)) === normalizedBrand)
      const titleKey = normalizeBrandKey(tab.title)
      const nameHint = titleKey.includes(normalizedBrand) || (normalizedBrand.includes(titleKey) && titleKey.length > 2)
      return { ...tab, suggested: !mapped && nameHint, mapped }
    })
    .filter((tab) => tab.mapped || tab.suggested)
    .sort((a, b) => Number(b.mapped) - Number(a.mapped) || Number(b.suggested) - Number(a.suggested) || String(a.title).localeCompare(String(b.title), "th"))
}

const MONTH_INDEX = { jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11 }
const PROJECT_MONTH_RE = /\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|october|oct|november|nov|december|dec)\s*(\d{2}|\d{4})\b/iu

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * Build a stable, explainable Project name from a source-tab title. Team names,
 * the confirmed Brand is removed while month/year remains. Month is part of the
 * identity because one monthly Google Sheet tab is exactly one Project.
 */
export function projectNameFromTab(tabTitle, brandName = "") {
  const original = String(tabTitle || "").trim()
  if (!original) return "Untitled Project"
  let value = original.replace(/^\([^)]*\)\s*/u, "")
  if (brandName.trim()) value = value.replace(new RegExp(escapeRegExp(brandName.trim()), "giu"), " ")
  value = value
    .replace(/[\s_+|/]+/gu, " ")
    .replace(/^[-–—:]+|[-–—:]+$/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
  return value || `${brandName || "Project"} · General`
}

export function projectDatesFromTab(tabTitle) {
  const match = String(tabTitle || "").match(PROJECT_MONTH_RE)
  if (!match) return { startDate: "", endDate: "" }
  const month = MONTH_INDEX[match[1].toLocaleLowerCase("en")]
  const rawYear = Number(match[2])
  const year = rawYear < 100 ? 2000 + rawYear : rawYear
  if (!Number.isInteger(month) || year < 2000 || year > 2200) return { startDate: "", endDate: "" }
  const startDate = isoDate(new Date(Date.UTC(year, month, 1)))
  const endDate = isoDate(new Date(Date.UTC(year, month + 1, 0)))
  return { startDate, endDate }
}

/** Build one review-only Project suggestion for every unassigned tab. */
export function suggestProjectsForBrand({ tabs = [], brandName = "" } = {}) {
  return tabs
    .map((tab) => ({
      key: tab.key,
      name: projectNameFromTab(tab.title, brandName),
      tab,
      sourceTabKey: tab.key,
      sourceTabKeys: [tab.key],
      taskCount: Number(tab.count || 0),
      ...projectDatesFromTab(tab.title),
      reason: "1 source tab = 1 Project · ตรวจชื่อและช่วงเวลาก่อนยืนยัน",
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "th"))
}

export function projectCompletion(tasks = []) {
  const total = tasks.length
  const completed = tasks.filter((task) => task.done).length
  const complete = total > 0 && completed === total
  const completionDates = complete ? tasks.map((task) => task.actualSubmit).filter(validIsoDate).sort() : []
  return {
    total,
    completed,
    incomplete: total - completed,
    percent: total ? Math.round((completed / total) * 100) : 0,
    complete,
    completionDate: completionDates.at(-1) || "",
  }
}

export function projectDeliveryState(project, today = bangkokDate()) {
  const completion = projectCompletion(project?.tasks || [])
  if (!validIsoDate(project?.startDate) || !validIsoDate(project?.endDate)) return { state: "missing_dates", days: null, ...completion }
  const remaining = daysFrom(project.endDate, today)
  if (completion.complete) {
    const lateDays = completion.completionDate ? Math.max(0, daysFrom(completion.completionDate, project.endDate) || 0) : 0
    return { state: lateDays > 0 ? "completed_late" : "complete", days: lateDays, ...completion }
  }
  if (remaining < 0) return { state: "overdue", days: Math.abs(remaining), ...completion }
  if (remaining <= 7) return { state: "due_soon", days: remaining, ...completion }
  return { state: "active", days: remaining, ...completion }
}

export function riskForBrand({ tasks = [], contracts = [], overrides = {}, today = bangkokDate() }) {
  const openContracts = contracts.filter((contract) => contract.status === "open")
  const visibleContracts = openContracts.filter((contract) => isContractVisibleInRadar(contract, today))
  const contractRank = visibleContracts.length ? Math.min(...visibleContracts.map((contract) => contractRadarRank(contract, today))) : 6
  const keyTasks = tasks.filter((task) => milestoneForTask(task, overrides))
  const overdueKeyTasks = keyTasks.filter((task) => taskIsOverdue(task, today))
  const overdueTasks = tasks.filter((task) => taskIsOverdue(task, today))
  const missingKeyTasks = keyTasks.filter((task) => !task.dueDate && !task.done)
  // Contract urgency is intentionally evaluated before task urgency. Missing dates
  // remain visible as a warning but do not affect this numeric ordering.
  const rank = contractRank < 6
    ? contractRank
    : overdueKeyTasks.length
      ? 7
      : overdueTasks.length
        ? 8
        : 9
  return {
    rank,
    contractRank,
    visibleContracts,
    overdueKeyTasks,
    overdueTasks,
    missingKeyTasks,
    label: rank === 0 ? "Expired contract" : rank <= 3 ? "Contract watch" : rank === 7 ? "Key milestone overdue" : rank === 8 ? "Overdue work" : "Healthy",
  }
}

export function groupTasksBySource(tasks = []) {
  return tasks.reduce((groups, task) => {
    const key = sourceTabKey(task)
    if (!groups[key]) groups[key] = []
    groups[key].push(task)
    return groups
  }, {})
}

export function rangeContainsDate(startDate, endDate, value) {
  if (!validIsoDate(value)) return false
  return (!startDate || value >= startDate) && (!endDate || value <= endDate)
}

export function timelinePosition(value, startDate, endDate) {
  if (!validIsoDate(value) || !validIsoDate(startDate) || !validIsoDate(endDate)) return null
  const total = daysFrom(endDate, startDate)
  const offset = daysFrom(value, startDate)
  if (!Number.isFinite(total) || total <= 0 || offset === null) return null
  return Math.max(0, Math.min(1, offset / total))
}

export function timelineTodayOffset(startDate, endDate, today = bangkokDate()) {
  return timelinePosition(today, startDate, endDate)
}

export function formatRemainingDays(days) {
  if (days === null || days === undefined) return "ไม่มีวันที่"
  if (days < 0) return `หมดอายุ ${Math.abs(days)} วัน`
  if (days === 0) return "หมดวันนี้"
  return `เหลือ ${days} วัน`
}

export function contractDateRange(contract) {
  if (!contract?.startDate || !contract?.endDate) return "ยังไม่ระบุช่วงเวลา"
  return `${contract.startDate} — ${contract.endDate}`
}

function addMonthsToIso(value, months) {
  const parts = isoParts(value)
  if (!parts) return ""
  const targetMonth = new Date(Date.UTC(parts.year, parts.month - 1 + months, 1))
  const lastDay = new Date(Date.UTC(targetMonth.getUTCFullYear(), targetMonth.getUTCMonth() + 1, 0)).getUTCDate()
  const target = new Date(Date.UTC(targetMonth.getUTCFullYear(), targetMonth.getUTCMonth(), Math.min(parts.day, lastDay)))
  return isoDate(target)
}

export function timelineRangeDates({ tasks = [], contracts = [], range = "6m", today = bangkokDate() } = {}) {
  const selected = TIMELINE_RANGES.find((item) => item.value === range) || TIMELINE_RANGES[1]
  if (selected.all) {
    const dates = [
      today,
      ...tasks.map((task) => task.dueDate),
      ...contracts.flatMap((contract) => [contract.startDate, contract.endDate]),
    ].filter(validIsoDate).sort()
    if (!dates.length) return { startDate: today, endDate: today }
    const first = addMonthsToIso(dates[0], -1)
    const last = addMonthsToIso(dates[dates.length - 1], 1)
    return { startDate: first || dates[0], endDate: last || dates[dates.length - 1] }
  }
  return {
    startDate: addMonthsToIso(today, -selected.pastMonths),
    endDate: addMonthsToIso(today, selected.futureMonths),
  }
}

export const BRAND_DAY_MS = DAY_MS
