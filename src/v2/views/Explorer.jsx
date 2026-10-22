import { useMemo, useRef } from "react";
import {
  useTable,
  tableFeatures,
  rowSortingFeature,
  sortFns,
  createSortedRowModel,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { csvForTasks } from "../model";
const features = tableFeatures({
  rowSortingFeature,
  sortFns,
  sortedRowModel: createSortedRowModel(),
});
const definitions = [
  ["topic", "งาน", 340],
  ["brand", "แบรนด์", 170],
  ["project", "โปรเจกต์", 190],
  ["owners", "ผู้รับผิดชอบ", 180],
  ["status", "Workflow", 150],
  ["priority", "Priority", 100],
  ["dueDate", "กำหนดส่งจริง", 145],
];
const EMPTY_SORTING = [];
const columns = definitions.map(([id, header]) => ({
  id,
  header,
  accessorFn: (t) =>
    id === "owners"
      ? t.owners.join(", ") || "ยังไม่มีเจ้าของ"
      : id === "status" && t.done
        ? "Done"
        : t[id] || "—",
}));
export default function Explorer({
  tasks,
  filters,
  openTask,
  settings,
  setSettings,
}) {
  const scroller = useRef(null);
  const table = useTable({
    features,
    data: tasks,
    columns,
    getRowId: (t) => t.key,
    state: { sorting: settings.sorting || EMPTY_SORTING },
    onSortingChange: (updater) =>
      setSettings({
        ...settings,
        sorting:
          typeof updater === "function"
            ? updater(settings.sorting || EMPTY_SORTING)
            : updater,
      }),
  });
  const rows = table.getRowModel().rows;
  const display = useMemo(() => {
    if (!filters.group) return rows.map((row) => ({ row }));
    const groups = new Map();
    rows.forEach((row) => {
      const t = row.original;
      const name =
        filters.group === "owners"
          ? t.owners.join(", ") || "ยังไม่มีเจ้าของ"
          : filters.group === "project"
            ? `${t.brand} / ${t.project}`
            : t[filters.group] || "ไม่ระบุ";
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push({ row });
    });
    return [...groups].flatMap(([name, items]) => [
      { group: `${name} · ${items.length}` },
      ...items,
    ]);
  }, [rows, filters.group]);
  // https://tanstack.com/virtual/latest/docs/api/virtualizer
  // React Compiler is not enabled; keep the virtualizer outside compiler memoization.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtual = useVirtualizer({
    count: display.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => 62,
    overscan: 8,
    useAnimationFrameWithResizeObserver: true,
  });
  const pinned = settings.pinned || (settings.pin !== false ? ["topic"] : []);
  const visible = definitions
    .filter(([id]) => !settings.hidden?.includes(id))
    .sort(
      (a, b) => Number(pinned.includes(b[0])) - Number(pinned.includes(a[0])),
    );
  const width = (id) =>
    settings.widths?.[id] || definitions.find((d) => d[0] === id)[2];
  const left = (id) =>
    visible
      .slice(
        0,
        visible.findIndex(([key]) => key === id),
      )
      .filter(([key]) => pinned.includes(key))
      .reduce((n, [key]) => n + width(key), 0);
  const items = virtual.getVirtualItems();
  const download = () => {
    const url = URL.createObjectURL(
      new Blob([csvForTasks(rows.map((r) => r.original))], {
        type: "text/csv;charset=utf-8",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "magic-timeline.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <section className="v2-card">
      <div className="v2-section-head">
        <div>
          <h2>Explorer</h2>
          <p>
            {tasks.length.toLocaleString()} งาน · คลิกชื่องานเพื่อเปิดรายละเอียด
          </p>
        </div>
        <div className="v2-actions">
          <details className="v2-column-menu">
            <summary>ปรับคอลัมน์</summary>
            <div>
              {definitions.map(([id, label]) => (
                <label key={id}>
                  <input
                    type="checkbox"
                    checked={!settings.hidden?.includes(id)}
                    disabled={id === "topic"}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        hidden: e.target.checked
                          ? (settings.hidden || []).filter((x) => x !== id)
                          : [...(settings.hidden || []), id],
                      })
                    }
                  />
                  {label}
                  <input
                    type="checkbox"
                    aria-label={`ตรึง ${label}`}
                    checked={pinned.includes(id)}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        pinned: e.target.checked
                          ? [...pinned, id]
                          : pinned.filter((key) => key !== id),
                      })
                    }
                  />
                  <input
                    aria-label={`ความกว้าง ${label}`}
                    type="range"
                    min="100"
                    max="500"
                    value={width(id)}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        widths: {
                          ...settings.widths,
                          [id]: Number(e.target.value),
                        },
                      })
                    }
                  />
                </label>
              ))}
            </div>
          </details>
          <button onClick={download}>ส่งออก CSV</button>
        </div>
      </div>
      <div className="v2-table-scroll" ref={scroller}>
        <table
          className="v2-table"
          style={{ width: visible.reduce((n, [id]) => n + width(id), 0) }}
        >
          <thead>
            <tr>
              {visible.map(([id, label]) => {
                const col = table.getColumn(id);
                return (
                  <th
                    key={id}
                    style={{
                      width: width(id),
                      left: pinned.includes(id) ? left(id) : undefined,
                    }}
                    className={pinned.includes(id) ? "v2-pinned" : ""}
                  >
                    <button onClick={col.getToggleSortingHandler()}>
                      {label}{" "}
                      {col.getIsSorted() === "asc"
                        ? "↑"
                        : col.getIsSorted() === "desc"
                          ? "↓"
                          : "↕"}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {items.length > 0 && (
              <tr aria-hidden="true">
                <td
                  colSpan={visible.length}
                  style={{ height: items[0].start, padding: 0 }}
                />
              </tr>
            )}
            {items.map((item) => {
              const d = display[item.index];
              return d.group ? (
                <tr key={`g:${d.group}`} className="v2-group-row">
                  <th colSpan={visible.length}>{d.group}</th>
                </tr>
              ) : (
                <tr key={d.row.id}>
                  {visible.map(([id]) => (
                    <td
                      key={id}
                      className={pinned.includes(id) ? "v2-pinned" : ""}
                      style={{
                        width: width(id),
                        left: pinned.includes(id) ? left(id) : undefined,
                      }}
                    >
                      {id === "topic" ? (
                        <button
                          className="v2-task-link"
                          onClick={() => openTask(d.row.original.key)}
                        >
                          {d.row.original.done ? "✓ " : ""}
                          {d.row.original.topic}
                        </button>
                      ) : id === "status" ? (
                        <span
                          className={`v2-badge ${d.row.original.done ? "done" : d.row.original.status}`}
                        >
                          {d.row.getValue(id)}
                        </span>
                      ) : (
                        d.row.getValue(id)
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
            {items.length > 0 && (
              <tr aria-hidden="true">
                <td
                  colSpan={visible.length}
                  style={{
                    height: virtual.getTotalSize() - (items.at(-1)?.end || 0),
                    padding: 0,
                  }}
                />
              </tr>
            )}
          </tbody>
        </table>
        {!tasks.length && <div className="v2-empty">ไม่พบงานตามตัวกรองนี้</div>}
      </div>
    </section>
  );
}
