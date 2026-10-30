import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { PGlite } from '@electric-sql/pglite'
import { collectSheetRevisions, ingestTabActivity, validateSheetEvent, validActivitySecret } from '../api/activity.js'
import { actionLabel, changedValues, newestActivityFirst } from '../src/lib/activity.js'
import { taskColumns, taskHeaderValues } from '../src/lib/sheetSchema.js'
import { fetchSheetResource } from '../src/lib/sheetsApi.js'
import { isNoActivity, isRecentlyResumed, NO_ACTIVITY_MS, RESUMED_VISIBLE_MS } from '../src/lib/notifications.js'

const actor = '00000000-0000-0000-0000-000000000001'
const project = '00000000-0000-0000-0000-000000000002'
const event = (id, changes, occurredAt = new Date().toISOString()) => ({ id, spreadsheetId: 'sheet', sheetGid: 1, taskId: 'task', taskKey: 'sheet:1:task', source: 'google_sheet', occurredAt, changes })
const tabEvent = (id, changes, occurredAt = new Date().toISOString()) => ({ id, spreadsheetId: 'sheet', sheetGid: 1, scope: 'tab', source: 'google_sheet', occurredAt, changes })

test('validates webhook identity, secret, time and actual changes', () => {
  assert.equal(validActivitySecret('abc','abc'),true)
  assert.equal(validActivitySecret('abc','ab'),false)
  assert.equal(validActivitySecret('',undefined),false)
  assert.equal(validateSheetEvent(event('id',{done:{before:false,after:true}})),null)
  assert.equal(validateSheetEvent({...event('id',{}),taskKey:'other:1:task'}),'Invalid task identity')
  assert.equal(validateSheetEvent(event('id',{done:{before:true,after:true}})),'Unchanged value')
  assert.equal(validateSheetEvent(event('id',{due_date:{before:null,after:'2026-02-30'}})),'Invalid date')
  assert.equal(validateSheetEvent(event('id',{note:{before:'a',after:'b'}})),'Unsupported field')
  assert.equal(validateSheetEvent(event('remarks',{remarks:{before:'รอ',after:'ส่งแล้ว'}})),null)
  assert.equal(validateSheetEvent(tabEvent('tab-link',{'project_link:link canva':{before:null,after:'https://example.com'}})),null)
  assert.equal(validateSheetEvent(event('id',{},new Date(Date.now()+600000).toISOString())),'Invalid event time')
  assert.deepEqual(changedValues({note:'a',priority:'high'},{note:'',priority:'high'}),{note:{before:'a',after:''}})
  assert.equal(validateSheetEvent({...event('cell',{'cell:status':{before:null,after:'รอลูกค้า'}}),sheetName:'Oct',range:'H12'}),null)
  assert.equal(validateSheetEvent({...event('cell',{'cell:status':{before:null,after:'x'}}),range:'H12; drop'}),'Invalid range')
  assert.equal(validateSheetEvent(tabEvent('tab-cell',{'cell:status':{before:null,after:'x'}})),'Invalid activity scope')
  assert.equal(validateSheetEvent({...tabEvent('unidentified',{}),historyGap:'แก้แถว 4 ที่ยังไม่มี Task ID'}),null)
  assert.equal(actionLabel('cell:status'),'Status')
})

test('an edit to a row without Task ID is history for the editor but resets no task', async () => {
  const calls=[]
  const admin={from:(table)=>({
    select:()=>{throw new Error('should not list tab tasks')},
    upsert:(value)=>{calls.push(['upsert',table,value]);return Promise.resolve({error:null})},
    update:()=>{throw new Error('should not reset activity')},
  })}
  await ingestTabActivity(admin,{...tabEvent('unidentified',{}),historyGap:'แก้แถว 4',actorEmail:'editor@example.com',sheetName:'Oct',range:'A4:F4'})
  const saved=calls[0][2]
  assert.equal(saved.kind,'sheet_row_unidentified')
  assert.deepEqual(saved.task_keys,[])
  assert.equal(saved.sheet_name,'Oct')
  assert.equal(saved.spreadsheet_id,'sheet')
})

