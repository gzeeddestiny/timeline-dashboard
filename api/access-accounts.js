import { sameOrigin, send, userContext } from "./_supabase.js"

export default async function handler(request, response) {
  if (request.method !== "GET") return send(response, 405, { error: "Method not allowed" })
  if (!sameOrigin(request)) return send(response, 403, { error: "Cross-origin request denied" })
  try {
    const context = await userContext(request)
    if (context.error) return send(response, context.status, { error: context.error })
    if (context.access.role !== "admin") return send(response, 403, { error: "Admin access required" })

    const { admin } = context
    const access = await admin.from("access_list").select("email")
    if (access.error) throw access.error
    const approved = new Set((access.data || []).map((entry) => entry.email.toLowerCase()))
    const pending = []
    for (let page = 1; page <= 20; page += 1) {
      const users = await admin.auth.admin.listUsers({ page, perPage: 1000 })
      if (users.error) throw users.error
      users.data.users.forEach((user) => {
        const email = user.email?.toLowerCase()
        if (email && !approved.has(email)) pending.push({
          email,
          name: user.user_metadata?.full_name || user.user_metadata?.name || "",
          lastSignInAt: user.last_sign_in_at,
        })
      })
      if (users.data.users.length < 1000) break
    }
    pending.sort((a, b) => String(b.lastSignInAt || "").localeCompare(String(a.lastSignInAt || "")))
    return send(response, 200, { accounts: pending.slice(0, 200) })
  } catch (error) {
    return send(response, error.status || 500, { error: error.message })
  }
}
