import { blockedRead, missingSchema } from "./readPolicy.js"
import { authHeaders, isSupabaseConfigured, supabase } from "./supabase"
import { taskKey } from "./sharedState"
import { fetchAllRows } from "./supabasePages"
import { validateAvatarBlob } from "./teamAvatar"

function throwIf(error) {
  if (!error) return
  if (typeof error.message === "string") {
    error.message = error.message.replace(/workstreams/gi, "Projects").replace(/workstream/gi, "Project")
  }
  throw error
}

async function fetchOptionalRows(factory) {
  try {
    return await fetchAllRows(factory)
  } catch (error) {
    if (blockedRead(error) && !missingSchema(error)) throw error
    // Brand timeline tables are additive. Keeping an empty snapshot lets an
    // older database continue serving tasks while the migration is rolling out.
    return []
  }
}

async function fetchOptionalRowsWithFallback(primary, fallback) {
  try {
    return await fetchAllRows(primary)
  } catch (error) {
    if (blockedRead(error) && !missingSchema(error)) throw error
    return fetchOptionalRows(fallback)
  }
}

async function fetchSupabaseState({ structureOnly = false, previous = {} } = {}) {
  const [sheets, team, brands, assignments, tasks, workflow, latestRun, lastSuccess, brandCatalog, projectRows, projectSourceRows, contractRounds, milestoneOverrides] = await Promise.all([
    fetchAllRows((from, to) => supabase.from("sheets").select("spreadsheet_id,url").eq("active", true).order("created_at").order("spreadsheet_id").range(from, to)),
    fetchAllRows((from, to) => supabase.from("team_members").select("name,role,avatar").order("name").range(from, to)),
    fetchAllRows((from, to) => supabase.from("brands").select("tab_key,brand_name").order("tab_key").range(from, to)),
    fetchAllRows((from, to) => supabase.from("assignments").select("brand_key,value").order("brand_key").range(from, to)),
    structureOnly ? [] : fetchAllRows((from, to) => supabase.from("tasks_current").select("task_key,task_id,spreadsheet_id,sheet_gid,row_index,client_name,month,topic,responsibility,due_date,actual_submit,source_dates,done").eq("active", true).order("task_key").range(from, to)),
    structureOnly ? [] : fetchAllRows((from, to) => supabase.from("task_workflow").select("task_key,status,note,priority,next_action,note_version,updated_at").order("task_key").range(from, to)),
    structureOnly ? { data: previous.syncStatus || null } : supabase.from("sync_runs").select("id,status,started_at,finished_at,task_count,invalid_row_count,issues,error").order("started_at", { ascending: false }).limit(1).maybeSingle(),
    structureOnly ? { data: { finished_at: previous.updatedAt } } : supabase.from("sync_runs").select("finished_at").eq("status", "success").order("finished_at", { ascending: false }).limit(1).maybeSingle(),
    fetchOptionalRows((from, to) => supabase.from("brand_catalog").select("id,brand_key,brand_name,active,updated_at").order("brand_name").range(from, to)),
    fetchOptionalRowsWithFallback(
      (from, to) => supabase.from("brand_workstreams").select("id,brand_id,brand_key,brand_name,contract_id,name,workstream_type,owner_member,assignment,start_date,end_date,active,updated_at").order("brand_name").order("name").range(from, to),
      (from, to) => supabase.from("brand_workstreams").select("id,brand_key,brand_name,name,workstream_type,owner_member,active,updated_at").order("brand_name").order("name").range(from, to),
    ),
    fetchOptionalRows((from, to) => supabase.from("brand_workstream_sources").select("workstream_id,tab_key").order("tab_key").range(from, to)),
    fetchOptionalRowsWithFallback(
      (from, to) => supabase.from("contract_rounds").select("id,workstream_id,brand_id,name,contract_type,start_date,end_date,term_months,renewal_status,notes,document_url,status,closed_at,updated_at").order("end_date").range(from, to),
      (from, to) => supabase.from("contract_rounds").select("id,workstream_id,start_date,end_date,term_months,notes,document_url,status,closed_at,updated_at").order("end_date").range(from, to),
    ),
    fetchOptionalRows((from, to) => supabase.from("milestone_overrides").select("task_key,milestone_type,updated_at").order("task_key").range(from, to)),
  ])
  ;[latestRun, lastSuccess].forEach(({ error }) => throwIf(error))
  const workflowMap = Object.fromEntries(workflow.map((row) => [row.task_key, row]))
  const sourcesByProject = projectSourceRows.reduce((groups, row) => {
    if (!groups[row.workstream_id]) groups[row.workstream_id] = []
    groups[row.workstream_id].push(row.tab_key)
    return groups
  }, {})
  const snapshot = {
    sheets: sheets.map((row) => ({ spreadsheetId: row.spreadsheet_id, url: row.url })),
    teamMembers: team,
    brands: Object.fromEntries(brands.map((row) => [row.tab_key, row.brand_name])),
    brandCatalog: brandCatalog.map((row) => ({
      id: row.id,
      key: row.brand_key,
      name: row.brand_name,
      active: row.active !== false,
      updatedAt: row.updated_at || null,
    })),
    assignments: Object.fromEntries(assignments.map((row) => [row.brand_key, row.value || {}])),
    remarks: Object.fromEntries(Object.entries(workflowMap).filter(([, row]) => row.note).map(([key, row]) => [key, row.note])),
    noteVersions: Object.fromEntries(Object.entries(workflowMap).map(([key, row]) => [key, row.note_version || 0])),
    priorities: Object.fromEntries(Object.entries(workflowMap).filter(([, row]) => row.priority).map(([key, row]) => [key, row.priority])),
    nextActions: Object.fromEntries(Object.entries(workflowMap).filter(([, row]) => row.next_action).map(([key, row]) => [key, row.next_action])),
    workflow: Object.fromEntries(Object.entries(workflowMap).map(([key, row]) => [key, row.status])),
    brandProjects: projectRows.map((row) => ({
      id: row.id,
      brandId: row.brand_id || null,
      brandKey: row.brand_key,
      brandName: row.brand_name,
      name: row.name,
      type: row.workstream_type,
      ownerMember: row.owner_member || "",
      assignment: row.assignment && typeof row.assignment === "object" ? row.assignment : {},
      contractId: row.contract_id || null,
      startDate: row.start_date || "",
      endDate: row.end_date || "",
      sourceTabKey: (sourcesByProject[row.id] || [])[0] || "",
      sourceTabKeys: sourcesByProject[row.id] || [],
      active: row.active !== false,
    })),
    brandContracts: contractRounds.map((row) => ({
      id: row.id,
      brandId: row.brand_id || projectRows.find((project) => project.id === row.workstream_id)?.brand_id || null,
      projectId: row.workstream_id,
      name: row.name || "Contract",
      type: row.contract_type || (projectRows.find((project) => project.id === row.workstream_id)?.workstream_type === "always_on" ? "always_on" : "one_time"),
      startDate: row.start_date,
      endDate: row.end_date,
      termMonths: row.term_months,
      renewalStatus: row.renewal_status || "not_contacted",
      notes: row.notes || "",
      documentUrl: row.document_url || "",
      status: row.status || "open",
      closedAt: row.closed_at || null,
    })),
    milestoneOverrides: Object.fromEntries(milestoneOverrides.map((row) => [row.task_key, row.milestone_type])),
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
      sourceDates: row.source_dates || {},
      done: row.done,
    })),
    syncStatus: latestRun.data || null,
    updatedAt: lastSuccess.data?.finished_at || null,
  };
  if (structureOnly) for (const name of ['tasks','remarks','noteVersions','priorities','nextActions','workflow']) snapshot[name] = previous[name];
  return snapshot;
}