test('revision collection stores editors, overlaps a day and isolates file errors', async () => {
  const calls=[]
  const query=(result)=>{const q={select:()=>q,eq:()=>q,order:()=>q,limit:()=>Promise.resolve(result),then:(resolve)=>Promise.resolve(result).then(resolve)};return q}
  const admin={
    from:(table)=>({
      select:()=>table==='sheets'?query({data:[{spreadsheet_id:'sheet'},{spreadsheet_id:'other'}],error:null}):query({data:[{modified_at:'2026-10-29T10:00:00Z'}],error:null}),
      upsert:(rows,options)=>{calls.push(['upsert',table,rows,options]);return Promise.resolve({error:null})},
    }),
    rpc:(name,args)=>{calls.push(['rpc',name,args]);return Promise.resolve({data:2,error:null})},
  }
  const call=async(payload)=>{calls.push(['call',payload]);return {success:true,files:[
    {spreadsheetId:'sheet',name:'Kiss Kitchen',revisions:[{id:'7',modifiedTime:'2026-10-30T02:00:00Z',editorEmail:'Editor@Example.com',editorName:'Editor'}]},
    {spreadsheetId:'other',error:'No access'},
    {spreadsheetId:'unregistered',revisions:[{id:'1',modifiedTime:'2026-10-30T02:00:00Z'}]},
  ]}}
  const result=await collectSheetRevisions(admin,{call,now:new Date('2026-10-30T03:00:00Z')})
  assert.equal(calls[0][1].since,'2026-10-28T10:00:00.000Z')
  const stored=calls.find((c)=>c[0]==='upsert')
  assert.deepEqual(stored[2],[{spreadsheet_id:'sheet',revision_id:'7',spreadsheet_name:'Kiss Kitchen',modified_at:'2026-10-30T02:00:00.000Z',editor_email:'editor@example.com',editor_name:'Editor'}])
  assert.equal(stored[3].onConflict,'spreadsheet_id,revision_id')
  assert.deepEqual(calls.find((c)=>c[0]==='rpc').slice(1),['attribute_sheet_actors',{p_since:'2026-10-28T10:00:00.000Z',p_collected_at:'2026-10-30T03:00:00.000Z'}])
  assert.deepEqual(result,{revisions:1,attributed:2,errors:[{spreadsheetId:'other',error:'No access'}]})
})

test('resolves moved Task ID and all task date headers', () => {
  const columns=taskColumns(['Done','Description','Task ID','Responsibility','Due Date','Actual Submit','GD Timeline','วันที่ถ่าย'])
  assert.equal(columns.valid,true)
  assert.equal(columns.taskId,2)
  assert.equal(columns.responsibility,3)
  assert.deepEqual(columns.dates.map((d)=>d.name),['due date','actual submit','gd timeline','วันที่ถ่าย'])
  const merged=taskColumns(taskHeaderValues([['','Description','Responsibility','Due Date','','','','Task ID'],['','','','','Actual Submit','GD Timeline ','Remarks']],0))
  assert.equal(merged.actualSubmit,4)
  assert.deepEqual(merged.dates.map((d)=>d.name),['due date','actual submit','gd timeline'])
})

test('Apps Script converts checkbox and date event values without losing transitions', async () => {
  const context=vm.createContext({ Date, Utilities:{formatDate:()=> '2026-09-07'} })
  vm.runInContext(await readFile(new URL('../google-apps-script/Code.gs',import.meta.url),'utf8'),context)
  assert.equal(context.activityValue(undefined,'done','Asia/Bangkok'),false)
  assert.equal(context.activityValue('TRUE','done','Asia/Bangkok'),true)
  assert.equal(context.activityValue('FALSE','done','Asia/Bangkok'),false)
  assert.equal(context.activityValue('07/09/2026','due_date','Asia/Bangkok'),'2026-09-07')
  assert.equal(context.activityValue('2026-09-07','date:gd timeline','Asia/Bangkok'),'2026-09-07')
})

test('Project Link activity has a readable Follow-up label', () => {
  assert.equal(actionLabel('project_link:link canva'), 'Project Link · link canva')
  assert.equal(actionLabel('remarks'), 'Remarks')
})

test('tab-scoped Project Link activity updates every unfinished task returned for that tab', async () => {
  const calls=[]
  const chain=(result={data:[],error:null})=>{
    const query={select:()=>query,eq:()=>query,order:()=>query,in:(field,value)=>{calls.push(['in',field,value]);return query},lte:(field,value)=>{calls.push(['lte',field,value]);return query},range:()=>Promise.resolve(result),then:(resolve)=>Promise.resolve(result).then(resolve)}
    return query
  }
  const admin={from:(table)=>({
    select:()=>chain({data:[{task_key:'sheet:1:a'},{task_key:'sheet:1:b'}],error:null}),
    upsert:(value)=>{calls.push(['upsert',table,value]);return Promise.resolve({error:null})},
    update:(value)=>{calls.push(['update',table,value]);return chain()},
  })}
  const input=tabEvent('tab-link',{'project_link:link material':{before:null,after:'https://example.com/material'}})
  await ingestTabActivity(admin,input)
  assert.deepEqual(calls.find((call)=>call[0]==='upsert')[2].task_keys,['sheet:1:a','sheet:1:b'])
  assert.deepEqual(calls.find((call)=>call[0]==='in').slice(1),['task_key',['sheet:1:a','sheet:1:b']])
  assert.equal(calls.find((call)=>call[0]==='update' && call[2].last_activity_kind)[2].last_activity_kind,'project_link_changed')
  assert.equal(calls.find((call)=>call[0]==='update' && call[2].resumed_at)[2].resumed_at,input.occurredAt)
  assert.equal(calls.find((call)=>call[0]==='lte')[2],new Date(Date.parse(input.occurredAt)-NO_ACTIVITY_MS).toISOString())
})

