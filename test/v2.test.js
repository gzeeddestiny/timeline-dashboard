import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  buildTasks,
  filterTasks,
  csvForTasks,
  dateOnly,
  addDays,
  validatePlan,
  workload,
  dependencyWarnings,
} from "../src/v2/model.js";
import { demoState } from "../src/v2/fixtures.js";

test("V2 date-only planning rejects invalid dates and keeps calendar day boundaries", () => {
  assert.equal(dateOnly("2026-02-30"), "");
  assert.equal(dateOnly("2028-02-29"), "2028-02-29");
  assert.equal(addDays("2026-09-30", 1), "2026-10-01");
  assert.ok(validatePlan("2026-09-21", "2026-09-20"));
  assert.ok(validatePlan("", "2026-09-20"));
  assert.equal(validatePlan("", ""), "");
});
test("V2 ownership matches legacy explicit responsibility then project assignment", () => {
  const state = demoState(2);
  state.brandProjects[0].assignment = { creative: ["Other"] };
  const tasks = buildTasks(state);
  assert.deepEqual(tasks[0].owners, ["Other"]);
  assert.deepEqual(tasks[1].owners, ["Mint"]);
});
test("V2 Thai search, compound filters and 10,000 task model", () => {
  const tasks = buildTasks(demoState(10000));
  assert.equal(tasks.length, 10000);
  const found = filterTasks(
    tasks,
    { search: "ออกแบบ", brand: "LUMI", status: "not_started" },
    "2026-09-20",
  );
  assert.ok(found.length > 0);
  assert.ok(
    found.every(
      (t) => t.brand === "LUMI" && !t.done && t.status === "not_started",
    ),
  );
  assert.equal(
    filterTasks(tasks, { member: "nonexistent" }, "2026-09-20").length,
    0,
  );
});
test("CSV quotes values and neutralizes spreadsheet formula execution", () => {
  const csv = csvForTasks([
    {
      topic: '=HYPERLINK("x")',
      brand: "a,b",
      project: "p",
      owners: ["สมชาย"],
      status: "blocked",
      priority: "high",
      dueDate: "2026-09-20",
    },
  ]);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.ok(csv.includes('"\'=HYPERLINK(""x"")"'));
  assert.ok(csv.includes('"a,b"'));
  assert.ok(csv.includes("สมชาย"));
});
test("Workload counts overlapping intervals and dependency conflicts without moving dates", () => {
  const tasks = [
    { key: "a", owners: ["A"], dueDate: "2026-09-10" },
    { key: "b", owners: ["A"], dueDate: "2026-09-22" },
    { key: "c", owners: [], dueDate: "" },
  ];
  const plans = {
    a: { start_date: "2026-09-20", end_date: "2026-09-23" },
    b: { start_date: "2026-09-23", end_date: "2026-09-25" },
  };
  const rows = workload(tasks, plans, "2026-09-20");
  assert.equal(rows[0].overlap, 2);
  assert.equal(rows[0].overdue, 1);
  assert.equal(rows[0].upcoming, 1);
  assert.equal(rows[1].name, "ยังไม่มีเจ้าของ");
  assert.equal(
    dependencyWarnings([{ predecessor: "a", successor: "b" }], plans).length,
    1,
  );
  assert.equal(plans.b.start_date, "2026-09-23");
});

