// Local preview with synthetic data; never sends email or accesses production.
// Run: node scripts/preview-daily-email.mjs
import { createServer } from 'node:http'
import { buildNotificationEmail } from '../src/lib/notificationFormat.js'
import { DEFAULT_NOTIFICATION_TEMPLATES } from '../src/lib/notifications.js'
import { summarizeDigestChanges } from '../src/lib/digestChanges.js'
const now = new Date('2026-09-21T02:00:00Z')
const tasks = [{ taskKey: 'preview:1:task', projectName: 'MAGIC · Autumn Campaign', topic: 'ตรวจและส่ง Campaign Draft ให้ลูกค้า', status: 'in_progress', ownerNames: ['เมย์'], dueDate: '2026-09-20', nextAction: 'ปรับภาพตาม Feedback และส่งให้ลูกค้าตรวจรอบสุดท้าย' }]
const changes = summarizeDigestChanges([{ id: 'sample', task_keys: [tasks[0].taskKey], kind: 'workflow_changed', occurred_at: '2026-09-20T14:30:00+07:00', actor_name: 'เมย์', changes: { status: { before: 'not_started', after: 'in_progress' }, next_action: { before: 'รอ Brief', after: tasks[0].nextAction } } }], tasks, { now })
const render = (owner) => buildNotificationEmail({ template: DEFAULT_NOTIFICATION_TEMPLATES[owner ? 1 : 0], recipientName: owner ? 'Owner' : 'เมย์', tasks, changes, now, digestDate: '2026-09-21', attentionCount: 1, employeeCount: 1, groups: owner ? [{ name: 'เมย์', tasks, total: 1 }] : null, baseUrl: 'https://example.com', viewAllPath: owner ? '/?view=follow_up' : '/?view=my' }).html
const frame = (width, owner) => `<div><h2>${owner ? 'Owner' : 'Employee'} · ${width}px</h2><iframe title="${owner ? 'Owner' : 'Employee'} ${width}" src="/${owner ? 'owner' : 'employee'}" style="width:${width}px;height:1500px;border:1px solid #ccc"></iframe></div>`
createServer((req, res) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(req.url === '/owner' ? render(true) : req.url === '/employee' ? render(false) : `<html><body style="font-family:sans-serif"><h1>Daily email preview · ข้อมูลตัวอย่าง</h1><div style="display:flex;gap:24px;flex-wrap:wrap">${frame(390, false)}${frame(680, true)}</div></body></html>`) }).listen(4179, '127.0.0.1', () => console.log('Preview: http://127.0.0.1:4179'))
