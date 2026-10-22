import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { PGlite } from '@electric-sql/pglite'
import { ingestTabActivity, validateSheetEvent, validActivitySecret } from '../api/activity.js'
import { actionLabel, changedValues, newestActivityFirst } from '../src/lib/activity.js'
import { taskColumns, taskHeaderValues } from '../src/lib/sheetSchema.js'
import { fetchSheetResource } from '../src/lib/sheetsApi.js'
import { isNoActivity, NO_ACTIVITY_MS } from '../src/lib/notifications.js'

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
  assert.equal(calls.find((call)=>call[0]==='update')[2].last_activity_kind,'project_link_changed')
})

test('120 hour boundary, completion, reopening and snooze', () => {
  const time=Date.parse('2026-09-07T00:00:00Z')
  const state={lastActivityAt:new Date(time-NO_ACTIVITY_MS).toISOString()}
  assert.equal(isNoActivity(state,{done:false},new Date(time-1)),false)
  assert.equal(isNoActivity(state,{done:false},new Date(time)),true)
  assert.equal(isNoActivity(state,{done:true},new Date(time)),false)
  assert.equal(isNoActivity({...state,snoozedUntil:'2026-09-07'},{done:false},new Date(time)),false)
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
`

test('migration and database action lifecycle', async (t) => {
  const db=new PGlite()
  try {
    await db.exec(bootstrap)
    await db.exec(await readFile(new URL('../supabase/migrations/20260907100000_action_history.sql',import.meta.url),'utf8'))
    await db.exec(await readFile(new URL('../supabase/migrations/20260908100000_action_history_evidence.sql',import.meta.url),'utf8'))
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
    await t.test('sync is never an action; unmatched changes flag a gap',async()=>{
      const before=(await rows('select count(*)::int n from public.action_events'))[0].n
      await db.exec("update public.tasks_current set due_date='2026-10-01' where task_id='other'")
      assert.equal((await rows('select count(*)::int n from public.action_events'))[0].n,before)
      assert.match((await rows("select history_gap from public.task_activity_state where task_key='sheet:1:other'"))[0].history_gap,/sync/)
    })
    await t.test('ingestion is service-only and history has no direct authenticated access',async()=>{
      const permissions=(await rows("select has_function_privilege('authenticated','public.ingest_sheet_action(jsonb)','execute') as ingest,has_table_privilege('authenticated','public.action_events','select') as history"))[0]
      assert.deepEqual(permissions,{ingest:false,history:false})
      assert.equal((await rows("select has_function_privilege('authenticated','private.record_action(text,timestamptz,text,text,text[],jsonb,text,uuid,text,text)','execute') as allowed"))[0].allowed,false)
    })
  } finally { await db.close() }
})
