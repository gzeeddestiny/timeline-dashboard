import { createClient } from '@supabase/supabase-js'

const mode = process.argv[2] || '--dry-run'
if (!['--dry-run', '--apply'].includes(mode)) throw new Error('Use --dry-run or --apply')
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) throw new Error('Supabase credentials are required')

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } })
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date())
const { data: tasks, error: taskError } = await db.from('tasks_current')
  .select('task_key,client_name,topic,actual_submit,done,active')
  .eq('active', true).eq('done', false)
  .gte('actual_submit', '2026-09-01').lte('actual_submit', today).limit(5000)
if (taskError) throw taskError

const states = []
for (let index = 0; index < tasks.length; index += 100) {
  const { data, error } = await db.from('task_activity_state').select('task_key,last_activity_at,last_activity_kind')
    .in('task_key', tasks.slice(index, index + 100).map((task) => task.task_key))
  if (error) throw error
  states.push(...data)
}
const stateByKey = new Map(states.map((state) => [state.task_key, state]))
const candidates = tasks.filter((task) => {
  const state = stateByKey.get(task.task_key)
  const eventTime = `${task.actual_submit}T05:00:00.000Z`
  return state?.last_activity_kind === 'task_discovered' || !state?.last_activity_at
    || Date.parse(state.last_activity_at) < Date.parse(eventTime)
})

if (mode === '--apply') {
  for (const task of candidates) {
    const eventTime = `${task.actual_submit}T05:00:00.000Z`
    const dedupeKey = `sheet-current-actual-submit:${task.task_key}:${task.actual_submit}`
    const event = await db.from('action_events').upsert({
      dedupe_key: dedupeKey, occurred_at: eventTime, source: 'google_sheet', kind: 'history_backfill',
      task_keys: [task.task_key], project_name: task.client_name, task_name: task.topic,
      changes: { actual_submit: { before: null, after: task.actual_submit } },
      history_gap: 'ยืนยันวันที่จากค่า Actual Submit ปัจจุบัน แต่ไม่มีเวลาแก้ไขระดับนาที',
      evidence_source: 'sheet_current_actual_submit', time_precision: 'version',
    }, { onConflict: 'dedupe_key', ignoreDuplicates: true })
    if (event.error) throw event.error
    const state = await db.from('task_activity_state').update({
      last_activity_at: eventTime, last_activity_kind: 'history_backfill', last_activity_source: 'google_sheet',
      last_activity_actor_email: null, last_action_changes: { actual_submit: { before: null, after: task.actual_submit } },
      history_gap: null, snoozed_until: null, snooze_reason: null, snoozed_by: null, updated_at: new Date().toISOString(),
    }).eq('task_key', task.task_key)
    if (state.error) throw state.error
  }
}

console.log(JSON.stringify({ mode, today, count: candidates.length, candidates: candidates.map((task) => ({
  project: task.client_name, task: task.topic, actualSubmit: task.actual_submit,
})) }, null, 2))
