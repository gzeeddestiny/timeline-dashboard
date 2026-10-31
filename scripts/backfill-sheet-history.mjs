import { readFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'

const [file, mode = '--dry-run'] = process.argv.slice(2)
if (!file || !['--dry-run', '--apply'].includes(mode)) {
  console.error('Usage: node scripts/backfill-sheet-history.mjs <evidence.json> [--dry-run|--apply]')
  process.exit(2)
}

const events = JSON.parse(await readFile(file, 'utf8'))
if (!Array.isArray(events) || !events.length) throw new Error('Evidence file must contain events')
const url = process.env.SUPABASE_URL
const secret = process.env.SUPABASE_SECRET_KEY
if (!url || !secret) throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY are required')
const db = createClient(url, secret)
const ids = new Set(), report = []

for (const event of events) {
  const invalid = !event.id?.startsWith('verified_sheet:') || ids.has(event.id)
    || event.evidenceSource !== 'sheet_version_history' || !Date.parse(event.occurredAt)
    || !event.taskKey || !event.changes || !Object.keys(event.changes).length
  ids.add(event.id)
  if (invalid) { report.push({ id: event.id, status: 'invalid' }); continue }
  const task = await db.from('tasks_current').select('task_key,topic,active').eq('task_key', event.taskKey).maybeSingle()
  if (task.error || !task.data) { report.push({ id: event.id, status: 'task_not_found' }); continue }
  const existing = await db.from('action_events').select('id').eq('dedupe_key', event.id).maybeSingle()
  if (existing.error) throw existing.error
  if (existing.data) { report.push({ id: event.id, status: 'duplicate', task: task.data.topic }); continue }
  if (mode === '--dry-run') { report.push({ id: event.id, status: 'ready', task: task.data.topic }); continue }
  const saved = await db.rpc('ingest_verified_history', { p_event: event })
  if (saved.error) throw saved.error
  report.push({ id: event.id, status: saved.data, task: task.data.topic })
}

console.log(JSON.stringify({ mode, total: events.length, counts: Object.groupBy(report, (item) => item.status), report }, null, 2))
