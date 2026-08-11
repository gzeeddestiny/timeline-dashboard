import { normalizeBrandKey } from "../src/lib/sharedState.js"
import { assignmentMemberNames, responsibilityMentions } from "../src/lib/teamConfig.js"
import { userContext, sameOrigin, send } from "./_supabase.js"

const STATUSES = new Set(["not_started", "in_progress", "waiting_client", "blocked"])

export function validateWorkflow(body) {
  if (!body || typeof body.key !== "string" || body.key.split(":").length !== 3) return "Invalid task key"
  if (body.status !== undefined && !STATUSES.has(body.status)) return "Invalid workflow status"
  if (body.note !== undefined && (typeof body.note !== "string" || body.note.length > 5000)) return "Invalid note"
  if (body.note !== undefined && (!Number.isInteger(body.expectedNoteVersion) || body.expectedNoteVersion < 0)) return "Invalid note version"
  if (body.forceNote !== undefined && typeof body.forceNote !== "boolean") return "Invalid note conflict option"
  if (body.priority !== undefined && body.priority !== null && !["normal", "high", "urgent"].includes(body.priority)) return "Invalid priority"
  if (body.status === undefined && body.note === undefined && body.priority === undefined) return "No changes supplied"
  return null
}

export function workflowRpcArgs(body, actorId) {
  return {
    p_task_key: body.key,
    p_status: body.status ?? null,
    p_has_status: body.status !== undefined,
    p_note: body.note ?? null,
    p_has_note: body.note !== undefined,
    p_priority: body.priority ?? null,
    p_has_priority: body.priority !== undefined,
    p_actor: actorId,
    p_expected_note_version: body.expectedNoteVersion ?? null,
    p_force_note: body.forceNote === true,
  }
}

export function blockedRecipients(access, assignedNames, responsibility, actorEmail) {
  const explicit = new Set((access || []).filter((entry) => entry.member_name && responsibilityMentions(responsibility, entry.member_name)).map((entry) => entry.member_name))
  const owners = explicit.size ? explicit : assignedNames
  return (access || []).filter((entry) => entry.email !== actorEmail && entry.member_name && owners.has(entry.member_name))
}

async function notifyBlocked(admin, task, actorEmail) {
  const tabKey = `${task.spreadsheet_id}:${task.sheet_gid}`
  const { data: brand, error: brandError } = await admin.from("brands").select("brand_name").eq("tab_key", tabKey).maybeSingle()
  if (brandError) throw brandError
  const brandName = brand?.brand_name || task.client_name
  const { data: assignment, error: assignmentError } = await admin.from("assignments").select("value").eq("brand_key", normalizeBrandKey(brandName)).maybeSingle()
  if (assignmentError) throw assignmentError
  const assignedNames = new Set(assignmentMemberNames(assignment?.value))
  const { data: access, error: accessError } = await admin.from("access_list").select("email,role,member_name").eq("active", true)
  if (accessError) throw accessError
  let recipients = blockedRecipients(access, assignedNames, task.responsibility, actorEmail)
  if (recipients.length === 0) recipients = (access || []).filter((entry) => entry.email !== actorEmail && ["manager", "admin"].includes(entry.role))
  if (recipients.length === 0) return

  const message = `${brandName}: ${task.topic} ถูกเปลี่ยนเป็น Blocked`
  const result = await admin.from("notifications").insert(recipients.map((entry) => ({ recipient_email: entry.email, type: "blocked", task_key: task.task_key, message })))
  if (result.error) throw result.error
}

export default async function handler(request, response) {
  if (request.method !== "PATCH") return send(response, 405, { error: "Method not allowed" })
  if (!sameOrigin(request)) return send(response, 403, { error: "Cross-origin write blocked" })
  try {
    const context = await userContext(request)
    if (context.error) return send(response, context.status, { error: context.error })
    const body = typeof request.body === "string" ? JSON.parse(request.body) : request.body
    const validationError = validateWorkflow(body)
    if (validationError) return send(response, 400, { error: validationError })

    const { admin, user, access } = context
    const { data: task, error: taskError } = await admin.from("tasks_current").select("*").eq("task_key", body.key).maybeSingle()
    if (taskError) throw taskError
    if (!task) return send(response, 404, { error: "Task not found" })
    if (!task.active) return send(response, 409, { error: "Task unavailable" })
    const { data: existing, error: existingError } = await admin.from("task_workflow").select("status,note,note_version,updated_at").eq("task_key", body.key).maybeSingle()
    if (existingError) throw existingError
    if (body.note !== undefined && !body.forceNote && body.expectedNoteVersion !== (existing?.note_version || 0)) {
      return send(response, 409, { error: "Note changed since it was opened", currentNote: existing?.note || "", noteVersion: existing?.note_version || 0, updatedAt: existing?.updated_at || null })
    }

    const { data, error } = await admin.rpc("patch_task_workflow", workflowRpcArgs(body, user.id))
    if (error) throw error
    const saved = Array.isArray(data) ? data[0] : data
    let warning = null
    if (body.status === "blocked" && existing?.status !== "blocked") {
      try { await notifyBlocked(admin, task, access.email) }
      catch (notifyError) { console.error("[workflow:notify]", notifyError); warning = "Workflow saved but notification could not be queued" }
    }
    return send(response, 200, warning ? { ...saved, noteVersion: saved.note_version, warning } : { ...saved, noteVersion: saved.note_version })
  } catch (error) {
    if (error.code === "40001" || error.message?.includes("NOTE_CONFLICT")) {
      const body = typeof request.body === "string" ? JSON.parse(request.body) : request.body
      const context = await userContext(request)
      const current = context.error ? null : await context.admin.from("task_workflow").select("note,note_version,updated_at").eq("task_key", body?.key).maybeSingle()
      return send(response, 409, { error: "Note changed since it was opened", currentNote: current?.data?.note || "", noteVersion: current?.data?.note_version || 0, updatedAt: current?.data?.updated_at || null })
    }
    console.error("[workflow]", error)
    return send(response, 502, { error: error.message || "Workflow save failed" })
  }
}
