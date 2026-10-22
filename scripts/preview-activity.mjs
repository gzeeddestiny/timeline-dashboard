// Local UI acceptance fixture. No Google Sheet or Supabase writes are performed.
// Run: node scripts/preview-activity.mjs, then open http://127.0.0.1:4178/activity-preview
import { createServer } from 'vite'

let updated = false
let failHistory = false
const key = 'fixture:1:task'
const project = '00000000-0000-0000-0000-000000000002'
const oldTime = new Date(Date.now() - 6 * 86400000).toISOString()
const initialEvent = {
  id: 'initial', occurred_at: oldTime, received_at: oldTime, source: 'dashboard', kind: 'workflow_changed',
  task_keys: [key], task_name: 'ส่ง Draft ให้ลูกค้า', project_id: project, project_name: 'โปรเจกต์ตัวอย่าง',
  ae_names: ['AE ตัวอย่าง'], actor_email: 'ae@example.com', changes: { note: { before: '', after: 'รอ Draft' } },
}
const html = `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module">
import React from 'react';
import { createRoot } from 'react-dom/client';
import FollowUpView from '/src/components/FollowUpView.jsx';
import TaskPanel from '/src/components/TaskPanel.jsx';
import '/src/index.css';
function Preview() {
  const [open,setOpen]=React.useState(false);
  return React.createElement('main',{className:'mx-auto max-w-6xl p-5'},
    React.createElement('div',{className:'mb-5 flex flex-wrap gap-3 text-sm'},
      React.createElement('span',null,'ข้อมูลทดสอบในเครื่อง'),
      React.createElement('button',{className:'ui-button ui-button-secondary',onClick:()=>fetch('/__activity-fixture/update',{method:'POST'})},'จำลอง Action ใหม่'),
      React.createElement('button',{className:'ui-button ui-button-secondary',onClick:()=>fetch('/__activity-fixture/error',{method:'POST'})},'สลับข้อผิดพลาด API')),
    React.createElement(FollowUpView,{onOpenTask:()=>setOpen(true),onManualNotification:()=>{}}),
    open && React.createElement(TaskPanel,{taskKey:'${key}',task:{taskId:'task',spreadsheetId:'fixture',sheetGid:1,topic:'ส่ง Draft ให้ลูกค้า',done:false},configured:true,editable:false,onClose:()=>setOpen(false)}));
}
createRoot(document.getElementById('root')).render(React.createElement(Preview));
</script></body></html>`

const server = await createServer({
  server: { host: '127.0.0.1', port: 4178, strictPort: true },
  plugins: [{
    name: 'activity-acceptance-fixture',
    configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url, 'http://127.0.0.1')
        if (url.pathname === '/activity-preview') {
          res.setHeader('Content-Type', 'text/html')
          return res.end(await vite.transformIndexHtml(url.pathname, html))
        }
        if (url.pathname.startsWith('/__activity-fixture/')) {
          if (url.pathname.endsWith('/update')) updated = true
          if (url.pathname.endsWith('/error')) failHistory = !failHistory
          return res.end('ok')
        }
        if (!['/api/activity', '/api/notifications'].includes(url.pathname)) return next()
        res.setHeader('Content-Type', 'application/json')
        res.setHeader('Cache-Control', 'no-store')
        if (url.pathname === '/api/activity') {
          if (failHistory) { res.statusCode = 503; return res.end(JSON.stringify({ error: 'ข้อผิดพลาด API ทดสอบ' })) }
          const events = updated ? [{ ...initialEvent, id: 'updated', occurred_at: new Date().toISOString(), actor_email: null, source: 'google_sheet', changes: { 'date:gd timeline': { before: '2026-09-07', after: '2026-09-10' } } }, initialEvent] : [initialEvent]
          return res.end(JSON.stringify({ items: events.filter((event) => !url.searchParams.get('ae') || event.ae_names.includes(url.searchParams.get('ae'))), nextOffset: null }))
        }
        return res.end(JSON.stringify({
          items: updated ? [] : [{ taskKey: key, projectName: 'โปรเจกต์ตัวอย่าง', taskName: 'ส่ง Draft ให้ลูกค้า', status: 'in_progress', ownerNames: ['AE ตัวอย่าง'], dueDate: '2026-09-10', daysOverdue: 0, daysSinceUpdate: 6, noActivity: true, nextAction: '', activity: { lastActivityAt: oldTime, lastActivityKind: 'workflow_changed', lastActivitySource: 'dashboard', lastActivityActorEmail: 'ae@example.com', lastActionChanges: initialEvent.changes } }],
          dataIssues: [{ taskKey: key, projectName: 'โปรเจกต์ตัวอย่าง', taskName: 'ส่ง Draft ให้ลูกค้า', issues: ['ไม่มี Next Action'] }], trackingIssues: [],
          historyOptions: { aes: ['AE ตัวอย่าง'], projects: [{ id: project, name: 'โปรเจกต์ตัวอย่าง' }], tasks: [{ key, name: 'ส่ง Draft ให้ลูกค้า' }] },
        }))
      })
    },
  }],
})
await server.listen()
console.log('Activity acceptance fixture: http://127.0.0.1:4178/activity-preview')
