import { authHeaders, isSupabaseConfigured, supabase } from "./supabase"
import { taskKey } from "./sharedState"
import { fetchAllRows } from "./supabasePages"

function throwIf(error) {
  if (error) throw error
}

async function fetchSupabaseState() {
  const since = new Date()
  since.setMonth(since.getMonth() - 12)
  const [sheets, team, brands, assignments, tasks, workflow, latestRun, lastSuccess] = await Promise.all([
    fetchAllRows((from, to) => supabase.from("sheets").select("spreadsheet_id,url").eq("active", true).order("created_at").range(from, to)),
    fetchAllRows((from, to) => supabase.from("team_members").select("name,role,avatar").order("name").range(from, to)),
    fetchAllRows((from, to) => supabase.from("brands").select("tab_key,brand_name").range(from, to)),
    fetchAllRows((from, to) => supabase.from("assignments").select("brand_key,value").range(from, to)),
    fetchAllRows((from, to) => supabase.from("tasks_current").select("*").eq("active", true).range(from, to)),
    fetchAllRows((from, to) => supabase.from("task_workflow").select("task_key,status,note,priority,updated_at").range(from, to)),
    supabase.from("sync_runs").select("id,status,started_at,finished_at,task_count,invalid_row_count,issues,error").order("started_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("sync_runs").select("*").eq("status", "success").order("finished_at", { ascending: false }).limit(1).maybeSingle(),
  ])
  ;[latestRun, lastSuccess].forEach(({ error }) => throwIf(error))
  const [metricsResult, eventsResult] = await Promise.allSettled([
    fetchAllRows((from, to) => supabase.from("daily_metrics").select("*").gte("snapshot_date", since.toISOString().slice(0, 10)).order("snapshot_date").range(from, to)),
    supabase.from("task_events").select("id,resource,record_key,event_type,before_value,after_value,actor_email,created_at").order("created_at", { ascending: false }).limit(100),
  ])
  const metrics = metricsResult.status === "fulfilled" ? metricsResult.value : []
  const events = eventsResult.status === "fulfilled" ? eventsResult.value.data || [] : []

  const workflowMap = Object.fromEntries(workflow.map((row) => [row.task_key, row]))
  return {
    sheets: sheets.map((row) => ({ spreadsheetId: row.spreadsheet_id, url: row.url })),
    teamMembers: team,
    brands: Object.fromEntries(brands.map((row) => [row.tab_key, row.brand_name])),
    assignments: Object.fromEntries(assignments.map((row) => [row.brand_key, row.value || {}])),
    remarks: Object.fromEntries(Object.entries(workflowMap).filter(([, row]) => row.note).map(([key, row]) => [key, row.note])),
    priorities: Object.fromEntries(Object.entries(workflowMap).filter(([, row]) => row.priority).map(([key, row]) => [key, row.priority])),
    workflow: Object.fromEntries(Object.entries(workflowMap).map(([key, row]) => [key, row.status])),
    tasks: tasks.map((row) => ({
      taskId: row.task_id,
      spreadsheetId: row.spreadsheet_id,
      sheetGid: Number(row.sheet_gid),
      rowIndex: row.row_index,
      clientName: row.client_name,
      month: row.month || "",
      topic: row.topic,
      responsibility: row.responsibility || "",
      dueDate: row.due_date || "",
      actualSubmit: row.actual_submit || "",
      done: row.done,
    })),
    dailyMetrics: metrics,
    taskEvents: events,
    syncStatus: latestRun.data || null,
    updatedAt: lastSuccess.data?.finished_at || null,
  }
}

export async function fetchSystemState() {
  if (!isSupabaseConfigured) throw new Error("Supabase is not configured")
  return fetchSupabaseState()
}

async function workflowPatch(key, patch) {
  const response = await fetch("/api/workflow", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ key, ...patch }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || `Workflow save failed (${response.status})`)
  return data
}

export async function patchSystemState(resource, key, value) {
  if (!isSupabaseConfigured) throw new Error("Supabase is not configured")

  if (resource === "remarks") return workflowPatch(key, { note: value || "" })
  if (resource === "priorities") return workflowPatch(key, { priority: value || null })
  if (resource === "workflow") return workflowPatch(key, { status: value || "not_started" })

  if (resource === "sheets") {
    const query = value === null
      ? supabase.from("sheets").update({ active: false, updated_at: new Date().toISOString() }).eq("spreadsheet_id", key)
      : supabase.from("sheets").upsert({ spreadsheet_id: key, url: value, active: true }, { onConflict: "spreadsheet_id" })
    const { error } = await query
    throwIf(error)
  } else if (resource === "brands") {
    const query = value === null
      ? supabase.from("brands").delete().eq("tab_key", key)
      : supabase.from("brands").upsert({ tab_key: key, brand_name: value }, { onConflict: "tab_key" })
    const { error } = await query
    throwIf(error)
  } else if (resource === "assignments") {
    const response = await fetch("/api/assignment", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify({ key, ...(value || {}) }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || `Assignment save failed (${response.status})`)
    return data
  } else if (resource === "teamMembers") {
    const { error } = await supabase.rpc("replace_team_members", { members: value || [] })
    throwIf(error)
  } else {
    throw new Error(`Unsupported resource: ${resource}`)
  }

  return { resource, key, value }
}

export async function triggerSystemSync(force = false) {
  if (!isSupabaseConfigured) return null
  const response = await fetch("/api/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ force }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok && response.status !== 202) throw new Error(data.error || `Sync failed (${response.status})`)
  return data
}

export async function systemSyncStatus(runId) {
  const query = runId ? `?runId=${encodeURIComponent(runId)}` : ""
  const response = await fetch(`/api/sync${query}`, { headers: await authHeaders(), cache: "no-store" })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || `Sync status failed (${response.status})`)
  return data
}

export async function updateSystemCompletion(task, done, actualSubmit) {
  if (!isSupabaseConfigured) return null
  const response = await fetch("/api/completion", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({
      taskKey: taskKey(task),
      spreadsheetId: task.spreadsheetId,
      sheetGid: task.sheetGid,
      taskId: task.taskId,
      done,
      actualSubmit,
    }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || `Completion save failed (${response.status})`)
  return data
}

export async function listAccess() {
  const { data, error } = await supabase.from("access_list").select("email,role,member_name,active,created_at").order("email")
  throwIf(error)
  return data || []
}

export async function saveAccess(entry) {
  const row = { ...entry, email: entry.email.trim().toLowerCase() }
  const { error } = await supabase.from("access_list").upsert(row, { onConflict: "email" })
  throwIf(error)
}

export async function deleteAccess(email) {
  const { error } = await supabase.from("access_list").delete().eq("email", email)
  throwIf(error)
}

export async function renameSystemBrand(oldName, newName, tabKeys) {
  const { error } = await supabase.rpc("rename_brand", { old_name: oldName, new_name: newName, tab_keys: tabKeys })
  throwIf(error)
}

export async function listNotifications() {
  if (!isSupabaseConfigured) return []
  const { data, error } = await supabase.from("notifications").select("*").order("created_at", { ascending: false }).limit(50)
  throwIf(error)
  return data || []
}

export async function markNotificationRead(id) {
  const { error } = await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id)
  throwIf(error)
}

export async function listTaskEvents(key) {
  if (!isSupabaseConfigured || !key) return []
  const { data, error } = await supabase
    .from("task_events")
    .select("id,resource,event_type,before_value,after_value,actor_email,created_at")
    .eq("record_key", key)
    .order("created_at", { ascending: false })
    .limit(100)
  throwIf(error)
  return data || []
}
