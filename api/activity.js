import { timingSafeEqual } from 'node:crypto'
import { adminClient, sameOrigin, send, userContext } from './_supabase.js'
import { loadNotificationData } from './_notifications.js'
import { callAppsScript } from './_appsScript.js'
import { validIsoDate } from '../src/lib/dates.js'
import { fetchAllRows } from '../src/lib/supabasePages.js'
import { NO_ACTIVITY_MS } from '../src/lib/notifications.js'
import { validCronSecret } from './cron-sync.js'
import { buildEmployeeActivity, EMPLOYEE_ACTIVITY_DAYS } from './_employeeActivity.js'

export function validActivitySecret(value, expected) {
  return typeof value === 'string' && Boolean(expected) && Buffer.byteLength(value) === Buffer.byteLength(expected)
    && timingSafeEqual(Buffer.from(value), Buffer.from(expected))
}
export function validateSheetEvent(event, now = Date.now()) {
  if (!event || typeof event.id !== 'string' || !/^[\w-]{1,200}$/.test(event.id)) return 'Invalid event ID'
  const tabScoped = event.scope === 'tab'
  if (typeof event.spreadsheetId !== 'string' || !/^[\w-]{1,200}$/.test(event.spreadsheetId) || !Number.isInteger(event.sheetGid)) return 'Invalid task identity'
  if (tabScoped ? event.taskId != null || event.taskKey != null : !/^[\w-]{1,200}$/.test(event.taskId || '') || event.taskKey !== `${event.spreadsheetId}:${event.sheetGid}:${event.taskId}`) return 'Invalid task identity'
  if (event.scope != null && !tabScoped) return 'Invalid activity scope'
  const at = Date.parse(event.occurredAt)
  if (!Number.isFinite(at) || at > now + 300_000) return 'Invalid event time'
  if (!['google_sheet', 'dashboard'].includes(event.source)) return 'Invalid event source'
  if (event.actorEmail != null && (typeof event.actorEmail !== 'string' || event.actorEmail.length > 320)) return 'Invalid actor'
  if (event.historyGap != null && (typeof event.historyGap !== 'string' || event.historyGap.length > 1000)) return 'Invalid history gap'
  if (event.sheetName != null && (typeof event.sheetName !== 'string' || event.sheetName.length > 200)) return 'Invalid sheet name'
  if (event.range != null && (typeof event.range !== 'string' || !/^[A-Za-z0-9:$]{1,100}$/.test(event.range))) return 'Invalid range'
  if (!event.changes || Array.isArray(event.changes) || typeof event.changes !== 'object' || JSON.stringify(event.changes).length > 20000) return 'Invalid changes'
  for (const [field, change] of Object.entries(event.changes)) {
    if (!['done', 'due_date', 'actual_submit', 'responsibility', 'description', 'remarks'].includes(field) && !/^(date|project_link|cell):.{1,100}$/.test(field)) return 'Unsupported field'
    if (tabScoped !== field.startsWith('project_link:')) return 'Invalid activity scope'
    if (!change || !Object.hasOwn(change, 'before') || !Object.hasOwn(change, 'after')) return 'Invalid change'
    for (const value of [change.before, change.after]) {
      if (value !== null && !['string', 'boolean'].includes(typeof value)) return 'Invalid value'
      if (field === 'done' && value !== null && typeof value !== 'boolean') return 'Invalid done value'
      if (['due_date', 'actual_submit'].includes(field) && value !== null && !validIsoDate(value)) return 'Invalid date'
    }
    if (JSON.stringify(change.before) === JSON.stringify(change.after)) return 'Unchanged value'
  }
  if (!Object.keys(event.changes).length && !event.historyGap) return 'Empty event'
  return null
}

