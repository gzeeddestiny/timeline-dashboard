const API_BASE = "https://api.github.com/gists"
const RECORD_PREFIX = "magic-record-"
const LEGACY_FILES = {
  teamMembers: "magic-team.json",
  assignments: "magic-assignments.json",
  remarks: "magic-remarks.json",
  priorities: "magic-priorities.json",
}
const RESOURCES = new Set(["sheets", "teamMembers", "brands", "assignments", "remarks", "priorities", "workflow"])

function parseJson(value, fallback) {
  try { return JSON.parse(value) } catch { return fallback }
}

export async function readSharedState({ gistId, token, fetchImpl = fetch }) {
  const headers = { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" }
  const response = await fetchImpl(`${API_BASE}/${gistId}`, { headers })
  if (!response.ok) throw new Error(`Gist read failed (${response.status})`)
  const gist = await response.json()
  const state = { sheets: {}, teamMembers: [], brands: {}, assignments: {}, remarks: {}, priorities: {}, workflow: {} }
  const content = async (file) => {
    if (!file) return null
    if (!file.truncated) return file.content ?? null
    const raw = await fetchImpl(file.raw_url, { headers })
    if (!raw.ok) throw new Error(`Gist raw file failed (${raw.status})`)
    return raw.text()
  }
  for (const [resource, filename] of Object.entries(LEGACY_FILES)) {
    const value = await content(gist.files?.[filename])
    if (value) state[resource] = parseJson(value, state[resource])
  }
  for (const [filename, file] of Object.entries(gist.files || {})) {
    if (!filename.startsWith(RECORD_PREFIX)) continue
    const record = parseJson(await content(file), null)
    if (!record || !RESOURCES.has(record.resource) || typeof record.key !== "string") continue
    if (record.resource === "teamMembers" && record.key === "all") state.teamMembers = Array.isArray(record.value) ? record.value : []
    else if (record.value === null) delete state[record.resource][record.key]
    else state[record.resource][record.key] = record.value
  }
  state.sheets = Object.entries(state.sheets).map(([spreadsheetId, url]) => ({ spreadsheetId, url }))
  return state
}
