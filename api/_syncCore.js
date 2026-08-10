import { fetchAllSheetsData } from "../src/lib/sheetsApi.js"
import { taskKey } from "../src/lib/sharedState.js"
import { fetchAllRows } from "../src/lib/supabasePages.js"
import { callAppsScript } from "./_appsScript.js"
import { addTransitionMetrics, bangkokDate, buildMetricRows } from "./_metrics.js"

const AUTO_COOLDOWN_MS = 5 * 60 * 1000
const MANUAL_COOLDOWN_MS = 60 * 1000
const STALE_RUNNING_MS = 10 * 60 * 1000

export function syncDecision(latest, force = false, now = Date.now()) {
  if (!latest) return { action: "start" }
  const lastTime = latest.finished_at || latest.started_at
  const age = lastTime ? now - new Date(lastTime).getTime() : Infinity
  const cooldown = force ? MANUAL_COOLDOWN_MS : AUTO_COOLDOWN_MS
  if (latest.status === "success" && age < cooldown) return { action: "cached" }
  if (latest.status === "running" && age < STALE_RUNNING_MS) return { action: "running" }
  if (latest.status === "running") return { action: "recover", staleRunId: latest.id }
  return { action: "start" }
}

function taskRow(task, syncedAt) {
  return {
    task_key: taskKey(task),
    task_id: task.taskId,
    spreadsheet_id: task.spreadsheetId,
    sheet_gid: task.sheetGid,
    row_index: task.rowIndex,
    client_name: task.clientName,
    month: task.month || null,
    topic: task.topic,
    responsibility: task.responsibility || "",
    due_date: task.dueDate || null,
    actual_submit: task.actualSubmit || null,
    done: Boolean(task.done),
    active: true,
    removed_at: null,
    source_synced_at: syncedAt,
  }
}

export function taskIdRepairTargets(issues) {
  const targets = new Map()
  for (const issue of issues.filter((item) => ["missing_task_id", "duplicate_task_id", "invalid_task_id"].includes(item.type))) {
    if (!targets.has(issue.spreadsheetId)) targets.set(issue.spreadsheetId, new Set())
    targets.get(issue.spreadsheetId).add(Number(issue.sheetGid))
  }
  return [...targets].map(([spreadsheetId, gids]) => ({ spreadsheetId, sheetGids: [...gids] }))
}

