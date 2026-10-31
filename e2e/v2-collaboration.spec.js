import { test, expect } from "@playwright/test";
import { mockBackend } from "./backend";

test("Saved view restores filters, sorting and hidden columns after reload", async ({
  page,
}) => {
  const mock = await mockBackend(page);
  await page.goto("/v2/explorer");
  await page
    .getByLabel("ทุกแบรนด์", { exact: true })
    .selectOption("Fixture Brand");
  await page.getByRole("button", { name: "กำหนดส่งจริง ↕" }).click();
  await page.getByText("ปรับคอลัมน์", { exact: true }).click();
  await page
    .locator(".v2-column-menu label")
    .filter({ hasText: "Priority" })
    .locator("input[type=checkbox]")
    .first()
    .uncheck();
  await page.getByLabel("ตรึง แบรนด์", { exact: true }).check();
  await page.getByLabel("ชื่อมุมมอง").fill("My saved work");
  await page.getByRole("button", { name: "บันทึกมุมมอง", exact: true }).click();
  await expect
    .poll(() => mock.calls.filter((c) => c.p_action === "view").length)
    .toBe(1);
  await page.reload();
  await page
    .getByLabel("มุมมองที่บันทึก")
    .selectOption({ label: "My saved work" });
  await expect(page.getByLabel("ทุกแบรนด์", { exact: true })).toHaveValue(
    "Fixture Brand",
  );
  await expect(
    page.getByRole("columnheader").filter({ hasText: "Priority" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "กำหนดส่งจริง ↑" }),
  ).toBeVisible();
  await expect(page.locator("thead th.v2-pinned")).toHaveCount(2);
});

test("Comments and inbox load beyond the first page and edits stay separate from Note", async ({
  page,
}) => {
  const mock = await mockBackend(page);
  mock.setRows(
    "v2_comments",
    Array.from({ length: 105 }, (_, i) => ({
      id: `c-${i}`,
      task_key: "fixture:1:t",
      body: `Comment ${i}`,
      author_id: "00000000-0000-0000-0000-000000000001",
      author_email: "fixture@example.test",
      version: 1,
      created_at: "2026-09-20T05:00:00Z",
    })),
  );
  mock.setRows(
    "v2_mentions",
    Array.from({ length: 105 }, (_, i) => ({
      id: `m-${i}`,
      task_key: "fixture:1:t",
      actor_email: "other@example.test",
      created_at: "2026-09-20T05:00:00Z",
    })),
  );
  await page.goto("/v2/?task=fixture%3A1%3At");
  await expect(page.locator(".v2-comments article")).toHaveCount(100);
  await page
    .getByRole("button", { name: "โหลดความคิดเห็นและประวัติเพิ่มเติม" })
    .click();
  await expect(page.locator(".v2-comments article")).toHaveCount(105);
  await page
    .getByLabel("ความคิดเห็น", { exact: true })
    .fill("New collaboration note");
  await page
    .getByLabel("กล่าวถึงสมาชิก", { exact: true })
    .selectOption("Tester");
  await page
    .getByRole("button", { name: "ส่งความคิดเห็น", exact: true })
    .click();
  await expect(page.locator(".v2-comments article").first()).toContainText(
    "New collaboration note",
  );
  await expect(page.locator(".v2-comments article")).toHaveCount(106);
  expect(
    mock.calls.find((c) => c.p_action === "comment").p_payload.mentions,
  ).toEqual(["Tester"]);
  await expect(page.getByLabel("Note", { exact: true })).toHaveValue(
    "original",
  );
  await page
    .locator(".v2-comments article")
    .first()
    .getByRole("button", { name: "ลบ", exact: true })
    .click();
  await expect(page.locator(".v2-comments article")).toHaveCount(105);
  await page.getByLabel("ปิดรายละเอียด").click();
  await page
    .getByRole("navigation", { name: "เมนู V2" })
    .getByRole("button", { name: "Inbox", exact: true })
    .click();
  await expect(page.locator(".v2-inbox-item")).toHaveCount(100);
  await page.getByRole("button", { name: "โหลดการกล่าวถึงเพิ่มเติม" }).click();
  await expect(page.locator(".v2-inbox-item")).toHaveCount(105);
  await page.locator(".v2-inbox-item").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(mock.calls.some((c) => c.p_action === "read_mention")).toBeTruthy();
});

