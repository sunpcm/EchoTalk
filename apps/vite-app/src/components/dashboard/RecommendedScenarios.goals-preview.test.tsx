import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RecommendedScenarios } from "./RecommendedScenarios";
import * as api from "@/lib/api";
import { useConversationStore } from "@/store/conversation";

vi.mock("@/lib/api", () => ({
  getRecommendedCurriculum: vi.fn(),
}));

function goal(goalId: string, descriptionEn: string, descriptionZh: string, criteria: string[]) {
  return {
    goal_id: goalId,
    goal_version: 1,
    description_en: descriptionEn,
    description_zh: descriptionZh,
    criteria,
    evidence_types: ["transcript"],
  };
}

const pilotRecommendations: api.CurriculumNextResponse = {
  weakest_skill: "word_stress",
  weakest_skill_mastery: 0.4,
  target_level: "B1",
  recommendations: [
    {
      scenario_name: "business_meeting_greetings",
      difficulty_cefr: "B1",
      category: "conversation",
      focus_skills: ["word_stress", "linking_sounds"],
      system_prompt_template: "",
      goal_binding: {
        material_id: "mat_biz_greet_b1",
        material_version: 1,
        goals: [
          goal(
            "mat_biz_greet_b1:introduce_name_and_role",
            "Introduce your name and your job or role.",
            "介绍自己的姓名及工作/角色。",
            ["State your name.", "State your job or role."],
          ),
          goal(
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
      system_prompt_template: "",
      goal_binding: {
        material_id: "mat_hotel_checkin_b1",
        material_version: 1,
        goals: [
          goal(
            "mat_hotel_checkin_b1:express_checkin_reservation_status",
            "Express a check-in request and state whether you have a reservation.",
            "表达入住需求并说明有无预订。",
            ["Express a check-in request.", "State whether you have a reservation."],
          ),
          goal(
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
      system_prompt_template: "",
      goal_binding: {
        material_id: "mat_restaurant_b1",
        material_version: 1,
        goals: [
          goal(
            "mat_restaurant_b1:order_one_dish_or_drink",
            "Clearly order one dish or drink.",
            "明确点一道菜或饮品。",
            ["Order one dish or drink clearly."],
          ),
          goal(
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
  ],
};

describe("RecommendedScenarios goal preview draft", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConversationStore.setState({
      connectionState: "idle",
      selectedScenario: null,
    });
  });

  it("shows the six current teaching-material goals as passive text in each recommendation", async () => {
    vi.mocked(api.getRecommendedCurriculum).mockResolvedValueOnce(pilotRecommendations);

    render(<RecommendedScenarios />);

    expect(
      await screen.findByRole("heading", { name: "Business Meeting Greetings" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(3);
    expect(screen.getAllByTestId("recommendation-goal")).toHaveLength(6);
    expect(screen.getAllByRole("listitem")).toHaveLength(6);
    expect(screen.queryByText(/已达成|未达成|无法判断|未评估|%/)).not.toBeInTheDocument();

    for (const text of [
      "介绍自己的姓名及工作/角色。",
      "向对方提出一个与其工作相关的问题。",
      "表达入住需求并说明有无预订。",
      "询问退房时间。",
      "明确点一道菜或饮品。",
      "说明一项偏好或限制，或明确表示没有特殊要求。",
    ]) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }

    for (const scenarioName of [
      "Business Meeting Greetings",
      "Hotel Checkin Roleplay",
      "Restaurant Ordering",
    ]) {
      const heading = screen.getByRole("heading", { name: scenarioName });
      const card = heading.closest("article");
      expect(card, "recommendation cards should expose an article element").not.toBeNull();
      const preview = within(card!).getByRole("region", { name: "本课目标" });
      expect(within(preview).getAllByRole("listitem")).toHaveLength(2);
      expect(within(preview).queryAllByRole("button")).toHaveLength(0);
      expect(within(card!).getAllByRole("button")).toHaveLength(1);
    }
  });

  it("renders no synthetic preview rows or controls for absent and empty bindings", async () => {
    vi.mocked(api.getRecommendedCurriculum).mockResolvedValueOnce({
      weakest_skill: null,
      weakest_skill_mastery: null,
      target_level: "B1",
      recommendations: [
        {
          scenario_name: "legacy_without_binding",
          difficulty_cefr: "A2",
          category: "conversation",
          focus_skills: ["past_tense"],
          system_prompt_template: "",
        },
        {
          scenario_name: "empty_binding",
          difficulty_cefr: "B1",
          category: "conversation",
          focus_skills: ["preposition"],
          system_prompt_template: "",
          goal_binding: {
            material_id: "mat_empty",
            material_version: 1,
            goals: [],
          },
        },
      ],
    } as unknown as api.CurriculumNextResponse);

    render(<RecommendedScenarios />);

    expect(
      await screen.findByRole("heading", { name: "Legacy Without Binding" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "本课目标" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("recommendation-goal")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });
});
