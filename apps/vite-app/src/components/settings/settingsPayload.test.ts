import { describe, expect, it } from "vitest";
import { buildSettingsUpdate, type SettingsPayloadInput } from "./settingsPayload";

describe("buildSettingsUpdate", () => {
  const baseInput: SettingsPayloadInput = {
    isCustomMode: false,
    sttProvider: "deepgram",
    llmProvider: "siliconflow",
    llmModel: "",
    ttsProvider: "cartesia",
    sttKey: "",
    llmKey: "",
    ttsKey: "",
  };

  it("returns only is_custom_mode: false when custom mode is disabled", () => {
    const input: SettingsPayloadInput = {
      ...baseInput,
      isCustomMode: false,
      sttProvider: "deepgram",
      llmProvider: "siliconflow",
      llmModel: "some-model",
      ttsProvider: "cartesia",
      sttKey: "stt-secret",
      llmKey: "llm-secret",
      ttsKey: "tts-secret",
    };

    const payload = buildSettingsUpdate(input);

    expect(payload).toEqual({
      is_custom_mode: false,
    });
    expect(payload).not.toHaveProperty("stt_provider");
    expect(payload).not.toHaveProperty("llm_provider");
    expect(payload).not.toHaveProperty("tts_provider");
    expect(payload).not.toHaveProperty("llm_model");
    expect(payload).not.toHaveProperty("stt_key");
    expect(payload).not.toHaveProperty("llm_key");
    expect(payload).not.toHaveProperty("tts_key");
  });

  it("includes provider fields when custom mode is enabled with empty keys and empty model", () => {
    const input: SettingsPayloadInput = {
      ...baseInput,
      isCustomMode: true,
      sttProvider: "deepgram",
      llmProvider: "openrouter",
      ttsProvider: "cartesia",
      llmModel: "",
      sttKey: "",
      llmKey: "",
      ttsKey: "",
    };

    const payload = buildSettingsUpdate(input);

    expect(payload).toEqual({
      is_custom_mode: true,
      stt_provider: "deepgram",
      llm_provider: "openrouter",
      tts_provider: "cartesia",
    });
    expect(payload).not.toHaveProperty("llm_model");
    expect(payload).not.toHaveProperty("stt_key");
    expect(payload).not.toHaveProperty("llm_key");
    expect(payload).not.toHaveProperty("tts_key");
  });

  it("trims and includes llm_model when non-empty, but omits when whitespace-only", () => {
    // 1) 有值 model
    const inputWithValue: SettingsPayloadInput = {
      ...baseInput,
      isCustomMode: true,
      llmModel: "  meta-llama/Llama-3-70b-chat  ",
    };
    const payloadWithValue = buildSettingsUpdate(inputWithValue);
    expect(payloadWithValue.llm_model).toBe("meta-llama/Llama-3-70b-chat");

    // 2) 全空白 model
    const inputWithWhitespace: SettingsPayloadInput = {
      ...baseInput,
      isCustomMode: true,
      llmModel: "   \t\n  ",
    };
    const payloadWithWhitespace = buildSettingsUpdate(inputWithWhitespace);
    expect(payloadWithWhitespace).not.toHaveProperty("llm_model");
  });

  it("handles three role keys individually with trim and omissions", () => {
    // STT key only
    const sttOnly = buildSettingsUpdate({
      ...baseInput,
      isCustomMode: true,
      sttKey: "  sk-stt-key  ",
      llmKey: "   ",
      ttsKey: "",
    });
    expect(sttOnly.stt_key).toBe("sk-stt-key");
    expect(sttOnly).not.toHaveProperty("llm_key");
    expect(sttOnly).not.toHaveProperty("tts_key");

    // LLM key only
    const llmOnly = buildSettingsUpdate({
      ...baseInput,
      isCustomMode: true,
      sttKey: "",
      llmKey: "  sk-llm-key  ",
      ttsKey: "   ",
    });
    expect(llmOnly.llm_key).toBe("sk-llm-key");
    expect(llmOnly).not.toHaveProperty("stt_key");
    expect(llmOnly).not.toHaveProperty("tts_key");

    // TTS key only
    const ttsOnly = buildSettingsUpdate({
      ...baseInput,
      isCustomMode: true,
      sttKey: "  ",
      llmKey: "",
      ttsKey: "  sk-tts-key  ",
    });
    expect(ttsOnly.tts_key).toBe("sk-tts-key");
    expect(ttsOnly).not.toHaveProperty("stt_key");
    expect(ttsOnly).not.toHaveProperty("llm_key");
  });

  it("handles mixed keys and trims all non-empty keys", () => {
    const mixed = buildSettingsUpdate({
      ...baseInput,
      isCustomMode: true,
      sttKey: "  deepgram-token-123  ",
      llmKey: "  sk-siliconflow-456  ",
      ttsKey: "  cartesia-key-789  ",
      llmModel: "  Qwen/Qwen2.5-7B-Instruct  ",
    });

    expect(mixed).toEqual({
      is_custom_mode: true,
      stt_provider: "deepgram",
      llm_provider: "siliconflow",
      tts_provider: "cartesia",
      llm_model: "Qwen/Qwen2.5-7B-Instruct",
      stt_key: "deepgram-token-123",
      llm_key: "sk-siliconflow-456",
      tts_key: "cartesia-key-789",
    });
  });

  it("does not mutate frozen input object", () => {
    const frozenInput = Object.freeze({
      isCustomMode: true,
      sttProvider: "deepgram",
      llmProvider: "siliconflow",
      llmModel: "  model-a  ",
      ttsProvider: "cartesia",
      sttKey: "  k-stt  ",
      llmKey: "  k-llm  ",
      ttsKey: "  k-tts  ",
    });

    expect(() => buildSettingsUpdate(frozenInput)).not.toThrow();
    const result = buildSettingsUpdate(frozenInput);
    expect(result.stt_key).toBe("k-stt");
    expect(frozenInput.sttKey).toBe("  k-stt  ");
  });

  it("returns distinct independent objects across multiple calls", () => {
    const input: SettingsPayloadInput = {
      ...baseInput,
      isCustomMode: true,
      sttKey: "key-1",
    };

    const res1 = buildSettingsUpdate(input);
    const res2 = buildSettingsUpdate(input);

    expect(res1).toEqual(res2);
    expect(res1).not.toBe(res2);

    res1.is_custom_mode = false;
    expect(res2.is_custom_mode).toBe(true);
  });

  it("does not include extra unrequested fields like theme, has_key, or status", () => {
    const result = buildSettingsUpdate({
      ...baseInput,
      isCustomMode: true,
      sttKey: "k1",
      llmKey: "k2",
      ttsKey: "k3",
    });

    const allowedKeys = new Set([
      "is_custom_mode",
      "stt_provider",
      "llm_provider",
      "tts_provider",
      "llm_model",
      "stt_key",
      "llm_key",
      "tts_key",
    ]);

    for (const key of Object.keys(result)) {
      expect(allowedKeys.has(key)).toBe(true);
    }
    expect(result).not.toHaveProperty("theme");
    expect(result).not.toHaveProperty("has_stt_key");
    expect(result).not.toHaveProperty("has_llm_key");
    expect(result).not.toHaveProperty("has_tts_key");
    expect(result).not.toHaveProperty("stt_status");
    expect(result).not.toHaveProperty("llm_status");
    expect(result).not.toHaveProperty("tts_status");
  });
});
