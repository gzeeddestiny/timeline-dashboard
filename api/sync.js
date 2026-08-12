import { runSync, syncDecision } from "./_syncCore.js"
import { userContext, sameOrigin, send } from "./_supabase.js"

export { syncDecision }
export const config = { maxDuration: 60 }

export default async function handler(request, response) {
  if (!["GET", "POST"].includes(request.method)) return send(response, 405, { error: "Method not allowed" })
  if (request.method === "POST" && !sameOrigin(request)) return send(response, 403, { error: "Cross-origin write blocked" })
  try {
    const context = await userContext(request)
    if (context.error) return send(response, context.status, { error: context.error })
    if (request.method === "GET") {
      let query = context.admin.from("sync_runs").select("id,status,started_at,finished_at,task_count,invalid_row_count,issues,error")
      query = request.query?.runId
        ? query.eq("id", request.query.runId).maybeSingle()
        : query.order("started_at", { ascending: false }).limit(1).maybeSingle()
      const { data, error } = await query
      if (error) throw error
      return send(response, 200, data || { status: "idle" })
    }
    const body = typeof request.body === "string" ? JSON.parse(request.body) : request.body || {}
    if (body.force !== undefined && typeof body.force !== "boolean") return send(response, 400, { error: "Invalid force value" })
    const result = await runSync({
      admin: context.admin,
      force: Boolean(body.force),
      triggerType: body.force ? "manual" : "client",
      triggeredBy: context.user.id,
    })
    return send(response, result.status, result.body)
  } catch (error) {
    console.error("[sync]", error)
    return send(response, 502, { error: error.message || "Sync failed" })
  }
}
