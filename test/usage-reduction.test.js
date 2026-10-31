import test from 'node:test';
import assert from 'node:assert/strict';
import { processNotificationQueue } from '../api/_notifications.js';
import process from 'node:process';
import { runNotificationTick } from '../api/cron-notifications.js';
import { blockedRead, missingSchema } from '../src/lib/readPolicy.js';
function fixture(settings) {
  const calls=[];
  const admin={from(table) {calls.push(table); assert.equal(table,'notification_settings');return {select(){return this},eq(){return this},async single(){return {data:settings}}}}};
  const generated = new Set();
  const generate = async (_admin,_data,now) => { const key=now.toISOString().slice(0,10); const created=!generated.has(key); generated.add(key); return [{created}]; };
  const services={loadNotificationData:async()=>{calls.push('full snapshot');return {}},generateDailyDigest:generate,generateNoActivity:generate,processNotificationQueue:async()=>{calls.push('queue');return {claimed:1,failed:0,sent:1}}};
  return {calls,admin,services};
}
test('Notification cron skips full snapshot off schedule but still processes queued deliveries',async()=>{
  const f=fixture({daily_enabled:true,daily_time:'09:00',no_activity_enabled:true,no_activity_time:'09:15'});
  const result=await runNotificationTick(f.admin,new Date('2026-09-21T06:00:00Z'),f.services);
  assert.deepEqual(f.calls,['notification_settings','queue']);
  assert.equal(result.delivery.sent,1); assert.equal(result.generated.daily,0);
});
test('Notification schedule loads once when due and preserves generator idempotency',async()=>{
  const f=fixture({daily_enabled:true,daily_time:'09:00',no_activity_enabled:false});
  const now=new Date('2026-09-21T02:00:00Z');
  assert.equal((await runNotificationTick(f.admin,now,f.services)).generated.daily,1);
  assert.equal((await runNotificationTick(f.admin,now,f.services)).generated.daily,0);
  assert.equal(f.calls.filter(x=>x==='full snapshot').length,2);
  assert.equal(f.calls.filter(x=>x==='queue').length,2);
});
test('Weekend daily digest and disabled schedules do not load business data',async()=>{
  const f=fixture({daily_enabled:true,daily_time:'09:00',no_activity_enabled:false});
  await runNotificationTick(f.admin,new Date('2026-09-20T02:00:00Z'),f.services);
  assert.deepEqual(f.calls,['notification_settings','queue']);
});
test('Schema, permissions and quota errors stop automatic retry without hiding transient failures',()=>{
  for(const e of [{code:'42P01'},{code:'PGRST205'},{code:'42501'},{status:429},{message:'Egress quota exceeded'}]) assert.equal(blockedRead(e),true);
  assert.equal(missingSchema({code:'PGRST205'}),true);
  assert.equal(blockedRead({status:502,message:'temporary upstream error'}),false);
});

test('No Activity runs on Sunday and shares a single scheduled data load',async()=>{
  const f=fixture({daily_enabled:true,daily_time:'09:00',no_activity_enabled:true,no_activity_time:'09:00'});
  const result=await runNotificationTick(f.admin,new Date('2026-09-20T02:00:00Z'),f.services);
  assert.equal(result.generated.daily,0);assert.equal(result.generated.noActivity,1);
  assert.deepEqual(f.calls,['notification_settings','full snapshot','queue']);
});
test('Queued email retries retain 15 minute backoff and a successful delivery is not claimed twice',async(t)=>{
  const oldUrl=process.env.APPS_SCRIPT_URL,oldSecret=process.env.APPS_SCRIPT_SHARED_SECRET;
  process.env.APPS_SCRIPT_URL='https://fixture.invalid/mail';process.env.APPS_SCRIPT_SHARED_SECRET='fixture';
  t.after(()=>{for(const [name,value] of [['APPS_SCRIPT_URL',oldUrl],['APPS_SCRIPT_SHARED_SECRET',oldSecret]]){if(value===undefined)delete process.env[name];else process.env[name]=value;}});
  let fails=true,status='queued';const updates=[];
  t.mock.method(globalThis,'fetch',async()=>fails ? new Response('{}',{status:503}) : Response.json({success:true,results:[{deliveryId:'delivery',status:'sent'}]}));
  const admin={
    rpc:async()=>({data:status==='sent'?[]:[{id:'delivery',batch_id:'batch',attempts:1}]}),
    from(table){let update=null;const query={select(){return this},eq(){return this},lt(){return this},limit(){return this},in(){return this},single(){return this},update(value){update=value;return this},then(resolve){
      if(update){updates.push(update);status=update.status;return Promise.resolve({data:null}).then(resolve);}
      const data=table==='notification_deliveries'?[]:table==='notification_batches'?[{id:'batch',recipient_email:'fixture@example.test',payload:{email:{subject:'Fixture',htmlBody:'Fixture'}}}]:{sender_name:'Fixture'};
      return Promise.resolve({data}).then(resolve);
    }};return query;}
  };
  const before=Date.now();const failed=await processNotificationQueue(admin);
  assert.equal(failed.failed,1);assert.equal(updates[0].status,'queued');
  assert.ok(Date.parse(updates[0].next_attempt_at)>=before+15*60000);
  fails=false;assert.equal((await processNotificationQueue(admin)).sent,1);
  assert.equal((await processNotificationQueue(admin)).claimed,0);
});