export async function runSync({ admin, force = false, triggerType = force ? "manual" : "client", triggeredBy = null }) {
  const startedAt = Date.now()
  let runId
  let syncIssues = []
  let repairedTaskIds = 0
  try {
    const { data: latest, error: latestError } = await admin
      .from("sync_runs")
      .select("id,status,started_at,finished_at,task_count")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (latestError) throw latestError
    const decision = syncDecision(latest, force)
    if (decision.action === "cached") {
      return { status: 200, body: { status: "cached", taskCount: latest.task_count, dataAsOf: latest.finished_at } }
    }
    if (decision.action === "running") {
      return { status: 202, body: { status: "running", runId: latest.id } }
    }
    if (decision.action === "recover") {
      const { error: recoveryError } = await admin.from("sync_runs").update({
        status: "failed",
        error: "Recovered stale running sync",
        finished_at: new Date().toISOString(),
      }).eq("id", decision.staleRunId).eq("status", "running")
      if (recoveryError) throw recoveryError
    }

    const { data: run, error: runError } = await admin.from("sync_runs").insert({
      status: "running",
      trigger_type: triggerType,
      triggered_by: triggeredBy,
    }).select("id").single()
    if (runError?.code === "23505") {
      const { data: running } = await admin.from("sync_runs").select("id").eq("status", "running").maybeSingle()
      return { status: 202, body: { status: "running", runId: running?.id || null } }
    }
    if (runError) throw runError
    runId = run.id

    const sheetRows = await fetchAllRows((from, to) => admin.from("sheets").select("spreadsheet_id,url").eq("active", true).order("spreadsheet_id").range(from, to))
    const sheets = sheetRows.map((row) => ({ spreadsheetId: row.spreadsheet_id, url: row.url }))
    const googleKey = process.env.GOOGLE_SHEETS_API_KEY
    if (!googleKey) throw new Error("Google Sheets server API key is not configured")
    const previousTasks = await fetchAllRows((from, to) => admin.from("tasks_current").select("*").eq("active", true).order("task_key").range(from, to))
    let result = sheets.length ? await fetchAllSheetsData(sheets, googleKey) : { tasks: [], issues: [] }
    syncIssues = result.issues
    const repairTargets = taskIdRepairTargets(result.issues)
    if (repairTargets.length) {
      const repair = await callAppsScript({ action: "ensure_task_ids", targets: repairTargets })
      repairedTaskIds = Number(repair.updated) || 0
      result = await fetchAllSheetsData(sheets, googleKey)
      syncIssues = result.issues
    }
    const { tasks, issues } = result
    syncIssues = issues
    const identityIssues = issues.filter((issue) => ["missing_task_id", "duplicate_task_id", "invalid_task_id", "invalid_task_id_header"].includes(issue.type))
    if (identityIssues.length) {
      throw new Error(`Sync stopped: ${identityIssues.length} Task ID issue(s) still need attention.`)
    }
    const syncedAt = new Date().toISOString()
    const rows = tasks.map((task) => taskRow(task, syncedAt))
    for (let index = 0; index < rows.length; index += 500) {
      const staged = rows.slice(index, index + 500).map((row) => ({ run_id: runId, ...row }))
      const { error } = await admin.from("sync_stage_tasks").insert(staged)
      if (error) throw error
    }

    const [workflowRows, teamRows, brandRows, assignmentRows] = await Promise.all([
      fetchAllRows((from, to) => admin.from("task_workflow").select("task_key,status").order("task_key").range(from, to)),
      fetchAllRows((from, to) => admin.from("team_members").select("name,role,avatar").order("name").range(from, to)),
      fetchAllRows((from, to) => admin.from("brands").select("tab_key,brand_name").order("tab_key").range(from, to)),
      fetchAllRows((from, to) => admin.from("assignments").select("brand_key,value").order("brand_key").range(from, to)),
    ])
    const workflow = Object.fromEntries(workflowRows.map((row) => [row.task_key, row.status]))
    const brands = Object.fromEntries(brandRows.map((row) => [row.tab_key, row.brand_name]))
    const assignments = Object.fromEntries(assignmentRows.map((row) => [row.brand_key, row.value || {}]))
    const metricTasks = tasks.map((task) => ({ ...task, taskKey: taskKey(task) }))
    let metricRows = buildMetricRows(metricTasks, workflow, teamRows, brands, assignments, runId)
    const today = bangkokDate()
    metricRows = addTransitionMetrics(metricRows, previousTasks || [], metricTasks, teamRows, brands, assignments, today)
    const { data: existingMetrics, error: existingMetricError } = await admin
      .from("daily_metrics")
      .select("dimension,dimension_key,metrics")
      .eq("snapshot_date", today)
    if (existingMetricError) throw existingMetricError
    const existingByKey = new Map((existingMetrics || []).map((row) => [`${row.dimension}:${row.dimension_key}`, row.metrics || {}]))
    metricRows = metricRows.map((row) => {
      const existing = existingByKey.get(`${row.dimension}:${row.dimension_key}`) || {}
      return { ...row, metrics: {
        ...row.metrics,
        overdueCreated: (existing.overdueCreated || 0) + (row.metrics.overdueCreated || 0),
        overdueResolved: (existing.overdueResolved || 0) + (row.metrics.overdueResolved || 0),
      } }
    })
    const finishedAt = new Date().toISOString()
    const applied = await admin.rpc("apply_sync_snapshot", {
      p_run_id: runId,
      p_synced_at: syncedAt,
      p_sheet_ids: sheets.map((sheet) => sheet.spreadsheetId),
      p_metric_rows: metricRows,
      p_issues: issues.slice(0, 100),
      p_finished_at: finishedAt,
    })
    if (applied.error) throw applied.error
    return { status: 200, body: {
      status: "success",
      runId,
      taskCount: tasks.length,
      invalidRowCount: issues.filter((issue) => issue.type !== "skipped_tab").length,
      issues: issues.slice(0, 100),
      skippedTabs: issues.filter((issue) => issue.type === "skipped_tab").length,
      repairedTaskIds,
      dataAsOf: finishedAt,
      durationMs: Date.now() - startedAt,
    } }
  } catch (error) {
    if (runId) await admin.from("sync_runs").update({
      status: "failed",
      error: error.message,
      invalid_row_count: syncIssues.filter((issue) => issue.type !== "skipped_tab").length,
      issues: syncIssues.slice(0, 100),
      finished_at: new Date().toISOString(),
    }).eq("id", runId)
    throw error
  }
}
