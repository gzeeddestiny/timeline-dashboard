// Explicit local-only, read-only fixtures. Never loaded into production data.
export function demoState(count = 72) {
  const brands = ["LUMI", "NORTH STUDIO", "SORA", "EVERGREEN"];
  const names = ["Tony", "Mint", "Ploy", "Beam"];
  const topics = [
    "ออกแบบ Key Visual",
    "ตรวจ Content Calendar",
    "ถ่ายภาพสินค้า",
    "ส่งงานให้ลูกค้า",
    "วางแผนแคมเปญ",
    "สรุปรายงานประจำเดือน",
  ];
  const tasks = Array.from({ length: Math.min(count, 10000) }, (_, i) => ({
    spreadsheetId: "demo",
    sheetGid: i % 4,
    taskId: `task-${i}`,
    rowIndex: i + 2,
    topic: `${topics[i % 6]} ${Math.floor(i / 6) + 1}`,
    clientName: brands[i % 4],
    responsibility: i % 7 ? names[i % 4] : "",
    dueDate: `2026-09-${String(12 + (i % 18)).padStart(2, "0")}`,
    done: i % 5 === 0,
    actualSubmit: i % 5 === 0 ? "2026-09-15" : "",
    sourceDates: {},
  }));
  return {
    v2: {
      plans: Object.fromEntries(
        tasks
          .slice(0, 12)
          .map((t, i) => [
            `demo:${t.sheetGid}:${t.taskId}`,
            {
              task_key: `demo:${t.sheetGid}:${t.taskId}`,
              start_date: `2026-09-${String(12 + i).padStart(2, "0")}`,
              end_date: `2026-09-${String(15 + i).padStart(2, "0")}`,
              version: 1,
            },
          ]),
      ),
      dependencies: [
        { predecessor: "demo:0:task-0", successor: "demo:1:task-1" },
      ],
      views: [],
      layout: null,
    },
    tasks,
    teamMembers: names.map((name) => ({ name, role: "creative" })),
    brands: {},
    assignments: {},
    workflow: Object.fromEntries(
      tasks.map((t, i) => [
        `demo:${t.sheetGid}:${t.taskId}`,
        ["not_started", "in_progress", "waiting_client", "blocked"][i % 4],
      ]),
    ),
    remarks: {},
    noteVersions: {},
    priorities: {},
    nextActions: {},
    brandProjects: brands.map((brand, i) => ({
      id: `project-${i}`,
      name: "September Campaign",
      brandName: brand,
      sourceTabKeys: [`demo:${i}`],
      active: true,
      assignment: {},
    })),
    brandContracts: [],
    milestoneOverrides: {},
    sheets: [],
    updatedAt: "2026-09-20T10:00:00Z",
  };
}
