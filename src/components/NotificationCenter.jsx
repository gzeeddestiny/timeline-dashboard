import { useEffect, useRef, useState } from "react"
import { listNotifications, markNotificationRead } from "../lib/fullSystem"
import { supabase } from "../lib/supabase"
import Emoji from "./Emoji"

export default function NotificationCenter({ configured, email, onOpenTask }) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState([])
  const [error, setError] = useState("")
  const [failedRead, setFailedRead] = useState(null)
  const containerRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const close = (event) => {
      if (event.type === "keydown" && event.key === "Escape") setOpen(false)
      if (event.type === "pointerdown" && !containerRef.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener("keydown", close)
    document.addEventListener("pointerdown", close)
    return () => { document.removeEventListener("keydown", close); document.removeEventListener("pointerdown", close) }
  }, [open])

  useEffect(() => {
    if (!configured || !email) return
    let active = true
    const refresh = () => listNotifications().then((next) => { if (active) { setItems(next); setError("") } }).catch((loadError) => { if (active) setError(loadError.message) })
    refresh()
    const timer = setInterval(refresh, 30_000)
    const onVisible = () => { if (document.visibilityState === "visible") refresh() }
    window.addEventListener("focus", refresh)
    document.addEventListener("visibilitychange", onVisible)
    const channel = supabase.channel(`notifications:${email}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `recipient_email=eq.${email}` }, refresh)
      .subscribe((status, channelError) => {
        if (active && channelError) setError(`Realtime notification ขัดข้อง: ${channelError.message || status}`)
      })
    return () => {
      active = false
      clearInterval(timer)
      window.removeEventListener("focus", refresh)
      document.removeEventListener("visibilitychange", onVisible)
      supabase.removeChannel(channel)
    }
  }, [configured, email])

  if (!configured) return null
  const unread = items.filter((item) => !item.read_at).length
  const markRead = async (item) => {
    try {
      await markNotificationRead(item.id)
      setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, read_at: new Date().toISOString() } : entry))
      setFailedRead(null)
      setError("")
    } catch (readError) {
      setFailedRead(item)
      setError(`เปิดงานแล้ว แต่ mark notification ไม่สำเร็จ: ${readError.message}`)
    }
  }
  const openNotification = (item) => {
    if (item.task_key) { onOpenTask?.(item.task_key); setOpen(false) }
    if (!item.read_at) markRead(item)
  }
  return (
    <div ref={containerRef} className="relative">
      {error && <div className="ui-popover fixed right-3 top-16 z-[12000] flex max-w-sm items-center gap-2 rounded-xl border-red-200 p-3 text-xs text-red-600"><span><Emoji name="warning" /> {error}</span>{failedRead && <button type="button" onClick={() => markRead(failedRead)} className="font-bold underline"><Emoji name="retry" /> Retry</button>}<button type="button" onClick={() => setError("")} aria-label="Dismiss notification error">✕</button></div>}
      <button type="button" onClick={() => setOpen((value) => !value)} aria-label="Notifications" aria-expanded={open} aria-controls="notification-list" className="relative rounded-lg border border-purple-100 bg-white p-2 text-purple-500 hover:bg-purple-50">
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 10-12 0v3.2c0 .5-.2 1-.6 1.4L4 17h5m2 0v1a2 2 0 004 0v-1" /></svg>
        {unread > 0 && <span className="absolute -right-1.5 -top-1.5 rounded-full bg-red-500 px-1.5 text-[9px] font-bold text-white">{unread}</span>}
      </button>
      {open && (
        <div id="notification-list" className="ui-popover ui-panel-enter absolute right-0 top-11 z-[9999] w-80 overflow-hidden rounded-xl">
          <div className="border-b border-purple-50 px-4 py-3 text-xs font-bold uppercase tracking-wider text-purple-500">Notifications</div>
          <div className="max-h-80 overflow-y-auto">
            {items.length === 0 ? <p className="p-6 text-center text-xs text-gray-300"><Emoji name="inbox" /> ไม่มี notification</p> : items.map((item) => (
              <button key={item.id} onClick={() => openNotification(item)} className={`block w-full border-b border-gray-50 px-4 py-3 text-left ${item.read_at ? "bg-white" : "bg-purple-50/60"}`}>
                <div className="text-xs font-medium text-gray-700">{item.message}</div>
                <div className="mt-1 text-[10px] text-gray-400">{new Date(item.created_at).toLocaleString("th-TH")}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
