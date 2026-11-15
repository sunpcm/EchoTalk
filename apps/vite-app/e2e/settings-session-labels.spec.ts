import { expect, test, type Locator, type Page } from "@playwright/test";

const FIRST_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const SECOND_ID = "4fa85f64-5717-4562-b3fc-2c963f66afa7";
const SAME_MODE = "scenario";
const SAME_STARTED_AT = "2026-11-15T02:03:04Z";

const SESSION_FIXTURES = [
  {
    id: FIRST_ID,
    mode: SAME_MODE,
    status: "active",
    started_at: SAME_STARTED_AT,
    ended_at: null,
  },
  {
    id: SECOND_ID,
    mode: SAME_MODE,
    status: "active",
    started_at: SAME_STARTED_AT,
    ended_at: null,
  },
];

async function installActiveSessions(page: Page) {
  await page.route("**/api/sessions/active", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: SESSION_FIXTURES, next_cursor: null }),
    });
  });
}

async function expectNoFullIdExposure(scope: Locator, sessionId: string) {
  await expect(scope).not.toContainText(sessionId);
  expect((await scope.getAttribute("title")) ?? "").not.toContain(sessionId);
  expect((await scope.getAttribute("aria-label")) ?? "").not.toContain(sessionId);
  await expect(scope).not.toHaveAccessibleName(new RegExp(sessionId));

  const titledValues = await scope
    .locator("[title]")
    .evaluateAll((elements) => elements.map((element) => element.getAttribute("title") ?? ""));
  expect(titledValues.join("\n")).not.toContain(sessionId);

  const buttons = scope.locator("button");
  for (let index = 0; index < (await buttons.count()); index += 1) {
    await expect(buttons.nth(index)).not.toHaveAccessibleName(new RegExp(sessionId));
  }
}

async function expectSameModeAndStart(row: Locator, sessionId: string) {
  const mode = row.getByTestId(`session-mode-${sessionId}`);
  const startedAt = row.getByTestId(`session-started-at-${sessionId}`);
  await expect(mode).toBeVisible();
  await expect(startedAt).toBeVisible();
  return { modeText: await mode.innerText(), startedAtText: await startedAt.innerText() };
}

