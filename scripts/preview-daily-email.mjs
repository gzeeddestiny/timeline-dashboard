// Local preview with synthetic data; never sends email or accesses production.
// Run: node scripts/preview-daily-email.mjs
import { createServer } from 'node:http'
import { buildNotificationEmail } from '../src/lib/notificationFormat.js'
import { DEFAULT_NOTIFICATION_TEMPLATES } from '../src/lib/notifications.js'
import { summarizeDigestChanges } from '../src/lib/digestChanges.js'
const now = new Date('2026-09-21T02:00:00Z')
const template = (type, audience = 'employee') => DEFAULT_NOTIFICATION_TEMPLATES.find((item) => item.templateType === type && item.audience === audience)
const tasks = [
  { taskKey: 'preview:1:task', projectName: 'MAGIC · Autumn Campaign', topic: 'ตรวจและส่ง Campaign Draft ให้ลูกค้า', status: 'in_progress', ownerNames: ['เมย์'], dueDate: '2026-09-20', nextAction: 'ปรับภาพตาม Feedback และส่งให้ลูกค้าตรวจรอบสุดท้าย', updatedRecently: true, activity: { lastActivityAt: '2026-09-20T15:25:00+07:00', lastActivityKind: 'sheet_sync_detected' } },
  { taskKey: 'preview:1:stale', projectName: 'MAGIC · Autumn Campaign', topic: 'สรุปผล KOL รอบแรก', status: 'waiting_client', ownerNames: ['เมย์'], dueDate: '2026-09-25', nextAction: 'รอลูกค้าอนุมัติ', noActivity: true, activity: { lastActivityAt: '2026-09-12T10:00:00+07:00', lastActivityKind: 'workflow_changed' } },
]
const changes = summarizeDigestChanges([
  { id: 'sample', task_keys: [tasks[0].taskKey], kind: 'workflow_changed', occurred_at: '2026-09-20T14:30:00+07:00', actor_name: 'เมย์', changes: { status: { before: 'not_started', after: 'in_progress' }, next_action: { before: 'รอ Brief', after: tasks[0].nextAction } } },
  { id: 'sync', task_keys: [tasks[0].taskKey], kind: 'sheet_sync_detected', occurred_at: '2026-09-20T15:25:00+07:00', time_precision: 'sync', actor_attribution: 'revision_single_editor', inferred_actor_name: 'เมย์', changes: { 'date:gd timeline': { before: '2026-09-22', after: '2026-09-24' } } },
], tasks, { now })
const pages = {
  employee: () => buildNotificationEmail({ template: template('daily_digest'), recipientName: 'เมย์', tasks, changes, now, digestDate: '2026-09-21', attentionCount: 2, resumedCount: 1, baseUrl: 'https://example.com', viewAllPath: '/?view=my' }).html,
  owner: () => buildNotificationEmail({ template: template('daily_digest', 'owner'), recipientName: 'Owner', tasks, changes, now, digestDate: '2026-09-21', attentionCount: 2, resumedCount: 1, employeeCount: 1, groups: [{ name: 'เมย์', tasks, total: 2 }], baseUrl: 'https://example.com', viewAllPath: '/?view=follow_up' }).html,
  'no-activity': () => buildNotificationEmail({ template: template('no_activity'), recipientName: 'เมย์', tasks: [tasks[1]], staleCount: 1, resumedTasks: [tasks[0]], now, baseUrl: 'https://example.com', viewAllPath: '/?view=my&attention=no_activity' }).html,
}
const frame = (width, name) => `<div><h2>${name} · ${width}px</h2><iframe title="${name} ${width}" src="/${name}" style="width:${width}px;height:1500px;border:1px solid #ccc"></iframe></div>`
createServer((req, res) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); const page = pages[req.url.slice(1)]; res.end(page ? page() : `<html><body style="font-family:sans-serif"><h1>Email preview · ข้อมูลตัวอย่าง</h1><div style="display:flex;gap:24px;flex-wrap:wrap">${frame(390, 'employee')}${frame(680, 'owner')}${frame(680, 'no-activity')}</div></body></html>`) }).listen(4179, '127.0.0.1', () => console.log('Preview: http://127.0.0.1:4179'))
