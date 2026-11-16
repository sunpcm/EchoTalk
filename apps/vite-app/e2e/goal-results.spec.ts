import { expect, test, type Page } from "@playwright/test";

test.use({ timezoneId: "Asia/Singapore" });

const viewports = [
  { name: "wide-1280x800", width: 1280, height: 800 },
  { name: "narrow-390x844", width: 390, height: 844 },
] as const;

type GoalStatus = "achieved" | "not_achieved" | "unknown" | "not_assessed";

function fixtureSessionId(seed: number) {
  return `78100000-0000-4000-8000-${String(seed).padStart(12, "0")}`;
}

function goalDefinition(
  goalId: string,
  descriptionEn: string,
  descriptionZh: string,
  criteria: string[],
) {
  return {
    goal_id: goalId,
    goal_version: 1,
    description_en: descriptionEn,
    description_zh: descriptionZh,
    criteria,
    evidence_types: ["transcript"],
  };
}

function goal(
  goalId: string,
  descriptionEn: string,
  descriptionZh: string,
  criteria: string[],
  result: GoalStatus | null,
) {
  return {
    ...goalDefinition(goalId, descriptionEn, descriptionZh, criteria),
    result,
  };
}

function businessGoals(result: GoalStatus | null) {
  return [
    goal(
      "mat_biz_greet_b1:introduce_name_and_role",
      "Introduce your name and your job or role.",
      "介绍自己的姓名及工作/角色。",
      ["State your name.", "State your job or role."],
      result,
    ),
    goal(
      "mat_biz_greet_b1:ask_other_work_question",
      "Ask the other person a question about their work.",
      "向对方提出一个与其工作相关的问题。",
      ["Ask the other person a question about their work."],
      result,
    ),
  ];
}

function pilotGoalBindings() {
  return [
    {
      scenario_name: "business_meeting_greetings",
      difficulty_cefr: "B1",
      category: "conversation",
      focus_skills: ["word_stress", "linking_sounds"],
      system_prompt_template: "Practice introducing yourself and professional small talk.",
      goal_binding: {
        material_id: "mat_biz_greet_b1",
        material_version: 1,
        goals: [
          goalDefinition(
            "mat_biz_greet_b1:introduce_name_and_role",
            "Introduce your name and your job or role.",
            "介绍自己的姓名及工作/角色。",
            ["State your name.", "State your job or role."],
          ),
          goalDefinition(
            "mat_biz_greet_b1:ask_other_work_question",
            "Ask the other person a question about their work.",
            "向对方提出一个与其工作相关的问题。",
            ["Ask the other person a question about their work."],
          ),
        ],
      },
    },
    {
      scenario_name: "hotel_checkin_roleplay",
      difficulty_cefr: "B1",
      category: "conversation",
      focus_skills: ["preposition", "linking_sounds"],
      system_prompt_template: "Practice a polite hotel check-in conversation.",
      goal_binding: {
        material_id: "mat_hotel_checkin_b1",
        material_version: 1,
        goals: [
          goalDefinition(
            "mat_hotel_checkin_b1:express_checkin_reservation_status",
            "Express a check-in request and state whether you have a reservation.",
            "表达入住需求并说明有无预订。",
            ["Express a check-in request.", "State whether you have a reservation."],
          ),
          goalDefinition(
            "mat_hotel_checkin_b1:ask_checkout_time",
            "Ask for the checkout time.",
            "询问退房时间。",
            ["Ask for the checkout time."],
          ),
        ],
      },
    },
    {
      scenario_name: "restaurant_ordering",
      difficulty_cefr: "B1",
      category: "conversation",
      focus_skills: ["vowel_sounds", "article_usage"],
      system_prompt_template: "Practice ordering food and stating preferences.",
      goal_binding: {
        material_id: "mat_restaurant_b1",
        material_version: 1,
        goals: [
          goalDefinition(
            "mat_restaurant_b1:order_one_dish_or_drink",
            "Clearly order one dish or drink.",
            "明确点一道菜或饮品。",
            ["Order one dish or drink clearly."],
          ),
          goalDefinition(
            "mat_restaurant_b1:state_preference_or_no_requirements",
            "State one preference or restriction, or clearly say that you have no special requirements.",
            "说明一项偏好或限制，或明确表示没有特殊要求。",
            [
              "State a preference or restriction, or explicitly say that there are no special requirements.",
            ],
          ),
        ],
      },
    },
  ];
}

