import { timingSafeEqual } from 'node:crypto'
import { adminClient, sameOrigin, send, userContext } from './_supabase.js'
import { loadNotificationData } from './_notifications.js'
import { callAppsScript } from './_appsScript.js'
import { validIsoDate } from '../src/lib/dates.js'
import { fetchAllRows } from '../src/lib/supabasePages.js'

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
  if (!event.changes || Array.isArray(event.changes) || typeof event.changes !== 'object' || JSON.stringify(event.changes).length > 20000) return 'Invalid changes'
  for (const [field, change] of Object.entries(event.changes)) {
    if (!['done', 'due_date', 'actual_submit', 'responsibility', 'description', 'remarks'].includes(field) && !/^date:.{1,100}$/.test(field) && !/^project_link:.{1,100}$/.test(field)) return 'Unsupported field'
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
  const tasks = await fetchAllRows((from, to) => admin.from('tasks_current').select('task_key')
    .eq('spreadsheet_id', event.spreadsheetId).eq('sheet_gid', event.sheetGid).eq('active', true).eq('done', false).order('task_key').range(from, to))
  const taskKeys = tasks.map((task) => task.task_key)
  if (!taskKeys.length) return

  const inserted = await admin.from('action_events').upsert({
    dedupe_key: event.id,
    occurred_at: event.occurredAt,
    source: event.source,
    kind: 'project_link_changed',
    task_keys: taskKeys,
    actor_email: event.actorEmail || null,
    changes: event.changes,
    history_gap: event.historyGap || null,
  }, { onConflict: 'dedupe_key', ignoreDuplicates: true })
  if (inserted.error) throw inserted.error

  const updated = await admin.from('task_activity_state').update({
    last_activity_at: event.occurredAt,
    last_activity_kind: 'project_link_changed',
    last_activity_source: event.source,
    last_activity_actor_email: event.actorEmail || null,
    last_action_changes: event.changes,
    history_gap: event.historyGap || null,
    snoozed_until: null,
    snooze_reason: null,
    snoozed_by: null,
    updated_at: new Date().toISOString(),
  }).in('task_key', taskKeys).lte('last_activity_at', event.occurredAt)
  if (updated.error) throw updated.error
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
        actor_attribution: event.actor_email || event.actor_name ? 'confirmed' : historicalWithoutAe ? 'current_ae_unverified' : 'responsible_ae_reference',
        display_ae_names: displayedAes,
        display_ae_emails: displayedAes.map((name) => emailByMember.get(name.toLocaleLowerCase('th-TH'))).filter(Boolean),
      }
    })
    return send(response, 200, { items, nextOffset: result.data.length > limit ? offset + limit : null })
  } catch (error) {
    return send(response, 502, { error: error.message || 'Activity request failed' })
  }
}
