import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import App from "./App";
import * as api from "@/lib/api";
import { useSettingsStore } from "@/store/settings";
import { useConversationStore } from "@/store/conversation";

vi.mock("@/lib/api", () => ({
  getUserSettings: vi.fn().mockResolvedValue({
    is_custom_mode: false,
    theme: "warm",
    stt_provider: null,
    llm_provider: null,
    llm_model: null,
    tts_provider: null,
    has_stt_key: false,
    has_llm_key: false,
    has_tts_key: false,
    stt_status: "unconfigured",
    llm_status: "unconfigured",
    tts_status: "unconfigured",
  }),
  updateUserSettings: vi.fn(),
  getKnowledgeStates: vi.fn().mockResolvedValue([]),
  getRecommendedCurriculum: vi.fn().mockResolvedValue({
    weakest_skill: "",
    weakest_skill_mastery: 0,
    target_level: "B1",
    recommendations: [],
  }),
  listSessions: vi.fn().mockResolvedValue([]),
  listActiveSessions: vi.fn().mockResolvedValue([]),
}));

describe("App initialization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConversationStore.getState().reset();
    useSettingsStore.getState().reset();
    useSettingsStore.setState({ theme: "dark" });
    document.documentElement.removeAttribute("data-theme");
  });

  it("applies theme DOM attribute on mount without triggering backend PUT sync", () => {
    render(<App />);

    // 属性已同步到 documentElement
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

    // 启动时不应调用 updateUserSettings 触发 PUT
    expect(api.updateUserSettings).not.toHaveBeenCalled();

    // 但正常触发了 fetchSettings 进行水合
    expect(api.getUserSettings).toHaveBeenCalledTimes(1);
  });
});
