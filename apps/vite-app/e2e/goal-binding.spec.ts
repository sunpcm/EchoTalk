import { expect, test } from "@playwright/test";

test("browser opts into goals and posts only the frozen binding reference", async ({ page }) => {
  const observedRequests: Array<{
    readonly method: string;
    readonly url: string;
    readonly body: unknown;
  }> = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/curriculum/next" || url.pathname === "/api/sessions") {
      let body: unknown = null;
      try {
        body = request.postDataJSON();
      } catch {
        body = request.postData();
      }
      observedRequests.push({
        method: request.method(),
        url: request.url(),
        body,
      });
    }
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "AI 英语口语练习" })).toBeVisible();

  const result = await page.evaluate(async () => {
    const api = await import("/src/lib/api/index.ts");
    const curriculum = (await api.getRecommendedCurriculum()) as {
      recommendations: Array<{
        goal_binding?: {
          material_id: string;
          material_version: number;
          goals: Array<Record<string, unknown>>;
        };
      }>;
    };
    const recommendation = curriculum.recommendations.find(
      (item) => item.goal_binding?.material_id === "mat_biz_greet_b1",
    );
    if (!recommendation?.goal_binding) {
      throw new Error("Fake curriculum did not return the pilot goal binding");
    }
    const binding = recommendation.goal_binding;
    const session = await api.createSession("scenario", undefined, {
      goalBinding: {
        material_id: binding.material_id,
        material_version: binding.material_version,
      },
    });
    return {
      binding: {
        material_id: binding.material_id,
        material_version: binding.material_version,
        goals: binding.goals,
      },
      sessionId: session.id,
    };
  });

  expect(result.binding).toMatchObject({
    material_id: "mat_biz_greet_b1",
    material_version: 1,
  });
  expect(result.binding.goals).toEqual([
    {
      goal_id: "mat_biz_greet_b1:introduce_name_and_role",
      goal_version: 1,
      description_en: "Introduce your name and your job or role.",
      description_zh: "介绍自己的姓名及工作/角色。",
      criteria: ["State your name.", "State your job or role."],
      evidence_types: ["transcript"],
    },
    {
      goal_id: "mat_biz_greet_b1:ask_other_work_question",
      goal_version: 1,
      description_en: "Ask the other person a question about their work.",
      description_zh: "向对方提出一个与其工作相关的问题。",
      criteria: ["Ask the other person a question about their work."],
      evidence_types: ["transcript"],
    },
  ]);
  expect(result.sessionId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  );

  const curriculumRequest = observedRequests.find((request) => {
    const url = new URL(request.url);
    return request.method === "GET" && url.pathname === "/api/curriculum/next";
  });
  expect(curriculumRequest).toBeDefined();
  const curriculumUrl = new URL(curriculumRequest!.url);
  expect(curriculumUrl.searchParams.get("include_goals")).toBe("true");

  const createRequest = observedRequests.find((request) => {
    const url = new URL(request.url);
    return request.method === "POST" && url.pathname === "/api/sessions";
  });
  expect(createRequest).toBeDefined();
  expect(createRequest!.body).toEqual({
    mode: "scenario",
    goal_binding: {
      material_id: "mat_biz_greet_b1",
      material_version: 1,
    },
  });
});
