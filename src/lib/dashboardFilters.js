import { bangkokDate, daysFrom } from "./dates.js"

export function dashboardStatus(task, today = new Date()) {
  if (task.done) return "done"
  const todayKey = typeof today === "string" ? today : bangkokDate(today)
  const days = daysFrom(task.dueDate, todayKey)
  if (days === null) return "unscheduled"
  return days < 0 ? "overdue" : "upcoming"
}

export function sortDashboardTasks(tasks, today = new Date()) {
  const todayKey = typeof today === "string" ? today : bangkokDate(today)
  return [...tasks].sort((a, b) => {
    const aStatus = dashboardStatus(a, today)
    const bStatus = dashboardStatus(b, today)
    if (aStatus === "overdue" && bStatus !== "overdue") return -1
    if (bStatus === "overdue" && aStatus !== "overdue") return 1
    const aDays = daysFrom(a.dueDate, todayKey)
    const bDays = daysFrom(b.dueDate, todayKey)
    if (aDays === null && bDays !== null) return 1
    if (bDays === null && aDays !== null) return -1
    return (aDays ?? 0) - (bDays ?? 0) || String(a.clientName).localeCompare(String(b.clientName), "th")
  })
}

export function filterDashboardTasks(tasks, filters, assignedNames = () => [], today = new Date()) {
  const workflowStatuses = new Set(["not_started", "in_progress", "waiting_client", "blocked"])
  const filtered = tasks.filter((task) => {
    if (filters.status !== "all") {
      const dateStatus = dashboardStatus(task, today)
      const workflowStatus = task.workflowStatus || "not_started"
      if (workflowStatuses.has(filters.status)) {
        if (task.done || filters.status !== workflowStatus) return false
      } else if (filters.status !== dateStatus) return false
    }
    if (filters.month !== "all" && task.month !== filters.month) return false
    if (filters.member !== "all" && !assignedNames(task).includes(filters.member)) return false
    return true
  })
  return sortDashboardTasks(filtered, today)
}
