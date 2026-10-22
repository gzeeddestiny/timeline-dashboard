import { test, expect } from "@playwright/test";
import { mockBackend, origin } from "./backend";
for (const role of ["employee", "manager", "admin"])
  test(`V2 ${role} sees allowed navigation and task snapshot`, async ({
    page,
  }) => {
    test.skip(
      !origin,
      "Local Supabase URL is required for intercepted auth client",
    );
    await mockBackend(page, role);
    await page.goto("/v2/?view=explorer");
    await expect(
      page.getByRole("button", { name: "งานทดสอบสิทธิ์", exact: true }),
    ).toBeVisible();
    const follow = page
      .getByRole("navigation", { name: "เมนู V2" })
      .getByRole("button", { name: "Follow-up", exact: true });
    if (role === "admin") await expect(follow).toBeVisible();
    else await expect(follow).toHaveCount(0);
    const nav = page.getByRole("navigation", { name: "เมนู V2" });
    const failures = [];
    page.on("pageerror", (e) => failures.push(e.message));
    for (const name of [
      "My Work",
      "Brand & contracts",
      ...(role === "admin" ? ["Follow-up"] : []),
      "ทีม / ตั้งค่า / Sync",
    ]) {
      await nav.getByRole("button", { name, exact: true }).click();
      await expect(
        page.getByRole("navigation", { name: "มุมมองหลัก" }),
      ).toBeVisible();
    }
    await page.getByLabel("เปิดเมนูเครื่องมือ").click();
    await page
      .getByRole("menuitem", {
        name: role === "admin" ? "Admin settings" : "Add Sheet",
        exact: true,
      })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByLabel("ปิด Admin Settings").click();
    if (role === "admin") {
      await page.getByLabel("เปิดเมนูเครื่องมือ").click();
      await page
        .getByRole("menuitem", { name: "จัดการทีม", exact: true })
        .click();
      await expect(page.getByRole("dialog")).toContainText("Team Members");
      await page.getByLabel("ปิดหน้าจัดการทีม").click();
    }
    expect(failures).toEqual([]);
  });
test("V2 rejects an inactive approved account", async ({ page }) => {
  test.skip(!origin, "Local Supabase URL is required");
  await mockBackend(page, "employee", false);
  await page.goto("/v2/");
  await expect(
    page.getByRole("heading", { name: "ยังไม่ได้รับสิทธิ์เข้าใช้งาน" }),
  ).toBeVisible();
  await expect(page.getByRole("navigation", { name: "เมนู V2" })).toHaveCount(
    0,
  );
});
test("V2 plan writes leave real due date untouched; workflow retry and note conflict work", async ({
  page,
}) => {
  test.skip(!origin, "Local Supabase URL is required");
  const mock = await mockBackend(page);
  await page.goto("/v2/?view=explorer&task=fixture%3A1%3At");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: /^Assign team for / }).click();
  await page
    .locator(".assign-team-popup")
    .getByRole("button", { name: /Tester$/ })
    .click({ trial: true });
  await page
    .locator(".assign-team-popup")
    .getByRole("button", { name: "เสร็จ", exact: true })
    .click();
  await page.getByLabel("เริ่มแผน", { exact: true }).fill("2026-09-21");
  await page.getByLabel("สิ้นสุดแผน", { exact: true }).fill("2026-09-24");
  await page.getByRole("button", { name: "บันทึกแผน", exact: true }).click();
  await expect
    .poll(() => mock.calls.filter((c) => c.p_action === "plan").length)
    .toBe(1);
  expect(mock.task.due_date).toBe("2026-09-25");
  await expect(
    page.getByRole("button", { name: "บันทึกแผน", exact: true }),
  ).toBeEnabled();
  mock.concurrentNote();
  await page.getByLabel("Note", { exact: true }).fill("my change");
  await page.getByRole("button", { name: "บันทึก Note", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "โหลดค่าล่าสุด", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "โหลดค่าล่าสุด", exact: true })
    .click();
  await expect(page.getByLabel("Note", { exact: true })).toHaveValue(
    "other actor",
  );
  mock.failNextWorkflow();
  await page
    .getByRole("dialog")
    .getByRole("combobox", { name: "Workflow", exact: true })
    .selectOption("in_progress");
  await expect(page.getByRole("alert")).toContainText("Fixture save failure");
  await page.getByLabel("ปิดรายละเอียด").click();
  await page
    .getByRole("main")
    .getByRole("button", { name: "Retry", exact: true })
    .click();
  await expect(
    page.getByRole("main").getByRole("button", { name: "Retry", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".v2-badge.in_progress")).toHaveText("in_progress");
});
test("V2 completion failure rolls back without writing a plan", async ({
  page,
}) => {
  test.skip(!origin, "Local Supabase URL is required");
  const mock = await mockBackend(page);
  mock.failCompletion();
  await page.goto("/v2/?task=fixture%3A1%3At");
  await page
    .getByRole("button", { name: "✓ ทำเครื่องหมาย Done", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("คืนค่าหน้าจอแล้ว");
  await expect(
    page.getByRole("button", { name: "✓ ทำเครื่องหมาย Done", exact: true }),
  ).toBeVisible();
  expect(mock.task.done).toBe(false);
  expect(mock.calls).toEqual([]);
});
