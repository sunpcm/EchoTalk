import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  useSettingsStore,
  readStoredTheme,
  applyThemeAttr,
} from "./settings";
import * as api from "@/lib/api";

vi.mock("@/lib/api", () => ({
  getUserSettings: vi.fn(),
  updateUserSettings: vi.fn(),
}));

describe("settings store & theme helpers", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    useSettingsStore.getState().reset();
    useSettingsStore.setState({ theme: "warm" });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("readStoredTheme", () => {
    it("returns 'warm' as default fallback when localStorage is empty", () => {
      expect(readStoredTheme()).toBe("warm");
    });

    it("returns 'cool' when stored theme is cool", () => {
      localStorage.setItem("echotalk-theme", "cool");
      expect(readStoredTheme()).toBe("cool");
    });

    it("returns 'dark' when stored theme is dark", () => {
      localStorage.setItem("echotalk-theme", "dark");
      expect(readStoredTheme()).toBe("dark");
    });

    it("returns 'warm' fallback when stored theme is invalid", () => {
      localStorage.setItem("echotalk-theme", "invalid-theme");
      expect(readStoredTheme()).toBe("warm");
    });
  });

  describe("applyThemeAttr", () => {
    it("sets data-theme attribute on documentElement", () => {
      applyThemeAttr("dark");
      expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

      applyThemeAttr("cool");
      expect(document.documentElement.getAttribute("data-theme")).toBe("cool");
    });
  });

  describe("useSettingsStore", () => {
    it("has correct initial state values", () => {
      const state = useSettingsStore.getState();
      expect(state.settings).toBeNull();
      expect(state.loading).toBe(false);
      expect(state.saving).toBe(false);
      expect(state.error).toBeNull();
      expect(state.theme).toBe("warm");
    });

    describe("setTheme", () => {
      it("updates store state, document data-theme, and localStorage", () => {
        useSettingsStore.getState().setTheme("dark");

        expect(useSettingsStore.getState().theme).toBe("dark");
        expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
        expect(localStorage.getItem("echotalk-theme")).toBe("dark");
      });
    });

    describe("fetchSettings", () => {
      it("successfully fetches settings and updates store", async () => {
        const mockSettings: api.UserSettingsResponse = {
          is_custom_mode: false,
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
        };

        vi.mocked(api.getUserSettings).mockResolvedValue(mockSettings);

        await useSettingsStore.getState().fetchSettings();

        expect(api.getUserSettings).toHaveBeenCalledTimes(1);
        const state = useSettingsStore.getState();
        expect(state.settings).toEqual(mockSettings);
        expect(state.loading).toBe(false);
        expect(state.error).toBeNull();
      });

      it("does not trigger fetch if loading is already true", async () => {
        useSettingsStore.setState({ loading: true });

        await useSettingsStore.getState().fetchSettings();

        expect(api.getUserSettings).not.toHaveBeenCalled();
      });

      it("handles fetchSettings error with Error instance", async () => {
        vi.mocked(api.getUserSettings).mockRejectedValue(new Error("Network error"));

        await useSettingsStore.getState().fetchSettings();

        const state = useSettingsStore.getState();
        expect(state.loading).toBe(false);
        expect(state.error).toBe("Network error");
      });

      it("handles fetchSettings error with fallback message for non-Error", async () => {
        vi.mocked(api.getUserSettings).mockRejectedValue("Unknown error");

        await useSettingsStore.getState().fetchSettings();

        const state = useSettingsStore.getState();
        expect(state.loading).toBe(false);
        expect(state.error).toBe("加载设置失败");
      });
    });

    describe("updateSettings", () => {
      it("successfully updates settings", async () => {
        const updateData: api.UserSettingsUpdate = {
          is_custom_mode: false,
        };
        const mockResponse: api.UserSettingsResponse = {
          is_custom_mode: false,
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
        };

        vi.mocked(api.updateUserSettings).mockResolvedValue(mockResponse);

        const result = await useSettingsStore.getState().updateSettings(updateData);

        expect(api.updateUserSettings).toHaveBeenCalledWith(updateData);
        expect(result).toEqual({ success: true });

        const state = useSettingsStore.getState();
        expect(state.settings).toEqual(mockResponse);
        expect(state.saving).toBe(false);
        expect(state.error).toBeNull();
      });

      it("handles custom mode unverified key failure", async () => {
        const updateData: api.UserSettingsUpdate = {
          is_custom_mode: true,
          stt_key: "invalid-key",
        };
        const mockResponse: api.UserSettingsResponse = {
          is_custom_mode: true,
          is_custom_verified: false,
          stt_provider: "deepgram",
          llm_provider: null,
          llm_model: null,
          tts_provider: null,
          has_stt_key: true,
          has_llm_key: false,
          has_tts_key: false,
          stt_status: "error",
          llm_status: "unconfigured",
          tts_status: "unconfigured",
        };

        vi.mocked(api.updateUserSettings).mockResolvedValue(mockResponse);

        const result = await useSettingsStore.getState().updateSettings(updateData);

        const expectedError = "密钥验证未通过，请检查提供的 API Key 是否有效。";
        expect(result).toEqual({ success: false, error: expectedError });

        const state = useSettingsStore.getState();
        expect(state.settings).toEqual(mockResponse);
        expect(state.saving).toBe(false);
        expect(state.error).toBe(expectedError);
      });

      it("handles updateSettings error with Error instance", async () => {
        vi.mocked(api.updateUserSettings).mockRejectedValue(new Error("Save failed"));

        const result = await useSettingsStore.getState().updateSettings({});

        expect(result).toEqual({ success: false, error: "Save failed" });

        const state = useSettingsStore.getState();
        expect(state.saving).toBe(false);
        expect(state.error).toBe("Save failed");
      });

      it("handles updateSettings error with fallback message for non-Error", async () => {
        vi.mocked(api.updateUserSettings).mockRejectedValue("String error");

        const result = await useSettingsStore.getState().updateSettings({});

        expect(result).toEqual({ success: false, error: "保存失败" });

        const state = useSettingsStore.getState();
        expect(state.saving).toBe(false);
        expect(state.error).toBe("保存失败");
      });
    });

    describe("reset", () => {
      it("resets store state fields to initial values", () => {
        const mockSettings: api.UserSettingsResponse = {
          is_custom_mode: false,
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
        };

        useSettingsStore.setState({
          settings: mockSettings,
          loading: true,
          saving: true,
          error: "Some error",
        });

        useSettingsStore.getState().reset();

        const state = useSettingsStore.getState();
        expect(state.settings).toBeNull();
        expect(state.loading).toBe(false);
        expect(state.saving).toBe(false);
        expect(state.error).toBeNull();
      });
    });
  });
});
