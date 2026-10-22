import { useEffect, useMemo, useRef, useState } from "react";
import { createOwnedGantt } from "../ganttAdapter";
import "../../../node_modules/frappe-gantt/dist/frappe-gantt.css";
import FullCalendar from "@fullcalendar/react";
import dayGrid from "@fullcalendar/react/daygrid";
import list from "@fullcalendar/react/list";
import interaction from "@fullcalendar/react/interaction";
import theme from "@fullcalendar/react/themes/monarch";
import th from "@fullcalendar/react/locales/th";
import "@fullcalendar/react/skeleton.css";
import "@fullcalendar/react/themes/monarch/theme.css";
import "@fullcalendar/react/themes/monarch/palettes/purple.css";
import { addDays, dateOnly, dependencyWarnings } from "../model";
import { milestoneForTask } from "../../lib/brandTimeline";
function safeLabel(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
function localDay(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function GanttView({
  tasks,
  plans,
  dependencies,
  openTask,
  savePlan,
  busy,
}) {
  const node = useRef(null);
  const [mode, setMode] = useState("Week");
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(tasks.length / 200));
  const currentPage = Math.min(page, pages - 1);
  const current = useMemo(
    () => tasks.slice(currentPage * 200, (currentPage + 1) * 200),
    [tasks, currentPage],
  );
  const scheduled = useMemo(
    () =>
      current.filter((t) => plans[t.key]?.start_date && plans[t.key]?.end_date),
    [current, plans],
  );
  const warnings = dependencyWarnings(dependencies, plans);
  useEffect(() => {
    if (!node.current || !scheduled.length) return;
    const element = node.current;
    let active = true;
    const ids = new Map(scheduled.map((t, i) => [t.key, `v2-task-${i}`]));
    const keys = new Map([...ids].map(([key, id]) => [id, key]));
    const rows = scheduled.map((t) => ({
      id: ids.get(t.key),
      name: safeLabel(t.topic),
      start: plans[t.key].start_date,
      end: plans[t.key].end_date,
      progress: t.done ? 100 : 0,
      dependencies: dependencies
        .filter((d) => d.successor === t.key && ids.has(d.predecessor))
        .map((d) => ids.get(d.predecessor)),
    }));
    const { chart, dispose } = createOwnedGantt(element, rows, {
      view_mode: mode,
      view_mode_select: false,
      container_height: 460,
      readonly_dates: busy,
      readonly_progress: true,
      move_dependencies: false,
      popup: false,
      on_click: (t) => openTask(keys.get(t.id)),
      on_date_change: (t, start, end) => {
        savePlan(
          keys.get(t.id),
          localDay(start),
          localDay(end),
          plans[keys.get(t.id)]?.version || 0,
        ).then((ok) => {
          if (!ok && active && element.isConnected) chart.refresh(rows);
        });
      },
    });
    return () => {
      active = false;
      dispose();
    };
  }, [scheduled, plans, dependencies, mode, openTask, savePlan, busy]);
  return (
    <section className="v2-card" aria-busy={busy}>
      <div className="v2-section-head">
        <div>
          <h2>Project timeline</h2>
          <p>
            วันตามแผนแยกจาก Google Sheets · dependency ไม่เลื่อนงานอัตโนมัติ
          </p>
        </div>
        <div className="v2-actions">
          <select
            aria-label="ช่วงเวลา Gantt"
            value={mode}
            onChange={(e) => setMode(e.target.value)}
          >
            {["Day", "Week", "Month"].map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
          <button
            disabled={!currentPage}
            onClick={() => setPage(currentPage - 1)}
          >
            ←
          </button>
          <span>
            {currentPage + 1} / {pages}
          </span>
          <button
            disabled={currentPage >= pages - 1}
            onClick={() => setPage(currentPage + 1)}
          >
            →
          </button>
        </div>
      </div>
      {warnings.length > 0 && (
        <p className="v2-warning">
          มี {warnings.length} ความสัมพันธ์ที่วันแผนขัดกัน ตรวจในรายละเอียดงาน
        </p>
      )}
      <div ref={node} className="v2-gantt" />
      {!scheduled.length && (
        <div className="v2-empty">
          ยังไม่มีช่วงแผนในหน้านี้ · เปิดงานเพื่อกำหนดวันเริ่มและวันสิ้นสุด
        </div>
      )}
      <div className="v2-plan-list">
        <h3>แผนเทียบกำหนดส่งจริง · สูงสุด 200 งานต่อหน้า</h3>
        {current.map((t) => (
          <button key={t.key} onClick={() => openTask(t.key)}>
            <span>{t.topic}</span>
            <span>
              {plans[t.key]?.start_date
                ? `${plans[t.key].start_date} → ${plans[t.key].end_date}`
                : "ยังไม่วางแผน"}
            </span>
            <strong>กำหนดส่ง {t.dueDate || "ไม่ระบุ"}</strong>
          </button>
        ))}
      </div>
    </section>
  );
}
export function CalendarView({
  tasks,
  plans,
  openTask,
  savePlan,
  busy,
  milestones,
}) {
  const [layer, setLayer] = useState("all");
  const events = useMemo(
    () =>
      tasks.flatMap((t) => {
        const result = [];
        const p = plans[t.key];
        if ((layer === "all" || layer === "plan") && p?.start_date)
          result.push({
            id: `plan:${t.key}`,
            title: `แผน · ${t.topic}`,
            start: p.start_date,
            end: addDays(p.end_date, 1),
            allDay: true,
            editable: !busy,
            backgroundColor: "#7950c9",
            extendedProps: { taskKey: t.key, version: p.version, kind: "plan" },
          });
        if ((layer === "all" || layer === "due") && dateOnly(t.dueDate))
          result.push({
            id: `due:${t.key}`,
            title: `กำหนดส่ง · ${t.topic}`,
            start: t.dueDate,
            allDay: true,
            editable: false,
            backgroundColor: t.done ? "#34856a" : "#cf7740",
            extendedProps: { taskKey: t.key, kind: "due" },
          });
        if (
          layer === "milestone" &&
          milestoneForTask(t, milestones) &&
          dateOnly(t.dueDate)
        )
          result.push({
            id: `milestone:${t.key}`,
            title: `◆ ${t.topic}`,
            start: t.dueDate,
            allDay: true,
            editable: false,
            extendedProps: { taskKey: t.key, kind: "milestone" },
          });
        return result;
      }),
    [tasks, plans, layer, busy, milestones],
  );
  const change = async (info) => {
    const { taskKey, version, kind } = info.event.extendedProps;
    if (kind !== "plan") {
      info.revert();
      return;
    }
    const start = info.event.startStr.slice(0, 10);
    const end = info.event.endStr
      ? addDays(info.event.endStr.slice(0, 10), -1)
      : start;
    if (!(await savePlan(taskKey, start, end, version))) info.revert();
  };
  return (
    <section className="v2-card v2-calendar" aria-busy={busy}>
      <div className="v2-section-head">
        <div>
          <h2>Calendar</h2>
          <p>สีม่วง: วันแผน · สีส้ม: กำหนดส่งจริง · ลากได้เฉพาะวันแผน</p>
        </div>
        <select
          aria-label="รายการในปฏิทิน"
          value={layer}
          onChange={(e) => setLayer(e.target.value)}
        >
          <option value="all">แผนและกำหนดส่ง</option>
          <option value="plan">วันตามแผน</option>
          <option value="due">กำหนดส่งจริง</option>
          <option value="milestone">Milestone</option>
        </select>
      </div>
      <FullCalendar
        plugins={[theme, dayGrid, list, interaction]}
        locale={th}
        toolbarClass="v2-calendar-toolbar"
        toolbarTitleClass="v2-calendar-title"
        initialView="dayGridMonth"
        events={events}
        height={650}
        timeZone="Asia/Bangkok"
        dayMaxEvents={3}
        eventClass={(info) => `v2-calendar-${info.event.extendedProps.kind}`}
        headerToolbar={{
          left: "prev,next today",
          center: "title",
          right: "dayGridMonth,dayGridWeek,listWeek",
        }}
        eventClick={(info) => openTask(info.event.extendedProps.taskKey)}
        eventDrop={change}
        eventResize={change}
      />
    </section>
  );
}
