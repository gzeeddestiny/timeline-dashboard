import { useCallback, useEffect, useRef, useState } from "react"
import { deleteAccess, inspectTaskTabs, listAccess, provisionTaskTabs, saveAccess } from "../lib/fullSystem"
import { findMemberByName, ROLE_CONFIG, ROLES as TEAM_ROLES } from "../lib/teamConfig"
import Emoji from "./Emoji"

const ACCESS_ROLES = ["employee", "manager", "admin"]

export default function AdminSettings({ open, onClose, members, currentEmail, configured, isAdmin, dataSources, onSaved }) {
  const [entries, setEntries] = useState([])
  const [draft, setDraft] = useState({ email: "", role: "employee", member_name: "", team_role: "creative", active: true })
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)
  const closeRef = useRef(null)
  const [taskTabs, setTaskTabs] = useState({ spreadsheetId: "", loading: false, error: "", items: [], selected: new Set() })

  const refresh = useCallback(async () => {
    if (!configured || !isAdmin) return
    try { setEntries(await listAccess()); setError("") }
    catch (loadError) { setError(loadError.message) }
  }, [configured, isAdmin])
  useEffect(() => {
    if (!open) return
    const timer = setTimeout(refresh, 0)
    return () => clearTimeout(timer)
  }, [open, refresh])
  useEffect(() => {
    if (!open) return undefined
    const previousFocus = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    closeRef.current?.focus()
    const keydown = (event) => { if (event.key === "Escape") onClose() }
    document.addEventListener("keydown", keydown)
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener("keydown", keydown); previousFocus?.focus?.() }
  }, [onClose, open])
  if (!open) return null

  const submit = async (event) => {
    event.preventDefault()
    if (!draft.email.trim() || !draft.member_name.trim()) return
    setSaving(true)
    try {
      await saveAccess({ ...draft, member_name: draft.member_name.trim() })
      setDraft({ email: "", role: "employee", member_name: "", team_role: "creative", active: true })
      await refresh()
      await onSaved?.()
    } catch (saveError) { setError(saveError.message) }
    finally { setSaving(false) }
  }

  const updateEntry = async (entry, patch) => {
    setSaving(true)
    try {
      const next = { ...entry, ...patch }
      const member = findMemberByName(members, next.member_name)
      await saveAccess({ ...next, team_role: member?.role })
      await refresh()
      await onSaved?.()
    }
    catch (saveError) { setError(saveError.message) }
    finally { setSaving(false) }
  }

  const removeEntry = async (email) => {
    setSaving(true)
    try { await deleteAccess(email); await refresh() }
    catch (removeError) { setError(removeError.message) }
    finally { setSaving(false) }
  }

  const inspectTabs = async (spreadsheetId) => {
    setTaskTabs({ spreadsheetId, loading: true, error: "", items: [], selected: new Set() })
    try {
      const result = await inspectTaskTabs(spreadsheetId)
      setTaskTabs({ spreadsheetId, loading: false, error: "", items: result.tabs, selected: new Set(result.tabs.filter((tab) => tab.valid && !tab.taskIdReady).map((tab) => tab.sheetGid)) })
    } catch (loadError) { setTaskTabs((current) => ({ ...current, loading: false, error: loadError.message })) }
  }

  const provisionTabs = async () => {
    setTaskTabs((current) => ({ ...current, loading: true, error: "" }))
    try {
      const result = await provisionTaskTabs(taskTabs.spreadsheetId, [...taskTabs.selected])
      setTaskTabs((current) => ({ ...current, loading: false, items: result.tabs, selected: new Set() }))
    } catch (provisionError) { setTaskTabs((current) => ({ ...current, loading: false, error: provisionError.message })) }
  }

  return (
    <div className="ui-overlay-enter fixed inset-0 z-[10000] flex items-center justify-center bg-black/35 p-4" onClick={onClose}>
      <section role="dialog" aria-modal="true" aria-labelledby="admin-settings-title" className="ui-popover ui-modal-enter max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-2xl p-6" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div>
            <h2 id="admin-settings-title" className="text-lg font-bold text-purple-900"><Emoji name={isAdmin ? "admin" : "add"} /> {isAdmin ? "Admin Settings" : "Add Google Sheet"}</h2>
            <p className="text-xs text-gray-400">{isAdmin ? "อนุมัติอีเมลและจัดการข้อมูลกลาง" : "เพิ่ม Sheet ใหม่ให้ทุกคนเห็นจาก URL หลักเดียวกัน"}</p>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="ปิด Admin Settings" className="ui-button ui-button-secondary min-h-0 p-2">✕</button>
        </div>

        {isAdmin && (!configured ? (
          <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">ตั้งค่า Supabase ก่อนจึงจะจัดการผู้ใช้ได้</div>
        ) : (
          <>
            <form onSubmit={submit} className="mt-5 grid gap-2 rounded-xl border border-purple-100 bg-purple-50/40 p-4 sm:grid-cols-2">
              <label htmlFor="new-user-email" className="text-xs font-semibold text-gray-600">Email
                <input id="new-user-email" type="email" required value={draft.email} onChange={(event) => setDraft((current) => ({ ...current, email: event.target.value }))} placeholder="employee@company.com" className="ui-field mt-1 w-full text-sm" />
              </label>
              <label htmlFor="new-user-name" className="text-xs font-semibold text-gray-600">ชื่อพนักงาน
                <input id="new-user-name" required list="team-member-names" value={draft.member_name} onChange={(event) => setDraft((current) => { const member = findMemberByName(members, event.target.value); return { ...current, member_name: event.target.value, team_role: member?.role || current.team_role } })} placeholder="ชื่อที่แสดงใน Timeline" className="ui-field mt-1 w-full text-sm" />
              </label>
              <datalist id="team-member-names">{members.map((member) => <option key={member.name} value={member.name} />)}</datalist>
              <label htmlFor="new-user-access-role" className="text-xs font-semibold text-gray-600">สิทธิ์ระบบ
                <select id="new-user-access-role" value={draft.role} onChange={(event) => setDraft((current) => ({ ...current, role: event.target.value }))} className="ui-field mt-1 w-full text-sm">
                  {ACCESS_ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
                </select>
              </label>
              <label htmlFor="new-user-team-role" className="text-xs font-semibold text-gray-600">ตำแหน่งใน Timeline
                <select id="new-user-team-role" disabled={Boolean(findMemberByName(members, draft.member_name))} value={draft.team_role} onChange={(event) => setDraft((current) => ({ ...current, team_role: event.target.value }))} className="ui-field mt-1 w-full text-sm disabled:bg-gray-100 disabled:text-gray-500">
                  {TEAM_ROLES.map((role) => <option key={role} value={role}>{ROLE_CONFIG[role].label}</option>)}
                </select>
              </label>
              <button disabled={saving} className="ui-button ui-button-primary text-sm disabled:opacity-50 sm:col-span-2">{saving ? "Saving…" : "Add employee"}</button>
            </form>
            {error && <p className="mt-3 text-xs text-red-500">{error}</p>}
            <div className="mt-4 overflow-x-auto rounded-xl border border-gray-100">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-gray-400"><tr><th className="px-4 py-3">Email</th><th className="px-4 py-3">Role</th><th className="px-4 py-3">Member</th><th className="px-4 py-3">Status</th><th /></tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {entries.map((entry) => (
                    <tr key={entry.email} className="ui-task-row">
                      <td className="px-4 py-3 font-medium text-gray-700">{entry.email}</td>
                      <td className="px-4 py-3"><select disabled={saving || entry.email === currentEmail} value={entry.role} onChange={(event) => updateEntry(entry, { role: event.target.value })} className="rounded border border-gray-100 bg-white px-2 py-1 text-xs">{ACCESS_ROLES.map((role) => <option key={role}>{role}</option>)}</select></td>
                      <td className="px-4 py-3"><select disabled={saving} value={entry.member_name || ""} onChange={(event) => updateEntry(entry, { member_name: event.target.value || null })} className="rounded border border-gray-100 bg-white px-2 py-1 text-xs">{!entry.member_name && <option value="">—</option>}{members.map((member) => <option key={member.name}>{member.name}</option>)}</select>{!entry.member_name && <p className="mt-1 text-[10px] font-semibold text-amber-600">⚠️ ยังไม่ผูกชื่อพนักงาน</p>}</td>
                      <td className="px-4 py-3"><button disabled={saving || entry.email === currentEmail} onClick={() => updateEntry(entry, { active: !entry.active })} className={`rounded-full px-2 py-1 text-[10px] font-bold ${entry.active ? "bg-green-50 text-green-600" : "bg-gray-100 text-gray-400"}`}>{entry.active ? "Active" : "Disabled"}</button></td>
                      <td className="px-4 py-3 text-right">
                        <button disabled={saving || entry.email === currentEmail} onClick={() => removeEntry(entry.email)} className="text-xs font-semibold text-red-400 hover:text-red-600 disabled:opacity-30">Remove</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

          </>
        ))}

            <section className="mt-6 border-t border-purple-100 pt-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><h3 className="font-bold text-purple-900">Connected Data Sources</h3><p className="text-xs text-gray-400">{isAdmin ? "เพิ่ม Sheet, เตรียม Task ID และสั่ง sync จากจุดเดียว" : "เพิ่ม Sheet ใหม่และสั่ง sync ข้อมูล"}</p></div>
                <button type="button" disabled={!configured || dataSources.isSyncing || !dataSources.sheets.length} onClick={() => dataSources.syncData(true)} className="ui-button ui-button-primary text-xs disabled:opacity-40"><Emoji name="sync" /> {dataSources.isSyncing ? "Syncing…" : "Sync now"}</button>
              </div>
              {!configured && <p className="mt-3 rounded-lg bg-purple-50 p-3 text-xs text-purple-700">Local Preview: เพิ่มและลบ Sheet เพื่อทดลอง UI ได้ แต่การ Sync และแชร์กับทุกคนต้องเชื่อม Supabase ก่อน</p>}
              {dataSources.syncError && <p className="mt-3 rounded-lg bg-red-50 p-3 text-xs text-red-600">{dataSources.syncError}</p>}
              <div className="mt-3 flex gap-2">
                <input type="url" value={dataSources.inputUrl} onChange={(event) => dataSources.setInputUrl(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") dataSources.addSheet() }} placeholder="https://docs.google.com/spreadsheets/d/..." className="ui-field min-w-0 flex-1 text-sm" />
                <button type="button" onClick={dataSources.addSheet} className="ui-button ui-button-primary text-xs"><Emoji name="add" /> Add Sheet</button>
              </div>
              <div className="mt-3 space-y-2">
                {dataSources.sheets.map((sheet) => <div key={sheet.spreadsheetId} className="ui-card ui-task-row rounded-xl p-3">
                  <div className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate text-xs text-gray-600">{sheet.url}</span>{isAdmin && <button type="button" disabled={!configured} onClick={() => inspectTabs(sheet.spreadsheetId)} className="text-xs font-semibold text-purple-600 disabled:text-gray-300">Task tabs</button>}{isAdmin && <button type="button" onClick={() => dataSources.removeSheet(sheet.spreadsheetId)} className="text-xs font-semibold text-red-500">Remove</button>}</div>
                  {taskTabs.spreadsheetId === sheet.spreadsheetId && <div className="mt-3 rounded-lg bg-gray-50 p-3">
                    {taskTabs.loading ? <p className="text-xs text-gray-400">Checking tabs…</p> : taskTabs.error ? <p className="text-xs text-red-500">{taskTabs.error}</p> : <>
                      <div className="space-y-1">{taskTabs.items.map((tab) => <label key={tab.sheetGid} className={`flex items-center gap-2 text-xs ${tab.valid ? "text-gray-700" : "text-gray-300"}`}><input type="checkbox" disabled={!tab.valid} checked={taskTabs.selected.has(tab.sheetGid)} onChange={() => setTaskTabs((current) => { const selected = new Set(current.selected); selected.has(tab.sheetGid) ? selected.delete(tab.sheetGid) : selected.add(tab.sheetGid); return { ...current, selected } })} /><span className="flex-1">{tab.title}</span><span>{tab.taskIdReady ? "Task ID ready" : tab.valid ? "Needs Task ID" : tab.reason}</span></label>)}</div>
                      <button type="button" disabled={!taskTabs.selected.size} onClick={provisionTabs} className="mt-3 rounded-lg bg-amber-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">Repair selected task tabs</button>
                    </>}
                  </div>}
                </div>)}
                {!dataSources.sheets.length && <p className="py-4 text-center text-xs text-gray-400"><Emoji name="inbox" /> ยังไม่มี Google Sheet</p>}
              </div>
            </section>
      </section>
    </div>
  )
}
