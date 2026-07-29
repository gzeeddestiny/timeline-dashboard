import { userContext, sameOrigin, send } from "./_supabase.js"

export default async function handler(request, response) {
  if (request.method !== "PATCH") return send(response, 405, { error: "Method not allowed" })
  if (!sameOrigin(request)) return send(response, 403, { error: "Cross-origin request denied" })
  try {
    const context = await userContext(request)
    if (context.error) return send(response, context.status, { error: context.error })
    const { admin, user } = context
    const key = typeof request.body?.key === "string" ? request.body.key.trim() : ""
    const value = request.body?.value
    if (!key || value === null || typeof value !== "object" || Array.isArray(value)) {
      return send(response, 400, { error: "Invalid assignment" })
    }
    if (key.length > 200 || JSON.stringify(value).length > 10_000) return send(response, 400, { error: "Assignment is too large" })
    const roles = new Set(["creative", "ae", "media", "pm"])
    if (Object.entries(value).some(([role, name]) => !roles.has(role) || typeof name !== "string" || !name.trim())) {
      return send(response, 400, { error: "Invalid assignment member" })
    }
    const previous = await admin.from("assignments").select("value").eq("brand_key", key).maybeSingle()
    if (previous.error) throw previous.error
    const memberNames = [...new Set(Object.values(value).filter((name) => typeof name === "string" && name.trim()))]
    if (memberNames.length) {
      const existingMembers = await admin.from("team_members").select("name").in("name", memberNames)
      if (existingMembers.error) throw existingMembers.error
      if ((existingMembers.data || []).length !== memberNames.length) return send(response, 400, { error: "Unknown team member" })
    }
    const oldNames = new Set(Object.values(previous.data?.value || {}))

    if (memberNames.length === 0) {
      const cleared = await admin.from("assignments").upsert({
        brand_key: key,
        value: {},
        updated_by: user.id,
        updated_at: new Date().toISOString(),
      })
      if (cleared.error) throw cleared.error
    } else {
      const saved = await admin.from("assignments").upsert({ brand_key: key, value, updated_by: user.id, updated_at: new Date().toISOString() })
      if (saved.error) throw saved.error
    }

    const added = memberNames.filter((name) => !oldNames.has(name))
    let warning = null
    if (added.length) try {
      const members = await admin.from("access_list").select("email,member_name").in("member_name", added).eq("active", true)
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