async function routePilotRecommendations(page: Page) {
  await page.route("**/api/curriculum/next?*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Cache-Control": "no-store" },
      body: JSON.stringify({
        weakest_skill: "grammar_past_tense",
        weakest_skill_mastery: 0.4,
        target_level: "B1",
        recommendations: pilotGoalBindings(),
      }),
    }),
  );
}

function terminalGoals(sessionId: string) {
  return {
    session_id: sessionId,
    configured: true,
    material_id: "mat_biz_greet_b1",
    material_version: 1,
    goals: [
      goal(
        "mat_biz_greet_b1:introduce_name_and_role",
        "Introduce your name and your job or role.",
        "介绍自己的姓名及工作/角色。",
        ["State your name.", "State your job or role."],
        "achieved",
      ),
      goal(
        "mat_biz_greet_b1:ask_other_work_question",
        "Ask the other person a question about their work.",
        "向对方提出一个与其工作相关的问题。",
        ["Ask the other person a question about their work."],
        "unknown",
      ),
    ],
    execution: {
      status: "succeeded",
      revision: 1,
      evaluator_version: "rules-v1",
    },
    summary: {
      total: 2,
      achieved: 1,
      not_achieved: 0,
      assessed: 1,
      unknown: 1,
      not_assessed: 0,
    },
  };
}

function progressGoals(sessionId: string, status: "pending" | "running") {
  return {
    session_id: sessionId,
    configured: true,
    material_id: "mat_biz_greet_b1",
    material_version: 1,
    goals: businessGoals(null),
    execution: {
      status,
      revision: 1,
      evaluator_version: "rules-v1",
    },
    summary: null,
  };
}

function unconfiguredGoals(sessionId: string) {
  return {
    session_id: sessionId,
    configured: false,
    material_id: null,
    material_version: null,
    goals: [],
    execution: null,
    summary: null,
  };
}

async function showEndedSession(
  page: Page,
  sessionId: string,
  agentError: { code: string; message: string } | null = null,
) {
  await page.evaluate(
    async ({ id, error }) => {
      const { useAppStore } = await import("/src/store/appStore.ts");
      useAppStore.setState({
        appView: "session",
        connectionState: "ended",
        sessionId: id,
        token: null,
        wsUrl: null,
        error: null,
        agentError: error,
      });
    },
    { id: sessionId, error: agentError },
  );
}

async function routeGoals(
  page: Page,
  sessionId: string,
  responses:
    | Array<{ status: number; body: unknown }>
    | ((call: number) => { status: number; body: unknown }),
) {
  let call = 0;
  await page.route(`**/api/sessions/${sessionId}/goals`, async (route) => {
    call += 1;
    const response = Array.isArray(responses)
      ? responses[Math.min(call - 1, responses.length - 1)]
      : responses(call);
    await route.fulfill({
      status: response.status,
      contentType: "application/json",
      headers: { "Cache-Control": "no-store" },
      body: JSON.stringify(response.body),
    });
  });
  return () => call;
}

async function routeAnalysisFailure(page: Page, sessionId: string) {
  await page.route(`**/api/sessions/${sessionId}/analysis-status`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Cache-Control": "no-store" },
      body: JSON.stringify({
        session_id: sessionId,
        status: "failed",
        attempt_count: 3,
        error_code: "analysis_failed",
        retryable: true,
        started_at: "2026-11-16T00:00:00Z",
        finished_at: "2026-11-16T00:00:01Z",
        updated_at: "2026-11-16T00:00:01Z",
      }),
    }),
  );
}

