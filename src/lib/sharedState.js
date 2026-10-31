const SHARED_CACHE_KEY = "magic-shared-state"
const PENDING_WRITES_KEY = "magic-pending-writes"

export function parseSheetUrl(url) {
  if (typeof url !== "string") return null
  try {
    const parsed = new URL(url.trim())
    if (parsed.protocol !== "https:" || parsed.hostname !== "docs.google.com") return null
    const spreadsheetId = parsed.pathname.match(/^\/spreadsheets\/d\/([a-zA-Z0-9-_]+)(?:\/|$)/)?.[1]
    return spreadsheetId
      ? { spreadsheetId, url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}` }
      : null
  } catch { return null }
}

export function sheetsFromLegacyHash(hash) {
  if (!hash?.startsWith("#s=")) return []
  const seen = new Set()
  return hash.slice(3).split(",").flatMap((spreadsheetId) => {
    if (!/^[a-zA-Z0-9-_]+$/.test(spreadsheetId) || seen.has(spreadsheetId)) return []
    seen.add(spreadsheetId)
    return [{ spreadsheetId, url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}` }]
  })
}

export function normalizeBrandKey(name) {
  return String(name || "").trim().replace(/\s+/g, " ").toLocaleLowerCase("th-TH")
}

export function tabKey(task) {
  return `${task.spreadsheetId || "local"}:${task.sheetGid ?? task.clientName ?? "unknown"}`
}

export function taskKey(task) {
  return `${tabKey(task)}:${task.taskId || task.rowIndex || task.id}`
}

export function taskSheetUrl(task, key = task ? taskKey(task) : "") {
  const [spreadsheetId, gid] = String(key || "").split(":")
  if (!/^[a-zA-Z0-9-_]+$/.test(spreadsheetId || "") || !/^\d+$/.test(gid || "")) return null
  const fragment = new URLSearchParams({ gid })
  if (Number.isInteger(task?.rowIndex) && task.rowIndex > 0) fragment.set("range", `A${task.rowIndex}`)
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#${fragment}`
}

export function mergeRemote(local, remote, dirtyKeys, resource) {
  const next = { ...(remote || {}) }
  const localRecords = local || {}
  dirtyKeys.forEach((dirtyKey) => {
    const prefix = `${resource}:`
    if (!dirtyKey.startsWith(prefix)) return
    const key = dirtyKey.slice(prefix.length)
    if (!(key in localRecords)) delete next[key]
  })
  for (const [key, value] of Object.entries(localRecords)) {
    if (dirtyKeys.has(`${resource}:${key}`)) next[key] = value
  }
  return next
}

export function overlayPendingProjects(base, pending = []) {
  const next = Object.fromEntries((base || []).map((project) => [project.id, project]))
  pending.filter((item) => item.resource === "projectAssignments").forEach(({ key, value }) => {
    if (!next[key] || !value || typeof value !== "object") return
    next[key] = { ...next[key], assignment: value }
  })
  return Object.values(next)
}

export function mergeRemoteProjects(local, remote, pendingWrites = new Map()) {
  const next = Object.fromEntries((remote || []).map((project) => [project.id, project]))
  const localById = Object.fromEntries((local || []).map((project) => [project.id, project]))
  pendingWrites.forEach((item, dirtyKey) => {
    if (item.resource !== "projectAssignments") return
    const projectId = dirtyKey.slice("projectAssignments:".length)
    if (!localById[projectId]) return
    next[projectId] = { ...(next[projectId] || localById[projectId]), assignment: item.value || {} }
  })
  return Object.values(next)
}

export function loadCachedSharedState() {
  try {
    const cached = sessionStorage.getItem(SHARED_CACHE_KEY) || localStorage.getItem(SHARED_CACHE_KEY)
    if (cached && !sessionStorage.getItem(SHARED_CACHE_KEY)) sessionStorage.setItem(SHARED_CACHE_KEY, cached)
    localStorage.removeItem(SHARED_CACHE_KEY)
    const parsed = JSON.parse(cached || "null")
    if (parsed?.brandWorkstreams && !parsed.brandProjects) {
      const { brandWorkstreams: legacyProjects, ...current } = parsed
      return {
        ...current,
        brandProjects: legacyProjects.map((project) => ({
          ...project,
          contractId: project.contractId || null,
          sourceTabKey: project.sourceTabKey || project.sourceTabKeys?.[0] || "",
          startDate: project.startDate || "",
          endDate: project.endDate || "",
        })),
      }
    }
    if (!parsed) return parsed
    return {
      ...parsed,
      brandProjects: (parsed.brandProjects || []).map((project) => ({
        ...project,
        contractId: project.contractId || null,
        sourceTabKey: project.sourceTabKey || project.sourceTabKeys?.[0] || "",
        startDate: project.startDate || "",
        endDate: project.endDate || "",
      })),
      brandContracts: (parsed.brandContracts || []).map((contract) => ({
        ...contract,
        brandId: contract.brandId || null,
        type: contract.type || (contract.termMonths ? "always_on" : "one_time"),
        renewalStatus: contract.renewalStatus || "not_contacted",
      })),
    }
  }
  catch { return null }
}

export function cacheSharedState(state) {
  try { sessionStorage.setItem(SHARED_CACHE_KEY, JSON.stringify(state)) }
  catch { /* cache is optional */ }
}

export function loadPendingWrites() {
  try {
    const value = JSON.parse(sessionStorage.getItem(PENDING_WRITES_KEY) || "[]")
    return Array.isArray(value)
      ? value.filter((item) => item && typeof item.resource === "string" && typeof item.key === "string")
      : []
  } catch { return [] }
}

export function cachePendingWrites(writes) {
  try {
    if (writes.length) sessionStorage.setItem(PENDING_WRITES_KEY, JSON.stringify(writes))
    else sessionStorage.removeItem(PENDING_WRITES_KEY)
  } catch { /* pending data remains in memory when storage is full */ }
}
