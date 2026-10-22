import { userContext, sameOrigin, send } from "./_supabase.js"
import { assignmentRoleMembers } from "../src/lib/teamConfig.js"

const ROLES = new Set(["creative", "graphic_editor", "cameraman", "ae", "media_planner", "media", "ads_optimizer", "pm"])

export function validateAssignmentPatch(body) {
  const key = typeof body?.key === "string" ? body.key.trim() : ""
  if (!key || key.length > 200) return "Invalid assignment key"
  if (body.clear === true) return null
  if (!ROLES.has(body.role)) return "Invalid assignment role"
  if (!Array.isArray(body.members) || body.members.length > 100) return "Invalid assignment members"
  if (body.members.some((member) => typeof member !== "string" || !member.trim() || member.length > 100)) return "Invalid assignment member"
  if (new Set(body.members.map((member) => member.trim().toLocaleLowerCase())).size !== body.members.length) return "Duplicate assignment member"
  return null
}

export function assignmentRpcArgs(body, actorId) {
  return {
    p_brand_key: body.key.trim(),
    p_role: body.clear === true ? null : body.role,
    p_members: body.clear === true ? [] : body.members.map((member) => member.trim()),
    p_clear: body.clear === true,
    p_actor: actorId,
  }
}

export default async function handler(request, response) {
  if (request.method !== "PATCH") return send(response, 405, { error: "Method not allowed" })
  if (!sameOrigin(request)) return send(response, 403, { error: "Cross-origin request denied" })
  try {
    const context = await userContext(request)
    if (context.error) return send(response, context.status, { error: context.error })
    const { admin, user } = context
    const validationError = validateAssignmentPatch(request.body)
    if (validationError) return send(response, 400, { error: validationError })
    const args = assignmentRpcArgs(request.body, user.id)
    const key = args.p_brand_key
    const previous = await admin.from("assignments").select("value").eq("brand_key", key).maybeSingle()
    if (previous.error) throw previous.error
    if (args.p_members.length) {
      const existingMembers = await admin.from("team_members").select("name").in("name", args.p_members)
      if (existingMembers.error) throw existingMembers.error
      if ((existingMembers.data || []).length !== args.p_members.length) return send(response, 400, { error: "Unknown team member" })
    }

    const saved = await admin.rpc("patch_assignment_role", args)
    if (saved.error) throw saved.error
    const value = saved.data || {}

    let warning = null
    const previousNames = new Set(assignmentRoleMembers(previous.data?.value, args.p_role))
    const newlyAssigned = args.p_members.filter((member) => !previousNames.has(member))
    if (newlyAssigned.length) try {
      const members = await admin.from("access_list").select("email,member_name").in("member_name", newlyAssigned).eq("active", true)
      if (members.error) throw members.error
      const notifications = (members.data || []).map((member) => ({ recipient_email: member.email, type: "assignment", message: `คุณได้รับมอบหมายให้ดูแล ${key}` }))
      if (notifications.length) {
        const inserted = await admin.from("notifications").insert(notifications)
        if (inserted.error) throw inserted.error
      }
    } catch (notifyError) {
      console.error("[assignment:notify]", notifyError)
      warning = "Assignment saved but notification could not be queued"
    }
    return send(response, 200, { key, value, ...(warning ? { warning } : {}) })
  } catch (error) {
    return send(response, error.status || 500, { error: error.message })
  }
}