test("V2 database enforces active access, owner privacy, versions, cycles and legacy isolation", async () => {
  const db = new PGlite();
  const a = "00000000-0000-0000-0000-000000000001",
    b = "00000000-0000-0000-0000-000000000002",
    admin = "00000000-0000-0000-0000-000000000003";
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema private;
      create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
      create function private.current_email() returns text language sql as $$select current_setting('test.email',true)$$;
      create table public.access_list(email text primary key,member_name text,active boolean,role text);
      insert into public.access_list values ('a@test','A',true,'employee'),('b@test','B',true,'manager'),('admin@test','Admin',true,'admin');
      create function private.is_active_user() returns boolean language sql security definer as $$select exists(select 1 from public.access_list where email=private.current_email() and active)$$;
      create function private.is_admin() returns boolean language sql security definer as $$select exists(select 1 from public.access_list where email=private.current_email() and active and role='admin')$$;
      grant usage on schema private,auth to authenticated;grant execute on all functions in schema private,auth to authenticated;
      create table public.tasks_current(task_key text primary key,active boolean,due_date date);
      insert into public.tasks_current values ('s:1:a',true,'2026-09-20'),('s:1:b',true,'2026-09-22'),('s:1:c',true,null),('s:1:inactive',false,null);
      create table public.task_activity_state(task_key text primary key,last_action_at timestamptz);
      insert into public.task_activity_state values ('s:1:a','2026-09-10');
    `);
    await db.exec(
      await readFile(
        new URL(
          "../supabase/migrations/20260920170000_timeline_v2.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const login = async (id, email) => {
      await db.query(
        `select set_config('test.uid',$1,false),set_config('test.email',$2,false)`,
        [id, email],
      );
      await db.exec("set role authenticated");
    };
    const rpc = async (action, payload) =>
      (
        await db.query("select public.v2_mutate($1,$2::jsonb) as value", [
          action,
          JSON.stringify(payload),
        ])
      ).rows[0].value;
    await login(a, "a@test");
    const p = await rpc("plan", {
      taskKey: "s:1:a",
      startDate: "2026-09-01",
      endDate: "2026-09-04",
      expectedVersion: 0,
    });
    assert.equal(p.version, 1);
    await assert.rejects(
      rpc("plan", {
        taskKey: "s:1:a",
        startDate: "2026-09-01",
        endDate: "2026-09-04",
        expectedVersion: 0,
      }),
      /PLAN_CONFLICT/,
    );
    await assert.rejects(
      rpc("plan", {
        taskKey: "s:1:a",
        startDate: "2026-02-30",
        endDate: "2026-03-01",
        expectedVersion: 1,
      }),
      /date|range/i,
    );
    await assert.rejects(
      rpc("plan", {
        taskKey: "s:1:inactive",
        startDate: null,
        endDate: null,
        expectedVersion: 0,
      }),
      /unavailable/,
    );
    await assert.rejects(
      rpc("plan", {
        taskKey: "s:1:a",
        startDate: "2026-09-20",
        endDate: null,
        expectedVersion: 1,
      }),
      /check constraint/,
    );
    const cleared = await rpc("plan", {
      taskKey: "s:1:a",
      startDate: null,
      endDate: null,
      expectedVersion: 1,
    });
    assert.equal(cleared.version, 2);
    assert.equal(cleared.start_date, null);
    await rpc("dependency", { predecessor: "s:1:a", successor: "s:1:b" });
    await rpc("dependency", { predecessor: "s:1:b", successor: "s:1:c" });
    await assert.rejects(
      rpc("dependency", { predecessor: "s:1:c", successor: "s:1:a" }),
      /CYCLE/,
    );
    await assert.rejects(
      rpc("dependency", { predecessor: "s:1:a", successor: "s:1:a" }),
      /Invalid/,
    );
    await assert.rejects(
      rpc("dependency", { predecessor: "s:1:a", successor: "s:1:inactive" }),
      /unavailable/,
    );
    const view = await rpc("view", {
      name: "Private",
      config: { filters: { brand: "LUMI" } },
    });
    await rpc("layout", { layout: [] });
    const comment = await rpc("comment", {
      taskKey: "s:1:a",
      body: "hello @B",
      mentions: ["B", "Nobody"],
    });
    assert.equal(
      (await db.query("select * from public.v2_mentions")).rows.length,
      0,
    );
    await assert.rejects(
      db.query(
        "insert into public.v2_plans(task_key,updated_by) values('s:1:b',$1)",
        [a],
      ),
      /permission denied/,
    );
    await db.exec("reset role");
    await login(b, "b@test");
    assert.equal(
      (await db.query("select * from public.v2_saved_views")).rows.length,
      0,
    );
    assert.equal(
      (await db.query("select * from public.v2_layouts")).rows.length,
      0,
    );
    await assert.rejects(
      rpc("view", { id: view.id, name: "Stolen", config: {} }),
      /Access denied/,
    );
    await assert.rejects(
      rpc("comment", {
        id: comment.id,
        taskKey: "s:1:a",
        body: "edit",
        expectedVersion: 1,
      }),
      /Access denied/,
    );
    const mentions = (await db.query("select * from public.v2_mentions")).rows;
    assert.equal(mentions.length, 1);
    assert.equal(mentions[0].recipient_email, "b@test");
    await rpc("read_mention", { id: mentions[0].id });
    assert.ok(
      (await db.query("select read_at from public.v2_mentions")).rows[0]
        .read_at,
    );
    await db.exec("reset role");
    await login(admin, "admin@test");
    await rpc("comment", {
      id: comment.id,
      taskKey: "s:1:a",
      body: "Moderated",
      expectedVersion: 1,
    });
    await assert.rejects(
      rpc("remove_comment", { id: comment.id, expectedVersion: 1 }),
      /COMMENT_CONFLICT/,
    );
    await rpc("remove_comment", { id: comment.id, expectedVersion: 2 });
    await db.exec("reset role");
    await db.query("update access_list set active=false where email='a@test'");
    await login(a, "a@test");
    assert.equal(
      (await db.query("select * from public.v2_plans")).rows.length,
      0,
    );
    await assert.rejects(
      rpc("view", { name: "No", config: {} }),
      /Access denied/,
    );
    await db.exec("reset role");
    assert.equal(
      (
        await db.query(
          "select due_date::text as d from tasks_current where task_key='s:1:a'",
        )
      ).rows[0].d,
      "2026-09-20",
    );
    assert.equal(
      (
        await db.query(
          "select last_action_at::date::text as d from task_activity_state where task_key='s:1:a'",
        )
      ).rows[0].d,
      "2026-09-10",
    );
    await db.exec("set role anon");
    await assert.rejects(
      rpc("view", { name: "No", config: {} }),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
