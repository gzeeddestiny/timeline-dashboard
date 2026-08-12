import { createClient } from "@supabase/supabase-js"
import { createHash } from "node:crypto"
import { readSharedState } from "./gist-state.mjs"
import { fetchAllRows } from "../src/lib/supabasePages.js"

const { SUPABASE_URL, SUPABASE_SECRET_KEY, GIST_ID, GITHUB_TOKEN } = process.env
if (!SUPABASE_URL || !SUPABASE_SECRET_KEY || !GIST_ID || !GITHUB_TOKEN) {
  throw new Error("Set SUPABASE_URL, SUPABASE_SECRET_KEY, GIST_ID and GITHUB_TOKEN")
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, { auth: { persistSession: false } })
const legacy = await readSharedState({ gistId: GIST_ID, token: GITHUB_TOKEN })

async function insertMissing(table, rows, onConflict) {
  if (!rows.length) return
  const { error } = await supabase.from(table).upsert(rows, { onConflict, ignoreDuplicates: true })
  if (error) throw error
}

await insertMissing("sheets", legacy.sheets.map((sheet) => ({ spreadsheet_id: sheet.spreadsheetId, url: sheet.url })), "spreadsheet_id")
async function migrateAvatar(value) {
  if (!value?.startsWith("data:image/")) return value || ""
  const match = value.match(/^data:image\/(jpeg|png|webp);base64,(.+)$/)
  if (!match) return ""
  const bytes = Buffer.from(match[2], "base64")
  if (bytes.length > 2_097_152) throw new Error("Legacy avatar exceeds 2 MB")
  const extension = match[1] === "jpeg" ? "jpg" : match[1]
  const path = `legacy-${createHash("sha256").update(bytes).digest("hex")}.${extension}`
  const uploaded = await supabase.storage.from("team-avatars").upload(path, bytes, { contentType: `image/${match[1]}`, upsert: true })
  if (uploaded.error) throw uploaded.error
  return supabase.storage.from("team-avatars").getPublicUrl(path).data.publicUrl
}

const migratedTeam = []
for (const member of legacy.teamMembers) migratedTeam.push({ name: member.name, role: member.role || "creative", avatar: await migrateAvatar(member.avatar) })
await insertMissing("team_members", migratedTeam, "name")
await insertMissing("brands", Object.entries(legacy.brands).map(([tab_key, brand_name]) => ({ tab_key, brand_name })), "tab_key")
await insertMissing("assignments", Object.entries(legacy.assignments).map(([brand_key, value]) => ({ brand_key, value })), "brand_key")

const tasks = await fetchAllRows((from, to) => supabase.from("tasks_current").select("task_key,spreadsheet_id,sheet_gid,row_index").order("task_key").range(from, to))
const taskKeys = new Set(tasks.map((row) => row.task_key))
const legacyToStable = new Map(tasks.map((row) => [`${row.spreadsheet_id}:${row.sheet_gid}:${row.row_index}`, row.task_key]))
await insertMissing("task_aliases", [...legacyToStable].map(([legacy_task_key, task_key]) => ({ legacy_task_key, task_key })), "legacy_task_key")
const workflowKeys = new Set([...Object.keys(legacy.remarks), ...Object.keys(legacy.priorities)])
const resolvedKey = (key) => taskKeys.has(key) ? key : legacyToStable.get(key)
const normalizedPriority = (value) => value === "fire" ? "urgent" : value === "think" ? "high" : ["normal", "high", "urgent"].includes(value) ? value : null
const workflowRows = [...workflowKeys].filter((key) => resolvedKey(key)).map((legacyKey) => ({
  task_key: resolvedKey(legacyKey),
  note: legacy.remarks[legacyKey] || "",
  priority: normalizedPriority(legacy.priorities[legacyKey]),
  status: "not_started",
}))
await insertMissing("task_workflow", workflowRows, "task_key")

const skipped = [...workflowKeys].filter((key) => !resolvedKey(key))
async function tableCount(table) {
  const { count, error } = await supabase.from(table).select("*", { count: "exact", head: true })
  if (error) throw error
  return count || 0
}