test.describe("R2-UI shared labels and exact session targets", () => {
  test("shows literal settings name and targets the second same-label row for end", async ({
    page,
  }, testInfo) => {
    await installActiveSessions(page);
    let firstEndCount = 0;
    let secondEndCount = 0;

    await page.route("**/api/sessions/*/end", async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === `/api/sessions/${FIRST_ID}/end`) {
        firstEndCount += 1;
      } else if (pathname === `/api/sessions/${SECOND_ID}/end`) {
        secondEndCount += 1;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: pathname.includes(SECOND_ID) ? SECOND_ID : FIRST_ID,
          user_id: "user-1",
          mode: SAME_MODE,
          status: "completed",
          started_at: SAME_STARTED_AT,
          ended_at: "2026-11-15T02:08:04Z",
          transcripts: [],
        }),
      });
    });

    await page.goto("/");

    const firstRow = page.getByTestId(`active-session-item-${FIRST_ID}`);
    const secondRow = page.getByTestId(`active-session-item-${SECOND_ID}`);
    await expect(firstRow).toBeVisible();
    await expect(secondRow).toBeVisible();
    const firstLabels = await expectSameModeAndStart(firstRow, FIRST_ID);
    const secondLabels = await expectSameModeAndStart(secondRow, SECOND_ID);
    expect(firstLabels).toEqual(secondLabels);
    await expectNoFullIdExposure(firstRow, FIRST_ID);
    await expectNoFullIdExposure(secondRow, SECOND_ID);
    await expect(firstRow.getByTestId(`resume-session-button-${FIRST_ID}`)).toHaveAccessibleName(
      "恢复练习",
    );
    await expect(firstRow.getByTestId(`end-session-button-${FIRST_ID}`)).toHaveAccessibleName(
      "结束记录",
    );

    await page.getByRole("button", { name: "设置", exact: true }).click();
    const settingsDialog = page.getByRole("dialog", { name: "设置", exact: true });
    await expect(settingsDialog).toBeVisible();
    await expect(
      settingsDialog.getByRole("heading", { level: 2, name: "设置", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("settings-literal-title.png"),
      animations: "disabled",
    });
    await settingsDialog.getByRole("button", { name: "关闭设置抽屉", exact: true }).click();
    await expect(settingsDialog).not.toBeVisible();

    await secondRow.getByTestId(`end-session-button-${SECOND_ID}`).click();
    const endPanel = page.getByTestId(`end-confirm-panel-${SECOND_ID}`);
    await expect(endPanel).toBeVisible();
    await expect(firstRow).toBeVisible();
    await expect(secondRow).toBeVisible();
    const endTarget = page.getByTestId(`confirm-session-id-${SECOND_ID}`);
    await expect(endTarget).toContainText(secondLabels.modeText);
    await expect(endTarget).toContainText(secondLabels.startedAtText);
    await expectNoFullIdExposure(endPanel, SECOND_ID);
    await expect(firstEndCount).toBe(0);
    await expect(secondEndCount).toBe(0);
    await expect(page.getByTestId(`confirm-end-button-${SECOND_ID}`)).toHaveAccessibleName(
      "确认结束",
    );
    await expect(page.getByTestId(`cancel-end-button-${SECOND_ID}`)).toHaveAccessibleName("取消");
    await page.screenshot({
      path: testInfo.outputPath("end-panel-same-labels.png"),
      animations: "disabled",
    });

    await page.getByTestId(`confirm-end-button-${SECOND_ID}`).click();
    await expect.poll(() => secondEndCount).toBe(1);
    expect(firstEndCount).toBe(0);
  });

  test("shows mode/start in the resume panel and requests detail only for the second row", async ({
    page,
  }, testInfo) => {
    await installActiveSessions(page);
    const detailCounts = new Map([
      [FIRST_ID, 0],
      [SECOND_ID, 0],
    ]);
    let tokenCount = 0;

    await page.route("**/api/call-capabilities", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ protocol_version: 1, call_lease_mode: "disabled" }),
      });
    });
    await page.route(new RegExp(`/api/sessions/(?:${FIRST_ID}|${SECOND_ID})$`), async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      const sessionId = pathname.endsWith(SECOND_ID) ? SECOND_ID : FIRST_ID;
      detailCounts.set(sessionId, (detailCounts.get(sessionId) ?? 0) + 1);
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ detail: "local fake detail unavailable" }),
      });
    });
    await page.route("**/api/sessions/*/token", async (route) => {
      tokenCount += 1;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ detail: "local fake token unavailable" }),
      });
    });

    await page.goto("/");

    const firstRow = page.getByTestId(`active-session-item-${FIRST_ID}`);
    const secondRow = page.getByTestId(`active-session-item-${SECOND_ID}`);
    await expect(firstRow).toBeVisible();
    await expect(secondRow).toBeVisible();
    const firstLabels = await expectSameModeAndStart(firstRow, FIRST_ID);
    const secondLabels = await expectSameModeAndStart(secondRow, SECOND_ID);
    expect(firstLabels).toEqual(secondLabels);
    await expectNoFullIdExposure(firstRow, FIRST_ID);
    await expectNoFullIdExposure(secondRow, SECOND_ID);

    await secondRow.getByTestId(`resume-session-button-${SECOND_ID}`).click();
    const resumePanel = page.getByTestId(`resume-confirm-panel-${SECOND_ID}`);
    await expect(resumePanel).toBeVisible();
    const resumeTarget = page.getByTestId(`confirm-resume-session-id-${SECOND_ID}`);
    await expect(resumeTarget).toContainText(secondLabels.modeText);
    await expect(resumeTarget).toContainText(secondLabels.startedAtText);
    await expectNoFullIdExposure(resumePanel, SECOND_ID);
    await expect(page.getByTestId(`confirm-resume-button-${SECOND_ID}`)).toHaveAccessibleName(
      "确认恢复",
    );
    await expect(page.getByTestId(`cancel-resume-button-${SECOND_ID}`)).toHaveAccessibleName(
      "取消",
    );
    await page.screenshot({
      path: testInfo.outputPath("resume-panel-same-labels.png"),
      animations: "disabled",
    });

    await page.getByTestId(`confirm-resume-button-${SECOND_ID}`).click();
    await expect(page.getByTestId(`resume-error-${SECOND_ID}`)).toBeVisible();
    await expect.poll(() => detailCounts.get(SECOND_ID)).toBe(1);
    expect(detailCounts.get(FIRST_ID)).toBe(0);
    expect(tokenCount).toBe(0);
  });
});
