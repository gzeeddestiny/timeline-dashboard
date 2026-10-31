import Fuse from "fuse.js";
import { taskKey, tabKey } from "../lib/sharedState.js";
import {
  projectForTask,
  resolveAssignment,
} from "../lib/assignmentResolver.js";
import { taskOwnerNames } from "../lib/teamConfig.js";

export const WORKFLOW = [
  ["not_started", "Not started"],
  ["in_progress", "In progress"],
  ["waiting_client", "Waiting client"],
  ["blocked", "Hold"],
];
export const EMPTY_FILTERS = {
  search: "",
  brand: "",
  project: "",
  member: "",
  status: "",
  priority: "",
  from: "",
  to: "",
  group: "",
};
export function dateOnly(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return "";
  const d = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(d.valueOf()) || d.toISOString().slice(0, 10) !== value
    ? ""
    : value;
}
export function addDays(value, amount) {
  if (!dateOnly(value)) return "";
  const d = new Date(`${value}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + amount);
  return d.toISOString().slice(0, 10);
}
export function buildTasks(state = {}) {
  const projects = state.brandProjects || [];
  const projectAssignments = Object.fromEntries(
    projects.map((p) => [p.id, p.assignment || {}]),
  );
  return (state.tasks || []).map((task) => {
    const key = taskKey(task);
    const brand = state.brands?.[tabKey(task)] || task.clientName;
    const project = projectForTask(task, projects);
    const assignment = resolveAssignment(task, {
      projects,
      projectAssignments,
      assignments: state.assignments,
      brandName: brand,
    });
    return {
      ...task,
      key,
      brand,
      project: project?.name || "ยังไม่มีโปรเจกต์",
      projectId: project?.id || "",
      owners: taskOwnerNames(task, state.teamMembers, assignment),
      status: state.workflow?.[key] || "not_started",
      priority: state.priorities?.[key] || "normal",
    };
  });
}
export function filterTasks(tasks, filters = EMPTY_FILTERS, today = "") {
  const q = filters.search?.trim();
  const results = q
    ? new Fuse(tasks, {
        keys: ["topic", "brand", "project", "owners", "responsibility"],
        threshold: 0.35,
        ignoreLocation: true,
      })
        .search(q)
        .map((r) => r.item)
    : tasks;
  return results.filter(
    (t) =>
      (!filters.brand || t.brand === filters.brand) &&
      (!filters.project || t.projectId === filters.project) &&
      (!filters.member ||
        (filters.member === "__unassigned"
          ? !t.owners.length
          : t.owners.includes(filters.member))) &&
      (!filters.status ||
        (filters.status === "done"
          ? t.done
          : filters.status === "open"
            ? !t.done
            : filters.status === "overdue"
              ? !t.done && dateOnly(t.dueDate) && t.dueDate < today
              : !t.done && t.status === filters.status)) &&
      (!filters.priority || t.priority === filters.priority) &&
      (!filters.from || (dateOnly(t.dueDate) && t.dueDate >= filters.from)) &&
      (!filters.to || (dateOnly(t.dueDate) && t.dueDate <= filters.to)),
  );
}
export function csvForTasks(tasks) {
  const cell = (value) => {
    let text = String(value ?? "");
    if (/^[\s]*[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return (
    "\uFEFF" +
    [
      [
        "งาน",
        "แบรนด์",
        "โปรเจกต์",
        "ผู้รับผิดชอบ",
        "Workflow",
        "Priority",
        "กำหนดส่งจริง",
        "Done",
      ],
      ...tasks.map((t) => [
        t.topic,
        t.brand,
        t.project,
        t.owners.join(", "),
        t.status,
        t.priority,
        t.dueDate,
        t.done ? "Yes" : "No",
      ]),
    ]
      .map((row) => row.map(cell).join(","))
      .join("\r\n")
  );
}
export function workload(tasks, plans = {}, today) {
  const groups = new Map();
  for (const task of tasks.filter((t) => !t.done)) {
    for (const owner of task.owners.length
      ? task.owners
      : ["ยังไม่มีเจ้าของ"]) {
      if (!groups.has(owner))
        groups.set(owner, {
          name: owner,
          total: 0,
          overdue: 0,
          upcoming: 0,
          overlap: 0,
          tasks: [],
        });
      const row = groups.get(owner);
      row.total++;
      row.tasks.push(task);
      if (dateOnly(task.dueDate) && task.dueDate < today) row.overdue++;
      if (
        dateOnly(task.dueDate) &&
        task.dueDate >= today &&
        task.dueDate <= addDays(today, 7)
      )
        row.upcoming++;
    }
  }
  for (const row of groups.values()) {
    const intervals = row.tasks
      .map((t) => plans[t.key])
      .filter((p) => p?.start_date && p?.end_date)
      .sort((a, b) => a.start_date.localeCompare(b.start_date));
    let ends = [];
    let peak = 0;
    for (const p of intervals) {
      ends = ends.filter((end) => end >= p.start_date);
      ends.push(p.end_date);
      peak = Math.max(peak, ends.length);
    }
    row.overlap = peak > 1 ? peak : 0;
  }
  return [...groups.values()].sort((a, b) => b.total - a.total);
}
export function validatePlan(start, end) {
  if (!start && !end) return "";
  if (!dateOnly(start) || !dateOnly(end))
    return "กรุณาระบุวันเริ่มและสิ้นสุดที่ถูกต้อง";
  return start > end ? "วันสิ้นสุดต้องไม่ก่อนวันเริ่ม" : "";
}
export function dependencyWarnings(dependencies, plans) {
  return dependencies.filter(
    (d) =>
      plans[d.predecessor]?.end_date &&
      plans[d.successor]?.start_date &&
      plans[d.successor].start_date <= plans[d.predecessor].end_date,
  );
}
