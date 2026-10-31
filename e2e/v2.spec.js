import { test, expect } from "@playwright/test";
test("V2 fixture renders all new views and task details without page errors", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/v2/?demo=1");
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  const nav = page.getByRole("navigation", { name: "เมนู V2" });
  for (const name of [
    "Explorer",
    "Kanban",
    "Gantt",
    "Calendar",
    "Workload",
    "Inbox",
  ]) {
    await nav.getByRole("button", { name, exact: true }).click();
    await expect(
      page.getByRole("heading", { name, exact: true }).first(),
    ).toBeVisible();
    await page.waitForTimeout(150);
  }
  await nav.getByRole("button", { name: "Explorer", exact: true }).click();
  await page.locator(".v2-task-link").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByLabel("เริ่มแผน", { exact: true })).toBeVisible();
  await page.getByLabel("ปิดรายละเอียด").click();
  await page.screenshot({
    path: "scripts/evidence/v2-explorer.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
test("10,000 rows are virtualized and Thai search, grouping, sorting and CSV work", async ({
  page,
}) => {
  await page.goto("/v2/?demo=1&count=10000&view=explorer");
  await expect(
    page.getByText("10,000 งาน · คลิกชื่องานเพื่อเปิดรายละเอียด"),
  ).toBeVisible();
  expect(await page.locator("tbody tr").count()).toBeLessThan(60);
  await page.getByLabel("ค้นหางาน", { exact: true }).fill("ออกแบบ");
  await page.getByLabel("ทุกแบรนด์", { exact: true }).selectOption("LUMI");
  await page.getByLabel("ไม่จัดกลุ่ม", { exact: true }).selectOption("brand");
  await expect(page.locator(".v2-group-row").first()).toContainText("LUMI");
  await page.getByRole("button", { name: "กำหนดส่งจริง ↕" }).click();
  await expect(
    page
      .locator("tbody tr:not(.v2-group-row) td:last-child")
      .filter({ hasText: "2026-" })
      .first(),
  ).toHaveText("2026-09-12");
  await page.getByRole("button", { name: "กำหนดส่งจริง ↑" }).click();
  await expect(
    page
      .locator("tbody tr:not(.v2-group-row) td:last-child")
      .filter({ hasText: "2026-" })
      .first(),
  ).toHaveText("2026-09-24");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "ส่งออก CSV", exact: true }).click();
  expect((await download).suggestedFilename()).toBe("magic-timeline.csv");
  await page.getByRole("button", { name: "ค้นหางานและคำสั่ง" }).click();
  await page
    .getByPlaceholder("ค้นหางาน แบรนด์ โปรเจกต์ หรือชื่อคน…")
    .fill("รายงาน");
  await expect(
    page.locator("[cmdk-item]").filter({ hasText: "สรุปรายงาน" }).first(),
  ).toBeVisible();
});
test("V2 mobile navigation and calendar do not overflow the viewport", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.__v2WindowErrors = [];
    window.addEventListener("error", (e) =>
      window.__v2WindowErrors.push(e.message),
    );
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/v2/?demo=1&view=calendar");
  await expect(page.getByRole("grid")).toBeVisible();
  await page.screenshot({
    path: "scripts/evidence/v2-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(391);
  expect(await page.evaluate(() => window.__v2WindowErrors)).toEqual([]);
});

test("Gantt limits 10,000 tasks to 200 per page and never invents plans", async ({
  page,
}) => {
  await page.goto("/v2/?demo=1&count=10000&view=gantt");
  await expect(page.locator(".v2-plan-list > button")).toHaveCount(200);
  await expect(page.locator(".v2-gantt .bar-wrapper")).toHaveCount(12);
  await page.getByRole("button", { name: "→", exact: true }).click();
  await expect(page.locator(".v2-plan-list > button")).toHaveCount(200);
  await expect(page.locator(".v2-gantt .bar-wrapper")).toHaveCount(0);
  await expect(
    page.getByText(
      "ยังไม่มีช่วงแผนในหน้านี้ · เปิดงานเพื่อกำหนดวันเริ่มและวันสิ้นสุด",
    ),
  ).toBeVisible();
});
