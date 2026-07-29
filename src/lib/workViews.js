import { taskKey } from "./sharedState.js"
import { bangkokDate, daysFrom } from "./dates.js"

export const DEFAULT_MY_WORK_FILTERS = { query: "", month: "all", workflow: "all", showCompleted: false }

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
  return [...new Set(tasks.map((task) => task.month).filter(Boolean))].sort((a, b) => a.localeCompare(b, "th"))
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
  return result
}
