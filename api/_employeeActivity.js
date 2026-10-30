import { bangkokDate } from '../src/lib/dates.js'
import { actionLabel } from '../src/lib/activity.js'

export const EMPLOYEE_ACTIVITY_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000

const lower = (value) => (value ? String(value).trim().toLowerCase() : '')

// One row per person: when they last touched a registered Sheet, where, and how sure we are.
export function buildEmployeeActivity({ access = [], events = [], revisions = [], now = new Date() }) {
  const today = bangkokDate(now)
  const weekAgo = now.getTime() - 7 * DAY_MS
  const sheetNames = new Map(revisions.filter((r) => r.spreadsheet_name).map((r) => [r.spreadsheet_id, r.spreadsheet_name]))
  const people = new Map()
  const person = (email, name = '') => {
    if (!people.has(email)) people.set(email, { email, name: name || email, role: null, inAccess: false, lastEdit: null, lastRevision: null, editsToday: 0, edits7d: 0, days7d: new Set() })
    return people.get(email)
  }
  for (const item of access) {
    if (!item.email) continue
    const row = person(lower(item.email), item.member_name || '')
    row.inAccess = true
    row.role = item.role || null
  }

  let unattributed7d = 0, unattributedLastAt = null
  for (const event of events) {
    const confirmed = lower(event.actor_email)
    const inferred = event.actor_attribution === 'revision_single_editor' ? lower(event.inferred_actor_email) : ''
    const at = Date.parse(event.occurred_at)
    if (!confirmed && !inferred) {
      if (at >= weekAgo) unattributed7d += 1
      if (!unattributedLastAt || event.occurred_at > unattributedLastAt) unattributedLastAt = event.occurred_at
      continue
    }
    const row = person(confirmed || inferred, event.inferred_actor_name || '')
    if (at >= weekAgo) { row.edits7d += 1; row.days7d.add(bangkokDate(new Date(at))) }
    if (bangkokDate(new Date(at)) === today) row.editsToday += 1
    if (!row.lastEdit || at > Date.parse(row.lastEdit.occurredAt)) {
      row.lastEdit = {
        occurredAt: event.occurred_at,
        spreadsheetName: sheetNames.get(event.spreadsheet_id) || event.brand_name || '',
        sheetName: event.sheet_name || '',
        range: event.cell_range || '',
        taskName: event.task_name || '',
        projectName: event.project_name || '',
        taskKey: event.task_keys?.length === 1 ? event.task_keys[0] : null,
        fields: Object.keys(event.changes || {}).map(actionLabel),
        precision: event.time_precision || 'exact',
        attribution: confirmed ? 'confirmed' : 'revision_inferred',
      }
    }
  }

  for (const revision of revisions) {
    const email = lower(revision.editor_email)
    if (!email) continue
    const row = person(email, revision.editor_name || '')
    if (!row.lastRevision || revision.modified_at > row.lastRevision.modifiedAt) {
      row.lastRevision = { modifiedAt: revision.modified_at, spreadsheetName: revision.spreadsheet_name || '' }
    }
  }

  const items = [...people.values()].map(({ days7d, ...row }) => {
    const editAt = row.lastEdit ? Date.parse(row.lastEdit.occurredAt) : 0
    const revisionAt = row.lastRevision ? Date.parse(row.lastRevision.modifiedAt) : 0
    const lastUpdateAt = Math.max(editAt, revisionAt)
    return {
      ...row,
      activeDays7d: days7d.size,
      lastUpdateAt: lastUpdateAt ? new Date(lastUpdateAt).toISOString() : null,
      // Version history can be newer than any edit row we could place in a task.
      lastUpdateSource: !lastUpdateAt ? null : revisionAt > editAt ? 'revision' : 'edit',
    }
  }).filter((row) => row.inAccess || row.lastUpdateAt)
  // People who have been silent longest come first; never-seen people lead.
  items.sort((a, b) => (a.lastUpdateAt || '').localeCompare(b.lastUpdateAt || '') || a.name.localeCompare(b.name, 'th'))
  return { items, unattributed: { count7d: unattributed7d, lastAt: unattributedLastAt }, days: EMPLOYEE_ACTIVITY_DAYS }
}