const sourceCounts = {
  sheets: legacy.sheets.length,
  team: legacy.teamMembers.length,
  brands: Object.keys(legacy.brands).length,
  assignments: Object.keys(legacy.assignments).length,
  remarks: Object.keys(legacy.remarks).length,
  priorities: Object.keys(legacy.priorities).length,
  workflow: workflowRows.length,
}
const databaseCounts = {
  sheets: await tableCount("sheets"),
  team: await tableCount("team_members"),
  brands: await tableCount("brands"),
  assignments: await tableCount("assignments"),
  workflow: await tableCount("task_workflow"),
}
const countMismatch = ["sheets", "team", "brands", "assignments", "workflow"]
  .filter((key) => databaseCounts[key] < sourceCounts[key])

const canonical = (value) => Array.isArray(value)
  ? value.map(canonical)
  : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
    : value
const checksum = (value) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex")
const [databaseSheets, databaseTeam, databaseBrands, databaseAssignments, databaseWorkflow] = await Promise.all([
  fetchAllRows((from, to) => supabase.from("sheets").select("spreadsheet_id,url").order("spreadsheet_id").range(from, to)),
  fetchAllRows((from, to) => supabase.from("team_members").select("name,role,avatar").order("name").range(from, to)),
  fetchAllRows((from, to) => supabase.from("brands").select("tab_key,brand_name").order("tab_key").range(from, to)),
  fetchAllRows((from, to) => supabase.from("assignments").select("brand_key,value").order("brand_key").range(from, to)),
  fetchAllRows((from, to) => supabase.from("task_workflow").select("task_key,note,priority,status").order("task_key").range(from, to)),
])
const expected = {
  sheets: legacy.sheets.map((sheet) => ({ spreadsheet_id: sheet.spreadsheetId, url: sheet.url })).sort((a, b) => a.spreadsheet_id.localeCompare(b.spreadsheet_id)),
  team: migratedTeam.toSorted((a, b) => a.name.localeCompare(b.name)),
  brands: Object.entries(legacy.brands).map(([tab_key, brand_name]) => ({ tab_key, brand_name })).sort((a, b) => a.tab_key.localeCompare(b.tab_key)),
  assignments: Object.entries(legacy.assignments).map(([brand_key, value]) => ({ brand_key, value })).sort((a, b) => a.brand_key.localeCompare(b.brand_key)),
  workflow: workflowRows.toSorted((a, b) => a.task_key.localeCompare(b.task_key)),
}
const database = {
  sheets: databaseSheets.filter((row) => expected.sheets.some((item) => item.spreadsheet_id === row.spreadsheet_id)),
  team: databaseTeam.filter((row) => expected.team.some((item) => item.name === row.name)),
  brands: databaseBrands.filter((row) => expected.brands.some((item) => item.tab_key === row.tab_key)),
  assignments: databaseAssignments.filter((row) => expected.assignments.some((item) => item.brand_key === row.brand_key)),
  workflow: databaseWorkflow.filter((row) => expected.workflow.some((item) => item.task_key === row.task_key)),
}
const valueMismatch = Object.keys(expected).filter((key) => checksum(expected[key]) !== checksum(database[key]))
const checksums = Object.fromEntries(Object.keys(expected).map((key) => [key, { source: checksum(expected[key]), database: checksum(database[key]) }]))
console.log(JSON.stringify({ sourceCounts, databaseCounts, skippedWorkflow: skipped.length, countMismatch, valueMismatch, checksums }, null, 2))
if (skipped.length) {
  console.warn("Some legacy notes/priorities did not match tasks_current. Run a successful sync, then rerun this idempotent migration.")
  process.exitCode = 1
}
if (countMismatch.length) {
  console.error(`Migration reconciliation failed: ${countMismatch.join(", ")}`)
  process.exitCode = 1
}
if (valueMismatch.length) {
  console.error(`Migration value reconciliation failed: ${valueMismatch.join(", ")}`)
  process.exitCode = 1
}
