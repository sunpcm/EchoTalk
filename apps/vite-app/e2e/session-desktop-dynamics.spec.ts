import { expect, test, type Page } from "@playwright/test";
import { zhCN } from "../src/i18n/zh-CN";

const SESSION_FIXTURE = "/e2e/fixtures/session-active-stubbed.html";
const RECOMMENDATION_TEXT = "My name is ... and I'm learning English.";

async function stubLiveKitModule(page: Page): Promise<void> {
  await page.route("**/@livekit_components-react.js*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: `
export function useConnectionState() {
  return "connected";
}

export function useVoiceAssistant() {
  return {
    state: "listening",
    audioTrack: null,
    agentTranscriptions: [
      {
        id: "fixture-question",
        text: "What is your name?",
        final: true,
        firstReceivedTime: Date.now(),
      },
    ],
  };
}

export function useRoomContext() {
  return {};
}

export function useDataChannel() {}

export function useLocalParticipant() {
  return { localParticipant: {}, microphoneTrack: null };
}

export function useTrackTranscription() {
  return { segments: [] };
}

export function BarVisualizer() {
  return null;
}

export function VoiceAssistantControlBar() {
  return null;
}
`,
    });
  });
}

function trackApiWrites(page: Page): string[] {
  const writes: string[] = [];
  page.on("request", (request) => {
    if (
      request.url().includes("/api/") &&
      ["POST", "PUT", "PATCH", "DELETE"].includes(request.method())
    ) {
      writes.push(`${request.method()} ${request.url()}`);
    }
  });
  return writes;
}

async function stubClipboard(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const copied: string[] = [];
    const testWindow = window as Window & { __copiedRecommendations?: string[] };
    testWindow.__copiedRecommendations = copied;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          copied.push(text);
        },
      },
    });
  });
}

async function openSession(page: Page, width = 1280, height = 800): Promise<void> {
  await page.setViewportSize({ width, height });
  await stubLiveKitModule(page);
  await stubClipboard(page);
  await page.goto(SESSION_FIXTURE);
  await expect(page.getByText(zhCN.conversation.listening, { exact: true })).toBeVisible();
  await expect(page.getByTestId("session-scenario")).toHaveText("Travel Planning");
}

function recommendationRegion(page: Page) {
  return page.getByRole("region", {
    name: zhCN.answerRecommendations.title,
    includeHidden: true,
  });
}

function recommendationToggle(page: Page) {
  return page.getByTestId("answer-recs-toggle");
}

async function expectNarrowOrder(page: Page): Promise<void> {
  const statusBox = await page
    .getByText(zhCN.conversation.listening, { exact: true })
    .boundingBox();
  const subtitlesBox = await page.getByRole("log", { name: zhCN.chat.title }).boundingBox();
  const recommendationsBox = await recommendationRegion(page).boundingBox();

  expect(statusBox).not.toBeNull();
  expect(subtitlesBox).not.toBeNull();
  expect(recommendationsBox).not.toBeNull();
  expect(statusBox!.y).toBeLessThan(subtitlesBox!.y);
  expect(subtitlesBox!.y).toBeLessThan(recommendationsBox!.y);
}

async function expectWideTwoColumnLayout(page: Page): Promise<void> {
  const statusBox = await page
    .getByText(zhCN.conversation.listening, { exact: true })
    .boundingBox();
  const subtitlesBox = await page.getByRole("log", { name: zhCN.chat.title }).boundingBox();
  const recommendationsBox = await recommendationRegion(page).boundingBox();

  expect(statusBox).not.toBeNull();
  expect(subtitlesBox).not.toBeNull();
  expect(recommendationsBox).not.toBeNull();
  expect(statusBox!.x + statusBox!.width).toBeLessThanOrEqual(subtitlesBox!.x + 1);
  expect(recommendationsBox!.x + recommendationsBox!.width).toBeLessThanOrEqual(
    subtitlesBox!.x + 1,
  );
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const measure = (name: string, element: Element) => ({
      name,
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    });
    const room = document.querySelector('[data-testid="livekit-room-container"]');
    const layout = document.querySelector(".session-layout");

    return {
      document: measure("document", document.documentElement),
      body: measure("body", document.body),
      room: room ? measure("room", room) : null,
      layout: layout ? measure("layout", layout) : null,
    };
  });

  expect(overflow.room).not.toBeNull();
  expect(overflow.layout).not.toBeNull();
  for (const measurement of [overflow.document, overflow.body, overflow.room!, overflow.layout!]) {
    expect(measurement.scrollWidth, `${measurement.name} horizontal overflow`).toBeLessThanOrEqual(
      measurement.clientWidth + 1,
    );
  }
}

async function expectVisibleControlsAreReachable(page: Page): Promise<void> {
  const controls = await page.locator(".session-layout button").evaluateAll((buttons) => {
    const viewportWidth = document.documentElement.clientWidth;
    return buttons.flatMap((button) => {
      const rect = button.getBoundingClientRect();
      const style = getComputedStyle(button);
      if (
        rect.width === 0 ||
        rect.height === 0 ||
        style.visibility === "hidden" ||
        style.display === "none"
      ) {
        return [];
      }
      return [
        {
          name: (button.getAttribute("aria-label") || button.textContent || "").trim(),
          left: rect.left,
          right: rect.right,
          width: rect.width,
          height: rect.height,
          viewportWidth,
        },
      ];
    });
  });

  expect(controls.length).toBeGreaterThan(0);
  for (const control of controls) {
    expect(control.left, `${control.name} left edge`).toBeGreaterThanOrEqual(-1);
    expect(control.right, `${control.name} right edge`).toBeLessThanOrEqual(
      control.viewportWidth + 1,
    );
    expect(control.width, `${control.name} width`).toBeGreaterThanOrEqual(43.5);
    expect(control.height, `${control.name} height`).toBeGreaterThanOrEqual(43.5);
  }
}

test.describe("CP-05 会话界面动态桌面与键盘", () => {
  test("宽屏、紧邻断点与窄屏往返时保持布局模式和推荐展开状态", async ({ page }) => {
    const apiWrites = trackApiWrites(page);
    await openSession(page);

    const recommendations = recommendationRegion(page);
    const toggle = recommendationToggle(page);
    await expect(toggle).toBeHidden();
    await expect(recommendations).toBeVisible();
    await expectWideTwoColumnLayout(page);

    await page.setViewportSize({ width: 1023, height: 800 });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(recommendations).toBeHidden();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(recommendations).toBeVisible();
    await expectNarrowOrder(page);

    await page.setViewportSize({ width: 1024, height: 800 });
    await expect(toggle).toBeHidden();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(recommendations).toBeVisible();
    await expectWideTwoColumnLayout(page);

    await page.setViewportSize({ width: 1280, height: 800 });
    await expectWideTwoColumnLayout(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expectNarrowOrder(page);
    await expectNoHorizontalOverflow(page);
    expect(apiWrites).toEqual([]);
  });

  test("根字号 200% 后再缩放仍无水平溢出且关键按钮保持在视口内", async ({ page }) => {
    const apiWrites = trackApiWrites(page);
    await openSession(page);

    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).fontSize))
      .toBe("32px");
    await expectWideTwoColumnLayout(page);
    await expectNoHorizontalOverflow(page);
    await expectVisibleControlsAreReachable(page);

    await page.setViewportSize({ width: 800, height: 800 });
    const toggle = recommendationToggle(page);
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect(recommendationRegion(page)).toBeVisible();
    await expectNarrowOrder(page);
    await expectNoHorizontalOverflow(page);
    await expectVisibleControlsAreReachable(page);

    await page.setViewportSize({ width: 390, height: 844 });
    await expectNarrowOrder(page);
    await expectNoHorizontalOverflow(page);
    await expectVisibleControlsAreReachable(page);
    expect(apiWrites).toEqual([]);
  });

  test("键盘可到达并激活推荐开关与推荐按钮", async ({ page, browserName }) => {
    const apiWrites = trackApiWrites(page);
    await openSession(page, 390, 844);

    const tabKey = browserName === "webkit" ? "Alt+Tab" : "Tab";
    const endButton = page.getByRole("button", { name: zhCN.conversation.endButton });
    const toggle = recommendationToggle(page);

    await page.locator("body").click({ position: { x: 1, y: 1 } });
    await page.keyboard.press(tabKey);
    await expect(endButton).toBeFocused();
    await page.keyboard.press(tabKey);
    await expect(toggle).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(recommendationRegion(page)).toBeVisible();

    await page.keyboard.press(tabKey);
    const firstRecommendation = page.getByRole("button", {
      name: `复制推荐回答 1: ${RECOMMENDATION_TEXT}`,
    });
    await expect(firstRecommendation).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(firstRecommendation.getByText(zhCN.answerRecommendations.copied)).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as Window & { __copiedRecommendations?: string[] }).__copiedRecommendations ??
            [],
        ),
      )
      .toEqual([RECOMMENDATION_TEXT]);
    expect(apiWrites).toEqual([]);
  });

  test("缩放时当前仍可见控件的键盘焦点和推荐展开状态保持", async ({ page, browserName }) => {
    const apiWrites = trackApiWrites(page);
    await openSession(page, 390, 844);

    const tabKey = browserName === "webkit" ? "Alt+Tab" : "Tab";
    const toggle = recommendationToggle(page);
    await page.locator("body").click({ position: { x: 1, y: 1 } });
    await page.keyboard.press(tabKey);
    await page.keyboard.press(tabKey);
    await expect(toggle).toBeFocused();
    await page.keyboard.press("Enter");
    await page.keyboard.press(tabKey);

    const firstRecommendation = page.getByRole("button", {
      name: `复制推荐回答 1: ${RECOMMENDATION_TEXT}`,
    });
    await expect(firstRecommendation).toBeFocused();

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(firstRecommendation).toBeVisible();
    await expect(firstRecommendation).toBeFocused();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expectWideTwoColumnLayout(page);

    await page.setViewportSize({ width: 1023, height: 800 });
    await expect(firstRecommendation).toBeVisible();
    await expect(firstRecommendation).toBeFocused();
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expectNarrowOrder(page);
    await expectNoHorizontalOverflow(page);
    expect(apiWrites).toEqual([]);
  });

  test("动态缩放、字号与推荐交互不产生隐式 API 写请求", async ({ page }) => {
    const apiWrites = trackApiWrites(page);
    await openSession(page);

    for (const viewport of [
      { width: 1024, height: 800 },
      { width: 1023, height: 800 },
      { width: 1280, height: 800 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await expectNoHorizontalOverflow(page);
    }

    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
    const toggle = recommendationToggle(page);
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect(recommendationRegion(page)).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(recommendationRegion(page)).toBeVisible();
    expect(apiWrites).toEqual([]);
  });
});
