import {test,expect} from '@playwright/test';
import {mockBackend,origin} from './backend';
async function ready(page,path='/v2/?view=my') {
  await page.clock.install({time:new Date('2026-09-21T05:00:00Z')});
  await page.goto(path);
  await expect(page.locator('nav[aria-label="เมนู V2"]')).toBeAttached();
  await page.clock.runFor(2000);
  await page.waitForLoadState('networkidle');
}
async function visibility(page,value) {
  await page.evaluate(value=>{Object.defineProperty(document,'visibilityState',{configurable:true,value});document.dispatchEvent(new Event('visibilitychange'));},value);
  await page.waitForLoadState('networkidle');
}
test('Hidden tabs stop reads; foreground checks access and only refreshes stale visible resources',async({page})=>{
  const mock=await mockBackend(page);const urls=[];
  page.on('request',r=>{if(r.url().startsWith(origin)&&r.method()==='GET')urls.push(r.url());});
  await ready(page);
  expect(urls.filter(u=>u.includes('/tasks_current?'))).toHaveLength(1);
  expect(urls.filter(u=>u.includes('/notifications?'))).toHaveLength(1);
  expect(urls.some(u=>/daily_metrics|v2_events|v2_mentions/.test(u))).toBe(false);
  await visibility(page,'hidden');urls.length=0;
  await page.clock.runFor(360000);await page.waitForLoadState('networkidle');
  expect(urls).toHaveLength(0);
  await visibility(page,'visible');
  expect(urls.filter(u=>u.includes('/access_list?'))).toHaveLength(1);
  expect(urls.filter(u=>u.includes('/tasks_current?'))).toHaveLength(1);
  urls.length=0;await visibility(page,'hidden');await visibility(page,'visible');
  expect(urls.filter(u=>u.includes('/tasks_current?'))).toHaveLength(0);
  mock.setActive(false);await visibility(page,'hidden');await visibility(page,'visible');
  await expect(page.getByText('ยังไม่ได้รับสิทธิ์เข้าใช้งาน',{exact:true})).toBeVisible();
  await expect(page.getByRole('navigation',{name:'เมนู V2'})).toHaveCount(0);
});
test('Missing V2 schema latches across navigation and focus until explicit Refresh',async({page})=>{
  await mockBackend(page);let reads=0;
  await page.route(`${origin}/rest/v1/v2_*`,route=>{reads++;return route.fulfill({status:404,json:{code:'PGRST205',message:'Fixture schema missing'}});});
  await ready(page);const initial=reads;expect(initial).toBeGreaterThan(0);
  await page.clock.runFor(360000);await visibility(page,'hidden');await visibility(page,'visible');
  await page.getByRole('navigation',{name:'เมนู V2'}).getByRole('button',{name:'Inbox',exact:true}).click();
  await page.waitForLoadState('networkidle');expect(reads).toBe(initial);
  await page.getByRole('button',{name:'↻ Refresh',exact:true}).first().click();
  await expect.poll(()=>reads).toBeGreaterThan(initial);
});
test('Quota response preserves notifications and stops automatic reads; manual Retry recovers',async({page})=>{
  const mock=await mockBackend(page);mock.setRows('notifications',[{id:'n1',message:'Saved notification',created_at:'2026-09-20T05:00:00Z'}]);
  await ready(page);let reads=0;
  await page.route(`${origin}/rest/v1/notifications?**`,route=>{reads++;return route.fulfill({status:429,json:{message:'Temporarily unavailable'}});});
  await page.clock.runFor(120000);await page.waitForLoadState('networkidle');expect(reads).toBe(1);
  await page.clock.runFor(360000);await visibility(page,'hidden');await visibility(page,'visible');expect(reads).toBe(1);
  await page.getByRole('button',{name:'Notifications ยังไม่อ่าน 1 รายการ'}).first().click();
  await expect(page.getByText('Saved notification',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Notifications ยังไม่อ่าน 1 รายการ'}).first().click();
  await page.unroute(`${origin}/rest/v1/notifications?**`);
  await page.getByRole('button',{name:'Retry',exact:true}).first().click();
  await expect(page.getByText('Temporarily unavailable',{exact:true})).toHaveCount(0);
});
test('Dashboard metrics are lazy and bounded to 30 overall snapshots',async({page})=>{
  await mockBackend(page);const urls=[];page.on('request',r=>{if(r.url().includes('/daily_metrics?'))urls.push(new URL(r.url()));});
  await ready(page);expect(urls).toHaveLength(0);
  await page.getByRole('navigation',{name:'เมนู V2'}).getByRole('button',{name:'Overview',exact:true}).click();
  await expect.poll(()=>urls.length).toBe(1);
  expect(urls[0].searchParams.get('limit')).toBe('30');
  expect(urls[0].searchParams.get('dimension')).toBe('eq.overall');
});
test('Confirmed writes stay saved when the confirmation read fails and never reload the full snapshot',async({page})=>{
  const mock=await mockBackend(page);await ready(page,'/v2/?view=explorer&task=fixture%3A1%3At');
  const reads=[];page.on('request',r=>{if(r.url().startsWith(origin)&&r.method()==='GET')reads.push(new URL(r.url()));});
  await page.route(`${origin}/rest/v1/task_workflow?**`,route=>route.fulfill({status:502,json:{message:'Fixture confirmation unavailable'}}));
  await page.getByRole('dialog').getByRole('combobox',{name:'Workflow',exact:true}).selectOption('in_progress');
  await expect(page.getByRole('alert')).toContainText('บันทึกสำเร็จ');
  expect(mock.calls.filter(c=>c.status==='in_progress')).toHaveLength(1);
  expect(reads.filter(u=>u.pathname.endsWith('/tasks_current'))).toHaveLength(0);
  expect(reads.filter(u=>u.pathname.endsWith('/task_workflow'))).toHaveLength(1);
  expect(reads.find(u=>u.pathname.endsWith('/task_workflow')).searchParams.get('task_key')).toBe('eq.fixture:1:t');
  await expect(page.getByRole('dialog').getByRole('combobox',{name:'Workflow',exact:true})).toHaveValue('in_progress');
  await page.getByLabel('ปิดรายละเอียด').click();
  await expect(page.getByRole('main').getByRole('button',{name:'Retry',exact:true})).toHaveCount(0);
});
test('Reconnect refreshes stale visible queries once without retrying a quota failure',async({page,context})=>{
  await mockBackend(page);await ready(page,'/v2/?view=inbox');let reads=0;
  page.on('request',r=>{if(r.url().includes('/v2_mentions?'))reads++;});
  await visibility(page,'hidden');await context.setOffline(true);await page.clock.runFor(130000);
  await context.setOffline(false);await visibility(page,'visible');
  await expect.poll(()=>reads).toBe(1);
  await page.waitForLoadState('networkidle');expect(reads).toBe(1);
});