export async function ingestTabActivity(admin, event) {
  const hasChanges = Object.keys(event.changes).length > 0
  const tasks = hasChanges ? await fetchAllRows((from, to) => admin.from('tasks_current').select('task_key')
    .eq('spreadsheet_id', event.spreadsheetId).eq('sheet_gid', event.sheetGid).eq('active', true).eq('done', false).order('task_key').range(from, to)) : []
  const taskKeys = tasks.map((task) => task.task_key)
  if (hasChanges && !taskKeys.length) return

  const inserted = await admin.from('action_events').upsert({
    dedupe_key: event.id,
    occurred_at: event.occurredAt,
    source: event.source,
    kind: hasChanges ? 'project_link_changed' : 'sheet_row_unidentified',
    task_keys: taskKeys,
    spreadsheet_id: event.spreadsheetId,
    sheet_name: event.sheetName || null,
    cell_range: event.range || null,
    actor_email: event.actorEmail || null,
    changes: event.changes,
    history_gap: event.historyGap || null,
  }, { onConflict: 'dedupe_key', ignoreDuplicates: true })
  if (inserted.error) throw inserted.error
  // An edit to a row without a Task ID is recorded for the editor, but cannot reset any task.
  if (!hasChanges) return

  const silentSince = new Date(Date.parse(event.occurredAt) - NO_ACTIVITY_MS).toISOString()
  const resumed = await admin.from('task_activity_state').update({ resumed_at: event.occurredAt })
    .in('task_key', taskKeys).lte('last_activity_at', silentSince)
  if (resumed.error) throw resumed.error

  const updated = await admin.from('task_activity_state').update({
    last_activity_at: event.occurredAt,
    last_activity_kind: 'project_link_changed',
    last_activity_source: event.source,
    last_activity_actor_email: event.actorEmail || null,
    last_activity_actor_inferred: false,
    last_action_changes: event.changes,
    history_gap: event.historyGap || null,
    snoozed_until: null,
    snooze_reason: null,
    snoozed_by: null,
    updated_at: new Date().toISOString(),
  }).in('task_key', taskKeys).lte('last_activity_at', event.occurredAt)
  if (updated.error) throw updated.error
}

export const REVISION_FIRST_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000
// The newest revision keeps growing while someone edits, so each run re-reads a day of overlap.
export const REVISION_OVERLAP_MS = 24 * 60 * 60 * 1000

export async function collectSheetRevisions(admin, { call = callAppsScript, now = new Date() } = {}) {
  const sheets = await admin.from('sheets').select('spreadsheet_id').eq('active', true).order('spreadsheet_id')
  if (sheets.error) throw sheets.error
  const ids = sheets.data.map((sheet) => sheet.spreadsheet_id)
  if (!ids.length) return { revisions: 0, attributed: 0, errors: [] }
  const latest = await admin.from('sheet_revisions').select('modified_at').order('modified_at', { ascending: false }).limit(1)
  if (latest.error) throw latest.error
  const latestAt = latest.data[0] ? Date.parse(latest.data[0].modified_at) : null
  const since = new Date(latestAt ? latestAt - REVISION_OVERLAP_MS : now.getTime() - REVISION_FIRST_LOOKBACK_MS).toISOString()
  const result = await call({ action: 'list_revisions', spreadsheetIds: ids, since }, { timeoutMs: 45_000 })
  if (!result?.success || !Array.isArray(result.files)) throw new Error(result?.error || 'Revision listing failed')
  const errors = [], rows = []
  for (const file of result.files) {
    if (!ids.includes(file.spreadsheetId)) continue
    if (file.error) { errors.push({ spreadsheetId: file.spreadsheetId, error: String(file.error).slice(0, 500) }); continue }
    for (const revision of file.revisions || []) {
      if (!revision.id || !Number.isFinite(Date.parse(revision.modifiedTime))) continue
      rows.push({
        spreadsheet_id: file.spreadsheetId,
        revision_id: String(revision.id).slice(0, 200),
        spreadsheet_name: file.name ? String(file.name).slice(0, 300) : null,
        modified_at: new Date(revision.modifiedTime).toISOString(),
        editor_email: revision.editorEmail ? String(revision.editorEmail).trim().toLowerCase().slice(0, 320) : null,
        editor_name: revision.editorName ? String(revision.editorName).slice(0, 200) : null,
      })
    }
  }
  for (let index = 0; index < rows.length; index += 500) {
    const saved = await admin.from('sheet_revisions').upsert(rows.slice(index, index + 500), { onConflict: 'spreadsheet_id,revision_id' })
    if (saved.error) throw saved.error
  }
  // With no file listed (e.g. Drive access revoked) every event would be finalized as unknown.
  if (errors.length && errors.length === result.files.filter((file) => ids.includes(file.spreadsheetId)).length) return { revisions: 0, attributed: 0, errors }
  const attributed = await admin.rpc('attribute_sheet_actors', { p_since: since, p_collected_at: now.toISOString() })
  if (attributed.error) throw attributed.error
  return { revisions: rows.length, attributed: attributed.data, errors }
}

const EMAIL = /^[a-z0-9._%+-]{1,64}@[a-z0-9.-]{1,253}\.[a-z]{2,}$/i

