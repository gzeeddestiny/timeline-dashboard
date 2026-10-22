import { Popover } from "@base-ui/react/popover"
import { BellIcon } from "@phosphor-icons/react/dist/csr/Bell"
import { CheckCircleIcon } from "@phosphor-icons/react/dist/csr/CheckCircle"
import { WarningCircleIcon } from "@phosphor-icons/react/dist/csr/WarningCircle"
import { useEffect, useState } from "react"
import { listNotifications, markNotificationRead } from "../lib/fullSystem"
import { formatThaiDateTime } from "../lib/dates"
import { supabase } from "../lib/supabase"
import { Banner, Button, EmptyState } from "./ui"

export default function NotificationCenter({ configured, email, onOpenTask, onOpenContract, onOpenAttention, triggerIcon: TriggerIcon = BellIcon }) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState([])
  const [error, setError] = useState("")
  const [failedRead, setFailedRead] = useState(null)

  useEffect(() => {
    if (!configured || !email) return
    let active = true
    const refresh = () => { if (document.visibilityState === "hidden") return; return listNotifications().then((next) => { if (active) { setItems(next); setError("") } }).catch((loadError) => { if (active) setError(loadError.message) }) }
    refresh()
    const timer = setInterval(refresh, 120_000)
    const onVisible = () => { if (document.visibilityState === "visible") refresh() }
    window.addEventListener("focus", refresh)
    document.addEventListener("visibilitychange", onVisible)
    const channel = supabase.channel(`notifications:${email}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `recipient_email=eq.${email}` }, refresh)
      .subscribe((status, channelError) => { if (active && channelError) setError(`Realtime notification ขัดข้อง: ${channelError.message || status}`) })
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
    if (item.contract_id) { onOpenContract?.(item.contract_id); setOpen(false) }
    const taskKeys = item.payload?.taskKeys || []
    if (!item.task_key && taskKeys.length === 1) { onOpenTask?.(taskKeys[0]); setOpen(false) }
    else if (!item.task_key && item.type === "no_activity_batch") {
      window.history.replaceState(null, "", `${window.location.pathname}?view=my&attention=no_activity`)
      onOpenAttention?.("no_activity")
      setOpen(false)
    } else if (!item.task_key && item.type === "manual_batch") {
      window.history.replaceState(null, "", `${window.location.pathname}?view=my`)
      onOpenAttention?.("manual")
      setOpen(false)
    } else if (item.type === "delivery_failure") { onOpenAttention?.("delivery_failure"); setOpen(false) }
    if (!item.read_at) markRead(item)
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      {error && (
        <Banner tone="danger" className="fixed right-3 top-20 z-[var(--z-alert)] max-w-sm" icon={<WarningCircleIcon size={20} />} actions={<><Button size="sm" variant="ghost" onClick={() => failedRead && markRead(failedRead)} disabled={!failedRead}>Retry</Button><Button size="sm" variant="ghost" onClick={() => setError("")}>ปิด</Button></>}>
          <p className="text-xs">{error}</p>
        </Banner>
      )}
      <Popover.Trigger className="ui-icon-button relative" aria-label={`Notifications${unread ? ` ยังไม่อ่าน ${unread} รายการ` : ""}`}>
        <TriggerIcon aria-hidden="true" size={19} />
        {unread > 0 && <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-[var(--ui-danger)] px-1 text-center text-[9px] font-bold leading-4 text-white">{unread}</span>}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner className="z-[var(--z-popover)]" sideOffset={8} align="end">
          <Popover.Popup id="notification-list" className="ui-popover ui-popover-enter w-[min(22rem,calc(100vw-1.5rem))] overflow-hidden" aria-label="Notifications">
            <div className="flex items-center justify-between border-b border-[var(--ui-border)] px-4 py-3"><h2 className="text-sm font-bold text-[var(--ui-text)]">Notifications</h2>{unread > 0 && <span className="ui-badge ui-badge-danger">{unread} ใหม่</span>}</div>
            <div className="max-h-[min(26rem,70vh)] overflow-y-auto">
              {items.length === 0 ? <EmptyState icon={<CheckCircleIcon size={28} weight="duotone" />} title="ไม่มี notification" description="รายการใหม่จะแสดงที่นี่" className="border-0 py-10" /> : items.map((item) => (
                <button key={item.id} onClick={() => openNotification(item)} className={`ui-task-row block w-full border-b border-[var(--ui-border)] px-4 py-3 text-left ${item.read_at ? "bg-white" : "bg-[var(--ui-brand-tint)]"}`}>
                  <span className="block text-xs font-semibold text-[var(--ui-text)]">{item.message}</span>
                  <span className="mt-1 block text-[11px] text-[var(--ui-muted)]">{formatThaiDateTime(item.created_at)}</span>
                </button>
              ))}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
