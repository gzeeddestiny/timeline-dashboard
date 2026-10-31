import { normalizeBrandKey, tabKey } from "./sharedState.js"

export function projectForTask(task, projects = []) {
  const sourceKey = tabKey(task)
  return projects.find((project) => project.active !== false && (project.sourceTabKey === sourceKey || (project.sourceTabKeys || []).includes(sourceKey))) || null
}

export function legacyAssignmentKey(brandName) {
  return normalizeBrandKey(brandName)
}

export function assignmentKeyForTask(task, projects = [], brandName) {
  return projectForTask(task, projects)?.id || legacyAssignmentKey(brandName || task?.clientName)
}

export function resolveAssignment(task, { projects = [], projectAssignments = {}, assignments = {}, brandName } = {}) {
  const key = assignmentKeyForTask(task, projects, brandName)
  return projectAssignments[key] || assignments[key] || assignments[task?.clientName] || {}
}
