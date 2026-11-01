import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UserSettingsResponse } from "@/lib/api";
import { useSettingsForm } from "./useSettingsForm";

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

interface OpenSettingsProps extends SettingsProps {
  open: boolean;
}

describe("useSettingsForm hydration", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("uses current defaults before settings arrive and falls back from null or empty references", () => {
    const updateSettings = vi.fn(async () => ({ success: true }));
    const initialProps: SettingsProps = { settings: null };
    const { result, rerender } = renderHook(
      ({ settings }: SettingsProps) => useSettingsForm({ open: true, settings, updateSettings }),
      { initialProps },
    );

    expect(result.current.draft).toEqual({
      isCustomMode: false,
      sttProvider: "deepgram",
      llmProvider: "siliconflow",
      llmModel: "",
      ttsProvider: "cartesia",
      sttKey: "",
      llmKey: "",
      ttsKey: "",
    });

    rerender({
      settings: makeSettings({
        stt_provider: null,
        llm_provider: "",
        llm_model: null,
        tts_provider: "",
      }),
    });

    expect(result.current.draft).toMatchObject({
      sttProvider: "deepgram",
      llmProvider: "siliconflow",
      llmModel: "",
      ttsProvider: "cartesia",
    });

    act(() => {
      result.current.setSttKey("draft-stt-key");
      result.current.setLlmKey("draft-llm-key");
      result.current.setTtsKey("draft-tts-key");
    });

    rerender({
      settings: makeSettings({
        stt_provider: "",
        llm_provider: null,
        llm_model: "",
        tts_provider: null,
        is_custom_mode: false,
      }),
    });

    expect(result.current.draft).toEqual({
      isCustomMode: false,
      sttProvider: "deepgram",
      llmProvider: "siliconflow",
      llmModel: "",
      ttsProvider: "cartesia",
      sttKey: "",
      llmKey: "",
      ttsKey: "",
    });
  });

  it("preserves valid values and drafts for the same reference or open changes, then rehydrates a new object", () => {
    const updateSettings = vi.fn(async () => ({ success: true }));
    const backendSettings = makeSettings({
      stt_provider: "deepgram",
      llm_provider: "openrouter",
      llm_model: "  custom/user-model:v2  ",
      tts_provider: "cartesia",
    });
    const initialProps: OpenSettingsProps = { open: true, settings: backendSettings };
    const { result, rerender } = renderHook(
      ({ open, settings }: OpenSettingsProps) =>
        useSettingsForm({ open, settings, updateSettings }),
      { initialProps },
    );

    expect(result.current.draft).toMatchObject({
      isCustomMode: true,
      sttProvider: "deepgram",
      llmProvider: "openrouter",
      llmModel: "  custom/user-model:v2  ",
      ttsProvider: "cartesia",
    });

    act(() => {
      result.current.setSttProvider("draft-stt");
      result.current.setLlmProvider("siliconflow");
      result.current.setLlmModel("draft/model");
      result.current.setTtsProvider("draft-tts");
      result.current.setSttKey("draft-stt-key");
      result.current.setLlmKey("draft-llm-key");
      result.current.setTtsKey("draft-tts-key");
    });

    rerender({ open: false, settings: backendSettings });
    rerender({ open: true, settings: backendSettings });

    expect(result.current.draft).toEqual({
      isCustomMode: true,
      sttProvider: "draft-stt",
      llmProvider: "siliconflow",
      llmModel: "draft/model",
      ttsProvider: "draft-tts",
      sttKey: "draft-stt-key",
      llmKey: "draft-llm-key",
      ttsKey: "draft-tts-key",
    });

    rerender({
      open: true,
      settings: makeSettings({
        stt_provider: "deepgram",
        llm_provider: "openrouter",
        llm_model: "  custom/user-model:v2  ",
        tts_provider: "cartesia",
      }),
    });

    expect(result.current.draft).toEqual({
      isCustomMode: true,
      sttProvider: "deepgram",
      llmProvider: "openrouter",
      llmModel: "  custom/user-model:v2  ",
      ttsProvider: "cartesia",
      sttKey: "",
      llmKey: "",
      ttsKey: "",
    });
  });
});
