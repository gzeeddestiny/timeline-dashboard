import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
test('database allows different actors to edit legacy notes and preserves conflict protection', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create type public.workflow_status as enum ('not_started','in_progress','waiting_client','blocked');
      create table public.task_workflow (
        task_key text primary key, status public.workflow_status, note text default '',
        priority text, next_action text default '', updated_by uuid,
        updated_at timestamptz, note_version bigint default 0
      );
      insert into public.task_workflow(task_key,status) values ('s:1:t','in_progress');
    `)
    await db.exec(await readFile(new URL('../supabase/migrations/20260918110000_optional_next_action.sql', import.meta.url), 'utf8'))
    const save = (note, version, actor) => db.query(`select * from public.patch_task_workflow(
      's:1:t',null,false,$1,true,null,false,null,false,$2,$3,false
    )`, [note, actor, version])
    const first = '00000000-0000-0000-0000-000000000001'
    const second = '00000000-0000-0000-0000-000000000002'
    await save('First note', 0, first)
    const result = await save('Second note', 1, second)
    assert.equal(result.rows[0].note, 'Second note')
    assert.equal(result.rows[0].updated_by, second)
    assert.equal(result.rows[0].status, 'in_progress')
    await assert.rejects(save('Stale note', 0, first), /NOTE_CONFLICT/)
    for (const status of ['not_started', 'in_progress', 'waiting_client', 'blocked']) {
      const changed = await db.query(`select * from public.patch_task_workflow(
        's:1:t',$1,true,null,false,null,false,null,false,$2,null,false
      )`, [status, first])
      assert.equal(changed.rows[0].status, status)
      assert.equal(changed.rows[0].note, 'Second note')
      assert.equal(changed.rows[0].next_action, '')
    }
    await db.query(`select public.patch_task_workflow(
      's:1:t',null,false,null,false,null,false,'Follow up',true,$1,null,false
    )`, [second])
    const statusOnly = await db.query(`select * from public.patch_task_workflow(
      's:1:t','in_progress',true,null,false,null,false,null,false,$1,null,false
    )`, [first])
    assert.equal(statusOnly.rows[0].next_action, 'Follow up')
    const cleared = await db.query(`select * from public.patch_task_workflow(
      's:1:t',null,false,null,false,null,false,'',true,$1,null,false
    )`, [second])
    assert.equal(cleared.rows[0].next_action, '')
  } finally { await db.close() }
})
