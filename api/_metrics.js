import { extractBrandName } from "../src/lib/sheetsApi.js"
import { normalizeBrandKey } from "../src/lib/sharedState.js"
import { bangkokDate } from "../src/lib/dates.js"
import { responsibilityMentions } from "../src/lib/teamConfig.js"

export { bangkokDate }

export function taskOwners(task, teamMembers, brands, assignments) {
  const brand = brands[`${task.spreadsheetId}:${task.sheetGid}`] || extractBrandName(task.clientName)
  const assigned = Object.values(assignments[normalizeBrandKey(brand)] || assignments[task.clientName] || {})
  const mentioned = teamMembers.filter((member) => responsibilityMentions(task.responsibility, member.name)).map((member) => member.name)
  return [...new Set([...assigned, ...mentioned])]
}

export function metricSummary(tasks, workflow, today = bangkokDate()) {
  const active = tasks.filter((task) => !task.done)
  return {
    total: tasks.length,
    done: tasks.filter((task) => task.done).length,
    overdue: active.filter((task) => task.dueDate && task.dueDate < today).length,
    blocked: active.filter((task) => workflow[task.taskKey] === "blocked").length,
    waitingClient: active.filter((task) => workflow[task.taskKey] === "waiting_client").length,
    inProgress: active.filter((task) => workflow[task.taskKey] === "in_progress").length,
    notStarted: active.filter((task) => !workflow[task.taskKey] || workflow[task.taskKey] === "not_started").length,
    upcoming: active.filter((task) => task.dueDate && task.dueDate >= today).length,
    unscheduled: active.filter((task) => !task.dueDate).length,
    dueThisWeek: active.filter((task) => {
      if (!task.dueDate || task.dueDate < today) return false
      const days = Math.floor((new Date(`${task.dueDate}T00:00:00Z`) - new Date(`${today}T00:00:00Z`)) / 86_400_000)
      return days <= 7
    }).length,
  }
}

export function overdueTransitions(previousTasks, currentTasks, today = bangkokDate()) {
  const keyOf = (task) => task.taskKey || task.task_key
  const overdue = (task) => {
    const due = task.dueDate || task.due_date
    return !task.done && Boolean(due) && due < today
  }
  const previous = new Map(previousTasks.map((task) => [keyOf(task), task]))
  const current = new Map(currentTasks.map((task) => [keyOf(task), task]))
  let created = 0
  let resolved = 0
  current.forEach((task, key) => { if (overdue(task) && !overdue(previous.get(key) || {})) created++ })
  previous.forEach((task, key) => { if (overdue(task) && !overdue(current.get(key) || {})) resolved++ })
  return { overdueCreated: created, overdueResolved: resolved }
}

function metricTask(task) {
  return {
    ...task,
    taskKey: task.taskKey || task.task_key,
    spreadsheetId: task.spreadsheetId || task.spreadsheet_id,
    sheetGid: Number(task.sheetGid ?? task.sheet_gid),
    clientName: task.clientName || task.client_name,
    dueDate: task.dueDate || task.due_date || "",
    responsibility: task.responsibility || "",
  }
}

export function addTransitionMetrics(rows, previousTasks, currentTasks, teamMembers, brands, assignments, today = bangkokDate()) {
  const previous = previousTasks.map(metricTask)
  const current = currentTasks.map(metricTask)
  const owners = (tasks) => new Map(tasks.map((task) => [task.taskKey, taskOwners(task, teamMembers, brands, assignments)]))
  const previousOwners = owners(previous)
  const currentOwners = owners(current)
  const select = (row, tasks, ownerMap) => {
    if (row.dimension === "overall") return tasks
    if (row.dimension === "month") return tasks.filter((task) => task.month === row.dimension_key)
    if (row.dimension === "person") return tasks.filter((task) => ownerMap.get(task.taskKey)?.includes(row.dimension_key))
    const separator = row.dimension_key.indexOf(":")
    const month = row.dimension_key.slice(0, separator)
    const person = row.dimension_key.slice(separator + 1)
    return tasks.filter((task) => task.month === month && ownerMap.get(task.taskKey)?.includes(person))
  }
  return rows.map((row) => {
    const transitions = overdueTransitions(
      select(row, previous, previousOwners),
      select(row, current, currentOwners),
      today,
    )
    return { ...row, metrics: { ...row.metrics, ...transitions } }
  })
}

export function buildMetricRows(tasks, workflow, teamMembers, brands, assignments, syncId, now = new Date()) {
  const snapshotDate = bangkokDate(now)
  const rows = [{
    snapshot_date: snapshotDate,
    dimension: "overall",
    dimension_key: "all",
    metrics: metricSummary(tasks, workflow, snapshotDate),
    source_sync_id: syncId,
    updated_at: now.toISOString(),
  }]

  const months = [...new Set(tasks.map((task) => task.month).filter(Boolean))]
  months.forEach((month) => rows.push({
    snapshot_date: snapshotDate,
    dimension: "month",
    dimension_key: month,
    metrics: metricSummary(tasks.filter((task) => task.month === month), workflow, snapshotDate),
    source_sync_id: syncId,
    updated_at: now.toISOString(),
  }))
  const owners = new Map(tasks.map((task) => [task.taskKey, taskOwners(task, teamMembers, brands, assignments)]))
  teamMembers.forEach((member) => rows.push({
    snapshot_date: snapshotDate,
    dimension: "person",
    dimension_key: member.name,
    metrics: metricSummary(tasks.filter((task) => owners.get(task.taskKey).includes(member.name)), workflow, snapshotDate),
    source_sync_id: syncId,
    updated_at: now.toISOString(),
  }))
  months.forEach((month) => teamMembers.forEach((member) => rows.push({
    snapshot_date: snapshotDate,
    dimension: "month_person",
    dimension_key: `${month}:${member.name}`,
    metrics: metricSummary(tasks.filter((task) => task.month === month && owners.get(task.taskKey).includes(member.name)), workflow, snapshotDate),
    source_sync_id: syncId,
    updated_at: now.toISOString(),
  })))
  return rows
}
