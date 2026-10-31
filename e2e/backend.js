import { Buffer } from "node:buffer";
export const origin = "https://v2-fixture.supabase.co";
const actor = "00000000-0000-0000-0000-000000000001";
export async function mockBackend(page, role = "employee", active = true) {
  await page.routeWebSocket("wss://v2-fixture.supabase.co/**", (socket) => {
    socket.onMessage((message) => {
      const packet = JSON.parse(String(message));
      const array = Array.isArray(packet);
      const [joinRef, ref, topic, event, payload] = array
        ? packet
        : [
            packet.join_ref,
            packet.ref,
            packet.topic,
            packet.event,
            packet.payload,
          ];
      if (
        event === "phx_join" ||
        event === "heartbeat" ||
        event === "phx_leave"
      ) {
        const response =
          event === "phx_join"
            ? {
                postgres_changes: (payload.config?.postgres_changes || []).map(
                  (c, id) => ({ ...c, id }),
                ),
              }
            : {};
        const body = { status: "ok", response };
        socket.send(
          JSON.stringify(
            array
              ? [joinRef, ref, topic, "phx_reply", body]
              : {
                  join_ref: joinRef,
                  ref,
                  topic,
                  event: "phx_reply",
                  payload: body,
                },
          ),
        );
      }
    });
  });
  const user = {
    id: actor,
    aud: "authenticated",
    role: "authenticated",
    email: "fixture@example.test",
    app_metadata: { provider: "google" },
    user_metadata: {},
    created_at: "2026-09-01T00:00:00Z",
  };
  const encode = (v) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const jwt = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: actor, exp: 4102444800, email: user.email, aud: "authenticated", role: "authenticated" })}.fixture-signature`;
  await page.addInitScript(
    ({ key, session }) => sessionStorage.setItem(key, JSON.stringify(session)),
    {
      key: `sb-${new URL(origin).hostname.split(".")[0]}-auth-token`,
      session: {
        access_token: jwt,
        refresh_token: "fixture-only",
        expires_at: 4102444800,
        expires_in: 3600,
        token_type: "bearer",
        user,
      },
    },
  );
  const task = {
    task_key: "fixture:1:t",
    task_id: "t",
    spreadsheet_id: "fixture",
    sheet_gid: 1,
    row_index: 2,
    topic: "งานทดสอบสิทธิ์",
    client_name: "Fixture Brand",
    responsibility: "Tester",
    due_date: "2026-09-25",
    done: false,
    active: true,
  };
  let workflow = {
    task_key: task.task_key,
    status: "not_started",
    note: "original",
    priority: "normal",
    next_action: "",
    note_version: 0,
  };
  let plan = null;
  const tables = {};
  let serial = 0;
  const calls = [];
  let failWorkflow = false;
  let failPlan = false;
  const completions = [];
  let failCompletion = false;
  let pendingCompletion = false;
  let pendingDone = false;
  const syncCalls = [];
  await page.route(`${origin}/**`, async (route) => {
    const u = new URL(route.request().url());
    const table = u.pathname.split("/").at(-1);
    const json = (value) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(value),
      });
    if (u.pathname.includes("/auth/")) return json(user);
    if (table === "access_list") {
      const account = {
        email: user.email,
        role,
        active,
        member_name: "Tester",
      };
      return json(u.searchParams.has("email") ? account : [account]);
    }
    if (table === "tasks_current") return json([task]);
    if (table === "team_members")
      return json([{ name: "Tester", role: "creative" }]);
    if (table === "task_workflow") return json([workflow]);
    if (table === "sync_runs") return json(null);
    if (table === "v2_plans") return json(plan ? [plan] : []);
    if (tables[table]) {
      let rows = tables[table].filter((r) => !r.deleted);
      if (u.searchParams.has('task_key')) rows = rows.filter(row=>row.task_key === u.searchParams.get('task_key').slice(3));
      if (u.searchParams.get("order")?.includes("created_at.desc"))
        rows = [...rows].sort((a,b)=>String(a.created_at) === String(b.created_at) ? (String(a.id) < String(b.id) ? 1 : -1) : (String(a.created_at) < String(b.created_at) ? 1 : -1));
      const cursor = u.searchParams.get('or')?.match(/created_at\.lt\.([^,]+),and\(created_at\.eq\.[^,]+,id\.lt\.([^)]*)/);
      if (cursor) rows = rows.filter(row=>row.created_at < cursor[1] || (row.created_at === cursor[1] && String(row.id) < cursor[2]));
      const offset = Number(u.searchParams.get("offset") || 0),
        limit = Math.min(1000, Number(u.searchParams.get("limit") || 1000));
      return json(rows.slice(offset, offset + limit));
    }
    if (table === "v2_mutate") {
      const body = route.request().postDataJSON();
      calls.push(body);
      if (body.p_action === "plan") {
        if (failPlan) {
          failPlan = false;
          return route.fulfill({
            status: 500,
            contentType: "application/json",
            body: JSON.stringify({
              code: "500",
              message: "Fixture plan failure",
            }),
          });
        }
        const p = body.p_payload;
        if (p.expectedVersion !== (plan?.version || 0))
          return route.fulfill({
            status: 409,
            contentType: "application/json",
            body: JSON.stringify({ code: "40001", message: "PLAN_CONFLICT" }),
          });
        plan = {
          task_key: p.taskKey,
          start_date: p.startDate,
          end_date: p.endDate,
          version: (plan?.version || 0) + 1,
        };
        return json(plan);
      }
      const p = body.p_payload;
      const id = p.id || `fixture-${++serial}`;
      if (body.p_action === "view")
        (tables.v2_saved_views ||= []).push({
          id,
          name: p.name,
          config: p.config,
        });
      if (body.p_action === "layout")
        tables.v2_layouts = [{ owner_id: actor, layout: p.layout }];
      if (body.p_action === "comment") {
        const rows = (tables.v2_comments ||= []);
        const old = rows.find((r) => r.id === id);
        if (old) {
          if (p.expectedVersion !== old.version)
            return route.fulfill({
              status: 409,
              contentType: "application/json",
              body: JSON.stringify({ code: "40001", message: "COMMENT_CONFLICT" }),
            });
          old.body = p.body;
          old.version++;
        } else
          rows.push({
            id,
            task_key: p.taskKey,
            body: p.body,
            author_id: actor,
            author_email: user.email,
            version: 1,
            created_at: new Date().toISOString(),
          });
      }
      if (body.p_action === "remove_comment")
        tables.v2_comments = (tables.v2_comments || []).filter(
          (r) => r.id !== p.id,
        );
      if (body.p_action === "remove_view")
        tables.v2_saved_views = (tables.v2_saved_views || []).filter(
          (r) => r.id !== p.id,
        );
      if (body.p_action === "read_mention") {
        const n = tables.v2_mentions?.find((r) => r.id === p.id);
        if (n) n.read_at = new Date().toISOString();
      }
      return json({});
    }
    return json([]);
  });
  await page.route("**/api/**", async (route) => {
    const u = new URL(route.request().url());
    const json = (body, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (
      u.pathname === "/api/notifications" &&
      u.searchParams.get("action") === "settings"
    ) {
      return json({
        settings: {
          dailyEnabled: false,
          noActivityEnabled: false,
          manualEnabled: false,
          dailyTime: "09:00",
          noActivityTime: "10:00",
          senderName: "Fixture",
          primaryOwnerEmail: "",
        },
        templates: [],
        ownerDigestEmails: [],
        adminOptions: [],
        health: {
          status: "ready",
          deliveryCounts: { failed: 0, unknown: 0 },
          quotaRemaining: 100,
          senderEmail: "fixture@example.test",
        },
        preflight: {
          daily: { recipients: 0, tasks: 0, changedTasks: 0 },
          noActivity: { recipients: 0, tasks: 0 },
          ownerRecipients: 0,
          dataIssues: 0,
        },
      });
    }
    if (u.pathname === "/api/workflow") {
      const body = route.request().postDataJSON();
      calls.push(body);
      if (failWorkflow) {
        failWorkflow = false;
        return json({ error: "Fixture save failure" }, 502);
      }
      if (body.note !== undefined) {
        if (body.expectedNoteVersion !== workflow.note_version)
          return json(
            {
              error: "Note changed",
              currentNote: workflow.note,
              noteVersion: workflow.note_version,
            },
            409,
          );
        workflow = {
          ...workflow,
          note: body.note,
          note_version: workflow.note_version + 1,
        };
      }
      if (body.status) workflow.status = body.status;
      return json({ noteVersion: workflow.note_version });
    }
    if (u.pathname === "/api/sync") {
      syncCalls.push(route.request().method());
      task.done = pendingDone;
      return json({ status: "success" });
    }
    if (u.pathname === "/api/completion") {
      completions.push(route.request().postDataJSON());
      if (failCompletion)
        return json({ error: "Fixture completion failure" }, 502);
      if (pendingCompletion) {
        pendingDone = route.request().postDataJSON().done;
        return json(
          { snapshotPending: true, warning: "Fixture snapshot pending" },
          202,
        );
      }
      task.done = route.request().postDataJSON().done;
      return json({});
    }
    return json({
      items: [],
      nextOffset: null,
      notifications: [],
      preferences: {},
      groups: [],
      dataIssues: [],
      trackingIssues: [],
      tasks: [],
    });
  });
  return {
    calls,
    setActive: value => { active = value; },
    completions,
    syncCalls,
    delayCompletionSnapshot: () => {
      pendingCompletion = true;
    },
    task,
    setRows: (name, rows) => {
      tables[name] = rows;
    },
    failNextPlan: () => {
      failPlan = true;
    },
    setPlan: (value) => {
      plan = value;
    },
    getPlan: () => plan,
    setStatus: (status) => {
      workflow.status = status;
    },
    concurrentNote: () => {
      workflow.note = "other actor";
      workflow.note_version++;
    },
    failNextWorkflow: () => {
      failWorkflow = true;
    },
    failCompletion: () => {
      failCompletion = true;
    },
  };
}
