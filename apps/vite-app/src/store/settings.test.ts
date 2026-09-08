import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
    vi.useFakeTimers();
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

  afterEach(() => {
    vi.useRealTimers();
  });

  it("setTheme updates store, localStorage, document attribute and calls updateUserSettings after debounce", async () => {
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

    expect(apiModule.updateUserSettings).not.toHaveBeenCalled();

    vi.advanceTimersByTime(300);

    expect(apiModule.updateUserSettings).toHaveBeenCalledWith({ theme: "dark" });
  });

  it("rapid setTheme calls debounce into a single updateUserSettings call with the latest theme", async () => {
    vi.mocked(apiModule.updateUserSettings).mockResolvedValue({
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

    useSettingsStore.getState().setTheme("dark");
    useSettingsStore.getState().setTheme("cool");

    vi.advanceTimersByTime(300);

    expect(apiModule.updateUserSettings).toHaveBeenCalledTimes(1);
    expect(apiModule.updateUserSettings).toHaveBeenCalledWith({ theme: "cool" });
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
