import { createClient } from "@supabase/supabase-js"
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
await insertMissing("team_members", legacy.teamMembers.map((member) => ({ name: member.name, role: member.role || "creative", avatar: member.avatar || "" })), "name")
await insertMissing("brands", Object.entries(legacy.brands).map(([tab_key, brand_name]) => ({ tab_key, brand_name })), "tab_key")
await insertMissing("assignments", Object.entries(legacy.assignments).map(([brand_key, value]) => ({ brand_key, value })), "brand_key")

const tasks = await fetchAllRows((from, to) => supabase.from("tasks_current").select("task_key,spreadsheet_id,sheet_gid,row_index").range(from, to))
const taskKeys = new Set(tasks.map((row) => row.task_key))
const legacyToStable = new Map(tasks.map((row) => [`${row.spreadsheet_id}:${row.sheet_gid}:${row.row_index}`, row.task_key]))
await insertMissing("task_aliases", [...legacyToStable].map(([legacy_task_key, task_key]) => ({ legacy_task_key, task_key })), "legacy_task_key")
const workflowKeys = new Set([...Object.keys(legacy.remarks), ...Object.keys(legacy.priorities)])
const resolvedKey = (key) => taskKeys.has(key) ? key : legacyToStable.get(key)
const workflowRows = [...workflowKeys].filter((key) => resolvedKey(key)).map((legacyKey) => ({
  task_key: resolvedKey(legacyKey),
  note: legacy.remarks[legacyKey] || "",
  priority: legacy.priorities[legacyKey] || null,
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
console.log(JSON.stringify({ sourceCounts, databaseCounts, skippedWorkflow: skipped.length, countMismatch }, null, 2))
if (skipped.length) {
  console.warn("Some legacy notes/priorities did not match tasks_current. Run a successful sync, then rerun this idempotent migration.")
  process.exitCode = 1
}
if (countMismatch.length) {
  console.error(`Migration reconciliation failed: ${countMismatch.join(", ")}`)
  process.exitCode = 1
}
