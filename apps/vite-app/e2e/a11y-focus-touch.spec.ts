import { expect, test, type Page } from "@playwright/test";

// R2-05：键盘焦点可见性、触控目标尺寸与页面地标的通用回归。

const ACTIVE_SESSION = {
  id: "5a11f0c0-0000-4000-8000-000000000001",
  mode: "scenario",
  status: "active",
  started_at: "2026-11-10T08:00:00Z",
  ended_at: null,
};

const PROVIDER_SELECTS = [
  {
    id: "stt-provider-select",
    label: "语音识别 (STT)",
    optionValues: ["deepgram"],
  },
  {
    id: "llm-provider-select",
    label: "语言模型 (LLM)",
    optionValues: ["siliconflow", "openrouter"],
  },
  {
    id: "tts-provider-select",
    label: "语音合成 (TTS)",
    optionValues: ["cartesia"],
  },
] as const;

const PROVIDER_VIEWPORTS = [
  { name: "390px mobile", width: 390, height: 844 },
  { name: "desktop", width: 1280, height: 720 },
] as const;

const PROVIDER_THEMES = [
  { key: "warm", radioName: "暖色外观主题" },
  { key: "cool", radioName: "冷色外观主题" },
  { key: "dark", radioName: "黑色外观主题" },
] as const;

async function openDashboard(page: Page) {
  await page.route("**/api/sessions/active*", (route) =>
    route.fulfill({ json: { items: [ACTIVE_SESSION], next_cursor: null } }),
  );
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "AI 英语口语练习" })).toBeVisible();
  await expect(page.getByRole("button", { name: /进入练习/ }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "恢复练习" })).toBeVisible();
}

function dashboardWeeklyDayButtons(page: Page) {
  return page
    .getByTestId("weekly-progress")
    .getByRole("list", { name: "最近七天的已完成会话" })
    .getByRole("button");
}

async function waitForDashboardWeeklyProgress(page: Page) {
  await expect(dashboardWeeklyDayButtons(page)).toHaveCount(7);
}

/** 读取当前焦点元素的名称，以及它是否有非透明的 outline 或 ring。 */
function describeFocus(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return null;
    const cs = getComputedStyle(el);
    const transparent = (c: string) => c === "transparent" || /rgba\(.*,\s*0\)$/.test(c);
    const hasOutline =
      cs.outlineStyle !== "none" &&
      parseFloat(cs.outlineWidth) >= 2 &&
      !transparent(cs.outlineColor);
    // ring 是 0 偏移、0 模糊、正扩散的 box-shadow 层
    const hasRing = cs.boxShadow
      .split(/,(?![^(]*\))/)
      .some((layer) => /0px 0px 0px [1-9]\d*px/.test(layer) && !/rgba\(0, 0, 0, 0\)/.test(layer));
    return {
      name: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 30),
      visible: hasOutline || hasRing,
    };
  });
}

// WebKit 默认 Tab 只遍历表单控件，Option+Tab 才遍历全部可聚焦元素
async function tabThrough(page: Page, max: number, key = "Tab") {
  const seen: { name: string; visible: boolean }[] = [];
  for (let i = 0; i < max; i++) {
    await page.keyboard.press(key);
    const info = await describeFocus(page);
    if (!info) break;
    seen.push(info);
  }
  return seen;
}

test("every keyboard-focusable control on the dashboard shows a visible focus indicator", async ({
  page,
  browserName,
}) => {
  await openDashboard(page);
  await waitForDashboardWeeklyProgress(page);

  const seen = await tabThrough(page, 40, browserName === "webkit" ? "Alt+Tab" : "Tab");
  expect(seen.length).toBeGreaterThanOrEqual(6);
  expect(seen.map((s) => s.name).join("|")).toContain("文档对话");
  expect(seen.filter((s) => !s.visible)).toEqual([]);
});

test("dashboard focus audit waits for a controlled slow weekly progress request", async ({
  page,
  browserName,
}) => {
  let releaseWeekly!: () => void;
  const weeklyReleased = new Promise<void>((resolve) => {
    releaseWeekly = resolve;
  });
  let weeklyRequestStarted!: () => void;
  const weeklyStarted = new Promise<void>((resolve) => {
    weeklyRequestStarted = resolve;
  });
  await page.route("**/api/sessions/weekly-progress?*", async (route) => {
    weeklyRequestStarted();
    await weeklyReleased;
    await route.continue();
  });

  let readiness: Promise<void> | undefined;
  try {
    await openDashboard(page);
    await weeklyStarted;
    let ready = false;
    readiness = waitForDashboardWeeklyProgress(page).then(() => {
      ready = true;
    });

    const weekly = page.getByTestId("weekly-progress");
    await expect(weekly.getByRole("status")).toHaveText("正在加载七天概览…");
    await expect(dashboardWeeklyDayButtons(page)).toHaveCount(0);
    expect(ready).toBe(false);
    releaseWeekly();
    await readiness;

    const seen = await tabThrough(page, 40, browserName === "webkit" ? "Alt+Tab" : "Tab");
    expect(seen.length).toBeGreaterThanOrEqual(6);
    expect(seen.map((s) => s.name).join("|")).toContain("文档对话");
    expect(seen.filter((s) => !s.visible)).toEqual([]);
  } finally {
    releaseWeekly();
    await readiness;
  }
});

