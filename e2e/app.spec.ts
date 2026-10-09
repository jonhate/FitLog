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

test("history calendar filters a day, clears selection and changes month/year", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "历史", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "查看 / 编辑", exact: true }),
  ).toHaveCount(1);
  const today = await page.evaluate(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  await page
    .getByRole("button", { name: today + " 有训练", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "查看 / 编辑", exact: true }),
  ).toHaveCount(1);
  const empty = page
    .locator(".calendar-grid button:not(.has-training)")
    .first();
  await empty.click();
  await expect(
    page.getByText("这一天没有训练记录", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "查看 / 编辑", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "全部记录", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "查看 / 编辑", exact: true }),
  ).toHaveCount(1);
  await page.getByRole("combobox", { name: "选择年份" }).selectOption("2025");
  await page.getByRole("button", { name: "下个月", exact: true }).click();
  await expect(page.locator(".calendar strong")).toHaveText(
    `${((new Date().getMonth() + 1) % 12) + 1}月`,
  );
  await page.locator(".calendar").evaluate((el) => {
    const start = new Event("touchstart", { bubbles: true });
    Object.defineProperty(start, "touches", {
      value: [{ clientX: 250, clientY: 200 }],
    });
    el.dispatchEvent(start);
    const end = new Event("touchend", { bubbles: true });
    Object.defineProperty(end, "changedTouches", {
      value: [{ clientX: 120, clientY: 205 }],
    });
    el.dispatchEvent(end);
  });
  await expect(page.locator(".calendar strong")).toHaveText(
    `${((new Date().getMonth() + 2) % 12) + 1}月`,
  );
});

test("unilateral logical groups, optional fixed target, notes and reminder", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "← 返回", exact: true }).click();
  await page.getByRole("button", { name: "编辑此计划", exact: true }).click();
  await expect(
    page.getByRole("switch", { name: "设为休息日" }),
  ).not.toBeChecked();
  await expect(
    page.getByRole("textbox", { name: "最少次数", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", {
      name: "目标次数：未设置 · 设置（可选）",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "固定次数", exact: true }).click();
  await page.getByRole("textbox", { name: "目标次数", exact: true }).fill("12");
  await expect(
    page.getByRole("textbox", { name: "最多次数", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("combobox", { name: "记录方式", exact: true })
    .selectOption("unilateral");
  await page
    .getByRole("textbox", { name: "左侧默认重量", exact: true })
    .first()
    .fill("10");
  await page
    .getByRole("textbox", { name: "右侧默认重量", exact: true })
    .first()
    .fill("12");
  await page.getByRole("button", { name: "保存计划", exact: true }).click();
  await page.getByRole("button", { name: "← 返回周计划", exact: true }).click();
  await page.getByRole("button", { name: "开始训练", exact: true }).click();
  await expect(page.locator(".side-group")).toHaveCount(4);
  await expect(
    page.getByText("单手 · 每组分左右记录 · 目标 12 次", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "重量", exact: true }),
  ).toHaveCount(8);
  await page
    .getByRole("textbox", { name: "次数", exact: true })
    .nth(0)
    .fill("12");
  await page
    .getByRole("button", { name: "完成组", exact: true })
    .nth(0)
    .click();
  await expect(page.getByText("0 / 4 组", { exact: true })).toBeVisible();
  await page
    .getByRole("textbox", { name: "次数", exact: true })
    .nth(1)
    .fill("12");
  await page
    .getByRole("button", { name: "完成组", exact: true })
    .nth(1)
    .click();
  await expect(page.getByText("1 / 4 组", { exact: true })).toBeVisible();
  await page
    .getByRole("textbox", { name: "本次感受", exact: true })
    .fill("左侧更稳定");
  await page
    .getByRole("textbox", { name: "下次提醒", exact: true })
    .fill("下次试 15 kg");
  await expect(
    page.getByText("已保存", { exact: false }).first(),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/unilateral.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "← 返回", exact: true }).click();
  await page
    .getByRole("button", { name: "继续训练", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("textbox", { name: "本次感受", exact: true }),
  ).toHaveValue("左侧更稳定");
  await expect(
    page.getByRole("textbox", { name: "下次提醒", exact: true }),
  ).toHaveValue("下次试 15 kg");
  await page.getByRole("button", { name: "历史", exact: true }).click();
  await page
    .getByRole("button", { name: "查看 / 编辑", exact: true })
    .first()
    .click();
  await page
    .getByRole("textbox", { name: "本次感受", exact: true })
    .fill("历史补充");
  await page.getByRole("button", { name: "保存历史修改", exact: true }).click();
  await page.getByRole("button", { name: "← 返回", exact: true }).click();
  await page
    .getByRole("button", { name: "查看 / 编辑", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("textbox", { name: "本次感受", exact: true }),
  ).toHaveValue("历史补充");
});
