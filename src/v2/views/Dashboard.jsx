import { useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { GridLayout, useContainerWidth } from "react-grid-layout";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  LineChart,
  Line,
} from "recharts";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { workload, dateOnly, addDays } from "../model";
const defaults = [
  { i: "status", x: 0, y: 0, w: 6, h: 5, minW: 3, minH: 4 },
  { i: "trend", x: 6, y: 0, w: 6, h: 5, minW: 3, minH: 4 },
  { i: "workload", x: 0, y: 5, w: 6, h: 5, minW: 3, minH: 4 },
  { i: "contracts", x: 6, y: 5, w: 6, h: 5, minW: 3, minH: 4 },
];
export function WorkloadView({ tasks, plans, today, onMember }) {
  const rows = workload(tasks, plans, today);
  return (
    <section className="v2-card">
      <div className="v2-section-head">
        <div>
          <h2>Team workload</h2>
          <p>
            นับงานต่อผู้รับผิดชอบ · งานหลายคนปรากฏในแต่ละคน ·
            ตัวเลขนี้ไม่ใช่ชั่วโมงทำงาน
          </p>
        </div>
      </div>
      <div className="v2-workload">
        {rows.map((r) => (
          <button
            key={r.name}
            onClick={() =>
              onMember(r.name === "ยังไม่มีเจ้าของ" ? "__unassigned" : r.name)
            }
          >
            <div className="v2-avatar">{r.name.slice(0, 2)}</div>
            <strong>{r.name}</strong>
            <span>
              <b>{r.total}</b> งานเปิด
            </span>
            <span className={r.overdue ? "v2-danger" : ""}>
              <b>{r.overdue}</b> เกินกำหนด
            </span>
            <span>
              <b>{r.upcoming}</b> ภายใน 7 วัน
            </span>
            <span>
              <b>{r.overlap}</b> งานซ้อนสูงสุด
            </span>
          </button>
        ))}
        {!rows.length && (
          <div className="v2-empty">ไม่มีงานเปิดในตัวกรองนี้</div>
        )}
      </div>
    </section>
  );
}
export default function Dashboard({
  tasks,
  plans,
  today,
  analytics,
  contracts,
  layout,
  saveLayout,
  onFilter,
  onMember,
  onContracts,
  busy,
}) {
  const [draft, setDraft] = useState(layout || defaults);
  const [snapshot, setSnapshot] = useState(null);
  const { width, containerRef } = useContainerWidth();
  const done = tasks.filter((t) => t.done).length;
  const overdue = tasks.filter(
    (t) => !t.done && dateOnly(t.dueDate) && t.dueDate < today,
  ).length;
  const people = workload(tasks, plans, today).slice(0, 8);
  const stats = [
    {
      name: "Not started",
      value: tasks.filter((t) => !t.done && t.status === "not_started").length,
      status: "not_started",
    },
    {
      name: "In progress",
      value: tasks.filter((t) => !t.done && t.status === "in_progress").length,
      status: "in_progress",
    },
    {
      name: "Waiting client",
      value: tasks.filter((t) => !t.done && t.status === "waiting_client")
        .length,
      status: "waiting_client",
    },
    {
      name: "Hold",
      value: tasks.filter((t) => !t.done && t.status === "blocked").length,
      status: "blocked",
    },
    { name: "Done", value: done, status: "done" },
  ];
  const trend = (analytics?.dailyMetrics || [])
    .filter((r) => r.dimension === "overall")
    .map((r) => ({ date: r.snapshot_date, ...r.metrics }))
    .slice(-30);
  const risk = (contracts || [])
    .filter((c) => c.status === "open")
    .sort((a, b) => String(a.endDate).localeCompare(String(b.endDate)))
    .slice(0, 6);
  const chartStyle = { width: "100%", height: "100%", minHeight: 0 };
  const panels = {
    status: (
      <>
        <h3 className="v2-widget-handle">
          สถานะงาน <span>⠿</span>
        </h3>
        <div className="v2-chart">
          <ResponsiveContainer {...chartStyle}>
            <BarChart data={stats}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Bar
                dataKey="value"
                name="งาน"
                fill="#8052cb"
                radius={[6, 6, 0, 0]}
                onClick={(data) => onFilter(data.status)}
                cursor="pointer"
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </>
    ),
    trend: (
      <>
        <h3 className="v2-widget-handle">
          แนวโน้มทั้งระบบ · 30 snapshot ล่าสุด <span>⠿</span>
        </h3>
        <div className="v2-chart">
          {trend.length ? (
            <ResponsiveContainer {...chartStyle}>
              <LineChart
                data={trend}
                onClick={(chart) => {
                  const row =
                    chart?.activePayload?.[0]?.payload ||
                    trend.find((r) => r.date === chart?.activeLabel);
                  if (row) setSnapshot(row);
                }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Line dataKey="done" name="Done" stroke="#34856a" />
                <Line dataKey="overdue" name="เกินกำหนด" stroke="#c96b46" />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p className="v2-empty">ยังไม่มี snapshot สำหรับแสดงแนวโน้ม</p>
          )}
        </div>
        {trend.length > 0 && (
          <select
            aria-label="ดูข้อมูลต้นทางแนวโน้ม"
            value=""
            onChange={(e) =>
              setSnapshot(trend.find((r) => r.date === e.target.value))
            }
          >
            <option value="">ดู snapshot ตามวันที่…</option>
            {trend.map((r) => (
              <option key={r.date} value={r.date}>
                {r.date}
              </option>
            ))}
          </select>
        )}
      </>
    ),
    workload: (
      <>
        <h3 className="v2-widget-handle">
          ภาระงานทีม <span>⠿</span>
        </h3>
        <div className="v2-widget-list">
          {people.map((p) => (
            <button
              key={p.name}
              onClick={() =>
                onMember(p.name === "ยังไม่มีเจ้าของ" ? "__unassigned" : p.name)
              }
            >
              <span>{p.name}</span>
              <span>
                {p.total} งาน · {p.overdue} เกินกำหนด
              </span>
            </button>
          ))}
          {!people.length && <p className="v2-empty">ไม่มีงานเปิด</p>}
        </div>
      </>
    ),
    contracts: (
      <>
        <h3 className="v2-widget-handle">
          ความเสี่ยงสัญญา · ทั้งระบบ <span>⠿</span>
        </h3>
        <div className="v2-widget-list">
          {risk.map((c) => (
            <button key={c.id} onClick={() => onContracts(c.id)}>
              <span>{c.name}</span>
              <span className={c.endDate < today ? "v2-danger" : ""}>
                {c.endDate || "ไม่กำหนดวัน"} · {c.renewalStatus}
                {c.endDate && c.endDate < today
                  ? " · หมดอายุ"
                  : c.endDate && c.endDate <= addDays(today, 30)
                    ? " · สิ้นสุดภายใน 30 วัน"
                    : ""}
              </span>
            </button>
          ))}
          {!risk.length && <p className="v2-empty">ไม่มีสัญญาที่เปิดอยู่</p>}
        </div>
      </>
    ),
  };
  return (
    <>
      <Dialog.Root
        open={!!snapshot}
        onOpenChange={(open) => {
          if (!open) setSnapshot(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className="v2-drawer-backdrop" />
          <Dialog.Popup className="v2-drawer v2-scope">
            <Dialog.Title>
              ข้อมูลต้นทางของแนวโน้ม · {snapshot?.date}
            </Dialog.Title>
            <Dialog.Description>
              สถิติ daily_metrics ณ วันที่บันทึก ทั้งระบบ
              ไม่ใช่รายการงานปัจจุบัน
            </Dialog.Description>
            <dl>
              {Object.entries(snapshot || {})
                .filter(([k]) => k !== "date")
                .map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>
                      {typeof v === "object" ? JSON.stringify(v) : String(v)}
                    </dd>
                  </div>
                ))}
            </dl>
            <Dialog.Close>ปิดข้อมูลต้นทาง</Dialog.Close>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
      <div className="v2-kpis">
        {[
          ["งานทั้งหมด", tasks.length, ""],
          ["เสร็จแล้ว", done, "done"],
          ["เกินกำหนด", overdue, "overdue"],
          [
            "ความคืบหน้า",
            `${tasks.length ? Math.round((done / tasks.length) * 100) : 0}%`,
            "done",
          ],
        ].map(([label, value, status]) => (
          <button key={label} onClick={() => onFilter(status)}>
            <span>{label}</span>
            <strong>{value}</strong>
            <small>ดูรายการงาน ↗</small>
          </button>
        ))}
      </div>
      <div className="v2-section-head">
        <div>
          <h2>ภาพรวมการทำงาน</h2>
          <p>ลากหัว widget เพื่อจัดตำแหน่ง · ปรับขนาดได้ที่มุมล่าง</p>
        </div>
        <div className="v2-actions">
          <button onClick={() => setDraft(defaults)}>คืนรูปแบบเริ่มต้น</button>
          <button disabled={busy} onClick={() => saveLayout(draft)}>
            บันทึกรูปแบบของฉัน
          </button>
        </div>
      </div>
      <div ref={containerRef}>
        {width < 700 ? (
          <div className="v2-mobile-widgets">
            {Object.entries(panels).map(([key, body]) => (
              <section key={key} className="v2-card v2-widget">
                {body}
              </section>
            ))}
          </div>
        ) : (
          <GridLayout
            width={width}
            layout={draft}
            gridConfig={{ cols: 12, rowHeight: 48, margin: [16, 16] }}
            dragConfig={{ handle: ".v2-widget-handle" }}
            onLayoutChange={setDraft}
          >
            {Object.entries(panels).map(([key, body]) => (
              <section key={key} className="v2-card v2-widget">
                {body}
              </section>
            ))}
          </GridLayout>
        )}
      </div>
    </>
  );
}
