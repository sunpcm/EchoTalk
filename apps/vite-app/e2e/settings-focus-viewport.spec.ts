import { expect, test, type Locator, type Page } from "@playwright/test";

const SYNTHETIC_STT_DRAFT = "synthetic-cp05d-stt-key";

// 完整合法的合成设置：所有 Provider 字段均有值，三项 Key 状态均已验证。
// 不使用真实 Provider、凭据或外部服务；
// 非 customMode 字段只用于避免保存被前置校验拦截。
const SYNTHETIC_SETTINGS = {
  is_custom_mode: false,
  is_custom_verified: true,
  subscription_tier: "vip",
  theme: "warm",
  stt_provider: "deepgram",
  llm_provider: "siliconflow",
  llm_model: "synthetic/cp05d-model",
  tts_provider: "cartesia",
  has_stt_key: true,
  has_llm_key: true,
  has_tts_key: true,
  stt_status: "verified",
  llm_status: "verified",
  tts_status: "verified",
} as const;

type SettingsPutBody = Record<string, unknown>;

interface OpenedSettings {
  closeButton: Locator;
  dialog: Locator;
  input: Locator;
  saveButton: Locator;
}

async function installSyntheticSettings(page: Page): Promise<SettingsPutBody[]> {
  const putBodies: SettingsPutBody[] = [];

  await page.route("**/api/user/settings", async (route, request) => {
    if (request.method() === "GET") {
      await route.fulfill({ json: SYNTHETIC_SETTINGS });
      return;
    }

    if (request.method() === "PUT") {
      const body = request.postDataJSON() as SettingsPutBody;
      putBodies.push(body);
      await route.fulfill({
        json: {
          ...SYNTHETIC_SETTINGS,
          is_custom_mode: body.is_custom_mode ?? SYNTHETIC_SETTINGS.is_custom_mode,
          is_custom_verified: true,
        },
      });
      return;
    }

    await route.continue();
  });

  return putBodies;
}

async function openSettingsWithVisibleDraft(
  page: Page,
  initialRootFontPercent: 100 | 200,
): Promise<OpenedSettings> {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "AI 英语口语练习" })).toBeVisible();

  if (initialRootFontPercent === 200) {
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
  }

  const settingsResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/user/settings" &&
      response.request().method() === "GET",
  );
  await page.getByRole("button", { name: "设置" }).click();
  const response = await settingsResponse;
  await response.finished();
  await waitForTwoAnimationFrames(page);

  const dialog = page.getByRole("dialog", { name: "设置", exact: true });
  await expect(dialog).toBeVisible();

  const customModeSwitch = dialog.getByRole("switch");
  await expect(customModeSwitch).toBeVisible();
  await customModeSwitch.click();
  await expect(customModeSwitch).toHaveAttribute("aria-checked", "true");

  const input = dialog.locator("#stt-key-input");
  await input.scrollIntoViewIfNeeded();
  await input.click();
  await input.fill(SYNTHETIC_STT_DRAFT);

  // 严格前置：填充后先证明同一 input 已聚焦、草稿完整且初始完全可视。
  await expectDraftFocusFullyVisible(input);
  expect(await readFocusedInputVisibility(input)).toMatchObject({
    activeElementIsInput: true,
    visibleRatio: 1,
  });

  return {
    closeButton: dialog.getByRole("button", { name: "关闭设置抽屉" }),
    dialog,
    input,
    saveButton: dialog.getByRole("button", { name: "保存设置" }),
  };
}

async function readFocusedInputVisibility(input: Locator) {
  return input.evaluate((element) => {
    const scroller = element.closest<HTMLElement>(".overflow-y-auto");
    if (!scroller) return null;

    const inputRect = element.getBoundingClientRect();
    const scrollerRect = scroller.getBoundingClientRect();
    const visibleLeft = Math.max(inputRect.left, scrollerRect.left, 0);
    const visibleTop = Math.max(inputRect.top, scrollerRect.top, 0);
    const visibleRight = Math.min(inputRect.right, scrollerRect.right, window.innerWidth);
    const visibleBottom = Math.min(inputRect.bottom, scrollerRect.bottom, window.innerHeight);
    const visibleWidth = Math.max(0, visibleRight - visibleLeft);
    const visibleHeight = Math.max(0, visibleBottom - visibleTop);
    const area = inputRect.width * inputRect.height;
    const visibleRatio = area > 0 ? (visibleWidth * visibleHeight) / area : 0;

    return {
      activeElementIsInput: document.activeElement === element,
      inputBottom: inputRect.bottom,
      inputTop: inputRect.top,
      scrollerBottom: scrollerRect.bottom,
      scrollerTop: scrollerRect.top,
      viewportHeight: window.innerHeight,
      visibleRatio: Number(visibleRatio.toFixed(4)),
    };
  });
}

