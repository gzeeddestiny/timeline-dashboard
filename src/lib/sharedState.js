const SHARED_CACHE_KEY = "magic-shared-state"

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
  for (const [key, value] of Object.entries(local || {})) {
    if (dirtyKeys.has(`${resource}:${key}`)) next[key] = value
  }
  return next
}

export function loadCachedSharedState() {
  try {
    const cached = sessionStorage.getItem(SHARED_CACHE_KEY) || localStorage.getItem(SHARED_CACHE_KEY)
    if (cached && !sessionStorage.getItem(SHARED_CACHE_KEY)) sessionStorage.setItem(SHARED_CACHE_KEY, cached)
    localStorage.removeItem(SHARED_CACHE_KEY)
    return JSON.parse(cached || "null")
  }
  catch { return null }
}

export function cacheSharedState(state) {
  sessionStorage.setItem(SHARED_CACHE_KEY, JSON.stringify(state))
}
