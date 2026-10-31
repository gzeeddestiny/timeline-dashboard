import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Command } from "cmdk";
import { useAuth } from "../lib/auth";
import { isSupabaseConfigured } from "../lib/supabase";
import {
  fetchSystemState,
  fetchSystemAnalytics,
  patchSystemState,
  updateSystemCompletion,
  triggerSystemSync,
  systemSyncStatus,
} from "../lib/fullSystem";
import { bangkokDate } from "../lib/dates";
import NotificationCenter from "./NotificationCenter";
import { mutateV2 } from "./data";
import { useExtras } from "./useExtras";
import { useFeed } from "./useFeed";
import {
  buildTasks,
  filterTasks,
  EMPTY_FILTERS,
  validatePlan,
  WORKFLOW,
} from "./model";
import { quietOptions, READ_INTERVAL, blockedRead } from "../lib/readPolicy";
import { snapshotPatch } from "./snapshot";
import TaskDrawer from "./TaskDrawer";
import logo from "../assets/magic-logo.svg";
const Explorer = lazy(() => import("./views/Explorer"));
const Kanban = lazy(() => import("./views/Kanban"));
const Dashboard = lazy(() => import("./views/Dashboard"));
const Workload = lazy(() =>
  import("./views/Dashboard").then((m) => ({ default: m.WorkloadView })),
);
const Gantt = lazy(() =>
  import("./views/Planning").then((m) => ({ default: m.GanttView })),
);
const Calendar = lazy(() =>
  import("./views/Planning").then((m) => ({ default: m.CalendarView })),
);
const LegacyApp = lazy(() => import("./LegacyApp"));
const EMPTY = {
  tasks: [],
  teamMembers: [],
  brandProjects: [],
  brandContracts: [],
  milestoneOverrides: {},
};
const EXTRA = { plans: {}, dependencies: [], views: [], layout: null };
const NAV = [
  ["dashboard", "◫", "Overview"],
  ["explorer", "☷", "Explorer"],
  ["kanban", "▥", "Kanban"],
  ["gantt", "↔", "Gantt"],
  ["calendar", "▦", "Calendar"],
  ["workload", "◎", "Workload"],
  ["inbox", "✉", "Inbox"],
  ["my", "✓", "My Work"],
  ["brand", "◇", "Brand & contracts"],
  ["follow_up", "◷", "Follow-up"],
  ["tools", "⚙", "ทีม / ตั้งค่า / Sync"],
];
const LEGACY = {
  my: "my",
  brand: "brand",
  follow_up: "follow_up",
  tools: "table",
};
function readSession(key, fallback) {
  try {
    return JSON.parse(sessionStorage.getItem(key)) || fallback;
  } catch {
    return fallback;
  }
}
function currentView() {
  const params = new URLSearchParams(location.search);
  const route = location.pathname.split("/").filter(Boolean)[1];
  return params.get("view") || route || "dashboard";
}
export default function Workspace({ fixture = null }) {
  const { user, access, signOut } = useAuth();
  const client = useQueryClient();
  const id = user?.id || "local";
  const enabled = isSupabaseConfigured && !fixture;
  const [view, setView] = useState(currentView);
  const [selected, setSelected] = useState(
    () => new URLSearchParams(location.search).get("task") || "",
  );
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [tableSettings, setTableSettings] = useState({
    hidden: [],
    pin: true,
    widths: {},
  });
  const [now, setNow] = useState(() => Date.now());
  const [commandSearch, setCommandSearch] = useState("");
  const [command, setCommand] = useState(false);
  const [contractTarget, setContractTarget] = useState(null);
  const [legacyRefresh, setLegacyRefresh] = useState(0);
  const readSnapshot = useCallback(async (force = false) => {
    const queryKey = ["v2-system", id];
    if (force !== true && blockedRead(client.getQueryState(queryKey)?.error)) throw client.getQueryState(queryKey).error;
    if (force === true) await client.invalidateQueries({ queryKey, refetchType: "none" });
    return client.fetchQuery({ queryKey, queryFn: fetchSystemState, staleTime: READ_INTERVAL });
  }, [client, id]);
  const refreshResource = useCallback(async (resource, key) => {
    const queryKey = ["v2-system", id];
    const prior = client.getQueryData(queryKey);
    if (!prior) return readSnapshot(true);
    const next = await snapshotPatch(prior, resource, key);
    client.setQueryData(queryKey, current => {
      const merged = {...current};
      for (const [name,value] of Object.entries(next)) {
        if (value === prior[name]) continue;
        if (key && ['remarks','noteVersions','workflow','priorities','nextActions','assignments'].includes(name)) {
          merged[name] = {...current[name]};
          if (Object.hasOwn(value,key)) merged[name][key] = value[key];
          else delete merged[name][key];
        } else if (resource === 'projectAssignments' && name === 'brandProjects') {
          merged[name] = current[name].map(p => p.id === key ? next[name].find(n => n.id === key) : p);
        } else merged[name] = value;
      }
      return merged;
    });
    return next;
  }, [client, id, readSnapshot]);
  const [viewName, setViewName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const pendingKey = `magic-v2-outbox:${id}`;
  const [pending, setPending] = useState(() => readSession(pendingKey, []));
  const system = useQuery({
    queryKey: ["v2-system", id],
    queryFn: fetchSystemState,
    ...quietOptions(enabled, false),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    initialData: fixture || undefined,
  });
  const extra = useExtras(id, enabled, fixture?.v2);
  const analytics = useQuery({
    queryKey: ["v2-analytics", id],
    queryFn: () => fetchSystemAnalytics({ overallOnly: true }),
    ...quietOptions(enabled && view === "dashboard", false),
  });
  const inbox = useFeed(["v2-inbox", id], "v2_mentions", null, enabled && !extra.error && view === "inbox");
  const state = system.data || EMPTY;
  const extras = extra.data || EXTRA;
  const tasks = useMemo(() => buildTasks(state), [state]);
  const today = bangkokDate();
  const filtered = useMemo(
    () => filterTasks(tasks, filters, today),
    [tasks, filters, today],
  );
  const isAdmin = access?.role === "admin";
  const commandTasks = useMemo(
    () =>
      filterTasks(tasks, { ...EMPTY_FILTERS, search: commandSearch }).slice(
        0,
        60,
      ),
    [tasks, commandSearch],
  );
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  const openTask = useCallback((key) => {
    setSelected(key);
    const url = new URL(location.href);
    url.searchParams.set("task", key);
    history.replaceState(null, "", url);
  }, []);
  const closeTask = () => {
    setSelected("");
    const url = new URL(location.href);
    url.searchParams.delete("task");
    history.replaceState(null, "", url);
  };
  const navigate = useCallback((next) => {
    setView(next);
    setSelected("");
    const url = new URL(location.href);
    url.pathname = "/v2/";
    url.searchParams.set("view", next);
    url.searchParams.delete("task");
    history.pushState(null, "", url);
  }, []);
  useEffect(() => {
    const listener = () => {
      setView(currentView());
      setSelected(new URLSearchParams(location.search).get("task") || "");
    };
    addEventListener("popstate", listener);
    return () => removeEventListener("popstate", listener);
  }, []);
  useEffect(() => {
    const listener = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCommand((o) => !o);
      }
    };
    addEventListener("keydown", listener);
    return () => removeEventListener("keydown", listener);
  }, []);
  useEffect(() => {
    try {
      sessionStorage.setItem(pendingKey, JSON.stringify(pending));
    } catch {
      /* best-effort session outbox */
    }
  }, [pending, pendingKey]);
  const refresh = useCallback(async () => {
    setLegacyRefresh((v) => v + 1);
    await Promise.all([
      readSnapshot(true),
      extra.refetch(),
      client.invalidateQueries({ queryKey: ["v2-analytics", id] }),
      view === "inbox" ? inbox.refetch() : Promise.resolve(),
    ]);
  }, [client, id, readSnapshot, extra, inbox, view]);
  const mutate = useCallback(
    async (action, payload) => {
      if (!enabled) {
        setError("โหมดตัวอย่างอ่านอย่างเดียว");
        return false;
      }
      if (lock.current) return false;
      lock.current = true;
      setBusy(true);
      setError("");
      try {
        const result = await mutateV2(action, payload);
        const kind = {plan:'plans',dependency:'dependencies',remove_dependency:'dependencies',view:'views',remove_view:'views',layout:'layouts'}[action];
        if (kind) await client.invalidateQueries({queryKey:['v2-extra',id,kind]});
        await client.invalidateQueries({queryKey:['v2-events',id]});
        if (action.includes('comment')) {
          client.setQueriesData({queryKey:['v2-comments',id]}, rows => Array.isArray(rows) ? action === 'remove_comment' ? rows.filter(row=>row.id !== payload.id) : rows.map(row=>row.id === result?.id ? result : row) : rows);
          await client.invalidateQueries({queryKey:['v2-comments',id,payload.taskKey].filter(Boolean),exact:!!payload.taskKey});
        }
        if (action === 'read_mention' || action.includes('comment')) await client.invalidateQueries({queryKey:['v2-inbox',id],exact:true});
        return true;
      } catch (e) {
        setError(e.message);
        if (e.code === "40001") {
          if (action === "plan") await client.invalidateQueries({ queryKey: ["v2-extra", id, "plans"] });
          if (action.includes("comment")) await client.invalidateQueries({ queryKey: ["v2-comments", id, payload.taskKey], exact: true });
        }
        return false;
      } finally {
        lock.current = false;
        setBusy(false);
      }
    },
    [enabled, client, id],
  );
  const savePlan = useCallback(
    async (key, start, end, version) => {
      const message = validatePlan(start, end);
      if (message) {
        setError(message);
        return false;
      }
      return mutate("plan", {
        taskKey: key,
        startDate: start || null,
        endDate: end || null,
        expectedVersion: version,
      });
    },
    [mutate],
  );
  const write = useCallback(
    async (resource, key, value, options = {}) => {
      if (!enabled) {
        setError("โหมดตัวอย่างอ่านอย่างเดียว");
        return false;
      }
      if (lock.current) return false;
      lock.current = true;
      setBusy(true);
      setError("");
      const pendingId = `${resource}:${key}`;
      try {
        const result = await patchSystemState(resource, key, value, options);
        client.setQueryData(['v2-system',id], current => {
          if (!['remarks','workflow','priorities','nextActions'].includes(resource)) return current;
          const updated = {...current,[resource]:{...current[resource],[key]:value}};
          if (Number.isInteger(result?.noteVersion)) updated.noteVersions = {...current.noteVersions,[key]:result.noteVersion};
          return updated;
        });
        setPending((p) => p.filter((x) => x.id !== pendingId));
        try { await refreshResource(resource, key); }
        catch (confirmationError) { setError(`บันทึกสำเร็จ แต่อ่านข้อมูลล่าสุดไม่สำเร็จ: ${confirmationError.message} — กด Refresh เพื่อตรวจอีกครั้ง`); }
        window.dispatchEvent(new Event("timeline:activity"));
        return true;
      } catch (e) {
        setError(e.message);
        if (e.status === 409)
          await refreshResource(resource, key).catch(() => {});
        else
          setPending((p) => [
            ...p.filter((x) => x.id !== pendingId),
            { id: pendingId, resource, key, value, options },
          ]);
        return false;
      } finally {
        lock.current = false;
        setBusy(false);
      }
    },
    [enabled, refreshResource, client, id],
  );
  const complete = async (task, done) => {
    if (!enabled) {
      setError("โหมดตัวอย่างอ่านอย่างเดียว");
      return false;
    }
    if (lock.current) return false;
    lock.current = true;
    setBusy(true);
    setError("");
    const previous = client.getQueryData(["v2-system", id]);
    client.setQueryData(["v2-system", id], (old) => ({
      ...old,
      tasks: old.tasks.map((t) =>
        t.taskId === task.taskId &&
        t.spreadsheetId === task.spreadsheetId &&
        t.sheetGid === task.sheetGid
          ? { ...t, done, actualSubmit: done ? today : "" }
          : t,
      ),
    }));
    try {
      const result = await updateSystemCompletion(
        task,
        done,
        done ? today : null,
      );
      if (result.snapshotPending) {
        setError(
          result.warning || "Sheets บันทึกแล้ว กำลังรอ snapshot จาก Sync",
        );
        try {
          const started = await triggerSystemSync(true);
          if (started?.status === "running") {
            if (!started.runId) throw new Error("ไม่พบหมายเลข Sync");
            for (let attempt = 0; attempt < 60; attempt++) {
              const current = await systemSyncStatus(started.runId);
              if (current.status === "success") break;
              if (current.status === "failed")
                throw new Error(current.error || "Sync failed");
              if (attempt === 59)
                throw new Error("Sync ยังไม่เสร็จ ตรวจ Data Health");
              await new Promise((resolve) => setTimeout(resolve, 1500));
            }
          }
          setError("");
        } catch (syncError) {
          // Sheets has already accepted the completion. Do not falsely roll it back.
          setError(
            `Sheets บันทึกแล้ว แต่ ${syncError.message} — ตรวจ Sync ในทีม / ตั้งค่า / Sync`,
          );
          return true;
        }
      }
      await client.invalidateQueries({ queryKey: ["v2-system", id] });
      window.dispatchEvent(new Event("timeline:activity"));
      return true;
    } catch (e) {
      client.setQueryData(["v2-system", id], previous);
      setError(`${e.message} — คืนค่าหน้าจอแล้ว`);
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const filterStatus = (status) => {
    setFilters((f) => ({ ...f, status }));
    navigate("explorer");
  };
  const filterMember = (member) => {
    setFilters((f) => ({ ...f, member, status: "open" }));
    navigate("explorer");
  };
  const chosen = tasks.find((t) => t.key === selected);
  const loadView = (id) => {
    const saved = extras.views.find((v) => v.id === id);
    if (saved) {
      setFilters({ ...EMPTY_FILTERS, ...saved.config.filters });
      setTableSettings(
        saved.config.tableSettings || { hidden: [], pin: true, widths: {} },
      );
      navigate(saved.config.view || "explorer");
    }
  };
  const visibleNav = NAV.filter(([v]) => v !== "follow_up" || isAdmin);
  const legacy = view === "follow_up" && !isAdmin ? null : LEGACY[view];
  const taskProps = {
    tasks: filtered,
    openTask,
    plans: extras.plans,
    dependencies: extras.dependencies,
    savePlan,
    busy,
  };
  return (
    <div className="v2-scope v2-shell">
      <aside className="v2-sidebar">
        <a className="v2-brand" href="/v2/">
          <img src={logo} alt="MAGIC" />
          <span>
            MAGIC
            <small>
              WORKSPACE <b>V2</b>
            </small>
          </span>
        </a>
        <p className="v2-nav-label">YOUR WORKSPACE</p>
        <nav aria-label="เมนู V2">
          {visibleNav.map(([key, icon, label]) => (
            <button
              key={key}
              aria-label={label}
              className={view === key ? "active" : ""}
              onClick={() => navigate(key)}
            >
              <span aria-hidden="true">{icon}</span>
              {label}
              {key === "inbox" &&
                !!inbox.data?.filter((n) => !n.read_at).length && (
                  <b>{inbox.data.filter((n) => !n.read_at).length}</b>
                )}
            </button>
          ))}
        </nav>
        <div className="v2-sidebar-bottom">
          <a href="/v2-licenses.txt" target="_blank" rel="noreferrer">
            Open-source licenses
          </a>
          <strong>
            {access?.member_name || user?.email || "Local preview"}
          </strong>
          <small>{access?.role}</small>
          <button
            onClick={async () => {
              client.clear();
              await signOut();
            }}
          >
            ออกจากระบบ
          </button>
        </div>
      </aside>
      <div className="v2-main">
        <header className="v2-topbar">
          <span>
            MAGIC /{" "}
            <strong>
              {NAV.find((n) => n[0] === view)?.[2] || "Workspace"}
            </strong>
          </span>
          <div className="v2-actions">
            <button
              className="v2-search-trigger"
              onClick={() => setCommand(true)}
            >
              ค้นหางานและคำสั่ง <kbd>⌘ K</kbd>
            </button>
            <button disabled={busy || system.isFetching || !enabled} onClick={refresh}>
              {system.isFetching ? "กำลังโหลด…" : "↻ Refresh"}
            </button>
            <NotificationCenter
              configured={enabled}
              email={user?.email}
              onOpenTask={openTask}
              onOpenContract={(id) => {
                setContractTarget(id);
                navigate("brand");
              }}
              onOpenAttention={() => navigate(isAdmin ? "follow_up" : "my")}
            />
          </div>
        </header>
        <main className="v2-content">
          <div className="v2-page-heading">
            <div>
              <p>MAKE EVERY DAY COUNT</p>
              <h1>{NAV.find((n) => n[0] === view)?.[2] || "Workspace"}</h1>
              <span>{today} · ข้อมูลล่าสุดของทีม</span>
            </div>
            <span className="v2-freshness">
              {system.dataUpdatedAt
                ? `อ่านล่าสุด ${new Date(system.dataUpdatedAt).toLocaleTimeString("th-TH")}`
                : "รอข้อมูล"}
            </span>
          </div>
          {fixture && (
            <div className="v2-warning">
              ข้อมูลตัวอย่างสำหรับตรวจหน้าเว็บเท่านั้น · อ่านอย่างเดียว
            </div>
          )}
          {(error || system.error) && (
            <div role="alert" className="v2-error">
              {error || system.error.message}
              <button onClick={() => setError("")}>ปิด</button>
            </div>
          )}
          {analytics.error && view === "dashboard" && (
            <p role="alert" className="v2-warning">
              โหลดแนวโน้มไม่ได้: {analytics.error.message} · กด Refresh
              เพื่อลองใหม่
            </p>
          )}
          {extra.error && (
            <div role="alert" className="v2-warning">
              ส่วนเสริม V2 ยังไม่พร้อม: {extra.error.message} · ต้องติดตั้ง
              migration V2 ก่อนบันทึกแผนหรือความคิดเห็น
            </div>
          )}
          {state.updatedAt &&
            now - new Date(state.updatedAt).valueOf() > 86400000 && (
              <div className="v2-warning">
                ข้อมูล Sheets เก่ากว่า 24 ชั่วโมง ตรวจ Sync ในทีม / ตั้งค่า /
                Sync
              </div>
            )}
          {pending.length > 0 && (
            <div className="v2-warning">
              มี {pending.length} รายการบันทึกไม่สำเร็จใน session นี้
              <button
                disabled={busy}
                onClick={async () => {
                  for (const item of pending)
                    if (
                      !(await write(
                        item.resource,
                        item.key,
                        item.value,
                        item.options,
                      ))
                    )
                      break;
                }}
              >
                Retry
              </button>
              <button disabled={busy} onClick={() => setPending([])}>
                ล้างรายการรอ
              </button>
            </div>
          )}
          {!legacy && view !== "inbox" && (
            <section className="v2-filterbar" aria-label="ตัวกรองงาน">
              <input
                aria-label="ค้นหางาน"
                value={filters.search}
                onChange={(e) =>
                  setFilters({ ...filters, search: e.target.value })
                }
                placeholder="ค้นหางาน แบรนด์ โปรเจกต์…"
              />
              {[
                [
                  "brand",
                  "ทุกแบรนด์",
                  [...new Set(tasks.map((t) => t.brand))].map((b) => [b, b]),
                ],
                [
                  "project",
                  "ทุกโปรเจกต์",
                  (state.brandProjects || [])
                    .filter((p) => p.active !== false)
                    .map((p) => [p.id, `${p.brandName} · ${p.name}`]),
                ],
                [
                  "member",
                  "ทุกคน",
                  [
                    ["__unassigned", "ยังไม่มีเจ้าของ"],
                    ...(state.teamMembers || []).map((m) => [m.name, m.name]),
                  ],
                ],
                [
                  "status",
                  "ทุกสถานะ",
                  [
                    ...WORKFLOW,
                    ["open", "ยังไม่เสร็จ"],
                    ["done", "Done"],
                    ["overdue", "เกินกำหนด"],
                  ],
                ],
                [
                  "priority",
                  "ทุก Priority",
                  ["normal", "high", "urgent"].map((s) => [s, s]),
                ],
                [
                  "group",
                  "ไม่จัดกลุ่ม",
                  [
                    ["brand", "จัดตามแบรนด์"],
                    ["project", "จัดตามโปรเจกต์"],
                    ["owners", "จัดตามทีม"],
                  ],
                ],
              ].map(([key, label, options]) => (
                <select
                  key={key}
                  aria-label={label}
                  value={filters[key]}
                  onChange={(e) =>
                    setFilters({ ...filters, [key]: e.target.value })
                  }
                >
                  <option value="">{label}</option>
                  {options.map(([value, text]) => (
                    <option key={value} value={value}>
                      {text}
                    </option>
                  ))}
                </select>
              ))}
              <label>
                จาก
                <input
                  type="date"
                  aria-label="กำหนดส่งจาก"
                  value={filters.from}
                  onChange={(e) =>
                    setFilters({ ...filters, from: e.target.value })
                  }
                />
              </label>
              <label>
                ถึง
                <input
                  type="date"
                  aria-label="กำหนดส่งถึง"
                  value={filters.to}
                  onChange={(e) =>
                    setFilters({ ...filters, to: e.target.value })
                  }
                />
              </label>
              <button onClick={() => setFilters(EMPTY_FILTERS)}>
                ล้างตัวกรอง
              </button>
              <div className="v2-saved-views">
                <select
                  aria-label="มุมมองที่บันทึก"
                  value=""
                  onChange={(e) => loadView(e.target.value)}
                >
                  <option value="">มุมมองของฉัน</option>
                  {extras.views.map((v) => (
                    <option value={v.id} key={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
                <input
                  aria-label="ชื่อมุมมอง"
                  value={viewName}
                  maxLength={80}
                  placeholder="ชื่อมุมมองใหม่"
                  onChange={(e) => setViewName(e.target.value)}
                />
                <button
                  disabled={!viewName.trim() || busy || !!extra.error}
                  onClick={async () => {
                    if (
                      await mutate("view", {
                        name: viewName,
                        config: { view, filters, tableSettings },
                      })
                    )
                      setViewName("");
                  }}
                >
                  บันทึกมุมมอง
                </button>
                <details>
                  <summary>จัดการมุมมอง</summary>
                  {extras.views.map((v) => (
                    <div key={v.id}>
                      {v.name}
                      <button
                        onClick={() => mutate("remove_view", { id: v.id })}
                      >
                        ลบ
                      </button>
                    </div>
                  ))}
                </details>
              </div>
            </section>
          )}
          <Suspense fallback={<div className="v2-empty">กำลังโหลดมุมมอง…</div>}>
            {legacy ? (
              <LegacyApp
                readSnapshot={readSnapshot}
                refreshResource={refreshResource}
                key={view}
                initialView={legacy}
                initialContractId={contractTarget}
                refreshToken={legacyRefresh}
              />
            ) : view === "explorer" ? (
              <Explorer
                {...taskProps}
                filters={filters}
                settings={tableSettings}
                setSettings={setTableSettings}
              />
            ) : view === "kanban" ? (
              <Kanban
                {...taskProps}
                update={(key, status) => write("workflow", key, status)}
              />
            ) : view === "gantt" ? (
              <Gantt {...taskProps} />
            ) : view === "calendar" ? (
              <Calendar {...taskProps} milestones={state.milestoneOverrides} />
            ) : view === "workload" ? (
              <Workload {...taskProps} today={today} onMember={filterMember} />
            ) : view === "inbox" ? (
              <section className="v2-card">
                <div className="v2-section-head">
                  <h2>กล่าวถึงฉัน</h2>
                </div>
                {inbox.error && <p role="alert">{inbox.error.message}</p>}
                {(inbox.data || []).map((n) => (
                  <button
                    className={`v2-inbox-item ${n.read_at ? "" : "unread"}`}
                    key={n.id}
                    onClick={async () => {
                      await mutate("read_mention", { id: n.id });
                      openTask(n.task_key);
                    }}
                  >
                    <strong>{n.actor_email} กล่าวถึงคุณ</strong>
                    <span>
                      {tasks.find((t) => t.key === n.task_key)?.topic ||
                        "งานไม่อยู่ใน snapshot ปัจจุบัน"}
                    </span>
                    <small>
                      {new Date(n.created_at).toLocaleString("th-TH")}
                    </small>
                  </button>
                ))}
                {inbox.hasNext && (
                  <button disabled={inbox.isFetchingMore} onClick={inbox.loadMore}>
                    โหลดการกล่าวถึงเพิ่มเติม
                  </button>
                )}
                {!inbox.data?.length && (
                  <div className="v2-empty">ยังไม่มีการกล่าวถึง</div>
                )}
              </section>
            ) : (
              <Dashboard
                key={JSON.stringify(extras.layout)}
                {...taskProps}
                today={today}
                analytics={analytics.data}
                contracts={state.brandContracts}
                layout={extras.layout}
                saveLayout={(layout) => mutate("layout", { layout })}
                onFilter={filterStatus}
                onMember={filterMember}
                onContracts={(id) => {
                  setContractTarget(id);
                  navigate("brand");
                }}
              />
            )}
          </Suspense>
          {selected && !chosen && !system.isFetching && (
            <div className="v2-warning">
              ไม่พบงานนี้ในข้อมูลปัจจุบัน
              <button onClick={closeTask}>ปิด</button>
            </div>
          )}
          {chosen && (
            <TaskDrawer
              key={chosen.key}
              task={chosen}
              tasks={tasks}
              state={state}
              extras={extras}
              user={user}
              isAdmin={isAdmin}
              onClose={closeTask}
              write={write}
              complete={complete}
              savePlan={savePlan}
              mutate={mutate}
              busy={busy}
              errorMessage={error}
              enabled={enabled && !extra.error}
            />
          )}
        </main>
      </div>
      <Command.Dialog
        open={command}
        onOpenChange={setCommand}
        label="ค้นหางานและคำสั่ง"
        className="v2-command"
        shouldFilter={false}
      >
        <Command.Input
          value={commandSearch}
          onValueChange={setCommandSearch}
          placeholder="ค้นหางาน แบรนด์ โปรเจกต์ หรือชื่อคน…"
        />
        <Command.List>
          <Command.Empty>ไม่พบผลลัพธ์</Command.Empty>
          <Command.Group heading="มุมมอง">
            {visibleNav.map(([key, , label]) => (
              <Command.Item
                key={key}
                onSelect={() => {
                  navigate(key);
                  setCommand(false);
                }}
              >
                {label}
              </Command.Item>
            ))}
          </Command.Group>
          <Command.Group heading="งาน">
            {commandTasks.map((t) => (
              <Command.Item
                key={t.key}
                value={`${t.key} ${t.topic} ${t.brand} ${t.project} ${t.owners.join(" ")}`}
                onSelect={() => {
                  openTask(t.key);
                  setCommand(false);
                }}
              >
                {t.topic}
                <small>
                  {t.brand} · {t.project}
                </small>
              </Command.Item>
            ))}
          </Command.Group>
        </Command.List>
      </Command.Dialog>
    </div>
  );
}