test('120 hour boundary, completion, reopening and snooze', () => {
  const time=Date.parse('2026-09-07T00:00:00Z')
  const state={lastActivityAt:new Date(time-NO_ACTIVITY_MS).toISOString()}
  assert.equal(isNoActivity(state,{done:false},new Date(time-1)),false)
  assert.equal(isNoActivity(state,{done:false},new Date(time)),true)
  assert.equal(isNoActivity(state,{done:true},new Date(time)),false)
  assert.equal(isNoActivity({...state,snoozedUntil:'2026-09-07'},{done:false},new Date(time)),false)
})

test('updated badge lasts 24 hours after a silent task resumes', () => {
  const time=Date.parse('2026-09-07T00:00:00Z')
  const state={lastActivityAt:new Date(time).toISOString(),resumedAt:new Date(time).toISOString()}
  assert.equal(isRecentlyResumed(state,{done:false},new Date(time+RESUMED_VISIBLE_MS-1)),true)
  assert.equal(isRecentlyResumed(state,{done:false},new Date(time+RESUMED_VISIBLE_MS)),false)
  assert.equal(isRecentlyResumed(state,{done:true},new Date(time)),false)
  assert.equal(isRecentlyResumed({lastActivityAt:state.lastActivityAt},{done:false},new Date(time)),false)
})

test('Sheet requests retry transient responses and Follow-up sorts recent actions first', async () => {
  const responses = [503, 429, 200]
  const response = await fetchSheetResource('https://example.test', { fetchImpl: async () => ({ ok: responses[0] === 200, status: responses.shift(), headers: { get: () => '0' } }) })
  assert.equal(response.status, 200)
  const rows = [
    { taskKey: 'old', activity: { lastActivityAt: '2026-09-01T00:00:00Z', lastActivityKind: 'done_changed' } },
    { taskKey: 'none', activity: { lastActivityAt: '2026-09-08T00:00:00Z', lastActivityKind: 'task_discovered' } },
    { taskKey: 'new', activity: { lastActivityAt: '2026-09-04T00:00:00Z', lastActivityKind: 'date_changed' } },
  ]
  assert.deepEqual(rows.sort(newestActivityFirst).map((item) => item.taskKey), ['new', 'old', 'none'])
})

const bootstrap = `
create role anon; create role authenticated; create role service_role;
create schema auth; create schema private;
create table auth.users(id uuid primary key,email text);
create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
create table public.sheets(spreadsheet_id text primary key,active boolean default true);
create table public.tasks_current(task_key text primary key,task_id text,spreadsheet_id text,sheet_gid bigint,row_index int,client_name text,month text,topic text,responsibility text default '',due_date date,actual_submit date,done boolean default false,active boolean default true,removed_at timestamptz,source_synced_at timestamptz);
create table public.sync_runs(id uuid primary key,status text,started_at timestamptz,finished_at timestamptz,task_count int,invalid_row_count int,issues jsonb,error text);
create table public.sync_stage_tasks(run_id uuid,task_key text,task_id text,spreadsheet_id text,sheet_gid bigint,row_index int,client_name text,month text,topic text,responsibility text,due_date date,actual_submit date,done boolean,active boolean,removed_at timestamptz,source_synced_at timestamptz);
create table public.task_activity_state(task_key text primary key references public.tasks_current,first_seen_at timestamptz default now(),last_activity_at timestamptz default now(),last_activity_kind text default 'task_discovered',last_activity_source text default 'system',last_activity_actor_email text,snoozed_until date,snooze_reason text,snoozed_by uuid,updated_at timestamptz default now());
create table public.task_workflow(task_key text primary key,status text default 'not_started',note text default '',priority text,next_action text default '',updated_by uuid);
create table public.team_members(name text primary key,role text,avatar text default '',updated_by uuid);
create table public.brands(tab_key text primary key,brand_name text);
create table public.assignments(brand_key text primary key,value jsonb,updated_by uuid);
create table public.brand_workstreams(id uuid primary key,brand_name text,name text,assignment jsonb,updated_by uuid);
create table public.brand_workstream_sources(tab_key text primary key,workstream_id uuid);
create table public.task_events(id uuid primary key,resource text,record_key text,event_type text,before_value jsonb,after_value jsonb,actor_email text,created_at timestamptz);
create table public.daily_metrics(snapshot_date date,dimension text,dimension_key text,metrics jsonb,source_sync_id uuid,updated_at timestamptz,primary key(snapshot_date,dimension,dimension_key));
insert into auth.users values ('${actor}','editor@example.com');
insert into public.sheets values ('sheet',true);
insert into public.team_members values ('AE One','ae','','${actor}'),('AE Two','ae','','${actor}');
insert into public.brand_workstreams values ('${project}','Brand','Project','{"ae":["AE One","AE Two"]}',null);
insert into public.brand_workstream_sources values ('sheet:1','${project}');
insert into public.tasks_current(task_key,task_id,spreadsheet_id,sheet_gid,row_index,topic,done) values ('sheet:1:task','task','sheet',1,10,'Task',false),('sheet:1:other','other','sheet',1,11,'Other',false),('sheet:1:closed','closed','sheet',1,12,'Closed',true);
insert into public.task_activity_state(task_key) select task_key from public.tasks_current;
create table public.v2_plans(task_key text primary key,start_date date,end_date date,version int default 1,updated_by uuid,updated_at timestamptz default now());
create table public.v2_comments(id uuid primary key default gen_random_uuid(),task_key text,author_id uuid,author_email text,body text,version int default 1,deleted boolean default false);
`

