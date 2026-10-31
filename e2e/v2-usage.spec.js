import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { mockBackend, origin } from './backend';
import process from 'node:process';

test('Ten minute My Work background usage benchmark', async ({ page }) => {
  test.setTimeout(60000);
  await mockBackend(page);
  await page.clock.install({ time: new Date('2026-09-21T05:00:00Z') });
  const reads = [];
  const pending = new Set();
  page.on('response', response => {
    if (!response.url().startsWith(origin) || response.request().method() !== 'GET') return;
    const p = response.body().then(body => reads.push({path:new URL(response.url()).pathname, bytes:body.length})).catch(()=>{});
    pending.add(p); p.finally(()=>pending.delete(p));
  });
  await page.goto('/v2/?view=my');
  await expect(page.getByRole('navigation', {name:'เมนู V2'})).toBeVisible();
  await page.clock.runFor(2000);
  await page.waitForLoadState('networkidle');
  await Promise.all([...pending]); reads.length = 0;
  for (let i=0;i<20;i++) {
    await page.clock.runFor(30000);
    await page.waitForLoadState('networkidle');
  }
  await Promise.all([...pending]);
  const result = {requests:reads.length, bytes:reads.reduce((n,r)=>n+r.bytes,0), byPath:{}};
  for (const row of reads) result.byPath[row.path]=(result.byPath[row.path]||0)+1;
  if (process.env.V2_USAGE_OUTPUT) await writeFile(process.env.V2_USAGE_OUTPUT, JSON.stringify(result,null,2));
  expect(result.requests).toBeGreaterThan(0);
  expect(result.requests).toBeLessThanOrEqual(692 * 0.30);
  expect(result.bytes).toBeLessThanOrEqual(28059 * 0.40);
  expect(result.byPath["/rest/v1/notifications"]).toBeLessThanOrEqual(5);
  expect(result.byPath["/rest/v1/access_list"]).toBeLessThanOrEqual(5);
});
