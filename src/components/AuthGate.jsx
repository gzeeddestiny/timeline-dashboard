import { useEffect, useMemo, useState } from "react"
import { isSupabaseConfigured, supabase } from "../lib/supabase"
import { AuthContext } from "../lib/auth"
import magicLogo from "../assets/magic-logo.svg"

function LoginScreen() {
  const [error, setError] = useState("")
  const login = async () => {
    setError("")
    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    })
    if (authError) setError(authError.message)
  }
  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--ui-canvas)] p-6">
      <section className="ui-card w-full max-w-sm rounded-3xl p-8 text-center">
        <img src={magicLogo} alt="MAGIC" className="mx-auto h-16 w-16" />
        <h1 className="mt-4 text-xl font-black text-purple-900">MAGIC Timeline</h1>
        <p className="mt-2 text-sm text-gray-400">เข้าสู่ระบบด้วยอีเมลที่ Admin อนุมัติแล้ว</p>
        <button onClick={login} className="ui-button ui-button-primary mt-6 w-full py-3 text-sm">
          Sign in with Google
        </button>
        {error && <p className="mt-3 text-xs text-red-500">{error}</p>}
      </section>
    </main>
  )
}

function AccessDenied({ email, onSignOut }) {
  const adminContact = import.meta.env.VITE_ADMIN_CONTACT || "Admin ของ Timeline Dashboard"
  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
      <section className="ui-card w-full max-w-md rounded-2xl border-amber-200 p-8 text-center">
        <div className="text-3xl">🔒</div>
        <h1 className="mt-3 text-lg font-bold text-gray-800">ยังไม่ได้รับสิทธิ์เข้าใช้งาน</h1>
        <p className="mt-2 text-sm text-gray-500">บัญชี <strong>{email}</strong> ยังไม่อยู่ในรายชื่อที่อนุมัติ กรุณาติดต่อ {adminContact}</p>
        <button onClick={onSignOut} className="mt-5 rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50">Sign out</button>
      </section>
    </main>
  )
}

function SystemUnavailable({ maintenance = false }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
      <section className="ui-card w-full max-w-md rounded-2xl p-8 text-center">
        <img src={magicLogo} alt="MAGIC" className="mx-auto h-14 w-14" />
        <h1 className="mt-4 text-lg font-bold text-purple-900">{maintenance ? "ระบบกำลังปรับปรุง" : "ระบบยังตั้งค่าไม่ครบ"}</h1>
        <p className="mt-2 text-sm text-gray-500">
          {maintenance ? "กำลังย้ายข้อมูลไปยังระบบที่ปลอดภัยกว่า กรุณาลองใหม่ภายหลัง" : "ไม่พบการตั้งค่า Supabase ระบบจึงปิดการเข้าถึงเพื่อป้องกันข้อมูลรั่วไหล"}
        </p>
      </section>
    </main>
  )
}

export default function AuthGate({ children }) {
  const [session, setSession] = useState(null)
  const [access, setAccess] = useState(null)
  const [accessError, setAccessError] = useState("")
  const maintenance = import.meta.env.VITE_MAINTENANCE_MODE === "true"
  const localFallback = import.meta.env.DEV && ["localhost", "127.0.0.1"].includes(window.location.hostname)
  const [loading, setLoading] = useState(isSupabaseConfigured)

  useEffect(() => {
    if (!isSupabaseConfigured) return
    let active = true
    const resolve = (nextSession) => {
      if (!active) return
      setSession(nextSession)
      if (!nextSession?.user?.email) {
        setAccess(null)
        setLoading(false)
      }
    }
    supabase.auth.getSession().then(({ data }) => resolve(data.session))
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => resolve(nextSession))
    return () => { active = false; listener.subscription.unsubscribe() }
  }, [])

  useEffect(() => {
    const email = session?.user?.email?.toLowerCase()
    if (!isSupabaseConfigured || !email) return
    let active = true
    const refreshAccess = async () => {
      const { data, error } = await supabase.from("access_list").select("email,role,member_name,active").eq("email", email).maybeSingle()
      if (!active) return
      if (error) {
        setAccessError(error.message)
      } else {
        setAccessError("")
        setAccess(data?.active ? data : null)
        if (!data?.active) sessionStorage.clear()
      }
      setLoading(false)
    }
    const initial = setTimeout(refreshAccess, 0)
    const timer = setInterval(refreshAccess, 30_000)
    const channel = supabase.channel(`access:${email}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "access_list", filter: `email=eq.${email}` }, refreshAccess)
      .subscribe()
    return () => { active = false; clearTimeout(initial); clearInterval(timer); supabase.removeChannel(channel) }
  }, [session?.user?.email])

  const value = useMemo(() => isSupabaseConfigured ? {
    configured: true,
    session,
    user: session?.user || null,
    access,
    signOut: async () => { sessionStorage.clear(); await supabase.auth.signOut() },
  } : {
    configured: false,
    session: null,
    user: null,
    access: { email: "local@localhost", role: "admin", member_name: import.meta.env.VITE_LOCAL_MEMBER_NAME || "Tony", active: true },
    signOut: () => {},
  }, [session, access])

  if (maintenance) return <SystemUnavailable maintenance />
  if (!isSupabaseConfigured && !localFallback) return <SystemUnavailable />
  if (accessError) return <SystemUnavailable />
  if (loading) return <div className="flex min-h-screen items-center justify-center text-sm text-[var(--ui-muted)]">กำลังตรวจสอบสิทธิ์…</div>
  if (isSupabaseConfigured && !session) return <LoginScreen />
  if (isSupabaseConfigured && !access) return <AccessDenied email={session.user.email} onSignOut={value.signOut} />
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
