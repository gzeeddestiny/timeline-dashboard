import { fetchEmployeeActivity } from '../lib/fullSystem'
import { formatThaiDateTime } from '../lib/dates'
import { useLiveResource } from '../lib/useLiveResource'
import { sinceLabel } from '../lib/activity'
import { Card, Skeleton } from './ui'

function whereLabel(edit) {
  return [edit.spreadsheetName, edit.sheetName, edit.range].filter(Boolean).join(' › ')
}

function UpdateDetail({ item }) {
  const edit = item.lastEdit
  if (item.lastUpdateSource === 'revision') return <>
    <span className="block">แก้ไฟล์ {item.lastRevision.spreadsheetName || 'Sheet'}</span>
    <span className="block text-[10px] text-gray-400">จาก Version history ของไฟล์ · ไม่ทราบแถว/งาน</span>
    {edit && <span className="block text-[10px] text-gray-400">แก้งานล่าสุดที่ระบุได้: {edit.taskName || 'ไม่ทราบงาน'} · {formatThaiDateTime(edit.occurredAt)}</span>}
  </>
  if (!edit) return <span className="text-gray-400">-</span>
  return <>
    <span className="block font-semibold text-purple-900">{edit.taskName || 'แถวที่ยังไม่มี Task ID'}</span>
    {whereLabel(edit) && <span className="block text-gray-500">{whereLabel(edit)}</span>}
    {edit.fields.length > 0 && <span className="block text-gray-500">แก้: {edit.fields.join(', ')}</span>}
  </>
}

function Evidence({ item }) {
  if (item.lastUpdateSource === 'revision') return <span className="ui-badge ui-badge-neutral">Version history</span>
  const edit = item.lastEdit
  if (!edit) return null
  return <span className="flex flex-col items-start gap-1">
    <span className={`ui-badge ${edit.attribution === 'confirmed' ? 'ui-badge-success' : 'ui-badge-warning'}`}>{edit.attribution === 'confirmed' ? 'ผู้แก้ยืนยันจาก Google' : 'ผู้แก้อนุมานจาก Version history'}</span>
    {edit.precision === 'sync' && <span className="text-[10px] text-gray-400">≈ เวลาจากรอบ Sync (ไม่เกิน 30 นาที)</span>}
  </span>
}

export default function EmployeeActivity({ actor, onSelectActor }) {
  const { data, loading, error, reload } = useLiveResource(fetchEmployeeActivity, { items: [], unattributed: null })
  return <Card className="mb-5 p-5" aria-label="พนักงานอัพเดท Sheet ล่าสุด">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h2 className="font-bold text-purple-900">พนักงานอัพเดท Sheet ล่าสุด</h2>
        <p className="mt-1 text-xs text-gray-500">นับทุกการแก้ในแถวงานและ Version history ของไฟล์ ย้อนหลัง 30 วัน · คนที่เงียบนานที่สุดอยู่บนสุด · คลิกชื่อเพื่อดูประวัติของคนนั้น</p>
      </div>
      <div className="flex gap-2">
        {actor && <button type="button" onClick={() => onSelectActor('')} className="ui-button ui-button-secondary ui-button-sm">ดูทุกคน</button>}
        <button type="button" onClick={reload} className="ui-button ui-button-secondary ui-button-sm">Refresh</button>
      </div>
    </div>
    {error && <p role="alert" className="mt-3 text-xs text-red-600">{error} <button type="button" onClick={reload} className="underline">ลองใหม่</button></p>}
    {loading ? <div className="mt-3 space-y-2"><Skeleton className="h-9 w-full" /><Skeleton className="h-9 w-full" /></div>
      : data.items.length ? <div className="ui-data-table-shell mt-3 overflow-x-auto"><table className="ui-data-table w-full min-w-[820px] text-left text-xs">
        <thead className="bg-gray-50 text-gray-400"><tr><th className="px-3 py-2">พนักงาน</th><th>อัพเดทล่าสุด</th><th>แก้ตรงไหน</th><th>วันนี้ / 7 วัน</th><th>หลักฐาน</th></tr></thead>
        <tbody className="divide-y divide-gray-100">{data.items.map((item) => <tr key={item.email} className={actor === item.email ? 'bg-purple-50' : ''}>
          <td className="px-3 py-2"><button type="button" onClick={() => onSelectActor(item.email)} className="text-left"><strong className="block text-purple-900">{item.name}</strong><span className="block text-[10px] text-gray-400">{item.email}{!item.inAccess && ' · ไม่อยู่ในรายชื่อผู้ใช้'}</span></button></td>
          <td>{item.lastUpdateAt ? <><span className="block font-semibold">{formatThaiDateTime(item.lastUpdateAt)}</span><span className="block text-gray-400">{sinceLabel(item.lastUpdateAt)}</span></> : <span className="font-semibold text-red-600">{sinceLabel(null)}</span>}</td>
          <td className="max-w-80"><UpdateDetail item={item} /></td>
          <td>{item.editsToday} / {item.edits7d} ครั้ง<span className="block text-[10px] text-gray-400">{item.activeDays7d} วันที่มีการแก้</span></td>
          <td><Evidence item={item} /></td>
        </tr>)}</tbody>
      </table></div> : <p className="mt-3 text-xs text-gray-500">ยังไม่มีข้อมูลการแก้ Sheet</p>}
    {data.unattributed?.count7d > 0 && <p className="mt-3 text-xs text-amber-700">มี {data.unattributed.count7d} การแก้ใน 7 วันที่ระบุผู้แก้ไม่ได้ (Google ไม่ส่งชื่อ และช่วงเวลานั้นมีหลายคนแก้หรือ Version history ยังไม่เข้ามา) ล่าสุด {formatThaiDateTime(data.unattributed.lastAt)}</p>}
  </Card>
}
