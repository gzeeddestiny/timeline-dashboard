export const ACTION_LABELS = {
  done: 'เสร็จงาน', due_date: 'Due Date', actual_submit: 'Actual Submit', status: 'Workflow',
  note: 'Note', priority: 'Priority', next_action: 'Next Action', responsibility: 'ผู้รับผิดชอบ',
  assignment: 'ทีมผู้รับผิดชอบ', avatar: 'รูปโปรไฟล์',
  description: 'รายละเอียดงาน', remarks: 'Remarks',
  start_date: 'Start (Plan)', end_date: 'End (Plan)', comment: 'Comment',
}

// Sheet column names are normalized to lower case; restore a readable heading.
const titleCase = (text) => text.replace(/(^|\s)\S/g, (letter) => letter.toUpperCase())

export function actionLabel(field) {
  if (field.startsWith('cell:')) return titleCase(field.slice(5))
  return ACTION_LABELS[field] || String(field).replace(/^date:/, '').replace(/^project_link:/, 'Project Link · ')
}

export function changedValues(before = {}, after = {}) {
  return Object.fromEntries([...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((key) => JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null))
    .map((key) => [key, { before: before[key] ?? null, after: after[key] ?? null }]))
}

export function actionValue(value) {
  if (value === true) return 'เสร็จแล้ว'
  if (value === false) return 'ยังไม่เสร็จ'
  if (value === null || value === undefined || value === '') return '—'
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

const HOUR_MS = 60 * 60 * 1000

export function sinceLabel(value, now = Date.now()) {
  if (!value) return 'ยังไม่พบการแก้ใน 30 วัน'
  const hours = Math.max(0, Math.floor((now - Date.parse(value)) / HOUR_MS))
  if (hours < 1) return 'ไม่ถึง 1 ชม.ที่แล้ว'
  if (hours < 24) return `${hours} ชม.ที่แล้ว`
  return `${Math.floor(hours / 24)} วันที่แล้ว`
}

export function newestActivityFirst(a, b) {
  const activityTime = (item) => item.activity?.lastActivityKind === 'task_discovered' ? 0 : Date.parse(item.activity?.lastActivityAt || '') || 0
  return activityTime(b) - activityTime(a) || String(a.taskKey || '').localeCompare(String(b.taskKey || ''))
}