test("Dashboard layout persists and trend drilldown shows the real source snapshot", async ({
  page,
}) => {
  const mock = await mockBackend(page);
  mock.setRows("daily_metrics", [
    {
      snapshot_date: "2026-09-20",
      dimension: "overall",
      dimension_key: "all",
      metrics: { done: 7, overdue: 3 },
    },
  ]);
  await page.goto("/v2/");
  const handle = page.getByRole("heading", { name: "สถานะงาน ⠿" });
  await expect(handle).toBeVisible();
  await expect(page.locator(".react-grid-item")).toHaveCount(4);
  const before = await handle.boundingBox();
  await page.mouse.move(before.x + 100, before.y + 10);
  await page.mouse.down();
  await page.mouse.move(before.x + 300, before.y + 290, { steps: 15 });
  await page.mouse.up();
  await page.getByRole("button", { name: "บันทึกรูปแบบของฉัน" }).click();
  await expect
    .poll(() => mock.calls.filter((c) => c.p_action === "layout").length)
    .toBe(1);
  const layout = mock.calls.find((c) => c.p_action === "layout").p_payload
    .layout;
  const moved = layout.find((w) => w.i === "status");
  expect([moved.x, moved.y]).not.toEqual([0, 0]);
  await page.reload();
  await expect(page.getByRole("heading", { name: "สถานะงาน ⠿" })).toBeVisible();
  await page.getByLabel("ดูข้อมูลต้นทางแนวโน้ม").selectOption("2026-09-20");
  await expect(page.getByRole("dialog")).toContainText("2026-09-20");
  await expect(page.getByRole("dialog").locator("dd").first()).toHaveText("7");
});

test("Concurrent comment edits preserve the draft and can recover without overwriting newer text", async ({ page }) => {
  const mock = await mockBackend(page);
  const comment = {
    id: "conflict-comment", task_key: "fixture:1:t", body: "Before edit",
    author_id: "00000000-0000-0000-0000-000000000001",
    author_email: "fixture@example.test", version: 1,
    created_at: "2026-09-20T05:00:00Z",
  };
  mock.setRows("v2_comments", [comment]);
  await page.goto("/v2/?task=fixture%3A1%3At");
  await page.locator(".v2-comments article").getByRole("button", { name: "แก้ไข", exact: true }).click();
  await page.getByLabel("ความคิดเห็น", { exact: true }).fill("My unsaved draft");
  mock.setRows("v2_comments", [{ ...comment, body: "Edited by another session", version: 2 }]);
  await page.getByRole("button", { name: "บันทึกความคิดเห็น", exact: true }).click();
  await expect(page.getByText("COMMENT_CONFLICT", { exact: true })).toBeVisible();
  await expect(page.getByLabel("ความคิดเห็น", { exact: true })).toHaveValue("My unsaved draft");
  await expect(page.getByRole("button", { name: "บันทึกความคิดเห็น", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "โหลดความคิดเห็นล่าสุด", exact: true }).click();
  await expect(page.getByLabel("ความคิดเห็น", { exact: true })).toHaveValue("Edited by another session");
  await page.getByLabel("ความคิดเห็น", { exact: true }).fill("Resolved edit");
  await page.getByRole("button", { name: "บันทึกความคิดเห็น", exact: true }).click();
  await expect(page.locator(".v2-comments article")).toContainText("Resolved edit");
  expect(mock.calls.filter(c => c.p_action === "comment").map(c => c.p_payload.expectedVersion)).toEqual([1, 2]);
});

test("Inbox pagination crosses the Supabase 1,000-row response cap", async ({ page }) => {
  const mock = await mockBackend(page);
  mock.setRows("v2_mentions", Array.from({ length: 1005 }, (_, i) => ({
    id: `many-${i}`, task_key: "fixture:1:t", actor_email: "other@example.test",
    created_at: "2026-09-20T05:00:00Z",
  })));
  const pageReads=[];
  page.on("request",r=>{if(r.url().includes("/v2_mentions?"))pageReads.push(new URL(r.url()));});
  await page.goto("/v2/?view=inbox");
  for (let count = 100; count <= 1000; count += 100) {
    await expect(page.locator(".v2-inbox-item")).toHaveCount(count);
    await page.getByRole("button", { name: "โหลดการกล่าวถึงเพิ่มเติม" }).click();
  }
  await expect(page.locator(".v2-inbox-item")).toHaveCount(1005);
  expect(pageReads).toHaveLength(11);
  expect(new Set(pageReads.map(u=>u.searchParams.get("or"))).size).toBe(11);
  expect(pageReads.every(u=>u.searchParams.get("limit") === "100")).toBe(true);
  await page.getByRole("button",{name:"↻ Refresh",exact:true}).click();
  await expect(page.locator(".v2-inbox-item")).toHaveCount(100);
  await page.getByRole("button",{name:"โหลดการกล่าวถึงเพิ่มเติม"}).click();
  await expect(page.locator(".v2-inbox-item")).toHaveCount(200);
  expect(pageReads).toHaveLength(13);
});
