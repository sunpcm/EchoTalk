import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UserSettingsResponse } from "@/lib/api";
import { useSettingsForm } from "./useSettingsForm";

vi.mock("@/lib/providerMetadata", () => ({
  STT_PROVIDER_OPTIONS: [{ value: "deepgram", label: "Deepgram" }],
  LLM_PROVIDER_OPTIONS: [
    { value: "siliconflow", label: "SiliconFlow" },
    { value: "openrouter", label: "OpenRouter" },
  ],
  TTS_PROVIDER_OPTIONS: [{ value: "cartesia", label: "Cartesia" }],
  DEFAULT_PROVIDER_IDS: Object.freeze({
    stt: "deepgram",
    llm: "openrouter",
    tts: "cartesia",
  }),
}));

const BASE_SETTINGS: UserSettingsResponse = {
  is_custom_mode: true,
  subscription_tier: "vip",
  theme: "warm",
  stt_provider: "deepgram",
  llm_provider: "siliconflow",
  llm_model: "backend/model",
  tts_provider: "cartesia",
  has_stt_key: false,
  has_llm_key: false,
  has_tts_key: false,
  stt_status: "unconfigured",
  llm_status: "unconfigured",
  tts_status: "unconfigured",
};

function makeSettings(overrides: Partial<UserSettingsResponse> = {}): UserSettingsResponse {
  return { ...BASE_SETTINGS, ...overrides };
}

interface SettingsProps {
  settings: UserSettingsResponse | null;
}

describe("useSettingsForm provider metadata defaults", () => {
  afterEach(() => {
    cleanup();
  });

  it("reads an alternate metadata default for both the initial draft and empty-value hydration", () => {
    const updateSettings = vi.fn(async () => ({ success: true }));
    const initialProps: SettingsProps = { settings: null };
    const { result, rerender } = renderHook(
      ({ settings }: SettingsProps) => useSettingsForm({ open: false, settings, updateSettings }),
      { initialProps },
    );

    expect(result.current.draft.llmProvider).toBe("openrouter");

    rerender({
      settings: makeSettings({
        stt_provider: null,
        llm_provider: "",
        llm_model: null,
        tts_provider: null,
      }),
    });

    expect(result.current.draft.sttProvider).toBe("deepgram");
    expect(result.current.draft.llmProvider).toBe("openrouter");
    expect(result.current.draft.llmModel).toBe("");
    expect(result.current.draft.ttsProvider).toBe("cartesia");
  });
});
