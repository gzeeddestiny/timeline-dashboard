import { taskKey } from "./sharedState.js"
import { bangkokDate, daysFrom } from "./dates.js"

export const DEFAULT_MY_WORK_FILTERS = { query: "", month: "all", workflow: "all", showCompleted: false }
const MONTH_INDEX = new Map(["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"].map((month, index) => [month, index]))

export function sortMonthLabels(values) {
  const key = (value) => {
    const match = String(value).toUpperCase().match(/\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s*(\d{2,4})?\b/)
    if (!match) return Number.MAX_SAFE_INTEGER
    const year = match[2] ? Number(match[2].length === 2 ? `20${match[2]}` : match[2]) : 0
    return year * 12 + MONTH_INDEX.get(match[1])
  }
  return [...values].sort((a, b) => key(a) - key(b) || String(a).localeCompare(String(b), "th"))
}

export function normalizeMyWorkFilters(value = {}) {
  const workflows = new Set(["all", "not_started", "in_progress", "waiting_client", "blocked"])
  return {
    query: typeof value.query === "string" ? value.query : "",
    month: typeof value.month === "string" ? value.month : "all",
    workflow: workflows.has(value.workflow) ? value.workflow : "all",
    showCompleted: value.showCompleted === true,
  }
}

function searchable(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase("th-TH")
}

export function filterMyWorkTasks(tasks, filters, workflow = {}, remarks = {}, brandNameForTask = (task) => task.clientName) {
  const query = searchable(filters.query)
  const matched = tasks.filter((task) => {
    const key = taskKey(task)
    const status = workflow[key] || "not_started"
    if (filters.month !== "all" && task.month !== filters.month) return false
    if (filters.workflow !== "all" && status !== filters.workflow) return false
    if (!query) return true
    return [brandNameForTask(task), task.clientName, task.topic, task.responsibility, remarks[key]]
      .some((value) => searchable(value).includes(query))
  })
  const completed = matched.filter((task) => task.done).sort((a, b) =>
    String(b.actualSubmit || b.dueDate || "").localeCompare(String(a.actualSubmit || a.dueDate || "")) ||
    String(a.topic).localeCompare(String(b.topic), "th")
  )
  return { active: matched.filter((task) => !task.done), completed }
}

export function myWorkMonths(tasks) {
  return sortMonthLabels(new Set(tasks.map((task) => task.month).filter(Boolean)))
}

export function partitionMyWorkTasks(tasks, workflow, today = new Date()) {
  const todayKey = typeof today === "string" ? today : bangkokDate(today)
  const result = { blocked: [], overdue: [], today: [], next7: [], later: [], unscheduled: [] }
  tasks.filter((task) => !task.done).forEach((task) => {
    if (workflow[taskKey(task)] === "blocked") {
      result.blocked.push(task)
      return
    }
    const days = daysFrom(task.dueDate, todayKey)
    if (days === null) result.unscheduled.push(task)
    else if (days < 0) result.overdue.push(task)
    else if (days === 0) result.today.push(task)
    else if (days <= 7) result.next7.push(task)
    else result.later.push(task)
  })
  const byDueThenName = (a, b) => {
    const aDays = daysFrom(a.dueDate, todayKey)
    const bDays = daysFrom(b.dueDate, todayKey)
    return (aDays ?? Number.MAX_SAFE_INTEGER) - (bDays ?? Number.MAX_SAFE_INTEGER) ||
      String(a.clientName).localeCompare(String(b.clientName), "th") ||
      String(a.topic).localeCompare(String(b.topic), "th")
  }
  Object.values(result).forEach((items) => items.sort(byDueThenName))
  return result
}

export function selectNextAction(groups) {
  return groups.blocked[0] || groups.overdue[0] || groups.today[0] || groups.next7[0] || groups.unscheduled[0] || groups.later[0] || null
}
