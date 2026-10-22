export const ACTION_LABELS = {
  done: 'เสร็จงาน', due_date: 'Due Date', actual_submit: 'Actual Submit', status: 'Workflow',
  note: 'Note', priority: 'Priority', next_action: 'Next Action', responsibility: 'ผู้รับผิดชอบ',
  assignment: 'ทีมผู้รับผิดชอบ', avatar: 'รูปโปรไฟล์',
  description: 'รายละเอียดงาน', remarks: 'Remarks',
}

export function actionLabel(field) {
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

export function newestActivityFirst(a, b) {
  const activityTime = (item) => item.activity?.lastActivityKind === 'task_discovered' ? 0 : Date.parse(item.activity?.lastActivityAt || '') || 0
  return activityTime(b) - activityTime(a) || String(a.taskKey || '').localeCompare(String(b.taskKey || ''))
}
