import { useEffect, useMemo, useState, useRef } from "react"
import { GoogleLogoIcon } from "@phosphor-icons/react/dist/csr/GoogleLogo"
import { LockKeyIcon } from "@phosphor-icons/react/dist/csr/LockKey"
import { SpinnerGapIcon } from "@phosphor-icons/react/dist/csr/SpinnerGap"
import { isSupabaseConfigured, supabase } from "../lib/supabase"
import { AuthContext } from "../lib/auth"
import { useQueryClient } from "@tanstack/react-query"
import { blockedRead, READ_INTERVAL } from "../lib/readPolicy"
import magicLogo from "../assets/magic-logo.svg"

function LoginScreen() {
  const [error, setError] = useState("")
  const login = async () => {
    setError("")
    sessionStorage.setItem("magic-v2-return-to", `${window.location.pathname}${window.location.search}`)
    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/v2/` },
    })
    if (authError) setError(authError.message)
  }
  return (
    <main className="ui-auth-screen flex min-h-[100dvh] items-center justify-center bg-[var(--ui-canvas)] p-6">
      <section className="ui-card ui-auth-card ui-modal-enter w-full max-w-md overflow-hidden text-center">
        <div className="bg-gradient-to-br from-[var(--ui-brand-tint)] to-white px-8 py-9">
          <img src={magicLogo} alt="MAGIC" className="mx-auto h-16 w-28 object-contain" />
          <p className="mt-5 text-xs font-bold uppercase tracking-[.16em] text-[var(--ui-brand)]">Operations workspace</p>
          <h1 className="mt-2 text-2xl font-extrabold tracking-[-.025em] text-[var(--ui-text)]">MAGIC Timeline</h1>
          <p className="mt-2 text-sm text-[var(--ui-muted)]">งาน ทีม และ deadline สำคัญในมุมมองเดียว</p>
        </div>
        <div className="border-t border-[var(--ui-border)] p-6">
        <button onClick={login} className="ui-button ui-button-primary w-full py-3 text-sm"><GoogleLogoIcon aria-hidden="true" size={19} weight="bold" />
          Sign in with Google
        </button>
        <p className="mt-3 text-xs text-[var(--ui-muted)]">ใช้เฉพาะอีเมลที่ Admin อนุมัติแล้ว</p>
        {error && <p className="mt-3 text-xs text-red-500">{error}</p>}
        </div>
      </section>
    </main>
  )
}

function AccessDenied({ email, onRetry, onSignOut }) {
  const adminContact = import.meta.env.VITE_ADMIN_CONTACT || "Admin ของ Timeline Dashboard"
  return (
    <main className="ui-auth-screen flex min-h-[100dvh] items-center justify-center bg-[var(--ui-canvas)] p-6">
      <section className="ui-card ui-auth-card ui-modal-enter w-full max-w-md border-amber-200 p-8 text-center">
        <LockKeyIcon aria-hidden="true" className="mx-auto text-[var(--ui-brand)]" size={38} weight="duotone" />
        <h1 className="mt-3 text-lg font-bold text-gray-800">ยังไม่ได้รับสิทธิ์เข้าใช้งาน</h1>
        <p className="mt-2 text-sm text-gray-500">บัญชี <strong>{email}</strong> ยังไม่อยู่ในรายชื่อที่อนุมัติ กรุณาติดต่อ {adminContact}</p>
        <div className="mt-5 flex justify-center gap-2">
          <button onClick={onRetry} className="ui-button ui-button-primary text-sm">ตรวจสอบสิทธิ์อีกครั้ง</button>
          <button onClick={onSignOut} className="ui-button ui-button-secondary text-sm">Sign out</button>
        </div>
      </section>
    </main>
  )
}

function SystemUnavailable({ maintenance = false }) {
  return (
    <main className="ui-auth-screen flex min-h-[100dvh] items-center justify-center bg-[var(--ui-canvas)] p-6">
      <section className="ui-card ui-auth-card ui-modal-enter w-full max-w-md p-8 text-center">
        <img src={magicLogo} alt="MAGIC" className="mx-auto h-14 w-14" />
        <h1 className="mt-4 text-lg font-bold text-purple-900">{maintenance ? "ระบบกำลังปรับปรุง" : "ระบบยังตั้งค่าไม่ครบ"}</h1>
        <p className="mt-2 text-sm text-gray-500">
          {maintenance ? "กำลังย้ายข้อมูลไปยังระบบที่ปลอดภัยกว่า กรุณาลองใหม่ภายหลัง" : "ไม่พบการตั้งค่า Supabase ระบบจึงปิดการเข้าถึงเพื่อป้องกันข้อมูลรั่วไหล"}
        </p>
      </section>
    </main>
  )
}

export default function V2AuthGate({ children }) {
  const client = useQueryClient()
  const resolvedUser = useRef(null)
  const [session, setSession] = useState(null)
  const [access, setAccess] = useState(null)
  const [accessError, setAccessError] = useState("")
  const [accessCheckVersion, setAccessCheckVersion] = useState(0)
  const maintenance = import.meta.env.VITE_MAINTENANCE_MODE === "true" || import.meta.env.VITE_V2_DISABLED === "true"
  const localFallback = import.meta.env.DEV && ["localhost", "127.0.0.1"].includes(window.location.hostname)
  const [loading, setLoading] = useState(isSupabaseConfigured)

  useEffect(() => {
    if (session && window.location.href.endsWith("#")) {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`)
    }
  }, [session])

  useEffect(() => {
    if (!isSupabaseConfigured) return
    let active = true
    const resolve = (nextSession) => {
      if (!active) return
      const nextId = nextSession?.user?.id || null
      if (resolvedUser.current !== nextId) {
        client.clear()
        resolvedUser.current = nextId
        setAccess(null)
        setAccessError("")
        setLoading(!!nextId)
        const owner = sessionStorage.getItem("magic-v2-cache-owner")
        if (owner !== nextId) {
          Object.keys(sessionStorage).filter((key) => key.startsWith("magic-v2-") && key !== "magic-v2-return-to" && key !== `magic-v2-outbox:${nextId}`).forEach((key) => sessionStorage.removeItem(key))
          if (nextId) sessionStorage.setItem("magic-v2-cache-owner", nextId)
        }
      }
      if (nextSession) {
        const target = sessionStorage.getItem("magic-v2-return-to")
        if (target) {
          const url = new URL(target, window.location.origin)
          if (url.origin === window.location.origin && (url.pathname === "/" || url.pathname === "/index.html" || url.pathname === "/v2" || url.pathname.startsWith("/v2/"))) window.history.replaceState(null, "", `${url.pathname === "/" || url.pathname === "/index.html" ? "/v2/" : url.pathname}${url.search}`)
          sessionStorage.removeItem("magic-v2-return-to")
        }
      }
      setSession(nextSession)
      if (!nextSession?.user?.email) {
        setAccess(null)
        setLoading(false)
      }
    }
    supabase.auth.getSession().then(({ data }) => resolve(data.session))
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => resolve(nextSession))
    return () => { active = false; listener.subscription.unsubscribe() }
  }, [client])

  useEffect(() => {
    const email = session?.user?.email?.toLowerCase()
    if (!isSupabaseConfigured || !email) return
    let active = true
    let pending = false
    let blocked = false
    const refreshAccess = async (explicit = false) => {
      if (pending || (blocked && explicit !== true) || document.visibilityState === "hidden") return
      pending = true
      const { data, error, status } = await supabase.from("access_list").select("email,role,member_name,active").eq("email", email).maybeSingle()
      pending = false
      if (!active) return
      blocked = blockedRead(error && Object.assign(error,{status}))
      if (error) {
        setAccessError(error.message)
      } else {
        setAccessError("")
        setAccess(data?.active ? data : null)
      }
      setLoading(false)
    }
    const visible = () => { if (document.visibilityState === "visible") void refreshAccess(true) }
    document.addEventListener("visibilitychange", visible)
    window.addEventListener("focus", visible)
    const initial = setTimeout(() => refreshAccess(true), 0)
    const timer = setInterval(refreshAccess, READ_INTERVAL)
    const channel = supabase.channel(`access:${email}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "access_list", filter: `email=eq.${email}` }, refreshAccess)
      .subscribe()
    return () => { active = false; clearTimeout(initial); clearInterval(timer); document.removeEventListener("visibilitychange", visible); window.removeEventListener("focus", visible); supabase.removeChannel(channel) }
  }, [session?.user?.email, accessCheckVersion])

  const value = useMemo(() => isSupabaseConfigured ? {
    configured: true,
    session,
    user: session?.user || null,
    access,
    signOut: async () => { Object.keys(sessionStorage).filter((key) => key.startsWith("magic-v2-")).forEach((key) => sessionStorage.removeItem(key)); await supabase.auth.signOut() },
  } : {
    configured: false,
    session: null,
    user: null,
    access: { email: "local@localhost", role: "admin", member_name: import.meta.env.VITE_LOCAL_MEMBER_NAME || "Tony", active: true },
    signOut: () => {},
  }, [session, access])

  if (maintenance) return <SystemUnavailable maintenance />
  if (!isSupabaseConfigured && !localFallback) return <SystemUnavailable />
  if (accessError) return <main className="ui-auth-screen p-8"><section className="ui-card p-6"><h1>ตรวจสอบสิทธิ์ไม่สำเร็จ</h1><p>{accessError}</p><button className="ui-button" onClick={() => setAccessCheckVersion(v => v + 1)}>ตรวจสอบสิทธิ์อีกครั้ง</button><button className="ui-button" onClick={value.signOut}>Sign out</button></section></main>
  if (loading) return <div className="ui-auth-screen flex min-h-[100dvh] flex-col items-center justify-center gap-3 bg-[var(--ui-canvas)] text-sm text-[var(--ui-muted)]"><span className="ui-auth-loader"><SpinnerGapIcon aria-hidden="true" className="animate-spin text-[var(--ui-brand)]" size={28} /></span><span>กำลังตรวจสอบสิทธิ์…</span></div>
  if (isSupabaseConfigured && !session) return <LoginScreen />
  if (isSupabaseConfigured && !access) return <AccessDenied email={session.user.email} onRetry={() => { setLoading(true); setAccessCheckVersion((version) => version + 1) }} onSignOut={value.signOut} />
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