async function assertNoHorizontalOverflow(page: Page) {
  const geometry = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
}

test.describe("G-VIEW recommendation goal preview in real Chromium/WebKit", () => {
  for (const viewport of viewports) {
    test(`shows six passive pilot goals and adds no keyboard stop (${viewport.name})`, async ({
      page,
      browserName,
    }, testInfo) => {
      await routePilotRecommendations(page);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "AI 英语口语练习" })).toBeVisible();
      await expect(page.getByTestId("recommendation-goal")).toHaveCount(6);
      await expect(page.getByRole("button", { name: /^进入练习：/ })).toHaveCount(3);

      const businessHeading = page.getByRole("heading", { name: "Business Meeting Greetings" });
      const businessCard = businessHeading.locator("xpath=ancestor::article[1]");
      await expect(businessCard).toHaveCount(1);
      const businessPreview = businessCard.getByRole("region", { name: "本课目标" });
      await expect(businessPreview.getByRole("listitem")).toHaveCount(2);
      await expect(businessPreview.getByRole("button")).toHaveCount(0);
      await expect(businessCard.getByRole("button")).toHaveCount(1);

      await businessCard.getByRole("button").focus();
      await page.keyboard.press(browserName === "webkit" ? "Alt+Tab" : "Tab");
      await expect(
        page
          .getByRole("heading", { name: "Hotel Checkin Roleplay" })
          .locator("xpath=ancestor::article[1]")
          .getByRole("button"),
      ).toBeFocused();

      await assertNoHorizontalOverflow(page);
      await businessCard.screenshot({
        path: testInfo.outputPath(`recommendation-preview-${viewport.name}.png`),
      });
      await page.screenshot({
        path: testInfo.outputPath(`dashboard-${viewport.name}.png`),
        fullPage: true,
      });
    });
  }
});

test("practice button still posts only the frozen material binding", async ({ page }) => {
  await routePilotRecommendations(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "AI 英语口语练习" })).toBeVisible();

  const businessCard = page
    .getByRole("heading", { name: "Business Meeting Greetings" })
    .locator("xpath=ancestor::article[1]");
  const practiceButton = businessCard.getByRole("button", { name: /^进入练习：/ });
  await expect(practiceButton).toBeEnabled();

  const createSessionRequest = page.waitForRequest(
    (request) => request.method() === "POST" && new URL(request.url()).pathname === "/api/sessions",
  );
  await practiceButton.click();
  const request = await createSessionRequest;

  expect(request.postDataJSON()).toEqual({
    mode: "scenario",
    goal_binding: {
      material_id: "mat_biz_greet_b1",
      material_version: 1,
    },
  });
});

test.describe("G-VIEW terminal goals in real Chromium/WebKit", () => {
  for (const viewport of viewports) {
    test(`shows X/Y/Z, unknown separately, no percent (${viewport.name})`, async ({
      page,
    }, testInfo) => {
      const sessionId = fixtureSessionId(viewport.width);
      await routeGoals(page, sessionId, [{ status: 200, body: terminalGoals(sessionId) }]);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "AI 英语口语练习" })).toBeVisible();
      await showEndedSession(page, sessionId);

      const goalResults = page.getByTestId("goal-results");
      await expect(goalResults).toBeVisible();
      await expect(goalResults.getByTestId("goal-summary")).toContainText(
        "已达成 1 / 已明确判定 1 / 目标总数 2",
      );
      await expect(goalResults.getByTestId("goal-summary")).toContainText("无法判断 1");
      await expect(goalResults.getByTestId("goal-summary")).toContainText("未评估 0");
      await expect(goalResults.getByTestId("goal-result")).toHaveCount(2);
      await expect(goalResults).not.toContainText("%");
      await expect(goalResults.getByRole("button", { name: /重新判定|重新评估/ })).toHaveCount(0);

      await assertNoHorizontalOverflow(page);
      await goalResults.screenshot({
        path: testInfo.outputPath(`goal-results-${viewport.name}.png`),
      });
      await page.screenshot({
        path: testInfo.outputPath(`ended-session-${viewport.name}.png`),
        fullPage: true,
      });
    });
  }
});