export async function fetchSystemState(options) {
  if (!isSupabaseConfigured) throw new Error("Supabase is not configured")
  return fetchSupabaseState(options)
}

export async function fetchSystemAnalytics({ overallOnly = false } = {}) {
  if (overallOnly) {
    const { data, error } = await supabase.from("daily_metrics").select("snapshot_date,dimension,dimension_key,metrics").eq("dimension", "overall").eq("dimension_key", "all").order("snapshot_date", { ascending: false }).limit(30);
    throwIf(error);
    return { dailyMetrics: (data || []).reverse(), taskEvents: [] };
  }
  if (!isSupabaseConfigured) throw new Error("Supabase is not configured")
  const since = new Date()
  since.setMonth(since.getMonth() - 12)
  const [dailyMetrics, events] = await Promise.all([
    fetchAllRows((from, to) => supabase.from("daily_metrics").select("*").gte("snapshot_date", since.toISOString().slice(0, 10)).order("snapshot_date").order("dimension").order("dimension_key").range(from, to)),
    supabase.from("task_events").select("id,resource,record_key,event_type,before_value,after_value,actor_email,created_at").order("created_at", { ascending: false }).order("id", { ascending: false }).limit(100),
  ])
  throwIf(events.error)
  return { dailyMetrics, taskEvents: events.data || [] }
}

async function taskTabsRequest(body) {
  const response = await fetch("/api/task-tabs", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(body),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || `Task tab request failed (${response.status})`)
  return data
}

export function inspectTaskTabs(spreadsheetId) {
  return taskTabsRequest({ action: "inspect", spreadsheetId })
}

export function provisionTaskTabs(spreadsheetId, sheetGids) {
  return taskTabsRequest({ action: "provision", spreadsheetId, sheetGids })
}

