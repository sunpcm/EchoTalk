import { describe, it, expect, vi, beforeEach } from "vitest";
import { useSettingsStore, THEME_STORAGE_KEY } from "./settings";
import * as apiModule from "@/lib/api";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    getUserSettings: vi.fn(),
    updateUserSettings: vi.fn(),
  };
});

describe("useSettingsStore", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      settings: null,
      loading: false,
      saving: false,
      error: null,
      theme: "warm",
    });
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    vi.clearAllMocks();
  });

  it("setTheme updates store, localStorage, document attribute and calls updateUserSettings", async () => {
    vi.mocked(apiModule.updateUserSettings).mockResolvedValue({
      is_custom_mode: true,
      theme: "dark",
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
    });

    useSettingsStore.getState().setTheme("dark");

    expect(useSettingsStore.getState().theme).toBe("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(apiModule.updateUserSettings).toHaveBeenCalledWith({ theme: "dark" });
  });

  it("fetchSettings updates theme in store, localStorage, and document attribute when returned from backend", async () => {
    vi.mocked(apiModule.getUserSettings).mockResolvedValue({
      is_custom_mode: true,
      theme: "cool",
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
    });

    await useSettingsStore.getState().fetchSettings();

    expect(useSettingsStore.getState().theme).toBe("cool");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("cool");
    expect(document.documentElement.getAttribute("data-theme")).toBe("cool");
  });
});
