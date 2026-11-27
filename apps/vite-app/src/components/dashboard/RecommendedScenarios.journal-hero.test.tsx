import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RecommendedScenarios } from "./RecommendedScenarios";
import * as api from "@/lib/api";
import { useConversationStore } from "@/store/conversation";

vi.mock("@/lib/api", () => ({
  getRecommendedCurriculum: vi.fn(),
}));

function goal(descriptionEn: string, descriptionZh: string) {
  return {
    goal_id: `goal-${descriptionEn}`,
    goal_version: 1,
    description_en: descriptionEn,
    description_zh: descriptionZh,
    criteria: ["criterion"],
    evidence_types: ["transcript"],
  };
}

function recommendation(
  name: string,
  difficulty = "B1",
  goals = [goal("Speak clearly.", "清晰表达。")],
) {
  return {
    scenario_name: name,
    difficulty_cefr: difficulty,
    category: "conversation",
    focus_skills: ["vowel_sounds"],
    system_prompt_template: "",
    goal_binding: {
      material_id: `mat-${name}`,
      material_version: 1,
      goals,
    },
  };
}

describe("RecommendedScenarios journal hero", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConversationStore.setState({ connectionState: "idle", selectedScenario: null });
  });

  it("promotes the first recommendation to an image hero and keeps the rest as cards", async () => {
    vi.mocked(api.getRecommendedCurriculum).mockResolvedValueOnce({
      weakest_skill: "vowel_sounds",
      weakest_skill_mastery: 0.4,
      target_level: "B1",
      recommendations: [
        recommendation("restaurant_ordering"),
        recommendation("hotel_checkin_roleplay"),
        recommendation("business_meeting_greetings"),
      ],
    });

    render(<RecommendedScenarios />);

    const heroHeading = await screen.findByRole("heading", {
      name: "餐厅点餐 Restaurant Ordering",
    });
    const hero = heroHeading.closest("article");
    expect(hero).not.toBeNull();
    expect(heroHeading).toHaveTextContent("餐厅点餐");
    expect(within(hero!).getByText("Restaurant Ordering")).toHaveAttribute("lang", "en");
    expect(
      within(hero!).getByRole("button", { name: "进入练习：Restaurant Ordering" }),
    ).toBeInTheDocument();
    expect(within(hero!).getByRole("region", { name: "本课目标" })).toBeInTheDocument();
    expect(within(hero!).getByText("清晰表达。")).toBeInTheDocument();
    expect(within(hero!).getByText("Speak clearly.")).toHaveAttribute("lang", "en");

    const heroImage = hero!.querySelector("img");
    expect(heroImage).not.toBeNull();
    expect(heroImage!.getAttribute("src")).toContain("bistro");
    expect(heroImage!.getAttribute("alt")).toBe("");

    expect(
      screen.getByRole("heading", { name: "酒店入住 Hotel Checkin Roleplay" }),
    ).toHaveTextContent("酒店入住");
    expect(
      screen.getByRole("heading", { name: "职场问候 Business Meeting Greetings" }),
    ).toHaveTextContent("职场问候");
    expect(screen.getAllByRole("button", { name: /^进入练习：/ })).toHaveLength(3);
  });

  it("uses the generic journal photo for a non-restaurant first recommendation", async () => {
    vi.mocked(api.getRecommendedCurriculum).mockResolvedValueOnce({
      weakest_skill: "preposition",
      weakest_skill_mastery: 0.4,
      target_level: "B1",
      recommendations: [
        recommendation("hotel_checkin_roleplay"),
        recommendation("restaurant_ordering"),
      ],
    });

    render(<RecommendedScenarios />);

    const heroHeading = await screen.findByRole("heading", {
      name: "酒店入住 Hotel Checkin Roleplay",
    });
    const hero = heroHeading.closest("article");
    expect(hero).not.toBeNull();

    const heroImage = hero!.querySelector("img");
    expect(heroImage).not.toBeNull();
    expect(heroImage!.getAttribute("src")).toContain("practice-notebook");
  });

  it("only uses own scenario title entries and renders unknown titles once", async () => {
    vi.mocked(api.getRecommendedCurriculum).mockResolvedValueOnce({
      weakest_skill: "future_skill",
      weakest_skill_mastery: 0.25,
      target_level: "B1",
      recommendations: [recommendation("__proto__"), recommendation("constructor")],
    });

    render(<RecommendedScenarios />);

    expect(await screen.findByRole("heading", { name: "Proto" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Constructor" })).toBeInTheDocument();
    expect(screen.getAllByText("Proto")).toHaveLength(1);
    expect(screen.getAllByText("Constructor")).toHaveLength(1);
  });
});