export async function employeeActivity(context, now = new Date()) {
  const since = new Date(now.getTime() - EMPLOYEE_ACTIVITY_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const [access, events, revisions] = await Promise.all([
    fetchAllRows((from, to) => context.admin.from('access_list').select('email,role,member_name').eq('active', true).order('email').range(from, to)),
    fetchAllRows((from, to) => context.admin.from('action_events')
      .select('occurred_at,actor_email,inferred_actor_email,inferred_actor_name,actor_attribution,task_keys,task_name,project_name,brand_name,spreadsheet_id,sheet_name,cell_range,changes,time_precision')
      .eq('source', 'google_sheet').neq('kind', 'history_backfill').gte('occurred_at', since).order('occurred_at').order('id').range(from, to)),
    fetchAllRows((from, to) => context.admin.from('sheet_revisions').select('spreadsheet_id,spreadsheet_name,modified_at,editor_email,editor_name')
      .gte('modified_at', since).order('modified_at').order('revision_id').range(from, to)),
  ])
  const result = buildEmployeeActivity({ access, events, revisions, now })
  if (['admin', 'manager'].includes(context.access.role)) return result
  // Employees see only their own row.
  const own = context.access.email.toLowerCase()
  return { ...result, items: result.items.filter((item) => item.email === own), unattributed: null }
}

export async function receiveSheetEvents(request, response) {
  const body = typeof request.body === 'string' ? JSON.parse(request.body) : request.body || {}
  if (!validActivitySecret(request.headers['x-activity-secret'], process.env.SHEET_ACTIVITY_SECRET)) return send(response, 401, { error: 'Unauthorized' })
  if (!Array.isArray(body.events) || body.events.length > 50) return send(response, 400, { error: 'Invalid batch' })
  const admin = adminClient()
  const registered = await admin.from('sheets').select('spreadsheet_id').eq('active', true)
  if (registered.error) throw registered.error
  const allowed = new Set(registered.data.map((row) => row.spreadsheet_id))
  const accepted = [], errors = []
  for (const event of body.events) {
    const error = validateSheetEvent(event)
    if (error || !allowed.has(event.spreadsheetId)) { errors.push({ id: event?.id, error: error || 'Unregistered Sheet' }); continue }
    if (event.scope === 'tab') {
      try { await ingestTabActivity(admin, event); accepted.push(event.id) }
      catch (saveError) { errors.push({ id: event.id, error: saveError.message }) }
    } else {
      const saved = await admin.rpc('ingest_sheet_action', { p_event: event })
      if (saved.error) errors.push({ id: event.id, error: saved.error.message })
      else accepted.push(event.id)
    }
  }
  if (Array.isArray(body.health)) {
    for (const health of body.health.slice(0, 100)) {
      if (!allowed.has(health.spreadsheetId)) continue
      const saved = await admin.from('sheet_activity_health').upsert({ spreadsheet_id: health.spreadsheetId,
        checked_at: new Date().toISOString(), pending_count: Math.max(0, Math.min(1000000, Number(health.pendingCount) || 0)),
        error: health.error ? String(health.error).slice(0, 1000) : null,
        installed_gids: Array.isArray(health.installedGids) ? health.installedGids.filter(Number.isInteger).slice(0, 100) : [],
      })
      if (saved.error) throw saved.error
    }
  }
  return send(response, 200, { accepted, errors })
}

export default async function handler(request, response) {
  try {
    if (request.method === 'POST' && request.query?.action === 'ingest') return await receiveSheetEvents(request, response)
    if (request.method === 'POST' && request.query?.action === 'collect-revisions') {
      if (!validCronSecret(request.headers['x-cron-secret'])) return send(response, 401, { error: 'Invalid cron credential' })
      return send(response, 200, await collectSheetRevisions(adminClient()))
    }
    const context = await userContext(request)
    if (context.error) return send(response, context.status, { error: context.error })
    if (request.method === 'POST' && request.query?.action === 'setup') {
      if (context.access.role !== 'admin' || !sameOrigin(request)) return send(response, 403, { error: 'Admin access required' })
      const sheets = await context.admin.from('sheets').select('spreadsheet_id').eq('active', true).order('spreadsheet_id')
      if (sheets.error) throw sheets.error
      const index = Number(request.query.index || 0)
      if (!Number.isInteger(index) || index < 0 || index >= sheets.data.length) return send(response, 400, { error: 'Invalid installation index' })
      if (!process.env.SHEET_ACTIVITY_SECRET || !process.env.APP_URL?.startsWith('https://')) return send(response, 409, { error: 'Configure SHEET_ACTIVITY_SECRET and HTTPS APP_URL first' })
      const result = await callAppsScript({ action: 'install_activity', spreadsheetIds: sheets.data.map((s) => s.spreadsheet_id), targetSpreadsheetId: sheets.data[index].spreadsheet_id, callbackUrl: `${process.env.APP_URL.trim().replace(/\/$/, '')}/api/activity?action=ingest`, activitySecret: process.env.SHEET_ACTIVITY_SECRET }, { timeoutMs: 55000 })
      return send(response, 200, { ...result, nextIndex: result.pending ? index : index + 1 < sheets.data.length ? index + 1 : null, total: sheets.data.length })
    }
    if (request.method !== 'GET') return send(response, 405, { error: 'Method not allowed' })
    const q = request.query || {}
    if (q.view === 'employees') return send(response, 200, await employeeActivity(context))
    if (q.actor && !EMAIL.test(String(q.actor))) return send(response, 400, { error: 'Invalid actor' })
    const limit = 50
    const offset = Number(q.offset || 0)
    if (!Number.isInteger(offset) || offset < 0 || offset > 1000000) return send(response, 400, { error: 'Invalid offset' })
    for (const key of ['from', 'to']) if (q[key] && !validIsoDate(q[key])) return send(response, 400, { error: 'Invalid date filter' })
    let query = context.admin.from('action_events').select('*').order('occurred_at', { ascending: false }).order('id', { ascending: false })
    if (q.personal !== '1') query = query.neq('kind', 'avatar_changed')
    if (q.personal === '1') {
      query = query.eq('kind', 'avatar_changed')
      if (context.access.role !== 'admin') query = query.eq('member_name', context.access.member_name || '')
    } else if (context.access.role !== 'admin') {
      const data = await loadNotificationData(context.admin)
      const keys = data.tasks.filter((task) => task.ownerEmails.includes(context.access.email)).map((task) => task.taskKey)
      if (q.taskKey && !keys.includes(q.taskKey)) return send(response, 403, { error: 'Task access denied' })
      // No raw SQL/PostgREST filter strings are assembled from user-supplied names.
      if (!keys.length) return send(response, 200, { items: [], nextOffset: null })
      query = query.overlaps('task_keys', keys)
    }
    if (q.taskKey) query = query.contains('task_keys', [String(q.taskKey)])
    if (q.ae) query = query.contains('ae_names', [String(q.ae)])
    // EMAIL admits no PostgREST separators, so the value cannot widen this filter.
    if (q.actor) query = query.or(`actor_email.eq.${String(q.actor).toLowerCase()},and(actor_attribution.eq.revision_single_editor,inferred_actor_email.eq.${String(q.actor).toLowerCase()})`)
    if (q.projectId) {
      if (!/^[0-9a-f-]{36}$/i.test(q.projectId)) return send(response, 400, { error: 'Invalid project' })
      query = query.eq('project_id', q.projectId)
    }
    if (q.from) query = query.gte('occurred_at', `${q.from}T00:00:00+07:00`)
    if (q.to) query = query.lte('occurred_at', `${q.to}T23:59:59.999+07:00`)
    const result = await query.range(offset, offset + limit)
    if (result.error) throw result.error
    const notificationData = await loadNotificationData(context.admin)
    const tasksByKey = new Map(notificationData.tasks.map((task) => [task.taskKey, task]))
    const aeNames = new Set(notificationData.members.filter((member) => member.role === 'ae').map((member) => member.name))
    const emailByMember = new Map(notificationData.access.filter((item) => item.member_name && item.email).map((item) => [item.member_name.toLocaleLowerCase('th-TH'), item.email]))
    const items = result.data.slice(0, limit).map((event) => {
      const task = event.task_keys.map((key) => tasksByKey.get(key)).find(Boolean)
      const currentAes = [...new Set(event.task_keys.flatMap((key) => tasksByKey.get(key)?.ownerNames || []).filter((name) => aeNames.has(name)))]
      const historicalWithoutAe = event.dedupe_key?.startsWith('historical:') && !event.ae_names.length
      const displayedAes = event.ae_names.length ? event.ae_names : currentAes
      return {
        ...event,
        brand_name: event.brand_name || task?.brandName || '',
        project_name: event.project_name || task?.projectName || '',
        evidence_source: !event.evidence_source || event.evidence_source === 'application' ? (event.dedupe_key?.startsWith('historical:') ? 'workflow_audit' : event.source) : event.evidence_source,
        time_precision: event.time_precision || 'exact',
        actor_attribution: event.actor_email || event.actor_name ? 'confirmed'
          : event.actor_attribution === 'revision_single_editor' ? 'revision_inferred'
          : event.actor_attribution === 'revision_ambiguous' ? 'revision_ambiguous'
          : historicalWithoutAe ? 'current_ae_unverified' : 'responsible_ae_reference',
        display_ae_names: displayedAes,
        display_ae_emails: displayedAes.map((name) => emailByMember.get(name.toLocaleLowerCase('th-TH'))).filter(Boolean),
      }
    })
    return send(response, 200, { items, nextOffset: result.data.length > limit ? offset + limit : null })
  } catch (error) {
    return send(response, 502, { error: error.message || 'Activity request failed' })
  }
}