test('migration and database action lifecycle', async (t) => {
  const db=new PGlite()
  try {
    await db.exec(bootstrap)
    await db.exec(await readFile(new URL('../supabase/migrations/20260907100000_action_history.sql',import.meta.url),'utf8'))
    await db.exec(await readFile(new URL('../supabase/migrations/20260908100000_action_history_evidence.sql',import.meta.url),'utf8'))
    await db.exec(await readFile(new URL('../supabase/migrations/20261030100000_sync_detected_activity.sql',import.meta.url),'utf8'))
    await db.exec(`create trigger track_task_source_activity after insert or update on public.tasks_current for each row execute function private.track_task_source_activity();
    create trigger track_workflow_activity after insert or update on public.task_workflow for each row execute function private.track_workflow_activity();`)
    const ingest=async(e)=>db.query('select public.ingest_sheet_action($1::jsonb)',[JSON.stringify(e)])
    const rows=async(sql)=> (await db.query(sql)).rows
    const base=Date.now()
    const at=(n)=>new Date(base+n*1000).toISOString()
    await t.test('verified history replaces discovery baseline without changing current task values and dedupes',async()=>{
      const history={id:'verified_sheet:sheet:revision:task:actual_submit',taskKey:'sheet:1:task',occurredAt:at(-100),actorName:'Editor Name',brandName:'Brand',projectName:'Brand · Project',aeNames:['AE One'],changes:{actual_submit:{before:null,after:'2026-09-01'}},evidenceSource:'sheet_version_history',timePrecision:'minute'}
      assert.equal((await db.query('select public.ingest_verified_history($1::jsonb) result',[JSON.stringify(history)])).rows[0].result,'inserted')
      assert.equal((await db.query('select public.ingest_verified_history($1::jsonb) result',[JSON.stringify(history)])).rows[0].result,'duplicate')
      const saved=(await rows("select actor_name,evidence_source,time_precision from public.action_events where dedupe_key='verified_sheet:sheet:revision:task:actual_submit'"))[0]
      assert.deepEqual(saved,{actor_name:'Editor Name',evidence_source:'sheet_version_history',time_precision:'minute'})
      assert.equal((await rows("select actual_submit from public.tasks_current where task_key='sheet:1:task'"))[0].actual_submit,null)
      assert.equal((await rows("select last_activity_kind from public.task_activity_state where task_key='sheet:1:task'"))[0].last_activity_kind,'history_backfill')
    })
    await t.test('A → B → A keeps two events, retries dedupe, unknown actor is null',async()=>{
      await ingest(event('one',{done:{before:false,after:true}},at(0)))
      await ingest(event('two',{done:{before:true,after:false}},at(1)))
      await ingest(event('two',{done:{before:true,after:false}},at(1)))
      const events=await rows("select * from public.action_events where dedupe_key in ('one','two') order by occurred_at")
      assert.equal(events.length,2)
      assert.deepEqual(events[0].ae_names,['AE One','AE Two'])
      assert.equal(events[0].actor_email,null)
      assert.equal((await rows("select done from public.tasks_current where task_id='task'"))[0].done,false)
    })
    await t.test('older events retain history without reversing state or clearing a newer snooze',async()=>{
      await db.exec("update public.task_activity_state set snoozed_until='2026-12-01',snooze_reason='wait' where task_key='sheet:1:task'")
      await ingest(event('late',{done:{before:false,after:true}},at(-10)))
      const state=(await rows("select * from public.task_activity_state where task_key='sheet:1:task'"))[0]
      assert.equal(new Date(state.last_activity_at).toISOString(),at(1))
      assert.equal(state.snooze_reason,'wait')
      await ingest(event('new-date',{'date:gd timeline':{before:null,after:'2026-09-09'}},at(2)))
      assert.equal((await rows("select snooze_reason from public.task_activity_state where task_key='sheet:1:task'"))[0].snooze_reason,null)
    })
    await t.test('delayed edits to other fields are applied independently',async()=>{
      await ingest(event('older-other-field',{due_date:{before:null,after:'2026-09-08'}},at(-1)))
      const task=(await rows("select done,due_date,source_event_at from public.tasks_current where task_id='task'"))[0]
      assert.equal(task.done,false)
      assert.equal(new Date(task.due_date).toISOString().slice(0,10),'2026-09-08')
      assert.equal(new Date(task.source_event_at).toISOString(),at(2))
    })
    await t.test('Remarks edits reset activity without changing task source fields',async()=>{
      await ingest(event('remarks', { remarks: { before: '', after: 'ส่งงานรอบใหม่' } }, at(3)))
      const state=(await rows("select last_activity_kind,last_action_changes from public.task_activity_state where task_key='sheet:1:task'"))[0]
      assert.equal(state.last_activity_kind,'sheet_fields_changed')
      assert.deepEqual(state.last_action_changes,{remarks:{before:'',after:'ส่งงานรอบใหม่'}})
    })
    await t.test('an uncertain interrupted write is a gap, not a new activity timestamp',async()=>{
      const before=(await rows("select last_activity_at from public.task_activity_state where task_key='sheet:1:task'"))[0]
      await ingest({...event('interrupted',{},at(4)),historyGap:'Interrupted Sheet write'})
      assert.deepEqual((await rows("select last_activity_at from public.task_activity_state where task_key='sheet:1:task'"))[0],before)
      assert.equal((await rows("select history_gap from public.task_activity_state where task_key='sheet:1:task'"))[0].history_gap,'Interrupted Sheet write')
    })
    await t.test('no-op workflow is ignored, notes and priority changes are preserved',async()=>{
      await db.exec(`insert into public.task_workflow(task_key,updated_by) values ('sheet:1:task','${actor}')`)
      let count=(await rows('select count(*)::int n from public.action_events'))[0].n
      await db.exec("update public.task_workflow set note=note")
      assert.equal((await rows('select count(*)::int n from public.action_events'))[0].n,count)
      await db.exec("update public.task_workflow set note='hello',priority='high',status='in_progress',next_action='send'")
      const e=(await rows("select * from public.action_events where kind='workflow_changed'"))[0]
      assert.deepEqual(Object.keys(e.changes).sort(),['next_action','note','priority','status'])
      assert.equal(e.actor_email,'editor@example.com')
      await db.exec("update public.task_workflow set note=''")
      assert.equal((await rows("select count(*)::int n from public.action_events where changes->'note'->>'after'=''"))[0].n,1)
    })
    await t.test('profile logs do not reset task activity',async()=>{
      const before=await rows('select task_key,last_activity_at from public.task_activity_state order by task_key')
      await db.exec("update public.team_members set avatar='https://example.com/a.png' where name='AE One'")
      assert.deepEqual(await rows('select task_key,last_activity_at from public.task_activity_state order by task_key'),before)
      const e=(await rows("select * from public.action_events where kind='avatar_changed'"))[0]
      assert.deepEqual(e.task_keys,[])
      assert.deepEqual(e.ae_names,['AE One'])
    })
    await t.test('project assignment creates one event with only unfinished task keys and immutable AEs',async()=>{
      await db.exec(`set test.actor='${actor}'; update public.brand_workstreams set assignment='{"ae":["AE Two"]}'`)
      const e=(await rows("select * from public.action_events where kind='assignment_changed'"))[0]
      assert.deepEqual(e.task_keys.sort(),['sheet:1:other','sheet:1:task'])
      await ingest(event('delayed-before-assignment',{done:{before:true,after:false}},at(-100)))
      assert.deepEqual((await rows("select ae_names from public.action_events where dedupe_key='delayed-before-assignment'"))[0].ae_names,['AE One','AE Two'])
      assert.deepEqual((await rows("select ae_names from public.action_events where dedupe_key='one'"))[0].ae_names,['AE One','AE Two'])
      await db.exec(`update public.brand_workstreams set assignment='{"ae":["AE One"]}'`)
      assert.deepEqual((await rows("select ae_names from public.action_events where kind='assignment_changed' order by occurred_at desc limit 1"))[0].ae_names,['AE One'])
    })
    await t.test('sync-detected timeline changes are activity with sync precision',async()=>{
      await db.exec("update public.task_activity_state set last_activity_at=now()-interval '200 hours',last_activity_kind='sheet_fields_changed' where task_key='sheet:1:other'")
      const baseline=(await rows('select count(*)::int n from public.action_events'))[0].n
      await db.exec("update public.tasks_current set source_dates='{\"gd timeline\":\"2026-09-29\"}' where task_id='other'")
      assert.equal((await rows('select count(*)::int n from public.action_events'))[0].n,baseline,'first date population is not an edit')
      await db.exec("update public.tasks_current set due_date='2026-10-01',source_dates='{\"gd timeline\":\"2026-09-30\"}' where task_id='other'")
      const e=(await rows("select * from public.action_events where kind='sheet_sync_detected'"))[0]
      assert.deepEqual(e.task_keys,['sheet:1:other'])
      assert.deepEqual(Object.keys(e.changes).sort(),['date:gd timeline','due_date'])
      assert.deepEqual(e.changes.due_date,{before:null,after:'2026-10-01'})
      assert.equal(e.evidence_source,'sync_snapshot')
      assert.equal(e.time_precision,'sync')
      const state=(await rows("select * from public.task_activity_state where task_key='sheet:1:other'"))[0]
      assert.equal(state.last_activity_kind,'sheet_sync_detected')
      assert.equal(new Date(state.resumed_at).toISOString(),new Date(state.last_activity_at).toISOString())
      assert.ok(Date.now()-new Date(state.last_activity_at).getTime()<60_000)
      const count=(await rows('select count(*)::int n from public.action_events'))[0].n
      await db.exec("update public.tasks_current set topic='Other' where task_id='other'")
      assert.equal((await rows('select count(*)::int n from public.action_events'))[0].n,count)
    })
    await t.test('a delayed exact Sheet event replaces the sync-time record of the same edit',async()=>{
      const resumed=(await rows("select resumed_at from public.task_activity_state where task_key='sheet:1:other'"))[0].resumed_at
      const exact={id:'exact-other',spreadsheetId:'sheet',sheetGid:1,taskId:'other',taskKey:'sheet:1:other',source:'google_sheet',occurredAt:at(-30),actorEmail:'editor@example.com',
        changes:{due_date:{before:null,after:'2026-10-01'},'date:gd timeline':{before:null,after:'2026-09-30'}}}
      await ingest(exact)
      assert.equal((await rows("select count(*)::int n from public.action_events where kind='sheet_sync_detected'"))[0].n,0)
      const state=(await rows("select * from public.task_activity_state where task_key='sheet:1:other'"))[0]
      assert.equal(state.last_activity_kind,'sheet_fields_changed')
      assert.equal(new Date(state.last_activity_at).toISOString(),at(-30))
      assert.equal(state.last_activity_actor_email,'editor@example.com')
      assert.deepEqual(state.resumed_at,resumed)
    })
    await t.test('recent activity does not mark a task as resumed',async()=>{
      await db.exec("update public.task_activity_state set resumed_at=null where task_key='sheet:1:other'")
      await db.exec("update public.tasks_current set due_date='2026-10-02' where task_id='other'")
      assert.equal((await rows("select resumed_at from public.task_activity_state where task_key='sheet:1:other'"))[0].resumed_at,null)
    })
    await t.test('V2 plan dates and comments reset activity; no-op writes do not',async()=>{
      await db.exec(`insert into public.v2_plans(task_key,start_date,end_date,updated_by) values ('sheet:1:other','2026-10-01','2026-10-05','${actor}')`)
      let state=(await rows("select * from public.task_activity_state where task_key='sheet:1:other'"))[0]
      assert.equal(state.last_activity_kind,'v2_plan_changed')
      assert.equal(state.last_activity_actor_email,'editor@example.com')
      assert.deepEqual(state.last_action_changes.start_date,{before:null,after:'2026-10-01'})
      const count=(await rows('select count(*)::int n from public.action_events'))[0].n
      await db.exec("update public.v2_plans set version=version+1 where task_key='sheet:1:other'")
      assert.equal((await rows('select count(*)::int n from public.action_events'))[0].n,count)
      await db.exec(`insert into public.v2_comments(task_key,author_id,author_email,body) values ('sheet:1:other','${actor}','editor@example.com','ส่งแบบแล้ว')`)
      state=(await rows("select * from public.task_activity_state where task_key='sheet:1:other'"))[0]
      assert.equal(state.last_activity_kind,'v2_comment')
      assert.deepEqual(state.last_action_changes,{comment:{before:null,after:'ส่งแบบแล้ว'}})
      await db.exec("update public.v2_comments set deleted=true where task_key='sheet:1:other'")
      assert.equal((await rows('select count(*)::int n from public.action_events'))[0].n,count+1)
    })
    await t.test('other cells in a task row are activity with location but never task state',async()=>{
      const before=(await rows("select * from public.tasks_current where task_key='sheet:1:task'"))[0]
      await ingest({...event('status-cell',{'cell:status':{before:null,after:'รอลูกค้า'}},at(20)),sheetName:'October',range:'H10'})
      const saved=(await rows("select spreadsheet_id,sheet_name,cell_range from public.action_events where dedupe_key='status-cell'"))[0]
      assert.deepEqual(saved,{spreadsheet_id:'sheet',sheet_name:'October',cell_range:'H10'})
      const after=(await rows("select * from public.tasks_current where task_key='sheet:1:task'"))[0]
      assert.deepEqual({...after,source_event_at:null,source_event_versions:null},{...before,source_event_at:null,source_event_versions:null})
      const state=(await rows("select last_activity_at,last_action_changes from public.task_activity_state where task_key='sheet:1:task'"))[0]
      assert.equal(new Date(state.last_activity_at).toISOString(),at(20))
      assert.deepEqual(state.last_action_changes,{'cell:status':{before:null,after:'รอลูกค้า'}})
    })
    await t.test('version history names a single hidden editor and never guesses between several',async()=>{
      const minutes=(n)=>new Date(base+n*60_000).toISOString()
      await ingest(event('hidden-single',{remarks:{before:null,after:'one'}},minutes(60)))
      await ingest(event('hidden-shared',{remarks:{before:'one',after:'two'}},minutes(120)))
      await ingest(event('hidden-none',{remarks:{before:'two',after:'three'}},minutes(180)))
      await ingest(event('hidden-pending',{remarks:{before:'three',after:'four'}},minutes(600)))
      await db.exec(`insert into public.sheet_revisions(spreadsheet_id,revision_id,modified_at,editor_email,editor_name) values
        ('sheet','r1','${minutes(64)}','kanya@example.com','Kanya'),
        ('sheet','r2','${minutes(121)}','kanya@example.com','Kanya'),
        ('sheet','r3','${minutes(125)}','somchai@example.com','Somchai')`)
      const count=(await rows(`select public.attribute_sheet_actors('${minutes(59)}','${minutes(600)}') n`))[0].n
      assert.equal(count,3)
      const events=Object.fromEntries((await rows("select dedupe_key,inferred_actor_email,inferred_actor_name,inferred_candidates,actor_attribution from public.action_events where dedupe_key like 'hidden-%'")).map((e)=>[e.dedupe_key,e]))
      assert.deepEqual(events['hidden-single'],{dedupe_key:'hidden-single',inferred_actor_email:'kanya@example.com',inferred_actor_name:'Kanya',inferred_candidates:[],actor_attribution:'revision_single_editor'})
      assert.equal(events['hidden-shared'].actor_attribution,'revision_ambiguous')
      assert.deepEqual(events['hidden-shared'].inferred_candidates,['kanya@example.com','somchai@example.com'])
      assert.equal(events['hidden-shared'].inferred_actor_email,null)
      assert.equal(events['hidden-none'].actor_attribution,'unknown')
      assert.equal(events['hidden-pending'].actor_attribution,null,'revisions for this window are not collected yet')
      // Only the latest task activity carries the inferred editor.
      const state=(await rows("select last_activity_actor_email,last_activity_actor_inferred from public.task_activity_state where task_key='sheet:1:task'"))[0]
      assert.deepEqual(state,{last_activity_actor_email:null,last_activity_actor_inferred:false})
      await db.exec(`insert into public.sheet_revisions(spreadsheet_id,revision_id,modified_at,editor_email,editor_name) values ('sheet','r4','${minutes(602)}','kanya@example.com','Kanya')`)
      await db.query(`select public.attribute_sheet_actors('${minutes(59)}','${minutes(700)}')`)
      assert.deepEqual((await rows("select last_activity_actor_email,last_activity_actor_inferred from public.task_activity_state where task_key='sheet:1:task'"))[0],{last_activity_actor_email:'kanya@example.com',last_activity_actor_inferred:true})
      await ingest({...event('confirmed-later',{remarks:{before:'four',after:'five'}},minutes(700)),actorEmail:'somchai@example.com'})
      assert.deepEqual((await rows("select last_activity_actor_email,last_activity_actor_inferred from public.task_activity_state where task_key='sheet:1:task'"))[0],{last_activity_actor_email:'somchai@example.com',last_activity_actor_inferred:false})
    })
    await t.test('ingestion is service-only and history has no direct authenticated access',async()=>{
      const permissions=(await rows("select has_function_privilege('authenticated','public.ingest_sheet_action(jsonb)','execute') as ingest,has_table_privilege('authenticated','public.action_events','select') as history"))[0]
      assert.deepEqual(permissions,{ingest:false,history:false})
      assert.equal((await rows("select has_function_privilege('authenticated','private.record_action(text,timestamptz,text,text,text[],jsonb,text,uuid,text,text)','execute') as allowed"))[0].allowed,false)
      assert.deepEqual((await rows("select has_function_privilege('authenticated','public.attribute_sheet_actors(timestamptz,timestamptz)','execute') as attribute,has_table_privilege('authenticated','public.sheet_revisions','select') as revisions"))[0],{attribute:false,revisions:false})
    })
  } finally { await db.close() }
})

