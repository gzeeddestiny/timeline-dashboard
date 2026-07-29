import { useCallback, useEffect, useState } from "react"
import { deleteAccess, listAccess, saveAccess } from "../lib/fullSystem"

const ROLES = ["employee", "manager", "admin"]

export default function AdminSettings({ open, onClose, members, currentEmail, configured }) {
  const [entries, setEntries] = useState([])
  const [draft, setDraft] = useState({ email: "", role: "employee", member_name: "", active: true })
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)

  const refresh = useCallback(async () => {
    if (!configured) return
    try { setEntries(await listAccess()); setError("") }
    catch (loadError) { setError(loadError.message) }
  }, [configured])
  useEffect(() => {
    if (!open) return
    const timer = setTimeout(refresh, 0)
    return () => clearTimeout(timer)
  }, [open, refresh])
  if (!open) return null

  const submit = async (event) => {
    event.preventDefault()
    if (!draft.email.trim()) return
    setSaving(true)
    try {
      await saveAccess({ ...draft, member_name: draft.member_name || null })
      setDraft({ email: "", role: "employee", member_name: "", active: true })
      await refresh()
    } catch (saveError) { setError(saveError.message) }
    finally { setSaving(false) }
  }

  const updateEntry = async (entry, patch) => {
    setSaving(true)
    try { await saveAccess({ ...entry, ...patch }); await refresh() }
    catch (saveError) { setError(saveError.message) }
    finally { setSaving(false) }
  }

  const removeEntry = async (email) => {
    setSaving(true)
    try { await deleteAccess(email); await refresh() }
    catch (removeError) { setError(removeError.message) }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/35 p-4" onClick={onClose}>
      <section className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-purple-900">Admin Settings</h2>
            <p className="text-xs text-gray-400">อนุมัติอีเมลและกำหนดหน้าเริ่มต้นของผู้ใช้</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100">✕</button>
        </div>

        {!configured ? (
          <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">ตั้งค่า Supabase ก่อนจึงจะจัดการผู้ใช้ได้</div>
        ) : (
          <>
            <form onSubmit={submit} className="mt-5 grid gap-2 rounded-xl border border-purple-100 bg-purple-50/40 p-4 md:grid-cols-[2fr_1fr_1fr_auto]">
              <input type="email" required value={draft.email} onChange={(event) => setDraft((current) => ({ ...current, email: event.target.value }))} placeholder="employee@company.com" className="rounded-lg border border-purple-100 px-3 py-2 text-sm outline-none focus:border-purple-400" />
              <select value={draft.role} onChange={(event) => setDraft((current) => ({ ...current, role: event.target.value }))} className="rounded-lg border border-purple-100 bg-white px-3 py-2 text-sm">
                {ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
              </select>
              <select value={draft.member_name} onChange={(event) => setDraft((current) => ({ ...current, member_name: event.target.value }))} className="rounded-lg border border-purple-100 bg-white px-3 py-2 text-sm">
                <option value="">ไม่ผูกพนักงาน</option>
                {members.map((member) => <option key={member.name} value={member.name}>{member.name}</option>)}
              </select>
              <button disabled={saving} className="rounded-lg bg-purple-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Add</button>
            </form>
            {error && <p className="mt-3 text-xs text-red-500">{error}</p>}
            <div className="mt-4 overflow-x-auto rounded-xl border border-gray-100">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-gray-400"><tr><th className="px-4 py-3">Email</th><th className="px-4 py-3">Role</th><th className="px-4 py-3">Member</th><th className="px-4 py-3">Status</th><th /></tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {entries.map((entry) => (
                    <tr key={entry.email}>
                      <td className="px-4 py-3 font-medium text-gray-700">{entry.email}</td>
                      <td className="px-4 py-3"><select disabled={saving || entry.email === currentEmail} value={entry.role} onChange={(event) => updateEntry(entry, { role: event.target.value })} className="rounded border border-gray-100 bg-white px-2 py-1 text-xs">{ROLES.map((role) => <option key={role}>{role}</option>)}</select></td>
                      <td className="px-4 py-3"><select disabled={saving} value={entry.member_name || ""} onChange={(event) => updateEntry(entry, { member_name: event.target.value || null })} className="rounded border border-gray-100 bg-white px-2 py-1 text-xs"><option value="">—</option>{members.map((member) => <option key={member.name}>{member.name}</option>)}</select></td>
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
        )}
      </section>
    </div>
  )
}
