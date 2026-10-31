import { test, expect } from "@playwright/test";
import { mockBackend } from "./backend";

test("V1 root and V2 share notes after refresh", async ({
  context,
  page,
}) => {
  await mockBackend(context);
  const old = await context.newPage();
  await old.goto("/?view=table&task=fixture%3A1%3At");
  await expect(old.getByRole("dialog")).toBeVisible();
  await expect(old.getByRole("navigation", { name: "มุมมองหลัก", includeHidden: true })).toBeAttached();
  await expect(old.getByText("↗ เปิดเวอร์ชันเดิม", { exact: true })).toHaveCount(0);
  await old
    .getByRole("textbox", { name: "Note", exact: true })
    .fill("Written in original");
  await old.getByRole("button", { name: "Save note", exact: true }).click();
  await page.goto("/v2/?task=fixture%3A1%3At");
  await expect(page.getByLabel("Note", { exact: true })).toHaveValue(
    "Written in original",
  );
  await page.getByLabel("Note", { exact: true }).fill("Written in V2");
  await page.getByRole("button", { name: "บันทึก Note", exact: true }).click();
  await old.getByLabel("Close task panel").click();
  await old.getByRole("button", { name: "Refresh", exact: true }).click();
  await old.goto("/?view=table&task=fixture%3A1%3At");
  await expect(
    old.getByRole("textbox", { name: "Note", exact: true }),
  ).toHaveValue("Written in V2");
});

test("V2 completion and undo send the same Actual Submit contract; logout returns to login", async ({
  page,
}) => {
  const mock = await mockBackend(page);
  await page.goto("/v2/?task=fixture%3A1%3At");
  await page
    .getByRole("button", { name: "✓ ทำเครื่องหมาย Done", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "นำ Done ออก", exact: true }),
  ).toBeEnabled();
  expect(mock.completions[0]).toMatchObject({
    done: true,
    taskKey: "fixture:1:t",
  });
  expect(mock.completions[0].actualSubmit).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await page.getByRole("button", { name: "นำ Done ออก", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "✓ ทำเครื่องหมาย Done", exact: true }),
  ).toBeEnabled();
  expect(mock.completions[1]).toMatchObject({
    done: false,
    actualSubmit: null,
  });
  await page.getByLabel("ปิดรายละเอียด").click();
  await page.getByRole("button", { name: "ออกจากระบบ", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sign in with Google" }),
  ).toBeVisible();
});

test("Accepted Sheets completion with a pending snapshot invokes the existing sync recovery", async ({
  page,
}) => {
  const mock = await mockBackend(page);
  mock.delayCompletionSnapshot();
  await page.goto("/v2/?task=fixture%3A1%3At");
  await page
    .getByRole("button", { name: "✓ ทำเครื่องหมาย Done", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "นำ Done ออก", exact: true }),
  ).toBeEnabled();
  expect(mock.syncCalls).toEqual(["POST"]);
  expect(mock.task.done).toBe(true);
});

test("OAuth return restores the V2 task link and isolates stale account caches", async ({
  page,
}) => {
  await mockBackend(page);
  await page.addInitScript(() => {
    sessionStorage.setItem(
      "magic-v2-return-to",
      "/v2/gantt?task=fixture%3A1%3At",
    );
    sessionStorage.setItem("magic-v2-cache-owner", "previous-account");
    sessionStorage.setItem("magic-v2-shared-state", "stale previous account");
    sessionStorage.setItem("magic-original-sentinel", "preserve original");
  });
  await page.goto("/v2/");
  await expect(page).toHaveURL(/\/v2\/gantt\?task=/);
  await expect(page.getByRole("dialog")).toContainText("งานทดสอบสิทธิ์");
  expect(
    await page.evaluate(() => sessionStorage.getItem("magic-v2-shared-state")),
  ).toBeNull();
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("magic-original-sentinel"),
    ),
  ).toBe("preserve original");
});


test("V2 OAuth migrates an old root return link to the V2 path", async ({ page }) => {
  await mockBackend(page);
  await page.addInitScript(() => sessionStorage.setItem("magic-v2-return-to", "/?task=fixture%3A1%3At"));
  await page.goto("/v2/");
  await expect(page).toHaveURL(/\/v2\/\?task=fixture%3A1%3At$/);
  await expect(page.getByRole("dialog")).toContainText("งานทดสอบสิทธิ์");
});


test("Root restores V1 while V2 remains separate across reloads", async ({ page }) => {
  await mockBackend(page);
  const extraReads = [];
  page.on("request", request => { if (/\/rest\/v1\/v2_/.test(request.url())) extraReads.push(request.url()); });
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "มุมมองหลัก" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "เมนู V2" })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("navigation", { name: "มุมมองหลัก" })).toBeVisible();
  expect(extraReads).toEqual([]);
  await page.goto("/v2/gantt");
  await expect(page.getByRole("navigation", { name: "เมนู V2" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("navigation", { name: "เมนู V2" })).toBeVisible();
});