async function workflowPatch(key, patch) {
  const response = await fetch("/api/workflow", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ key, ...patch }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(data.error || `Workflow save failed (${response.status})`)
    error.status = response.status
    error.data = data
    throw error
  }
  return data
}

export async function patchSystemState(resource, key, value, options = {}) {
  if (!isSupabaseConfigured) throw new Error("Supabase is not configured")

  if (resource === "remarks") return workflowPatch(key, {
    note: value || "",
    expectedNoteVersion: options.expectedNoteVersion ?? 0,
    forceNote: options.forceNote === true,
  })
  if (resource === "priorities") return workflowPatch(key, { priority: value || null })
  if (resource === "workflow") return workflowPatch(key, { status: value || "not_started", ...(options.nextAction !== undefined ? { nextAction: options.nextAction } : {}) })
  if (resource === "nextActions") return workflowPatch(key, { nextAction: value || "" })

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
  } else if (resource === "projectAssignments") {
    return saveBrandProjectAssignment(key, value || {})
  } else if (resource === "teamMembers") {
    const { error } = await supabase.rpc("replace_team_members", { members: value || [] })
    throwIf(error)
  } else {
    throw new Error(`Unsupported resource: ${resource}`)
  }

  return { resource, key, value }
}

export async function uploadTeamAvatar(blob) {
  validateAvatarBlob(blob)
  const extension = blob.type.split("/")[1].replace("jpeg", "jpg")
  const path = `${crypto.randomUUID()}.${extension}`
  const uploaded = await supabase.storage.from("team-avatars").upload(path, blob, { contentType: blob.type, upsert: false })
  throwIf(uploaded.error)
  const verified = await supabase.storage.from("team-avatars").download(path)
  if (verified.error || !verified.data || verified.data.size !== blob.size) {
    await supabase.storage.from("team-avatars").remove([path]).catch(() => {})
    throw new Error(verified.error?.message || "ตรวจสอบไฟล์รูปที่อัปโหลดไม่สำเร็จ")
  }
  return supabase.storage.from("team-avatars").getPublicUrl(path).data.publicUrl
}

export async function saveTeamAvatar(memberName, avatar) {
  const response = await fetch("/api/team-avatar", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ memberName, avatar: avatar || "" }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || `Profile image save failed (${response.status})`)
  if (!data.member || data.member.avatar !== (avatar || "")) throw new Error("บันทึกรูปแล้ว แต่ตรวจสอบข้อมูลที่อ่านกลับไม่สำเร็จ")
  return data.member
}

export async function deleteTeamAvatar(url) {
  const marker = "/storage/v1/object/public/team-avatars/"
  const path = String(url || "").split(marker)[1]
  if (!path) return
  const { error } = await supabase.storage.from("team-avatars").remove([decodeURIComponent(path)])
  throwIf(error)
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

export async function listPendingGoogleAccounts() {
  const response = await fetch("/api/access-accounts", { headers: await authHeaders(), cache: "no-store" })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || `Google account lookup failed (${response.status})`)
  return data.accounts || []
}

export async function saveAccess(entry) {
  const { data, error } = await supabase.rpc("save_access_with_member", {
    p_email: entry.email,
    p_access_role: entry.role,
    p_member_name: entry.member_name || null,
    p_team_role: entry.team_role || null,
    p_active: entry.active !== false,
  })
  throwIf(error)
  return data
}

export async function deleteAccess(email) {
  const { error } = await supabase.from("access_list").delete().eq("email", email)
  throwIf(error)
}

export async function renameAccessEmail(oldEmail, newEmail) {
  const { data, error } = await supabase.rpc("rename_access_email", {
    p_old_email: oldEmail,
    p_new_email: newEmail,
  })
  throwIf(error)
  return data
}

export async function renameSystemBrand(oldName, newName, tabKeys) {
  const { error } = await supabase.rpc("rename_brand", { old_name: oldName, new_name: newName, tab_keys: tabKeys })
  throwIf(error)
}

export async function saveBrandProject(payload) {
  if (!isSupabaseConfigured) throw new Error("Supabase is not configured")
  const { data, error } = await supabase.rpc("upsert_brand_project", {
    p_brand_id: payload.brandId,
    p_contract_id: payload.contractId || null,
    p_name: payload.name,
    p_start_date: payload.startDate || null,
    p_end_date: payload.endDate || null,
    p_assignment: payload.assignment || {},
    p_source_tab_key: payload.sourceTabKey || payload.sourceTabKeys?.[0] || "",
    p_id: payload.id || null,
  })
  throwIf(error)
  return data
}

