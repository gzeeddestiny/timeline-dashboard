import test from 'node:test'
import assert from 'node:assert/strict'
import { yesterdayWindow, summarizeDigestChanges } from '../src/lib/digestChanges.js'
import { generateDailyDigest, loadYesterdayChanges } from '../api/_notifications.js'
import { buildNotificationEmail } from '../src/lib/notificationFormat.js'
import { DEFAULT_NOTIFICATION_TEMPLATES } from '../src/lib/notifications.js'

const now = new Date('2026-09-21T02:00:00Z')
const tasks = [{ taskKey: 'a', projectName: 'Brand', topic: 'Done task', done: true, ownerNames: ['May', 'Ton'], ownerEmails: ['may@test', 'ton@test'] }]
const event = { id: '1', kind: 'workflow_changed', occurred_at: '2026-09-20T10:00:00+07:00', task_keys: ['a'], changes: { note: { before: 'old', after: '<script>new</script>' } } }

test('yesterday uses Bangkok calendar boundaries including Monday and year rollover', () => {
  assert.deepEqual(yesterdayWindow(now), { date: '2026-09-20', start: '2026-09-20T00:00:00+07:00', end: '2026-09-21T00:00:00+07:00' })
  assert.equal(yesterdayWindow(new Date('2026-12-31T17:00:00Z')).date, '2026-12-31')
  const events = ['2026-09-19T16:59:59.999Z', '2026-09-19T17:00:00Z', '2026-09-20T16:59:59.999Z', '2026-09-20T17:00:00Z'].map((occurred_at, i) => ({ ...event, id: String(i), occurred_at }))
  assert.deepEqual(summarizeDigestChanges(events, tasks, { now }).events.map((e) => e.id), ['1', '2'])
})

test('changes preserve history, dedupe events, filter noise and respect current task ownership', () => {
  const later = { ...event, id: '2', occurred_at: '2026-09-20T11:00:00+07:00' }
  const events = [later, event, event, { ...event, id: '3', kind: 'task_discovered' }, { ...event, id: '4', kind: 'avatar_changed' }, { ...event, id: '5', changes: {} }, { ...event, id: '6', changes: { note: { before: 'x', after: 'x' } } }, { ...event, id: '7', task_keys: ['other'] }]
  const result = summarizeDigestChanges(events, tasks, { now, personal: true })
  assert.deepEqual(result.events.map((e) => e.id), ['1', '2'])
  assert.equal(result.taskCount, 1)
  assert.equal(result.events[0].actor, 'ไม่ทราบผู้แก้ไข')
  assert.equal(summarizeDigestChanges(events, [], { now, personal: true }).total, 0)
  assert.equal(summarizeDigestChanges(events, tasks, { now }).total, 3)
})

test('limits count events rather than shared-task copies and retain full totals', () => {
  const events = Array.from({ length: 45 }, (_, i) => ({ ...event, id: String(i), task_keys: ['a', 'b'] }))
  for (const limit of [20, 40]) {
    const result = summarizeDigestChanges(events, tasks, { now, limit })
    assert.equal(result.events.length, limit)
    assert.equal(result.total, 45)
    assert.equal(result.remaining, 45 - limit)
    assert.equal(result.taskCount, 2)
  }
})

function fakeAdmin(events) {
  const batches = new Map()
  const filters = []
  return { batches, filters, from(table) {
    if (table === 'action_events') return {
      select() { return this }, gte(key, value) { filters.push(['gte', key, value]); return this }, lt(key, value) { filters.push(['lt', key, value]); return this }, order() { return this },
      range(from, to) { return Promise.resolve({ data: events.slice(from, to + 1) }) },
    }
    if (table === 'notification_deliveries') return { upsert: async () => ({}) }
    if (table === 'notification_batches') return {
      insert(batch) { this.batch = batch; return this }, select() { return this }, eq(key, value) { this.key = value; return this },
      async single() {
        if (this.key) return { data: batches.get(this.key) }
        if (batches.has(this.batch.dedupe_key)) return { error: { code: '23505' } }
        const data = { ...this.batch, id: String(batches.size) }; batches.set(data.dedupe_key, data); return { data }
      },
    }
    throw Error(table)
  } }
}
const data = { tasks, access: [{ member_name: 'May', email: 'may@test', role: 'employee' }, { member_name: 'Ton', email: 'ton@test', role: 'employee' }, { member_name: 'Other', email: 'other@test', role: 'employee' }, { member_name: 'Owner', email: 'owner@test', role: 'admin' }], ownerDigestEmails: new Set(['owner@test']), templates: DEFAULT_NOTIFICATION_TEMPLATES }