async function expectDraftFocusFullyVisible(input: Locator) {
  // 默认 5 秒会等待产品在 resize/font 后的 rAF 发布完成。
  await expect
    .poll(() => readFocusedInputVisibility(input))
    .toMatchObject({
      activeElementIsInput: true,
      visibleRatio: 1,
    });
  await expect(input).toBeInViewport({ ratio: 1 });
  await expect(input).toBeFocused();
  await expect(input).toHaveValue(SYNTHETIC_STT_DRAFT);
}

async function waitForTwoAnimationFrames(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve());
        });
      }),
  );
}

async function expectNoHorizontalOverflow(page: Page, dialog: Locator) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1),
  ).toBe(false);
  expect(await dialog.evaluate((element) => element.scrollWidth > element.clientWidth + 1)).toBe(
    false,
  );
}

test.describe("CP-05D settings focused input across dynamic viewport", () => {
  test("keeps the focused draft completely visible after an ordinary viewport resize", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const putBodies = await installSyntheticSettings(page);
    const { closeButton, dialog, input } = await openSettingsWithVisibleDraft(page, 100);
    expect(putBodies).toEqual([]);

    // 从这里开始只改可用视口；禁止 scrollIntoView/focus 帮助产品通过。
    await page.setViewportSize({ width: 667, height: 320 });
    await expectDraftFocusFullyVisible(input);
    await expectNoHorizontalOverflow(page, dialog);

    await waitForTwoAnimationFrames(page);
    await expectDraftFocusFullyVisible(input);
    expect(putBodies).toEqual([]);

    await expect(closeButton).toBeVisible();
    await closeButton.click();
    await expect(dialog).not.toBeVisible();
    await waitForTwoAnimationFrames(page);
    expect(putBodies).toEqual([]);
  });

  test("keeps a 200% focused draft visible after resize, then saves once and closes", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const putBodies = await installSyntheticSettings(page);
    const { closeButton, dialog, input, saveButton } = await openSettingsWithVisibleDraft(
      page,
      200,
    );
    expect(putBodies).toEqual([]);

    // 200% 字号在严格前置中已生效；factor 阶段只缩短并放宽可用视口。
    await page.setViewportSize({ width: 667, height: 320 });
    await expectDraftFocusFullyVisible(input);
    await expectNoHorizontalOverflow(page, dialog);

    await waitForTwoAnimationFrames(page);
    await expectDraftFocusFullyVisible(input);
    expect(putBodies).toEqual([]);

    await saveButton.click();
    await expect.poll(() => putBodies.length).toBe(1);
    expect(putBodies[0]).toMatchObject({
      is_custom_mode: true,
      stt_provider: "deepgram",
      llm_provider: "siliconflow",
      llm_model: "synthetic/cp05d-model",
      tts_provider: "cartesia",
      stt_key: SYNTHETIC_STT_DRAFT,
    });

    await expect(closeButton).toBeVisible();
    await closeButton.click();
    await expect(dialog).not.toBeVisible();
    await waitForTwoAnimationFrames(page);
    expect(putBodies).toHaveLength(1);
  });

  test("keeps the focused draft visible when only the root font changes to 200%", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const putBodies = await installSyntheticSettings(page);
    const { closeButton, dialog, input } = await openSettingsWithVisibleDraft(page, 100);
    expect(putBodies).toEqual([]);

    // 严格前置已建立 focus/value/visibleRatio=1；
    // 这里只改字号验证 body/scroll 尺寸变化。
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
    await expectDraftFocusFullyVisible(input);
    await expectNoHorizontalOverflow(page, dialog);

    await waitForTwoAnimationFrames(page);
    await expectDraftFocusFullyVisible(input);
    expect(putBodies).toEqual([]);

    await expect(closeButton).toBeVisible();
    await closeButton.click();
    await expect(dialog).not.toBeVisible();
    await waitForTwoAnimationFrames(page);
    expect(putBodies).toEqual([]);
  });
});
