import { test, expect, Page } from "@playwright/test";
async function setup(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "创建空白周计划" }).click();
  await page.locator("select").selectOption({ label: "周一 · 待编辑" });
  await page.getByRole("button", { name: "编辑此计划" }).click();
  await page.getByRole("textbox", { name: "训练名称" }).fill("胸部训练");
  page.once("dialog", (d) => d.accept("卧推"));
  await page.getByRole("button", { name: "＋ 添加动作", exact: true }).click();
  await expect(page.getByRole("heading", { name: "卧推" })).toBeVisible();
  await page.getByRole("button", { name: "＋ 目标组" }).click();
  const presets = page.getByRole("textbox", { name: "默认重量", exact: true });
  for (let i = 0; i < 4; i++)
    await presets.nth(i).fill(String([30, 35, 40, 30][i]));
  await page.getByRole("button", { name: "保存计划", exact: true }).click();
  await page.getByRole("button", { name: "← 返回周计划" }).click();
  await page.getByRole("button", { name: "开始训练", exact: true }).click();
  await expect(page.getByRole("heading", { name: "卧推" })).toBeVisible();
}
test("four set input, completion, historical inheritance, reference reps reset", async ({
  page,
}) => {
  await setup(page);
  const weights = page.getByRole("textbox", { name: "重量", exact: true });
  await expect(weights).toHaveCount(4);
  for (let i = 0; i < 4; i++) await expect(weights.nth(i)).toHaveValue("30");
  for (let i = 0; i < 4; i++) {
    await weights.nth(i).fill(String([30, 35, 40, 30][i]));
    await page
      .getByRole("textbox", { name: "次数", exact: true })
      .nth(i)
      .fill("12");
    await page
      .getByRole("textbox", { name: "RIR", exact: true })
      .nth(i)
      .fill("2");
    await page
      .getByRole("button", { name: "完成组", exact: true })
      .nth(i)
      .click();
    await expect(
      page.getByRole("button", { name: "完成组", exact: true }).nth(i),
    ).toHaveText("✓");
  }
  await page.screenshot({ path: "test-results/training.png", fullPage: true });
  await page.getByRole("button", { name: "完成训练", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "开始训练", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "开始训练", exact: true }).click();
  for (let i = 0; i < 4; i++)
    await expect(weights.nth(i)).toHaveValue(String([30, 35, 40, 30][i]));
  await expect(
    page.getByRole("textbox", { name: "上次12", exact: true }),
  ).toHaveCount(4);
  await expect(
    page.getByRole("textbox", { name: "上次12", exact: true }).first(),
  ).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "完成组", exact: true }).first(),
  ).toHaveText("○");
});
test("navigation resumes active session with saved draft and progress", async ({
  page,
}) => {
  await setup(page);
  await page
    .getByRole("textbox", { name: "重量", exact: true })
    .first()
    .fill("13.6");
  await page
    .getByRole("textbox", { name: "次数", exact: true })
    .first()
    .fill("12");
  await page
    .getByRole("textbox", { name: "RIR", exact: true })
    .first()
    .fill("0");
  await page
    .getByRole("button", { name: "完成组", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("button", { name: "完成组", exact: true }).first(),
  ).toHaveText("✓");
  await page.getByRole("button", { name: "← 返回", exact: true }).click();
  await expect(page.getByText("1 / 4 组", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "继续训练", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "重量", exact: true }).first(),
  ).toHaveValue("13.6");
  await expect(
    page.getByRole("textbox", { name: "次数", exact: true }).first(),
  ).toHaveValue("12");
  await expect(
    page.getByRole("textbox", { name: "RIR", exact: true }).first(),
  ).toHaveValue("0");
});
test("invalid visible number cannot silently complete with old data", async ({
  page,
}) => {
  await setup(page);
  await page
    .getByRole("textbox", { name: "次数", exact: true })
    .first()
    .fill("12");
  await page
    .getByRole("textbox", { name: "重量", exact: true })
    .first()
    .fill("-10");
  await page
    .getByRole("button", { name: "完成组", exact: true })
    .first()
    .click();
  await expect(page.getByRole("alert")).toContainText("请先修正");
  await expect(
    page.getByRole("button", { name: "完成组", exact: true }).first(),
  ).toHaveText("○");
});
