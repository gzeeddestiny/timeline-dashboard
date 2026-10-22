import { bangkokDate } from './dates.js'

export function yesterdayWindow(now = new Date()) {
  const end = `${bangkokDate(now)}T00:00:00+07:00`
  const date = bangkokDate(new Date(Date.parse(end) - 86_400_000))
  return { date, start: `${date}T00:00:00+07:00`, end }
}

export function summarizeDigestChanges(events, tasks, { now = new Date(), personal = false, limit = 40 } = {}) {
  const window = yesterdayWindow(now)
  const byKey = new Map(tasks.map((task) => [task.taskKey, task]))
  const seen = new Set()
  const rows = events.flatMap((event) => {
    const time = Date.parse(event.occurred_at)
    if (!(time >= Date.parse(window.start) && time < Date.parse(window.end)) ||
      ['avatar_changed', 'task_discovered'].includes(event.kind) || seen.has(event.id)) return []
    const changes = Object.fromEntries(Object.entries(event.changes || {}).filter(([, value]) =>
      value && Object.hasOwn(value, 'before') && Object.hasOwn(value, 'after') && JSON.stringify(value.before ?? null) !== JSON.stringify(value.after ?? null)))
    const keys = [...new Set(event.task_keys || [])].filter((key) => !personal || byKey.has(key))
    if (!keys.length || !Object.keys(changes).length) return []
    seen.add(event.id)
    return [{ id: event.id, occurredAt: event.occurred_at, actor: event.actor_name || event.actor_email || 'ไม่ทราบผู้แก้ไข', source: event.source,
      timePrecision: event.time_precision, changes,
      tasks: keys.map((key) => ({ taskKey: key, projectName: byKey.get(key)?.projectName || event.project_name || event.brand_name || 'ไม่ระบุโปรเจกต์', taskName: byKey.get(key)?.topic || event.task_name || 'ไม่ระบุชื่องาน' })) }]
  }).sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt) || String(a.id).localeCompare(String(b.id)))
  return { date: window.date, total: rows.length, taskCount: new Set(rows.flatMap((row) => row.tasks.map((task) => task.taskKey))).size, events: rows.slice(0, limit), remaining: Math.max(0, rows.length - limit) }
}
