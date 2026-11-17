import { expect, test as base, type Page } from "@playwright/test";
import { showEndedSession } from "./helpers/show-ended-session";

type GcGlobal = typeof globalThis & {
  __echotalkPromiseGcExecuted?: boolean;
  gc?: () => void;
};

function pageErrorListenerCount(page: Page) {
  return (page as Page & { listenerCount(event: string): number }).listenerCount("pageerror");
}

const test = base.extend({
  launchOptions: async ({ browserName, launchOptions }, provideLaunchOptions) => {
    if (browserName !== "chromium") {
      await provideLaunchOptions(launchOptions);
      return;
    }

    await provideLaunchOptions({
      ...launchOptions,
      args: [...(launchOptions?.args ?? []), "--js-flags=--expose-gc"],
    });
  },
});

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "AI 英语口语练习" })).toBeVisible();
});

test("shared helper keeps unsupported contract with forced GC only in Chromium", async ({
  browserName,
  page,
}) => {
  const triggersGc = browserName === "chromium";

  if (triggersGc) {
    const gcExposed = await page.evaluate(
      () => typeof (globalThis as typeof globalThis & { gc?: unknown }).gc === "function",
    );
    expect(gcExposed).toBe(true);

    await page.evaluate(async () => {
      const state = globalThis as GcGlobal;
      if (typeof state.gc !== "function") {
        throw new Error("Chromium garbage collection was not exposed");
      }

      const forceGarbageCollection = state.gc;
      const { useAppStore } = await import("/src/store/appStore.ts");
      const originalSetState = useAppStore.setState;
      useAppStore.setState = ((...args: Parameters<typeof originalSetState>) => {
        const result = originalSetState(...args);
        queueMicrotask(() => {
          queueMicrotask(() => {
            forceGarbageCollection();
            state.__echotalkPromiseGcExecuted = true;
          });
        });
        return result;
      }) as typeof originalSetState;
    });
  }

  const pageErrorListenersBefore = pageErrorListenerCount(page);
  await showEndedSession(page, "analysis-unsupported");
  expect(pageErrorListenerCount(page)).toBe(pageErrorListenersBefore);

  await expect(page.getByText("当前未配置真实评估服务，无法生成正式学习结果")).toBeVisible();
  await expect(page.getByRole("button", { name: "重新分析" })).toHaveCount(0);
  const goHome = page.getByRole("button", { name: "返回主页" });
  await expect(goHome).toBeEnabled();

  if (triggersGc) {
    const gcObserved = await page.evaluate(() => {
      const state = globalThis as GcGlobal;
      return state.__echotalkPromiseGcExecuted === true;
    });
    expect(gcObserved).toBe(true);
  }

  await goHome.click();
  await expect(page.getByRole("heading", { name: "AI 英语口语练习" })).toBeVisible();
});

test("shared helper propagates real module body page errors", async ({ page }) => {
  const failureMessage = "CGC_CONTROLLED_SETTER_FAILURE";
  const pageErrorListenersBefore = pageErrorListenerCount(page);

  await page.evaluate(async (message) => {
    const { useAppStore } = await import("/src/store/appStore.ts");
    useAppStore.setState = (() => {
      throw new Error(message);
    }) as typeof useAppStore.setState;
  }, failureMessage);

  await expect(showEndedSession(page, "analysis-error-propagation")).rejects.toThrow(
    failureMessage,
  );
  expect(pageErrorListenerCount(page)).toBe(pageErrorListenersBefore);
});
