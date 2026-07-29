import { createClient } from "@supabase/supabase-js"

const { SUPABASE_URL, SUPABASE_SECRET_KEY, INITIAL_ADMIN_EMAIL } = process.env
if (!SUPABASE_URL || !SUPABASE_SECRET_KEY || !INITIAL_ADMIN_EMAIL) {
  throw new Error("Set SUPABASE_URL, SUPABASE_SECRET_KEY and INITIAL_ADMIN_EMAIL")
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, { auth: { persistSession: false } })
const email = INITIAL_ADMIN_EMAIL.trim().toLowerCase()
const { error } = await supabase.from("access_list").upsert({ email, role: "admin", active: true }, { onConflict: "email" })
if (error) throw error
console.log(`Admin access ready: ${email}`)
