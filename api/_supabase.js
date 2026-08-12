import { createClient } from "@supabase/supabase-js"

export function adminClient() {
  const url = process.env.SUPABASE_URL
  const secret = process.env.SUPABASE_SECRET_KEY
  if (!url || !secret) throw new Error("Supabase server environment is not configured")
  return createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } })
}

export function sameOrigin(request) {
  const origin = request.headers.origin
  if (!origin) return true
  try {
    const host = request.headers["x-forwarded-host"] || request.headers.host
    return new URL(origin).host === host
  } catch { return false }
}

export async function userContext(request) {
  const token = request.headers.authorization?.match(/^Bearer (.+)$/)?.[1]
  if (!token) return { error: "Authentication required", status: 401 }
  const admin = adminClient()
  const { data: userData, error: userError } = await admin.auth.getUser(token)
  if (userError || !userData.user?.email) return { error: "Invalid session", status: 401 }
  const email = userData.user.email.toLowerCase()
  const { data: access, error: accessError } = await admin
    .from("access_list")
    .select("email,role,member_name,active")
    .eq("email", email)
    .eq("active", true)
    .maybeSingle()
  if (accessError) throw accessError
  if (!access) return { error: "Access is not approved", status: 403 }
  return { admin, user: userData.user, access }
}

export function send(response, status, data) {
  response.setHeader("Cache-Control", "no-store")
  response.setHeader("Content-Type", "application/json; charset=utf-8")
  return response.status(status).json(data)
}

