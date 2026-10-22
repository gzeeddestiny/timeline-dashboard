import { useCallback, useState } from 'react'
import { fetchActionHistory } from '../lib/fullSystem'
import { useLiveResource } from '../lib/useLiveResource'
import { actionLabel, actionValue } from '../lib/activity'
import { formatThaiDateTime } from '../lib/dates'
import TaskIdentity from './TaskIdentity'

function actorLine(event) {
  if (event.actor_attribution === 'confirmed') return <>ผู้แก้: {[event.actor_name, event.actor_email].filter(Boolean).join(' · ')}</>
  const people = [...(event.display_ae_names || event.ae_names || []), ...(event.display_ae_emails || [])]
  if (event.actor_attribution === 'current_ae_unverified') return <>ผู้แก้: ไม่ทราบ · {people.join(', ') || 'ไม่ทราบ AE'} <strong className="text-amber-700">(AE ปัจจุบัน — ไม่ยืนยันผู้แก้ย้อนหลัง)</strong></>
  return <>ผู้แก้: ไม่ทราบ · {people.join(', ') || 'ไม่ทราบ AE'} <strong className="text-amber-700">(อ้างอิงจาก AE ผู้รับผิดชอบ)</strong></>
}

export default function ActivityHistory({ taskKey = '', options = {} }) {
  const [filters, setFilters] = useState({ ae: '', projectId: '', taskKey: '', from: '', to: '', personal: '' })
  const [offset, setOffset] = useState(0)
  const loader = useCallback(() => fetchActionHistory({ ...filters, taskKey: taskKey || filters.taskKey, offset }), [filters, taskKey, offset])
  const { data, loading, error, reload, fetchedAt } = useLiveResource(loader, { items: [], nextOffset: null })
  const setFilter = (name, value) => { setFilters((old) => ({ ...old, ...(name === 'personal' && value === '1' ? { projectId: '', taskKey: '' } : {}), [name]: value })); setOffset(0) }
  return <section className="mt-5 rounded-xl border border-gray-200 bg-white p-4" aria-label="ประวัติ Action">
    <div className="flex items-center justify-between gap-3"><h2 className="font-bold text-purple-900">ประวัติ Action {taskKey ? 'ของงาน' : 'ราย AE'}</h2><button type="button" className="ui-button ui-button-secondary ui-button-sm" onClick={reload}>Refresh</button></div>
    {!taskKey && <div className="mt-3 grid gap-2 sm:grid-cols-3">
      <select aria-label="AE ในประวัติ" className="ui-field text-xs" value={filters.ae} onChange={(e) => setFilter('ae', e.target.value)}><option value="">AE ทั้งหมด</option>{(options.aes || []).map((ae) => <option key={ae}>{ae}</option>)}</select>
      <select disabled={filters.personal === '1'} aria-label="โปรเจกต์ในประวัติ" className="ui-field text-xs" value={filters.projectId} onChange={(e) => setFilter('projectId', e.target.value)}><option value="">โปรเจกต์ทั้งหมด</option>{(options.projects || []).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select>
      <select disabled={filters.personal === '1'} aria-label="งานในประวัติ" className="ui-field text-xs" value={filters.taskKey} onChange={(e) => setFilter('taskKey', e.target.value)}><option value="">งานทั้งหมด</option>{(options.tasks || []).map((task) => <option key={task.key} value={task.key}>{task.name}</option>)}</select>
      <label className="text-xs text-gray-500">ตั้งแต่<input type="date" className="ui-field w-full text-xs" value={filters.from} onChange={(e) => setFilter('from', e.target.value)} /></label>
      <label className="text-xs text-gray-500">ถึง<input type="date" className="ui-field w-full text-xs" value={filters.to} onChange={(e) => setFilter('to', e.target.value)} /></label>
      <select aria-label="ขอบเขตประวัติ" className="ui-field text-xs" value={filters.personal} onChange={(e) => setFilter('personal', e.target.value)}><option value="">Action ของงาน</option><option value="1">Action รูปโปรไฟล์</option></select>
    </div>}
    <p className="mt-2 text-[11px] text-gray-400">ดึงประวัติล่าสุด {formatThaiDateTime(fetchedAt)} · อัปเดตทุก 2 นาที</p>
    {error && <p role="alert" className="mt-3 text-xs text-red-600">{error} <button type="button" onClick={reload} className="underline">ลองใหม่</button></p>}
    {loading ? <p className="mt-3 text-xs text-gray-400">กำลังโหลดประวัติ…</p> : !data.items.length ? !error && <p className="mt-3 text-xs text-gray-500">ยังไม่มี action ที่บันทึกไว้ในช่วงนี้</p> : <ol className="mt-3 divide-y divide-gray-100">{data.items.map((event) => <li key={event.id} className="py-3 text-xs">
      <TaskIdentity brand={event.brand_name || event.project_name || event.member_name} task={event.task_name || (event.kind === 'avatar_changed' ? 'เปลี่ยนรูปโปรไฟล์' : 'Action')} detail={event.task_keys.length > 1 ? `${event.task_keys.length} งาน` : ''} />
      <div className="mt-1 text-gray-500">{formatThaiDateTime(event.occurred_at)} · {event.source === 'google_sheet' ? 'Google Sheet' : event.source === 'dashboard' ? 'Dashboard' : 'ระบบ'} · {actorLine(event)}</div>
      <div className="mt-1 text-gray-500">AE ณ เวลานั้น: {(event.ae_names || []).join(', ') || (event.display_ae_names || []).join(', ') || 'ไม่ทราบ / ยังไม่กำหนด'}</div>
      <div className="mt-1 text-[10px] text-gray-400">หลักฐาน: {event.evidence_source || event.source} · ความละเอียดเวลา: {event.time_precision === 'minute' ? 'ระดับนาที' : event.time_precision === 'version' ? 'ระดับเวอร์ชัน' : 'เวลาที่บันทึก'}</div>
      <ul className="mt-2 space-y-1">{Object.entries(event.changes).map(([field, change]) => <li key={field} className="break-words"><strong>{actionLabel(field)}</strong>: {field === 'avatar' ? `${change.before ? 'มีรูป' : 'ไม่มีรูป'} → ${change.after ? 'เปลี่ยนรูปแล้ว' : 'ลบรูปแล้ว'}` : `${actionValue(change.before)} → ${actionValue(change.after)}`}</li>)}</ul>
      {event.history_gap && <p className="mt-1 text-amber-700">{event.history_gap}</p>}
      <details className="mt-1 text-gray-400"><summary>เวลารับข้อมูล</summary>{formatThaiDateTime(event.received_at)}</details>
    </li>)}</ol>}
    <div className="mt-3 flex items-center gap-3 text-xs"><button type="button" disabled={offset === 0} className="ui-button ui-button-secondary ui-button-sm" onClick={() => setOffset(Math.max(0, offset - 50))}>ก่อนหน้า</button><span>หน้า {offset / 50 + 1}</span><button type="button" disabled={data.nextOffset === null} className="ui-button ui-button-secondary ui-button-sm" onClick={() => setOffset(data.nextOffset)}>ถัดไป</button></div>
  </section>
}