test("pending -> running -> terminal stops polling after the terminal response", async ({
  page,
}) => {
  const sessionId = fixtureSessionId(3901);
  const getCalls = await routeGoals(page, sessionId, [
    { status: 200, body: progressGoals(sessionId, "pending") },
    { status: 200, body: progressGoals(sessionId, "running") },
    { status: 200, body: terminalGoals(sessionId) },
  ]);

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "AI 英语口语练习" })).toBeVisible();
  await showEndedSession(page, sessionId);
  await expect(page.getByText("目标评估中")).toBeVisible();
  await expect(page.getByTestId("goal-summary")).toBeVisible({ timeout: 6_000 });
  expect(getCalls()).toBe(3);

  await page.waitForTimeout(6_500);
  expect(getCalls()).toBe(3);
});

test("legacy analysis failure does not hide a successful goal result", async ({ page }) => {
  const sessionId = fixtureSessionId(3902);
  await routeAnalysisFailure(page, sessionId);
  await routeGoals(page, sessionId, [{ status: 200, body: terminalGoals(sessionId) }]);

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "AI 英语口语练习" })).toBeVisible();
  await showEndedSession(page, sessionId);

  await expect(page.getByText("分析失败，请重试或返回主页")).toBeVisible();
  await expect(page.getByTestId("goal-results")).toBeVisible();
  await expect(page.getByTestId("goal-summary")).toContainText(
    "已达成 1 / 已明确判定 1 / 目标总数 2",
  );
});

test("agent error does not hide a successful goal result", async ({ page }) => {
  const sessionId = fixtureSessionId(3905);
  await routeGoals(page, sessionId, [{ status: 200, body: terminalGoals(sessionId) }]);

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "AI 英语口语练习" })).toBeVisible();
  await showEndedSession(page, sessionId, {
    code: "agent_track_failed",
    message: "Agent 通道异常",
  });

  await expect(page.getByText("Agent 通道异常")).toBeVisible();
  await expect(page.getByText("agent_track_failed")).toBeVisible();
  await expect(page.getByTestId("goal-results")).toBeVisible();
  await expect(page.getByTestId("goal-summary")).toContainText(
    "已达成 1 / 已明确判定 1 / 目标总数 2",
  );
});

test("configured=false and GET 404 are rendered as different unavailable states", async ({
  page,
}) => {
  const unconfiguredSessionId = fixtureSessionId(3903);
  await routeGoals(page, unconfiguredSessionId, [
    { status: 200, body: unconfiguredGoals(unconfiguredSessionId) },
  ]);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "AI 英语口语练习" })).toBeVisible();
  await showEndedSession(page, unconfiguredSessionId);

  const goalResults = page.getByTestId("goal-results");
  await expect(goalResults.getByText("本会话未配置课程目标")).toBeVisible();
  await expect(goalResults.getByText("目标结果暂不可用")).toHaveCount(0);
  await expect(goalResults).not.toContainText("0 / 0");
  await expect(goalResults).not.toContainText(/0%|100%/);

  const notFoundSessionId = fixtureSessionId(3904);
  await routeGoals(page, notFoundSessionId, [{ status: 404, body: { detail: "Not found" } }]);
  await showEndedSession(page, notFoundSessionId);
  await expect(goalResults.getByText("目标结果暂不可用")).toBeVisible();
  await expect(goalResults.getByText("本会话未配置课程目标")).toHaveCount(0);
});