test('employee summary shows when and where each person last updated a Sheet', async () => {
  const { buildEmployeeActivity } = await import('../api/_employeeActivity.js')
  const now = new Date('2026-10-30T10:00:00Z') // 17:00 Bangkok
  const result = buildEmployeeActivity({
    now,
    access: [{ email: 'kanya@example.com', role: 'employee', member_name: 'Kanya' }, { email: 'silent@example.com', role: 'employee', member_name: 'Silent' }, { email: 'somchai@example.com', role: 'employee', member_name: 'Somchai' }],
    events: [
      { occurred_at: '2026-10-28T03:00:00Z', actor_email: 'Kanya@example.com', task_keys: ['s:1:a'], task_name: 'Old', changes: { done: {} }, spreadsheet_id: 's' },
      { occurred_at: '2026-10-30T02:15:00Z', actor_email: null, inferred_actor_email: 'kanya@example.com', actor_attribution: 'revision_single_editor', task_keys: ['s:1:b'], task_name: 'Banner', project_name: 'Brand · Oct', spreadsheet_id: 's', sheet_name: 'October', cell_range: 'H12', changes: { 'cell:status': {} }, time_precision: 'exact' },
      { occurred_at: '2026-10-30T03:00:00Z', actor_email: null, inferred_actor_email: null, actor_attribution: 'revision_ambiguous', task_keys: ['s:1:c'], changes: {} },
      { occurred_at: '2026-09-01T03:00:00Z', actor_email: 'somchai@example.com', task_keys: ['s:1:d'], changes: { remarks: {} }, spreadsheet_id: 's' },
    ],
    revisions: [
      { spreadsheet_id: 's', spreadsheet_name: 'Kiss Kitchen', modified_at: '2026-10-30T02:20:00Z', editor_email: 'kanya@example.com', editor_name: 'Kanya' },
      { spreadsheet_id: 's', spreadsheet_name: 'Kiss Kitchen', modified_at: '2026-10-29T05:00:00Z', editor_email: 'somchai@example.com', editor_name: 'Somchai' },
      { spreadsheet_id: 's', spreadsheet_name: 'Kiss Kitchen', modified_at: '2026-10-29T06:00:00Z', editor_email: 'freelance@example.com', editor_name: 'Freelance' },
    ],
  })
  assert.deepEqual(result.items.map((item) => item.name), ['Silent', 'Somchai', 'Freelance', 'Kanya'])
  const kanya = result.items.find((item) => item.email === 'kanya@example.com')
  assert.equal(kanya.editsToday, 1)
  assert.equal(kanya.edits7d, 2)
  assert.equal(kanya.activeDays7d, 2)
  assert.deepEqual(kanya.lastEdit, { occurredAt: '2026-10-30T02:15:00Z', spreadsheetName: 'Kiss Kitchen', sheetName: 'October', range: 'H12', taskName: 'Banner', projectName: 'Brand · Oct', taskKey: 's:1:b', fields: ['Status'], precision: 'exact', attribution: 'revision_inferred' })
  assert.equal(kanya.lastUpdateAt, '2026-10-30T02:20:00.000Z')
  assert.equal(kanya.lastUpdateSource, 'revision')
  const somchai = result.items.find((item) => item.email === 'somchai@example.com')
  assert.equal(somchai.lastUpdateSource, 'revision', 'a file edit outside any task row still counts as an update')
  assert.equal(somchai.edits7d, 0)
  assert.equal(result.items.find((item) => item.name === 'Silent').lastUpdateAt, null)
  assert.equal(result.items.find((item) => item.name === 'Freelance').inAccess, false)
  assert.deepEqual(result.unattributed, { count7d: 1, lastAt: '2026-10-30T03:00:00Z' })
})

