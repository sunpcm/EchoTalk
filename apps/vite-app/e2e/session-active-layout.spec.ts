import { expect, test, type Page } from "@playwright/test";
import { zhCN } from "../src/i18n/zh-CN";

const viewports = [
  { width: 390, height: 844, name: "mobile-390" },
  { width: 1280, height: 800, name: "desktop-1280" },
] as const;

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

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const measure = (name: string, element: Element) => ({
      name,
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    });
    const room = document.querySelector('[data-testid="livekit-room-container"]');
    const dialogs = Array.from(document.querySelectorAll("dialog, [role='dialog']"));

    return {
      document: measure("document", document.documentElement),
      body: measure("body", document.body),
      room: room ? measure("room", room) : null,
      dialogs: dialogs.map((dialog, index) => measure(`dialog-${index}`, dialog)),
    };
  });

  expect(overflow.document.scrollWidth).toBeLessThanOrEqual(overflow.document.clientWidth + 1);
  expect(overflow.body.scrollWidth).toBeLessThanOrEqual(overflow.body.clientWidth + 1);
  expect(overflow.room).not.toBeNull();
  expect(overflow.room!.scrollWidth).toBeLessThanOrEqual(overflow.room!.clientWidth + 1);
  for (const dialog of overflow.dialogs) {
    expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth + 1);
  }
}

test.describe("R2-11 会话中界面模块桩布局", () => {
  for (const viewport of viewports) {
    test(`${viewport.name}：主题背景、场景/计时页头、字幕顺序与单实例回答推荐`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await stubLiveKitModule(page);
      const apiWrites = trackApiWrites(page);

      await page.goto("/e2e/fixtures/session-active-stubbed.html");

      await expect(page.getByText(zhCN.conversation.listening, { exact: true })).toBeVisible();
      await expect(page.getByTestId("session-scenario")).toHaveText("Travel Planning");
      await expect(page.getByTestId("session-timer")).toHaveText(/^\d{2}:\d{2}$/);

      const roomContainer = page.getByTestId("livekit-room-container");
      let backgrounds = { room: "", page: "" };
      await expect
        .poll(async () => {
          backgrounds = await roomContainer.evaluate((element) => ({
            room: window.getComputedStyle(element).backgroundColor,
            page: window.getComputedStyle(document.body).backgroundColor,
          }));
          return backgrounds.room === backgrounds.page;
        })
        .toBe(true);
      expect(backgrounds.room).not.toBe("");

      const recommendations = page.getByRole("region", {
        name: zhCN.answerRecommendations.title,
        includeHidden: true,
      });
      await expect(recommendations).toHaveCount(1);
      const status = page.getByText(zhCN.conversation.listening, { exact: true });
      const subtitles = page.getByRole("log", { name: zhCN.chat.title });

      if (viewport.width < 1024) {
        const toggle = page.getByTestId("answer-recs-toggle");
        await expect(toggle).toHaveAttribute("aria-expanded", "false");
        await expect(recommendations).toBeHidden();
        await toggle.click();
        await expect(toggle).toHaveAttribute("aria-expanded", "true");
        await expect(recommendations).toBeVisible();

        const statusBox = await status.boundingBox();
        const subtitlesBox = await subtitles.boundingBox();
        const recommendationsBox = await recommendations.boundingBox();

        expect(statusBox).not.toBeNull();
        expect(subtitlesBox).not.toBeNull();
        expect(recommendationsBox).not.toBeNull();
        expect(statusBox!.y).toBeLessThan(subtitlesBox!.y);
        expect(subtitlesBox!.y).toBeLessThan(recommendationsBox!.y);
      } else {
        await expect(recommendations).toBeVisible();

        const statusBox = await status.boundingBox();
        const subtitlesBox = await subtitles.boundingBox();
        const recommendationsBox = await recommendations.boundingBox();

        expect(statusBox).not.toBeNull();
        expect(subtitlesBox).not.toBeNull();
        expect(recommendationsBox).not.toBeNull();
        expect(statusBox!.x + statusBox!.width).toBeLessThanOrEqual(subtitlesBox!.x + 1);
        expect(recommendationsBox!.x + recommendationsBox!.width).toBeLessThanOrEqual(
          subtitlesBox!.x + 1,
        );
      }

      await expect(recommendations.getByRole("button")).toHaveCount(3);
      await expectNoHorizontalOverflow(page);
      expect(apiWrites).toEqual([]);
    });
  }
});
