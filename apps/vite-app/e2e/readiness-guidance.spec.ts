import { expect, test, type Page } from "@playwright/test";
import { zhCN } from "../src/i18n/zh-CN";

const t = zhCN.practiceReadiness;

async function observeEffects(page: Page) {
  const downstream: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (
      (request.method() === "POST" && path === "/api/sessions") ||
      /\/(token|dispatch)$/.test(path)
    )
      downstream.push(`${request.method()} ${path}`);
  });
  page.on("websocket", (socket) => {
    const url = new URL(socket.url());
    if (url.pathname.includes("livekit") || url.pathname.includes("/rtc")) {
      downstream.push(`WS ${socket.url()}`);
    }
  });
  await page.addInitScript(() => {
    const probe = window as unknown as { readinessMediaCalls: number };
    probe.readinessMediaCalls = 0;
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      // LiveKit wraps this method at import time; its wrapper must retain the guard.
      writable: true,
      value: async () => {
        probe.readinessMediaCalls++;
        throw new Error("Synthetic media guard");
      },
    });
  });
  return downstream;
}

async function expectNoEffects(page: Page, downstream: string[]) {
  expect(downstream).toEqual([]);
  expect(
    await page.evaluate(
      () => (window as unknown as { readinessMediaCalls: number }).readinessMediaCalls,
    ),
  ).toBe(0);
}

test("scenario failure opens settings, deduplicates explicit recheck and never auto-starts", async ({
  page,
}) => {
  const downstream = await observeEffects(page);
  let fixture = "settings_required";
  let checks = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/health/ready", async (route) => {
    checks++;
    if (checks === 2) await gate;
    await route.continue({ headers: { ...route.request().headers(), "x-e2e-readiness": fixture } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: zhCN.dashboard.enterPractice }).click();
  await expect(page.getByTestId("practice-readiness-error")).toContainText(t.settings_required);
  await expect(page.getByText(t.settings_required)).toHaveCount(1);
  await expect(page.locator("body")).not.toContainText("synthetic-readiness-canary");
  await page.getByRole("button", { name: t.openSettings }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: zhCN.settings.closeAriaLabel }).click();
  expect(checks).toBe(1);
  await expectNoEffects(page, downstream);

  fixture = "ready";
  await page.getByRole("button", { name: t.retry, exact: true }).click();
  await expect(page.getByRole("button", { name: t.checking })).toBeDisabled();
  await expect.poll(() => checks).toBe(2);
  release();
  await expect(page.getByText(t.ready)).toBeVisible();
  await expectNoEffects(page, downstream);
  expect(checks).toBe(2);
  // Register before clicking so a fast response cannot race the observer.
  const createdResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/sessions",
    { timeout: 10_000 },
  );
  await page.getByRole("button", { name: zhCN.dashboard.enterPractice }).click();
  const createdResponse = await createdResponsePromise;
  expect(createdResponse.status()).toBe(201);
  await expect(createdResponse.json()).resolves.toMatchObject({
    mode: "scenario",
    status: "active",
  });
  expect(checks).toBe(3);
  expect(downstream).toContain("POST /api/sessions");
});

test("DocTalk failure discards old document intent after a successful recheck", async ({
  page,
}) => {
  const downstream = await observeEffects(page);
  let fixture = "custom_unverified";
  await page.route("**/api/health/ready", (route) =>
    route.continue({
      headers: { ...route.request().headers(), "x-e2e-readiness": fixture },
    }),
  );
  await page.goto("/");
  await page.getByRole("heading", { name: zhCN.docChat.dashboardEntry }).click();
  await page.locator("#doc-upload-textarea").fill("Synthetic old private document");
  await page.getByRole("button", { name: zhCN.docChat.startButton }).click();
  await expect(page.getByText(t.custom_unverified)).toBeVisible();
  await expectNoEffects(page, downstream);
  fixture = "ready";
  await page.getByRole("button", { name: t.retry, exact: true }).click();
  await expect(page.getByText(t.ready)).toBeVisible();
  await expectNoEffects(page, downstream);
  await page.getByRole("heading", { name: zhCN.docChat.dashboardEntry }).click();
  await expect(page.locator("#doc-upload-textarea")).toHaveValue("");
});

test("resume readiness failure offers shared guidance and recheck does not resume", async ({
  page,
  request,
}) => {
  const created = await request.post("/api/sessions", {
    headers: { Authorization: "Bearer e2e-dev-token" },
    data: { mode: "scenario" },
  });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: string };
  const downstream = await observeEffects(page);
  let fixture = "permission_denied";
  await page.route("**/api/health/ready", (route) =>
    route.continue({
      headers: { ...route.request().headers(), "x-e2e-readiness": fixture },
    }),
  );
  await page.goto("/");
  await page.getByTestId(`resume-session-button-${id}`).click();
  await page.getByTestId(`confirm-resume-button-${id}`).click();
  await expect(page.getByText(t.permission_denied)).toHaveCount(1);
  await expect(page.getByTestId(`resume-error-${id}`)).toHaveCount(0);
  await expect(page.getByTestId(`retry-resume-button-${id}`)).toBeVisible();
  await expectNoEffects(page, downstream);
  fixture = "ready";
  await page.getByRole("button", { name: t.retry, exact: true }).click();
  await expect(page.getByText(t.ready)).toBeVisible();
  await expect(page.getByTestId(`resume-error-${id}`)).toHaveCount(0);
  await expectNoEffects(page, downstream);
});

for (const fixture of ["unknown", "legacy", "html"]) {
  test(`safe fallback for ${fixture} never infers a settings action`, async ({ page }) => {
    const downstream = await observeEffects(page);
    await page.route("**/api/health/ready", (route) =>
      route.continue({
        headers: { ...route.request().headers(), "x-e2e-readiness": fixture },
      }),
    );
    await page.goto("/");
    await page.getByRole("button", { name: zhCN.dashboard.enterPractice }).click();
    await expect(page.getByText(t.fallback)).toBeVisible();
    await expect(page.getByRole("button", { name: t.openSettings })).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText("synthetic-readiness-canary");
    await expectNoEffects(page, downstream);
  });
}
