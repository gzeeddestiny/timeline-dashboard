import { userContext, sameOrigin, send } from "./_supabase.js"
import { callAppsScript } from "./_appsScript.js"
import { validIsoDate } from "../src/lib/dates.js"

export function validateCompletion(body) {
  if (!body || typeof body.taskKey !== "string" || !/^[^:]+:\d+:[^:]+$/.test(body.taskKey)) return "Invalid task key"
  if (typeof body.spreadsheetId !== "string" || !body.spreadsheetId.trim() || body.spreadsheetId.length > 200) return "Invalid sheet target"
  if (!Number.isInteger(body.sheetGid) || typeof body.taskId !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(body.taskId)) return "Invalid sheet target"
  if (typeof body.done !== "boolean") return "Invalid completion payload"
  if (body.actualSubmit !== undefined && body.actualSubmit !== null && !validIsoDate(body.actualSubmit)) return "Invalid completion date"
  return null
}

export default async function handler(request, response) {
  if (request.method !== "POST") return send(response, 405, { error: "Method not allowed" })
  if (!sameOrigin(request)) return send(response, 403, { error: "Cross-origin write blocked" })
  try {
    const context = await userContext(request)
    if (context.error) return send(response, context.status, { error: context.error })
    const body = typeof request.body === "string" ? JSON.parse(request.body) : request.body
    const validationError = validateCompletion(body)
    if (validationError) return send(response, 400, { error: validationError })
    const { admin, user } = context
    const { data: before, error: beforeError } = await admin.from("tasks_current").select("*").eq("task_key", body.taskKey).maybeSingle()
    if (beforeError) throw beforeError
    if (!before) return send(response, 404, { error: "Task not found" })
    if (!before.active) return send(response, 409, { error: "Task unavailable" })
    if (before.spreadsheet_id !== body.spreadsheetId || Number(before.sheet_gid) !== body.sheetGid || before.task_id !== body.taskId) {
      return send(response, 409, { error: "Task target does not match the current snapshot" })
    }
    const result = await callAppsScript({
      action: "set_completion",
      actorEmail: user.email,
      spreadsheetId: body.spreadsheetId,
      sheetGid: body.sheetGid,
      taskId: body.taskId,
      done: body.done,
      actualSubmit: body.actualSubmit || null,
    })

    try {
      const savedAt = result.occurredAt || new Date().toISOString()
      const { error } = await admin.rpc("finalize_completion", {
        p_task_key: body.taskKey,
        p_row_index: result.rowIndex || before.row_index,
        p_done: body.done,
        p_actual_submit: body.actualSubmit || null,
        p_actor: user.id,
        p_actor_email: user.email,
        p_synced_at: savedAt,
      })
      if (error) throw error
      return send(response, 200, { success: true, done: body.done, actualSubmit: body.actualSubmit || null })
    } catch (snapshotError) {
      console.error("[completion:snapshot]", snapshotError)
      return send(response, 202, { success: true, snapshotPending: true, warning: "Google Sheet saved; dashboard snapshot will converge on the next sync" })
    }
  } catch (error) {
    console.error("[completion]", error)
    return send(response, 502, { error: error.message || "Completion save failed" })
  }
}
