import { test, expect } from "@playwright/test";
import { mockBackend } from "./backend";
const errors = new WeakMap();
test.beforeEach(async ({ page }) => {
  // Keep the calendar/Gantt viewport anchored to the dates in the fixture.
  await page.clock.setFixedTime(new Date("2026-09-21T05:00:00Z"));
  await page.addInitScript(() => {
    window.__v2WindowErrors = [];
    window.addEventListener("error", (e) =>
      window.__v2WindowErrors.push(e.message),
    );
  });
  const list = [];
  errors.set(page, list);
  page.on("pageerror", (e) => list.push(e.message));
});
test.afterEach(async ({ page }) => {
  expect(errors.get(page)).toEqual([]);
  expect(await page.evaluate(() => window.__v2WindowErrors || [])).toEqual([]);
});
const planned = {
  task_key: "fixture:1:t",
  start_date: "2026-09-21",
  end_date: "2026-09-23",
  version: 1,
};

test("Gantt drag saves a versioned plan only; reload preserves the actual deadline", async ({
  page,
}) => {
  const mock = await mockBackend(page);
  mock.setPlan({ ...planned });
  await page.goto("/v2/gantt");
  await page.getByLabel("ช่วงเวลา Gantt").selectOption("Day");
  const bar = page.locator(".v2-gantt .bar-wrapper .bar").first();
  await expect(bar).toBeVisible();
  await bar.scrollIntoViewIfNeeded();
  const box = await bar.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2, {
    steps: 12,
  });
  await page.mouse.up();
  await expect
    .poll(() => mock.calls.filter((c) => c.p_action === "plan").length)
    .toBe(1);
  expect(mock.getPlan().start_date).not.toBe(planned.start_date);
  expect(mock.task.due_date).toBe("2026-09-25");
  expect(mock.calls.every((c) => c.p_action === "plan")).toBeTruthy();
  await page.reload();
  await expect(
    page.getByText("กำหนดส่ง 2026-09-25", { exact: true }),
  ).toBeVisible();
});

test("Calendar drag edits the plan but actual due events are immutable", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-09-21T05:00:00Z"));
  const mock = await mockBackend(page);
  mock.setPlan({ ...planned });
  await page.goto("/v2/calendar");
  const event = page.locator(".v2-calendar-plan").first();
  await expect(event).toBeVisible();
  const box = await event.boundingBox();
  await page.mouse.move(box.x + 20, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 160, box.y + box.height / 2, { steps: 15 });
  await page.waitForTimeout(250);
  await page.mouse.up();
  await expect
    .poll(() => mock.calls.filter((c) => c.p_action === "plan").length)
    .toBe(1);
  expect(mock.task.due_date).toBe("2026-09-25");
  const prior = { ...mock.getPlan() };
  await expect(
    page.getByRole("button", { name: "↻ Refresh", exact: true }),
  ).toBeEnabled();
  mock.failNextPlan();
  await expect(event).toBeVisible();
  const retryBox = await event.boundingBox();
  await page.mouse.move(retryBox.x + 20, retryBox.y + retryBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(retryBox.x + 160, retryBox.y + retryBox.height / 2, {
    steps: 15,
  });
  await page.mouse.up();
  await expect(page.locator(".v2-error")).toContainText("Fixture plan failure");
  expect(mock.getPlan()).toEqual(prior);
  await expect
    .poll(async () => Math.abs((await event.boundingBox()).x - retryBox.x))
    .toBeLessThan(2);
  const due = page.locator(".v2-calendar-due").first();
  await expect(due).toBeVisible();
  const dueBox = await due.boundingBox();
  await page.mouse.move(dueBox.x + 10, dueBox.y + 10);
  await page.mouse.down();
  await page.mouse.move(dueBox.x + 150, dueBox.y + 10, { steps: 10 });
  await page.mouse.up();
  expect(mock.calls.filter((c) => c.p_action === "plan")).toHaveLength(2);
});

test("Kanban pointer drag and keyboard menu both use the existing workflow API", async ({
  page,
}) => {
  const mock = await mockBackend(page);
  await page.goto("/v2/kanban");
  const handle = page.getByRole("button", { name: "ลาก งานทดสอบสิทธิ์" });
  const target = page.locator(".v2-kanban-column").nth(1);
  const a = await handle.boundingBox(),
    b = await target.boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + 70, b.y + 100, { steps: 20 });
  await page.waitForTimeout(200);
  await page.mouse.up();
  await expect
    .poll(() => mock.calls.some((c) => c.status === "in_progress"))
    .toBeTruthy();
  const menu = page.getByRole("combobox", { name: "Workflow งานทดสอบสิทธิ์" });
  await expect(menu).toBeEnabled();
  await expect(menu).toHaveValue("in_progress");
  await menu.focus();
  await menu.press("w");
  await menu.press("Enter");
  await expect
    .poll(() => mock.calls.some((c) => c.status === "waiting_client"))
    .toBeTruthy();
});

test("V2 toolbar refresh reaches the compatibility view and returning sees current workflow", async ({
  page,
}) => {
  const mock = await mockBackend(page);
  await page.goto("/v2/explorer");
  await expect(page.locator(".v2-badge.not_started")).toBeVisible();
  const nav = page.getByRole("navigation", { name: "เมนู V2" });
  await nav
    .getByRole("button", { name: "ทีม / ตั้งค่า / Sync", exact: true })
    .click();
  mock.setStatus("blocked");
  await page.getByRole("button", { name: "↻ Refresh", exact: true }).click();
  await nav.getByRole("button", { name: "Explorer", exact: true }).click();
  await expect(page.locator(".v2-badge.blocked")).toBeVisible();
});

test("Gantt restores failed drags and reloads a concurrent plan before retry", async ({ page }) => {
  const mock = await mockBackend(page);
  mock.setPlan({ ...planned });
  await page.goto("/v2/gantt");
  await page.getByLabel("ช่วงเวลา Gantt").selectOption("Day");
  const bar = page.locator(".v2-gantt .bar-wrapper .bar");
  const drag = async () => {
    await expect(bar).toHaveCount(1);
    await bar.scrollIntoViewIfNeeded();
    const box = await bar.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2, { steps: 12 });
    await page.mouse.up();
    return box;
  };
  mock.failNextPlan();
  const initial = await drag();
  await expect(page.locator(".v2-error")).toContainText("Fixture plan failure");
  await expect.poll(async () => Math.abs((await bar.boundingBox()).x - initial.x)).toBeLessThan(2);
  expect(mock.getPlan()).toEqual(planned);
  mock.setPlan({ ...planned, start_date: "2026-09-24", end_date: "2026-09-26", version: 2 });
  await drag();
  await expect(page.locator(".v2-error")).toContainText("PLAN_CONFLICT");
  await expect(page.locator(".v2-plan-list")).toContainText("2026-09-24 → 2026-09-26");
  await expect(page.getByRole("button", { name: "↻ Refresh", exact: true })).toBeEnabled();
  await drag();
  await expect.poll(() => mock.getPlan().version).toBe(3);
  expect(mock.calls.filter(c => c.p_action === "plan").map(c => c.p_payload.expectedVersion)).toEqual([1, 1, 2]);
  expect(mock.task.due_date).toBe("2026-09-25");
});
