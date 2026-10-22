import { sameOrigin, send, userContext } from "./_supabase.js"

const MAX_AVATAR_URL_BYTES = 2_048

export function validateTeamAvatar(body) {
  const memberName = typeof body?.memberName === "string" ? body.memberName.trim() : ""
  const avatar = typeof body?.avatar === "string" ? body.avatar.trim() : ""
  if (!memberName || memberName.length > 100) return "Invalid team member"
  if (Buffer.byteLength(avatar, "utf8") > MAX_AVATAR_URL_BYTES || (avatar && !avatar.startsWith("https://"))) return "Invalid avatar URL"
  return null
}

export default async function handler(request, response) {
  if (request.method !== "PATCH") return send(response, 405, { error: "Method not allowed" })
  if (!sameOrigin(request)) return send(response, 403, { error: "Cross-origin request denied" })
  try {
    const context = await userContext(request)
    if (context.error) return send(response, context.status, { error: context.error })
    if (context.access.role !== "admin") return send(response, 403, { error: "Admin access required" })

    const validationError = validateTeamAvatar(request.body)
    if (validationError) return send(response, 400, { error: validationError })

    const memberName = request.body.memberName.trim()
    const avatar = request.body.avatar.trim()
    const existing = await context.admin.from("team_members").select("name").eq("name", memberName).maybeSingle()
    if (existing.error) throw existing.error
    if (!existing.data) return send(response, 404, { error: "Team member not found" })

    const saved = await context.admin
      .from("team_members")
      .update({ avatar, updated_by: context.user.id, updated_at: new Date().toISOString() })
      .eq("name", existing.data.name)
      .select("name,role,avatar")
      .single()
    if (saved.error) throw saved.error
    if (saved.data.avatar !== avatar) throw new Error("Avatar verification failed")
    return send(response, 200, { member: saved.data })
  } catch (error) {
    return send(response, error.status || 500, { error: error.message })
  }
}