test("primary buttons on the ended view show a visible focus indicator", async ({
  page,
  browserName,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "AI 英语口语练习" })).toBeVisible();
  await page.evaluate(async () => {
    const { useAppStore } = await import("/src/store/appStore.ts");
    useAppStore.setState({
      appView: "session",
      connectionState: "ended",
      sessionId: "analysis-success",
      token: null,
      wsUrl: null,
      error: null,
      agentError: null,
    });
  });
  await expect(page.getByRole("button", { name: "返回主页" })).toBeVisible();

  const seen = await tabThrough(page, 10, browserName === "webkit" ? "Alt+Tab" : "Tab");
  expect(seen.some((s) => s.name === "返回主页")).toBe(true);
  expect(seen.filter((s) => !s.visible)).toEqual([]);
});

test.describe("Provider native select touch geometry and interaction", () => {
  for (const viewport of PROVIDER_VIEWPORTS) {
    for (const theme of PROVIDER_THEMES) {
      test(`${viewport.name} ${theme.key} theme keeps three native Provider selects usable at 44px`, async ({
        page,
      }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await openDashboard(page);

        await page.getByRole("button", { name: "自定义模型设置" }).click();
        const dialog = page.getByRole("dialog", { name: "自定义模型设置" });
        await expect(dialog).toBeVisible();

        const customModeSwitch = dialog.getByRole("switch");
        await expect(customModeSwitch).toBeVisible();
        await customModeSwitch.click();

        const providerFieldset = dialog.locator("fieldset");
        await expect(providerFieldset).toBeEnabled();

        const themeRadio = dialog.getByRole("radio", { name: theme.radioName });
        await themeRadio.click();
        await expect(themeRadio).toHaveAttribute("aria-checked", "true");
        if (theme.key === "warm") {
          const appliedTheme = await page
            .locator("html")
            .evaluate((element) => element.getAttribute("data-theme"));
          expect(appliedTheme === "warm" || appliedTheme === null).toBe(true);
        } else {
          await expect(page.locator("html")).toHaveAttribute("data-theme", theme.key);
        }

        for (const providerSelect of PROVIDER_SELECTS) {
          const select = dialog.getByLabel(providerSelect.label);
          await expect(select).toHaveId(providerSelect.id);
          await expect(select).toBeEnabled();
          expect(await select.evaluate((element) => element.tagName)).toBe("SELECT");
          expect(await select.evaluate((element) => (element as HTMLSelectElement).type)).toBe(
            "select-one",
          );
          await expect(select.locator("option")).toHaveCount(providerSelect.optionValues.length);
          expect(
            await select
              .locator("option")
              .evaluateAll((options) =>
                options.map((option) => (option as HTMLOptionElement).value),
              ),
          ).toEqual(providerSelect.optionValues);

          const box = await select.boundingBox();
          expect.soft(box, `${providerSelect.id} bounding box`).not.toBeNull();
          expect
            .soft(box?.width ?? 0, `${providerSelect.id} actual width`)
            .toBeGreaterThanOrEqual(44);
          expect
            .soft(box?.height ?? 0, `${providerSelect.id} actual height`)
            .toBeGreaterThanOrEqual(44);

          await select.focus();
          await expect(select).toBeFocused();
          await expect.poll(async () => (await describeFocus(page))?.visible).toBe(true);
        }

        const llmSelect = dialog.getByLabel("语言模型 (LLM)");
        await llmSelect.focus();
        await expect(llmSelect).toBeFocused();
        await llmSelect.selectOption("openrouter");
        await expect(llmSelect).toHaveValue("openrouter");
        await llmSelect.selectOption("siliconflow");
        await expect(llmSelect).toHaveValue("siliconflow");
        await expect(llmSelect).toBeFocused();
      });
    }
  }
});

test("interactive controls are at least 44x44 at 390px on the dashboard and in settings", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openDashboard(page);

  const undersized = (scope: string) =>
    page.evaluate((selector) => {
      const root = document.querySelector(selector);
      if (!root) return ["scope-missing"];
      return [...root.querySelectorAll<HTMLElement>("button, select, input, textarea, a[href]")]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && el.type !== "file";
        })
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width < 43.5 || r.height < 43.5;
        })
        .map((el) => {
          const r = el.getBoundingClientRect();
          const name = (el.getAttribute("aria-label") || el.textContent || el.tagName).trim();
          return `${name.slice(0, 20)} ${Math.round(r.width)}x${Math.round(r.height)}`;
        });
    }, scope);

  expect(await undersized("main")).toEqual([]);

  await page.getByRole("button", { name: "自定义模型设置" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  // 打开自定义模式以渲染全部 Provider 表单控件
  await page.getByRole("dialog").getByRole("switch").click();
  expect(await undersized("dialog.settings-drawer")).toEqual([]);
});

test("the app exposes exactly one main landmark containing the page heading", async ({ page }) => {
  await openDashboard(page);
  await expect(page.locator("main")).toHaveCount(1);
  await expect(page.locator("main").getByRole("heading", { level: 1 })).toHaveText(
    "AI 英语口语练习",
  );
});

test("every failed dashboard section keeps its title and offers a 44px retry button", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route(/\/api\/(sessions|assessments|curriculum)/, (route) =>
    route.fulfill({ status: 503, json: { detail: "synthetic failure" } }),
  );
  await page.goto("/");
  await expect(page.getByText("七天语法记录加载失败，请重试")).toBeVisible();

  for (const title of ["活动会话", "今日专属推荐", "今日进度", "最近七天", "最近七天语法记录"]) {
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  }

  const retryButtons = page.locator("main").getByRole("button", { name: /重试/ });
  await expect(retryButtons).toHaveCount(5);
  for (const button of await retryButtons.all()) {
    const box = await button.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(43.5);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(43.5);
  }
  await expect(page.locator("main").getByRole("alert")).toHaveCount(5);
});