test('changes-only sends to current owners and company owner; retry preserves snapshot', async () => {
  const admin = fakeAdmin([event])
  const result = await generateDailyDigest(admin, data, now)
  assert.deepEqual(result.map((r) => r.batch.recipient_email), ['may@test', 'ton@test', 'owner@test'])
  assert.equal(result[2].batch.payload.changes.total, 1)
  assert.equal(result[2].batch.payload.changes.taskCount, 1)
  assert.match(result[0].batch.payload.email.text, /ไม่มีงานที่ต้องติดตามวันนี้/)
  const retry = await generateDailyDigest(admin, data, now)
  assert.ok(retry.every((r) => !r.created))
  assert.equal(admin.batches.size, 3)
  assert.deepEqual(retry[0].batch.payload, result[0].batch.payload)
  assert.deepEqual(admin.filters.slice(0, 2), [['gte', 'occurred_at', '2026-09-20T00:00:00+07:00'], ['lt', 'occurred_at', '2026-09-21T00:00:00+07:00']])
})

test('no work and no changes skips; attention-only and owner data issues still send', async () => {
  assert.equal((await generateDailyDigest(fakeAdmin([]), data, now)).length, 0)
  const active = { ...tasks[0], done: false, dueDate: '2026-09-20', status: 'in_progress', nextAction: 'Review' }
  assert.equal((await generateDailyDigest(fakeAdmin([]), { ...data, tasks: [active] }, now)).length, 3)
  const issuesOnly = { ...active, dueDate: '', status: 'not_started', ownerNames: [], ownerEmails: [] }
  const result = await generateDailyDigest(fakeAdmin([]), { ...data, tasks: [issuesOnly] }, now)
  assert.deepEqual(result.map((r) => r.batch.recipient_email), ['owner@test'])
})

test('history loads every page and propagates query failures', async () => {
  const events = Array.from({ length: 1001 }, (_, i) => ({ ...event, id: String(i) }))
  assert.equal((await loadYesterdayChanges(fakeAdmin(events), now)).length, 1001)
  const admin = fakeAdmin([])
  const original = admin.from
  admin.from = (...args) => ({ ...original(...args), range: async () => ({ error: Error('unavailable') }) })
  await assert.rejects(loadYesterdayChanges(admin, now), /unavailable/)
})

test('daily HTML and text include escaped changes, totals, dates, links and truncation', () => {
  const changes = summarizeDigestChanges([event, { ...event, id: '2' }], tasks, { now, limit: 1 })
  const email = buildNotificationEmail({ template: DEFAULT_NOTIFICATION_TEMPLATES[0], recipientName: 'May', tasks: [], changes, now, digestDate: '2026-09-21', baseUrl: 'https://example.com' })
  assert.match(email.html, /old → <strong>&lt;script&gt;new&lt;\/script&gt;<\/strong>/)
  assert.doesNotMatch(email.html, /<script>/)
  for (const output of [email.html, email.text]) {
    assert.match(output, /เมื่อวานแก้ไขอะไรบ้าง/)
    assert.match(output, /ไม่ทราบผู้แก้ไข/)
    assert.match(output, /ยังมีอีก 1 เหตุการณ์/)
    assert.match(output, /view=my/)
    assert.match(output, /\?task=a/)
  }
  const legacy = buildNotificationEmail({ template: DEFAULT_NOTIFICATION_TEMPLATES[0], baseUrl: 'https://example.com', now })
  assert.match(legacy.html, /ไม่มีการแก้ไขงานที่บันทึกไว้เมื่อวาน/)
})