test('employees only see their own update summary', async () => {
  const { employeeActivity } = await import('../api/activity.js')
  const rows = {
    access_list: [{ email: 'kanya@example.com', role: 'employee', member_name: 'Kanya' }, { email: 'boss@example.com', role: 'admin', member_name: 'Boss' }],
    action_events: [], sheet_revisions: [],
  }
  const admin = { from: (table) => { const q = { select: () => q, eq: () => q, neq: () => q, gte: () => q, order: () => q, range: () => Promise.resolve({ data: rows[table], error: null }) }; return q } }
  const own = await employeeActivity({ admin, access: { email: 'Kanya@example.com', role: 'employee' } })
  assert.deepEqual(own.items.map((item) => item.email), ['kanya@example.com'])
  assert.equal(own.unattributed, null)
  const all = await employeeActivity({ admin, access: { email: 'boss@example.com', role: 'manager' } })
  assert.equal(all.items.length, 2)
})

test('activity migration applies before the V2 tables exist, as in production', async () => {
  const db = new PGlite()
  try {
    await db.exec(bootstrap.split('\n').filter((line) => !/public\.v2_(plans|comments)/.test(line)).join('\n'))
    for (const name of ['20260907100000_action_history', '20260908100000_action_history_evidence', '20261030100000_sync_detected_activity']) {
      await db.exec(await readFile(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), 'utf8'))
    }
    const found = (await db.query("select to_regclass('public.sheet_revisions') is not null as revisions, to_regprocedure('private.track_v2_plan_activity()') is not null as v2_function")).rows[0]
    assert.deepEqual(found, { revisions: true, v2_function: true })
  } finally { await db.close() }
})