export async function saveBrandContract(payload) {
  if (!isSupabaseConfigured) throw new Error("Supabase is not configured")
  const { data, error } = await supabase.rpc("upsert_brand_contract", {
    p_brand_id: payload.brandId,
    p_name: payload.name,
    p_contract_type: payload.type,
    p_start_date: payload.startDate,
    p_end_date: payload.endDate,
    p_term_months: payload.termMonths || null,
    p_renewal_status: payload.renewalStatus || "not_contacted",
    p_notes: payload.notes || "",
    p_document_url: payload.documentUrl || null,
    p_id: payload.id || null,
  })
  throwIf(error)
  return data
}

export async function saveBrandCatalog(payload) {
  if (!isSupabaseConfigured) throw new Error("Supabase is not configured")
  const { data, error } = await supabase.rpc("save_brand_catalog", {
    p_name: payload.name,
    p_id: payload.id || null,
  })
  throwIf(error)
  return data
}

export async function setBrandCatalogActive(id, active) {
  if (!isSupabaseConfigured) throw new Error("Supabase is not configured")
  const { error } = await supabase.rpc("set_brand_catalog_active", { p_id: id, p_active: active })
  throwIf(error)
  return true
}

export async function assignTabsToBrand(brandId, tabKeys) {
  if (!isSupabaseConfigured) throw new Error("Supabase is not configured")
  const { error } = await supabase.rpc("assign_tabs_to_brand", { p_brand_id: brandId, p_tab_keys: tabKeys })
  throwIf(error)
  return true
}

export async function setBrandProjectActive(id, active) {
  if (!isSupabaseConfigured) throw new Error("Supabase is not configured")
  const { error } = await supabase.rpc("set_brand_project_active", { p_id: id, p_active: active })
  throwIf(error)
  return true
}

export async function saveBrandProjectAssignment(projectId, assignment) {
  if (!isSupabaseConfigured) throw new Error("Supabase is not configured")
  const { error } = await supabase.rpc("save_brand_project_assignment", { p_project_id: projectId, p_assignment: assignment || {} })
  throwIf(error)
  return true
}

export async function setBrandContractStatus(id, status) {
  if (!isSupabaseConfigured) throw new Error("Supabase is not configured")
  const { error } = await supabase.rpc("set_brand_contract_status", { p_id: id, p_status: status })
  throwIf(error)
  return true
}

export async function setBrandContractRenewalStatus(id, status) {
  if (!isSupabaseConfigured) throw new Error("Supabase is not configured")
  const { error } = await supabase.rpc("set_brand_contract_renewal_status", { p_id: id, p_status: status })
  throwIf(error)
  return true
}

export async function saveMilestoneOverride(taskKeyValue, milestoneType) {
  if (!isSupabaseConfigured) throw new Error("Supabase is not configured")
  const { error } = await supabase.rpc("save_milestone_override", { p_task_key: taskKeyValue, p_milestone_type: milestoneType })
  throwIf(error)
  return true
}

export async function listNotifications() {
  if (!isSupabaseConfigured) return []
  const { data, error, status } = await supabase.from("notifications").select("id,task_key,contract_id,type,payload,message,read_at,created_at").order("created_at", { ascending: false }).limit(50)
  throwIf(error && Object.assign(error,{status}))
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

async function notificationRequest(action, { method = "GET", body } = {}) {
  const response = await fetch(`/api/notifications?action=${encodeURIComponent(action)}`, {
    method,
    headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(await authHeaders()) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    cache: "no-store",
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(data.error || `Notification request failed (${response.status})`)
    error.status = response.status
    error.data = data
    throw error
  }
  return data
}

export const fetchNotificationSettings = () => notificationRequest("settings")
export const fetchNotificationHistory = () => notificationRequest("history")
export const fetchFollowUp = () => notificationRequest("follow-up")
export const fetchManualNotificationOptions = () => notificationRequest("manual-options")
export const saveNotificationSettings = (body) => notificationRequest("settings", { method: "PUT", body })
export const previewNotificationTemplate = (body) => notificationRequest("preview", { method: "POST", body })
export const sendNotificationTestEmail = (body) => notificationRequest("test-email", { method: "POST", body })
export const previewManualNotification = (body) => notificationRequest("manual-preview", { method: "POST", body })
export const sendManualNotification = (body) => notificationRequest("manual", { method: "POST", body })
export const snoozeTaskNotification = (body) => notificationRequest("snooze", { method: "POST", body })

export async function fetchActionHistory(filters = {}) {
  const params = new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== '' && value !== null && value !== undefined))
  const response = await fetch(`/api/activity?${params}`, { headers: await authHeaders(), cache: 'no-store' })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || 'โหลดประวัติไม่สำเร็จ')
  return result
}

export async function setupActivityTracking(index = 0) {
  const response = await fetch(`/api/activity?action=setup&index=${index}`, { method: 'POST', headers: await authHeaders() })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || 'เปิดรับเหตุการณ์ไม่สำเร็จ')
  window.dispatchEvent(new Event('timeline:activity'))
  return result
}
