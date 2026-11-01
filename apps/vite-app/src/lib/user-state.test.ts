import { describe, expect, it, beforeEach } from "vitest";
import { clearUserSessionData } from "./user-state";
import { useConversationStore } from "@/store/conversation";
import { useSettingsStore } from "@/store/settings";
import { useAssessmentStore } from "@/store/assessment";

describe("clearUserSessionData", () => {
  beforeEach(() => {
    useConversationStore.getState().reset();
    useSettingsStore.getState().reset();
    useAssessmentStore.getState().reset();
  });

  it("synchronously resets conversation, settings, and assessment stores idempotently", () => {
    // 设置一些临时用户数据
    useConversationStore.setState({
      sessionId: "session-123",
      token: "livekit-token-abc",
      wsUrl: "wss://lk.test",
      appView: "session",
      connectionState: "active",
    });
    useSettingsStore.setState({
      settings: {
        is_custom_mode: true,
        theme: "dark",
        stt_provider: "deepgram",
        llm_provider: "openrouter",
        llm_model: "test-model",
        tts_provider: "cartesia",
        has_stt_key: true,
        has_llm_key: true,
        has_tts_key: true,
        stt_status: "verified",
        llm_status: "verified",
        tts_status: "verified",
      },
    });
    useAssessmentStore.setState({
      loadState: "loaded",
      assessment: {
        id: "assess-1",
        session_id: "session-123",
        overall_score: 85,
        phoneme_alignment: [],
        source: "test",
        provider: null,
        model_version: null,
        is_synthetic: false,
        confidence: null,
        provider_response_ref: null,
        created_at: "2026-01-01",
      },
    });

    const convGenBefore = useConversationStore.getState().sessionGen;

    clearUserSessionData();

    // 验证 conversation 状态被清除，且回到 dashboard 且 token 为空
    const conv = useConversationStore.getState();
    expect(conv.sessionId).toBeNull();
    expect(conv.token).toBeNull();
    expect(conv.appView).toBe("dashboard");
    expect(conv.connectionState).toBe("idle");
    expect(conv.sessionGen).toBeGreaterThan(convGenBefore);

    // 验证 settings 状态被重置
    const settings = useSettingsStore.getState();
    expect(settings.settings).toBeNull();
    expect(settings.loading).toBe(false);
    expect(settings.saving).toBe(false);

    // 验证 assessment 状态被重置
    const assessment = useAssessmentStore.getState();
    expect(assessment.assessment).toBeNull();
    expect(assessment.loadState).toBe("idle");

    // 重复调用幂等，不报错
    expect(() => clearUserSessionData()).not.toThrow();
  });
});
