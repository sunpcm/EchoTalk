import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROVIDER_IDS,
  LLM_PROVIDER_OPTIONS,
  STT_PROVIDER_OPTIONS,
  TTS_PROVIDER_OPTIONS,
} from "./providerMetadata";

describe("providerMetadata", () => {
  it("projects the generated catalog into ordered role options and defaults", () => {
    expect(STT_PROVIDER_OPTIONS).toEqual([{ value: "deepgram", label: "Deepgram" }]);
    expect(LLM_PROVIDER_OPTIONS).toEqual([
      { value: "siliconflow", label: "SiliconFlow" },
      { value: "openrouter", label: "OpenRouter" },
    ]);
    expect(TTS_PROVIDER_OPTIONS).toEqual([{ value: "cartesia", label: "Cartesia" }]);
    expect(DEFAULT_PROVIDER_IDS).toEqual({
      llm: "siliconflow",
      stt: "deepgram",
      tts: "cartesia",
    });
  });
});
