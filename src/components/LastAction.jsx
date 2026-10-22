import { actionLabel } from '../lib/activity'
import { formatThaiDateTime } from '../lib/dates'

export default function LastAction({ activity }) {
  if (!activity || activity.lastActivityKind === 'task_discovered') return <span>ยังไม่มี action ที่บันทึกไว้</span>
  const fields = Object.keys(activity.lastActionChanges || {}).map(actionLabel)
  return <>
    <span>{formatThaiDateTime(activity.lastActivityAt)}</span>
    {fields.length > 0 && <span className="block text-gray-500">{fields.join(', ')}</span>}
    <span className="block text-gray-400">{activity.lastActivitySource === 'google_sheet' ? 'Google Sheet' : 'Dashboard'} · {activity.lastActivityActorEmail || 'ไม่ทราบผู้แก้'}</span>
  </>
}
