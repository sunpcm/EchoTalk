import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useSettingsStore, readStoredTheme, applyThemeAttr, THEME_STORAGE_KEY } from "./settings";
import * as api from "@/lib/api";
import * as auth from "@/lib/auth";

vi.mock("@/lib/api", () => ({
  getUserSettings: vi.fn(),
  updateUserSettings: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getAuthSnapshot: vi.fn(),
  getAuthRevision: vi.fn(),
  arePrincipalsEqual: vi.fn((a, b) => {
    if (a === b) return true;
    if (!a || !b) return false;
    return a.issuer === b.issuer && a.subject === b.subject;
  }),
}));

const DEFAULT_AUTH_SNAPSHOT: auth.AuthSnapshot = {
  state: "authenticated",
  principal: { issuer: "urn:echotalk:auth:dev", subject: "dev-user" },
};

describe("settings store & theme helpers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    vi.mocked(auth.getAuthSnapshot).mockReturnValue({ ...DEFAULT_AUTH_SNAPSHOT });
    vi.mocked(auth.getAuthRevision).mockReturnValue(1);
    useSettingsStore.getState().reset();
    useSettingsStore.setState({ theme: "warm" });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("setTheme updates store, localStorage, document attribute and calls updateUserSettings after debounce", async () => {
    vi.mocked(api.updateUserSettings).mockResolvedValue({
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

    expect(api.updateUserSettings).not.toHaveBeenCalled();

    vi.advanceTimersByTime(300);

    expect(api.updateUserSettings).toHaveBeenCalledWith({ theme: "dark" });
  });

  it("rapid setTheme calls debounce into a single updateUserSettings call with the latest theme", async () => {
    vi.mocked(api.updateUserSettings).mockResolvedValue({
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

    expect(api.updateUserSettings).toHaveBeenCalledTimes(1);
    expect(api.updateUserSettings).toHaveBeenCalledWith({ theme: "cool" });
  });

  it("ignores a stale backend response after a newer local theme selection", async () => {
    let resolveFirstRequest!: (settings: api.UserSettingsResponse) => void;
    vi.mocked(api.updateUserSettings).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirstRequest = resolve;
        }),
    );

    useSettingsStore.getState().setTheme("dark");
    await vi.advanceTimersByTimeAsync(300);
    useSettingsStore.getState().setTheme("cool");

    resolveFirstRequest({
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
    await Promise.resolve();

    expect(useSettingsStore.getState().theme).toBe("cool");
    expect(useSettingsStore.getState().settings).toBeNull();
  });

  it("reset cancels a pending backend theme update", () => {
    useSettingsStore.getState().setTheme("dark");
    useSettingsStore.getState().reset();
    vi.advanceTimersByTime(300);

    expect(api.updateUserSettings).not.toHaveBeenCalled();
  });

  it("fetchSettings updates theme in store, localStorage, and document attribute when returned from backend", async () => {
    vi.mocked(api.getUserSettings).mockResolvedValue({
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
          theme: "warm",
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

      it("advances independent generation so stale async fetch does not populate new session", async () => {
        let resolveStaleFetch!: (val: api.UserSettingsResponse) => void;
        vi.mocked(api.getUserSettings).mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveStaleFetch = resolve;
            }),
        );

        const fetchPromise = useSettingsStore.getState().fetchSettings();
        expect(useSettingsStore.getState().loading).toBe(true);

        useSettingsStore.getState().reset();
        expect(useSettingsStore.getState().loading).toBe(false);

        useSettingsStore.setState({ theme: "cool" });

        resolveStaleFetch({
          is_custom_mode: false,
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
        await fetchPromise;

        expect(useSettingsStore.getState().settings).toBeNull();
        expect(useSettingsStore.getState().theme).toBe("cool");
        expect(useSettingsStore.getState().loading).toBe(false);
      });

      it("stale updateSettings returns non-success and does not write to store", async () => {
        let resolveStaleUpdate!: (val: api.UserSettingsResponse) => void;
        vi.mocked(api.updateUserSettings).mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveStaleUpdate = resolve;
            }),
        );

        const updatePromise = useSettingsStore.getState().updateSettings({ theme: "dark" });
        expect(useSettingsStore.getState().saving).toBe(true);

        useSettingsStore.getState().reset();

        resolveStaleUpdate({
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

        const result = await updatePromise;
        expect(result.success).toBe(false);
        expect(useSettingsStore.getState().settings).toBeNull();
        expect(useSettingsStore.getState().saving).toBe(false);
      });

      it("stale fetch error does not overwrite new session error state", async () => {
        let rejectStaleFetch!: (err: Error) => void;
        vi.mocked(api.getUserSettings).mockImplementationOnce(
          () =>
            new Promise((_, reject) => {
              rejectStaleFetch = reject;
            }),
        );

        const fetchPromise = useSettingsStore.getState().fetchSettings();
        useSettingsStore.getState().reset();

        rejectStaleFetch(new Error("Stale network failure"));
        await fetchPromise;

        expect(useSettingsStore.getState().error).toBeNull();
      });
    });
  });

  describe("Phase 8 / A28 认证绑定、单在途合并与水合竞争防护回归", () => {
    it("anonymous / loading / misconfigured 状态仅保留本地偏好，不向后端发出写请求", () => {
      // 1. anonymous
      vi.mocked(auth.getAuthSnapshot).mockReturnValue({ state: "anonymous", principal: null });
      useSettingsStore.getState().setTheme("dark");
      expect(useSettingsStore.getState().theme).toBe("dark");
      expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
      expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
      vi.advanceTimersByTime(300);
      expect(api.updateUserSettings).not.toHaveBeenCalled();

      // 2. loading
      vi.mocked(auth.getAuthSnapshot).mockReturnValue({ state: "loading", principal: null });
      useSettingsStore.getState().setTheme("cool");
      expect(useSettingsStore.getState().theme).toBe("cool");
      vi.advanceTimersByTime(300);
      expect(api.updateUserSettings).not.toHaveBeenCalled();

      // 3. misconfigured
      vi.mocked(auth.getAuthSnapshot).mockReturnValue({ state: "misconfigured", principal: null });
      useSettingsStore.getState().setTheme("warm");
      expect(useSettingsStore.getState().theme).toBe("warm");
      vi.advanceTimersByTime(300);
      expect(api.updateUserSettings).not.toHaveBeenCalled();
    });

    it("setTheme 同步订阅触发 reset / 账号切换时，旧操作失效并不产生网络请求", () => {
      // 订阅者在接收到 theme 变更时同步调用 reset
      const unsubscribe = useSettingsStore.subscribe((state, prevState) => {
        if (state.theme !== prevState.theme) {
          useSettingsStore.getState().reset();
        }
      });

      useSettingsStore.getState().setTheme("dark");
      vi.advanceTimersByTime(300);

      expect(api.updateUserSettings).not.toHaveBeenCalled();
      unsubscribe();
    });

    it("setTheme 300ms timer 触发前同用户 authRevision 变化或账号变化，取消副作用", () => {
      useSettingsStore.getState().setTheme("dark");

      // 在 timer 到期前，同一用户 token 刷新导致 revision 变动
      vi.mocked(auth.getAuthRevision).mockReturnValue(2);

      vi.advanceTimersByTime(300);
      expect(api.updateUserSettings).not.toHaveBeenCalled();
    });

    it("setTheme 300ms timer 触发前账号变化但尚未 reset，取消副作用", () => {
      useSettingsStore.getState().setTheme("dark");

      // 账号变化为另一用户
      vi.mocked(auth.getAuthSnapshot).mockReturnValue({
        state: "authenticated",
        principal: { issuer: "urn:echotalk:auth:dev", subject: "another-user" },
      });

      vi.advanceTimersByTime(300);
      expect(api.updateUserSettings).not.toHaveBeenCalled();
    });

    it("同身份主题 PUT 单在途与最新意图串行合并，不并发且不丢末值", async () => {
      let resolveFirstPut!: (s: api.UserSettingsResponse) => void;
      let resolveSecondPut!: (s: api.UserSettingsResponse) => void;

      vi.mocked(api.updateUserSettings)
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveFirstPut = resolve;
            }),
        )
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveSecondPut = resolve;
            }),
        );

      // 用户选择 cool，300ms 后触发第一个 PUT
      useSettingsStore.getState().setTheme("cool");
      vi.advanceTimersByTime(300);
      expect(api.updateUserSettings).toHaveBeenCalledTimes(1);
      expect(api.updateUserSettings).toHaveBeenLastCalledWith({ theme: "cool" });

      // 在第一个 PUT 在途期间，用户再次连续切换 cool -> dark
      useSettingsStore.getState().setTheme("dark");
      vi.advanceTimersByTime(300);

      // 必须保持单在途，绝不并发发出第二个 PUT！
      expect(api.updateUserSettings).toHaveBeenCalledTimes(1);

      // 第一个 PUT 完成
      resolveFirstPut({
        is_custom_mode: false,
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
      // 推进微任务直到 finally 执行
      for (let i = 0; i < 5; i++) {
        await Promise.resolve();
      }

      // 第一个完成后，最新待发意图 dark 串行发出！
      expect(api.updateUserSettings).toHaveBeenCalledTimes(2);
      expect(api.updateUserSettings).toHaveBeenLastCalledWith({ theme: "dark" });

      resolveSecondPut({
        is_custom_mode: false,
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
      for (let i = 0; i < 5; i++) {
        await Promise.resolve();
      }

      expect(useSettingsStore.getState().theme).toBe("dark");
    });

    it("reset 后新身份不被旧永不返回的在途请求永久锁住", async () => {
      // 用户 A 发起 PUT，永远挂起
      vi.mocked(api.updateUserSettings).mockImplementationOnce(() => new Promise(() => {}));

      useSettingsStore.getState().setTheme("cool");
      vi.advanceTimersByTime(300);
      expect(api.updateUserSettings).toHaveBeenCalledTimes(1);
      expect(api.updateUserSettings).toHaveBeenLastCalledWith({ theme: "cool" });

      // 用户 A 退出/切换，触发 reset
      useSettingsStore.getState().reset();

      // 用户 B 登录
      vi.mocked(auth.getAuthSnapshot).mockReturnValue({
        state: "authenticated",
        principal: { issuer: "urn:echotalk:auth:dev", subject: "user-b" },
      });
      vi.mocked(auth.getAuthRevision).mockReturnValue(2);

      vi.mocked(api.updateUserSettings).mockResolvedValueOnce({
        is_custom_mode: false,
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

      // 用户 B 设置主题
      useSettingsStore.getState().setTheme("dark");
      vi.advanceTimersByTime(300);

      // 用户 B 的操作正常推进发出，未被用户 A 挂起的旧请求死锁！
      expect(api.updateUserSettings).toHaveBeenCalledTimes(2);
      expect(api.updateUserSettings).toHaveBeenLastCalledWith({ theme: "dark" });
    });

    it("旧 theme-only 响应绝不能回写覆盖更新的通用设置保存结果", async () => {
      let resolveThemePut!: (s: api.UserSettingsResponse) => void;
      vi.mocked(api.updateUserSettings).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveThemePut = resolve;
          }),
      );

      // 1. 先通过通用设置更新了 Provider 和 Key
      const initialSettings: api.UserSettingsResponse = {
        is_custom_mode: true,
        is_custom_verified: true,
        theme: "warm",
        stt_provider: "deepgram",
        llm_provider: "openrouter",
        llm_model: "gpt-4",
        tts_provider: "cartesia",
        has_stt_key: true,
        has_llm_key: true,
        has_tts_key: true,
        stt_status: "verified",
        llm_status: "verified",
        tts_status: "verified",
      };
      useSettingsStore.setState({ settings: initialSettings });

      // 2. 发起主题更新
      useSettingsStore.getState().setTheme("dark");
      vi.advanceTimersByTime(300);
      expect(api.updateUserSettings).toHaveBeenCalledWith({ theme: "dark" });

      // 3. 在 theme PUT 挂起期间，通用设置被更新（例如切换了模型为 claude-3）
      useSettingsStore.setState({
        settings: {
          ...initialSettings,
          llm_model: "claude-3",
        },
      });

      // 4. theme PUT 迟到返回，其响应中包含的是后端的旧通用设置（llm_model: "gpt-4"）
      resolveThemePut({
        is_custom_mode: true,
        is_custom_verified: true,
        theme: "dark",
        stt_provider: "deepgram",
        llm_provider: "openrouter",
        llm_model: "gpt-4", // 后端旧值
        tts_provider: "cartesia",
        has_stt_key: true,
        has_llm_key: true,
        has_tts_key: true,
        stt_status: "verified",
        llm_status: "verified",
        tts_status: "verified",
      });
      await Promise.resolve();

      // 验证：llm_model 依然保持更新后的 "claude-3"，绝未被 theme 响应覆盖！
      const currentSettings = useSettingsStore.getState().settings;
      expect(currentSettings?.llm_model).toBe("claude-3");
      expect(currentSettings?.theme).toBe("dark");
      expect(currentSettings?.is_custom_verified).toBe(true);
    });

    it("水合竞争防护：GET 请求在本地选择前已发出，返回时绝不能覆盖本地选择", async () => {
      let resolveGet!: (s: api.UserSettingsResponse) => void;
      vi.mocked(api.getUserSettings).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveGet = resolve;
          }),
      );

      // 发起 fetchSettings
      const fetchPromise = useSettingsStore.getState().fetchSettings();

      // 在 GET 挂起期间，用户显式选择了 cool
      useSettingsStore.getState().setTheme("cool");
      expect(useSettingsStore.getState().theme).toBe("cool");

      // GET 返回服务端存储的旧主题 warm
      resolveGet({
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
      });
      await fetchPromise;

      // 本地主题必须保持 cool，绝不被服务端旧 theme 覆盖
      expect(useSettingsStore.getState().theme).toBe("cool");
      expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("cool");
      expect(document.documentElement.getAttribute("data-theme")).toBe("cool");
      expect(useSettingsStore.getState().settings?.theme).toBe("cool");
    });

    it("水合竞争防护：在防抖或 PUT 在途中发出的 GET 请求返回时，绝不覆盖本地明确选择", async () => {
      useSettingsStore.getState().setTheme("dark");

      // 防抖期间调用 fetchSettings
      vi.mocked(api.getUserSettings).mockResolvedValueOnce({
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
      });

      await useSettingsStore.getState().fetchSettings();

      // 绝不被覆盖回 warm
      expect(useSettingsStore.getState().theme).toBe("dark");
      expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
      expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    });

    it("后端同步失败保持本地主题、无未处理异常且后续操作可正常恢复", async () => {
      vi.mocked(api.updateUserSettings).mockRejectedValueOnce(new Error("500 Internal Error"));

      useSettingsStore.getState().setTheme("dark");
      vi.advanceTimersByTime(300);
      for (let i = 0; i < 5; i++) {
        await Promise.resolve();
      }

      // 保持本地已选 theme
      expect(useSettingsStore.getState().theme).toBe("dark");

      // 再次选择可正常推进
      vi.mocked(api.updateUserSettings).mockResolvedValueOnce({
        is_custom_mode: false,
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

      useSettingsStore.getState().setTheme("cool");
      vi.advanceTimersByTime(300);
      for (let i = 0; i < 5; i++) {
        await Promise.resolve();
      }

      expect(api.updateUserSettings).toHaveBeenCalledTimes(2);
      expect(useSettingsStore.getState().theme).toBe("cool");
    });

    it("TH-01: 同步订阅者触发嵌套选择时，最新选择优先且不被外层覆盖", () => {
      vi.mocked(api.updateUserSettings).mockResolvedValue({
        is_custom_mode: false,
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

      // 订阅者在收到 dark 时同步选择 cool
      let nestedTriggered = false;
      const unsubscribe = useSettingsStore.subscribe((state) => {
        if (state.theme === "dark" && !nestedTriggered) {
          nestedTriggered = true;
          useSettingsStore.getState().setTheme("cool");
        }
      });

      useSettingsStore.getState().setTheme("dark");

      // 最终 UI 状态必须严格保持为内层选择的 cool
      expect(useSettingsStore.getState().theme).toBe("cool");

      vi.advanceTimersByTime(300);

      // 发向后端的写请求严格只有一次，且内容是内层的 cool，绝不能被外层的 dark 覆盖！
      expect(api.updateUserSettings).toHaveBeenCalledTimes(1);
      expect(api.updateUserSettings).toHaveBeenCalledWith({ theme: "cool" });

      unsubscribe();
    });

    it("TH-02: GET 在 dark PUT 在途时启动，PUT 先完成，旧 GET 后返回 warm 时绝不回滚 dark", async () => {
      let resolvePut!: (s: api.UserSettingsResponse) => void;
      let resolveGet!: (s: api.UserSettingsResponse) => void;

      vi.mocked(api.updateUserSettings).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolvePut = resolve;
          }),
      );
      vi.mocked(api.getUserSettings).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveGet = resolve;
          }),
      );

      // 1. 本地选择 dark，防抖 300ms 后 PUT 发出（在途中）
      useSettingsStore.getState().setTheme("dark");
      vi.advanceTimersByTime(300);
      expect(api.updateUserSettings).toHaveBeenCalledTimes(1);
      expect(api.updateUserSettings).toHaveBeenLastCalledWith({ theme: "dark" });

      // 2. 在 dark PUT 挂起期间，启动 fetchSettings
      const fetchPromise = useSettingsStore.getState().fetchSettings();
      expect(api.getUserSettings).toHaveBeenCalledTimes(1);

      // 3. dark PUT 先行完成
      resolvePut({
        is_custom_mode: false,
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
      for (let i = 0; i < 5; i++) {
        await Promise.resolve();
      }

      // 4. 旧 GET 随后返回服务端旧值 warm
      resolveGet({
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
      });
      await fetchPromise;

      // 核心断言：本地已确认的 dark 绝对不被旧 GET 覆盖回滚！
      expect(useSettingsStore.getState().theme).toBe("dark");
      expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
      expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

      // 5. 再次无冲突调用 fetchSettings 时，正常水合
      vi.mocked(api.getUserSettings).mockResolvedValueOnce({
        is_custom_mode: false,
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
    });

    it("TH-03: 旧 GET 仍在途时新身份可发起并完成，旧 GET 迟到不污染新身份且旧 finally 不死锁", async () => {
      let resolveUserAGet!: (s: api.UserSettingsResponse) => void;
      let resolveUserBGet!: (s: api.UserSettingsResponse) => void;

      vi.mocked(api.getUserSettings)
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveUserAGet = resolve;
            }),
        )
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveUserBGet = resolve;
            }),
        );

      // 用户 A 发起 fetchSettings
      const fetchPromiseA = useSettingsStore.getState().fetchSettings();
      expect(api.getUserSettings).toHaveBeenCalledTimes(1);

      // 切换到用户 B（principal / revision 变动，但尚未触发 React reset）
      vi.mocked(auth.getAuthSnapshot).mockReturnValue({
        state: "authenticated",
        principal: { issuer: "urn:echotalk:auth:dev", subject: "user-b" },
      });
      vi.mocked(auth.getAuthRevision).mockReturnValue(2);

      // 用户 B 发起 fetchSettings：必须能成功发出（不能被用户 A 的在途请求忽略死锁）
      const fetchPromiseB = useSettingsStore.getState().fetchSettings();
      expect(api.getUserSettings).toHaveBeenCalledTimes(2);

      // 用户 A 的旧请求返回 private-a 的数据
      resolveUserAGet({
        is_custom_mode: true,
        theme: "dark",
        stt_provider: "deepgram",
        llm_provider: "openrouter",
        llm_model: "user-a-secret-model",
        tts_provider: null,
        has_stt_key: true,
        has_llm_key: true,
        has_tts_key: false,
        stt_status: "verified",
        llm_status: "verified",
        tts_status: "unconfigured",
      });
      await fetchPromiseA;

      // 验证：用户 A 的旧数据绝对没有写入 store！
      expect(useSettingsStore.getState().settings).toBeNull();
      // 用户 B 的请求仍在在途，loading 保持为 true（旧 finally 绝不能清空新槽位的 loading）
      expect(useSettingsStore.getState().loading).toBe(true);

      // 用户 B 的请求完成
      resolveUserBGet({
        is_custom_mode: false,
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
      await fetchPromiseB;

      // 用户 B 成功水合，且 loading 正常复位
      expect(useSettingsStore.getState().settings?.theme).toBe("cool");
      expect(useSettingsStore.getState().loading).toBe(false);
    });

    it("TH-05: 两门状态机保证防抖与无在途同时满足才写，在途提前完成绝不提前发写", async () => {
      let resolveFirstPut!: (s: api.UserSettingsResponse) => void;

      vi.mocked(api.updateUserSettings).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirstPut = resolve;
          }),
      );

      // 1. 用户选择 dark，300ms 后在途发出
      useSettingsStore.getState().setTheme("dark");
      vi.advanceTimersByTime(300);
      expect(api.updateUserSettings).toHaveBeenCalledTimes(1);
      expect(api.updateUserSettings).toHaveBeenLastCalledWith({ theme: "dark" });

      // 2. 在途期间，用户点击 cool（cool 启动自身 300ms timer）
      useSettingsStore.getState().setTheme("cool");

      // 3. 仅过去 1ms，dark PUT 完成了
      vi.advanceTimersByTime(1);
      resolveFirstPut({
        is_custom_mode: false,
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
      for (let i = 0; i < 5; i++) {
        await Promise.resolve();
      }

      // 4. 在 cool 选后 298ms（总计 299ms）推进：必须绝对零新写！
      vi.advanceTimersByTime(298);
      expect(api.updateUserSettings).toHaveBeenCalledTimes(1);

      // 5. 推进最后 1ms（达到 300ms）：恰好发出一次写！
      vi.mocked(api.updateUserSettings).mockResolvedValueOnce({
        is_custom_mode: false,
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
      vi.advanceTimersByTime(1);
      for (let i = 0; i < 5; i++) {
        await Promise.resolve();
      }

      expect(api.updateUserSettings).toHaveBeenCalledTimes(2);
      expect(api.updateUserSettings).toHaveBeenLastCalledWith({ theme: "cool" });
    });

    it("TH-07: fetchSettings 同步订阅内切换 principal/revision，直接在副作用前取消且零网络请求", async () => {
      // 订阅者在接收到 loading: true 时同步切换用户为 user-b
      let switched = false;
      const unsubscribe = useSettingsStore.subscribe((state) => {
        if (state.loading && !switched) {
          switched = true;
          vi.mocked(auth.getAuthSnapshot).mockReturnValue({
            state: "authenticated",
            principal: { issuer: "urn:echotalk:auth:dev", subject: "user-b" },
          });
          vi.mocked(auth.getAuthRevision).mockReturnValue(2);
        }
      });

      await useSettingsStore.getState().fetchSettings();

      // 核心断言：副作用前复核拦截，getUserSettings 绝对零调用！
      expect(api.getUserSettings).not.toHaveBeenCalled();
      // 槽位与 loading 正确释放，不留下 loading 死锁
      expect(useSettingsStore.getState().loading).toBe(false);

      unsubscribe();
    });

    it("TH-07: updateSettings 同步订阅内切换 principal/revision，零网络请求且返回 stale", async () => {
      let switched = false;
      const unsubscribe = useSettingsStore.subscribe((state) => {
        if (state.saving && !switched) {
          switched = true;
          vi.mocked(auth.getAuthSnapshot).mockReturnValue({
            state: "authenticated",
            principal: { issuer: "urn:echotalk:auth:dev", subject: "user-b" },
          });
          vi.mocked(auth.getAuthRevision).mockReturnValue(2);
        }
      });

      const result = await useSettingsStore.getState().updateSettings({
        is_custom_mode: true,
        stt_key: "key-should-not-leak",
      });

      // 核心断言：updateUserSettings 绝对零调用，旧数据绝不写入新账号！
      expect(api.updateUserSettings).not.toHaveBeenCalled();
      expect(result).toEqual({ success: false, error: "stale" });
      expect(useSettingsStore.getState().saving).toBe(false);

      unsubscribe();
    });

    it("TH-08: 用户 A 待防抖残留意图在切换为用户 B 后失效，用户 B 的有效 GET 正常水合且不被残留 sequence 否决", async () => {
      // 1. 用户 A 选择 dark，300ms 防抖计时器正在运行
      useSettingsStore.getState().setTheme("dark");
      expect(useSettingsStore.getState().theme).toBe("dark");

      // 2. 认证立即切换为用户 B（未调用 reset）
      vi.mocked(auth.getAuthSnapshot).mockReturnValue({
        state: "authenticated",
        principal: { issuer: "urn:echotalk:auth:dev", subject: "user-b" },
      });
      vi.mocked(auth.getAuthRevision).mockReturnValue(2);

      // 用户 A 的 timer 到期：复核身份失效，正确零 PUT
      vi.advanceTimersByTime(300);
      expect(api.updateUserSettings).not.toHaveBeenCalled();

      // 3. 用户 B 发起 fetchSettings，服务端返回用户 B 的主题 cool
      vi.mocked(api.getUserSettings).mockResolvedValueOnce({
        is_custom_mode: false,
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

      // 核心断言：用户 A 的残留 sequence 绝对不能永久否决用户 B 的正常水合！
      expect(useSettingsStore.getState().theme).toBe("cool");
      expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("cool");
      expect(document.documentElement.getAttribute("data-theme")).toBe("cool");
      expect(useSettingsStore.getState().settings?.theme).toBe("cool");

      // 4. 用户 B 随后选新主题，正常推进
      vi.mocked(api.updateUserSettings).mockResolvedValueOnce({
        is_custom_mode: false,
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
      vi.advanceTimersByTime(300);
      for (let i = 0; i < 5; i++) {
        await Promise.resolve();
      }

      expect(api.updateUserSettings).toHaveBeenCalledTimes(1);
      expect(api.updateUserSettings).toHaveBeenLastCalledWith({ theme: "dark" });
    });

    it("TH-08: 用户 A 旧 PUT 挂起永不返回时，新身份用户 B 的有效 GET 正常水合且后续操作不被锁住", async () => {
      // 用户 A 发起 PUT 且永远挂起
      vi.mocked(api.updateUserSettings).mockImplementationOnce(() => new Promise(() => {}));

      useSettingsStore.getState().setTheme("dark");
      vi.advanceTimersByTime(300);
      expect(api.updateUserSettings).toHaveBeenCalledTimes(1);
      expect(api.updateUserSettings).toHaveBeenLastCalledWith({ theme: "dark" });

      // 认证切换为用户 B（未调用 reset）
      vi.mocked(auth.getAuthSnapshot).mockReturnValue({
        state: "authenticated",
        principal: { issuer: "urn:echotalk:auth:dev", subject: "user-b" },
      });
      vi.mocked(auth.getAuthRevision).mockReturnValue(2);

      // 用户 B 启动 GET 并返回 cool
      vi.mocked(api.getUserSettings).mockResolvedValueOnce({
        is_custom_mode: false,
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

      // 用户 B 正常水合，不受用户 A 永不返回的旧 PUT 影响
      expect(useSettingsStore.getState().theme).toBe("cool");
      expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("cool");

      // 用户 B 发起自己的新写请求，能正常发出
      vi.mocked(api.updateUserSettings).mockResolvedValueOnce({
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
      });

      useSettingsStore.getState().setTheme("warm");
      vi.advanceTimersByTime(300);
      for (let i = 0; i < 5; i++) {
        await Promise.resolve();
      }

      expect(api.updateUserSettings).toHaveBeenCalledTimes(2);
      expect(api.updateUserSettings).toHaveBeenLastCalledWith({ theme: "warm" });
    });

    it("TH-10: fetchSettings 与 updateSettings 在 anonymous/loading/misconfigured 下失败关闭，零网络请求且保留本地 theme", async () => {
      const authStates: auth.AuthState[] = ["anonymous", "loading", "misconfigured"];

      for (const st of authStates) {
        vi.mocked(auth.getAuthSnapshot).mockReturnValue({ state: st, principal: null });
        useSettingsStore.setState({ theme: "dark", loading: false, saving: false });
        vi.clearAllMocks();

        // 1. fetchSettings
        await useSettingsStore.getState().fetchSettings();
        expect(api.getUserSettings).not.toHaveBeenCalled();
        expect(useSettingsStore.getState().loading).toBe(false);
        expect(useSettingsStore.getState().theme).toBe("dark");

        // 2. updateSettings
        const res = await useSettingsStore.getState().updateSettings({ is_custom_mode: true });
        expect(api.updateUserSettings).not.toHaveBeenCalled();
        expect(res).toEqual({ success: false, error: "stale" });
        expect(useSettingsStore.getState().saving).toBe(false);
        expect(useSettingsStore.getState().theme).toBe("dark");
      }
    });

    it("TH-10: fetchSettings 与 updateSettings 在同步通知内降级为未认证状态时，立即在发送前取消且零网络请求", async () => {
      // 1. fetchSettings 在同步通知内变为 anonymous
      let switchedFetch = false;
      const unsubFetch = useSettingsStore.subscribe((state) => {
        if (state.loading && !switchedFetch) {
          switchedFetch = true;
          vi.mocked(auth.getAuthSnapshot).mockReturnValue({ state: "anonymous", principal: null });
        }
      });
      await useSettingsStore.getState().fetchSettings();
      expect(api.getUserSettings).not.toHaveBeenCalled();
      expect(useSettingsStore.getState().loading).toBe(false);
      unsubFetch();

      // 恢复认证状态
      vi.mocked(auth.getAuthSnapshot).mockReturnValue({ ...DEFAULT_AUTH_SNAPSHOT });
      vi.mocked(auth.getAuthRevision).mockReturnValue(1);

      // 2. updateSettings 在同步通知内变为 anonymous
      let switchedUpdate = false;
      const unsubUpdate = useSettingsStore.subscribe((state) => {
        if (state.saving && !switchedUpdate) {
          switchedUpdate = true;
          vi.mocked(auth.getAuthSnapshot).mockReturnValue({ state: "anonymous", principal: null });
        }
      });
      const res = await useSettingsStore.getState().updateSettings({ is_custom_mode: true });
      expect(api.updateUserSettings).not.toHaveBeenCalled();
      expect(res).toEqual({ success: false, error: "stale" });
      expect(useSettingsStore.getState().saving).toBe(false);
      unsubUpdate();
    });

    it("TH-09: updateSettings 同步订阅换号并立即启动新保存 B，A 发送前取消但绝不清除 B 的 saving，B 正常完成且后续保存可推进", async () => {
      let resolvePutB!: (s: api.UserSettingsResponse) => void;

      // 订阅者在感知到 A 的 saving: true 时，同步换为用户 B 并立即触发 B 的 updateSettings
      let switched = false;
      let promiseB: Promise<{ success: boolean; error?: string }> | null = null;

      const unsubscribe = useSettingsStore.subscribe((state) => {
        if (state.saving && !switched) {
          switched = true;
          vi.mocked(auth.getAuthSnapshot).mockReturnValue({
            state: "authenticated",
            principal: { issuer: "urn:echotalk:auth:dev", subject: "user-b" },
          });
          vi.mocked(auth.getAuthRevision).mockReturnValue(2);

          vi.mocked(api.updateUserSettings).mockImplementationOnce(
            () =>
              new Promise((resolve) => {
                resolvePutB = resolve;
              }),
          );

          promiseB = useSettingsStore.getState().updateSettings({
            is_custom_mode: true,
            llm_model: "model-b",
          });
        }
      });

      const resultA = await useSettingsStore.getState().updateSettings({
        is_custom_mode: true,
        llm_model: "model-a-should-abort",
      });

      // A 必须在发送前被取消，返回 stale
      expect(resultA).toEqual({ success: false, error: "stale" });
      // 核心断言：网络上恰好只有 1 次调用（属于 B 的 PUT），绝无 A 的 PUT！
      expect(api.updateUserSettings).toHaveBeenCalledTimes(1);
      expect(api.updateUserSettings).toHaveBeenLastCalledWith({
        is_custom_mode: true,
        llm_model: "model-b",
      });

      // 核心断言：A 的退出绝不能将 B 在途的 saving 误清为 false！此时 saving 必须仍然为 true！
      expect(useSettingsStore.getState().saving).toBe(true);

      // B 的保存完成
      resolvePutB({
        is_custom_mode: true,
        is_custom_verified: true,
        theme: "warm",
        stt_provider: null,
        llm_provider: null,
        llm_model: "model-b",
        tts_provider: null,
        has_stt_key: false,
        has_llm_key: false,
        has_tts_key: false,
        stt_status: "unconfigured",
        llm_status: "unconfigured",
        tts_status: "unconfigured",
      });

      const resultB = await promiseB!;
      expect(resultB).toEqual({ success: true });
      // B 完成后 saving 正常释放为 false，且 store 正确更新为 B 的数据
      expect(useSettingsStore.getState().saving).toBe(false);
      expect(useSettingsStore.getState().settings?.llm_model).toBe("model-b");

      // 用户 B 后续的显式保存可以正常推进
      vi.mocked(api.updateUserSettings).mockResolvedValueOnce({
        is_custom_mode: true,
        is_custom_verified: true,
        theme: "warm",
        stt_provider: null,
        llm_provider: null,
        llm_model: "model-b-next",
        tts_provider: null,
        has_stt_key: false,
        has_llm_key: false,
        has_tts_key: false,
        stt_status: "unconfigured",
        llm_status: "unconfigured",
        tts_status: "unconfigured",
      });

      const nextRes = await useSettingsStore.getState().updateSettings({
        llm_model: "model-b-next",
      });
      expect(nextRes).toEqual({ success: true });
      expect(useSettingsStore.getState().settings?.llm_model).toBe("model-b-next");
      expect(useSettingsStore.getState().saving).toBe(false);

      unsubscribe();
    });

    it("TH-09: updateSettings 同步订阅 reset 并立即启动新保存 B，A 发送前取消且不影响 B 在途 saving", async () => {
      let resolvePutB!: (s: api.UserSettingsResponse) => void;
      let switched = false;
      let promiseB: Promise<{ success: boolean; error?: string }> | null = null;

      const unsubscribe = useSettingsStore.subscribe((state) => {
        if (state.saving && !switched) {
          switched = true;
          // 同步执行 reset
          useSettingsStore.getState().reset();

          vi.mocked(auth.getAuthSnapshot).mockReturnValue({
            state: "authenticated",
            principal: { issuer: "urn:echotalk:auth:dev", subject: "user-b" },
          });
          vi.mocked(auth.getAuthRevision).mockReturnValue(2);

          vi.mocked(api.updateUserSettings).mockImplementationOnce(
            () =>
              new Promise((resolve) => {
                resolvePutB = resolve;
              }),
          );

          promiseB = useSettingsStore.getState().updateSettings({
            is_custom_mode: true,
            llm_model: "model-b-after-reset",
          });
        }
      });

      const resultA = await useSettingsStore.getState().updateSettings({
        is_custom_mode: true,
        llm_model: "model-a-before-reset",
      });

      expect(resultA).toEqual({ success: false, error: "stale" });
      expect(api.updateUserSettings).toHaveBeenCalledTimes(1);
      // B 在途中，saving 保持为 true
      expect(useSettingsStore.getState().saving).toBe(true);

      resolvePutB({
        is_custom_mode: true,
        is_custom_verified: true,
        theme: "warm",
        stt_provider: null,
        llm_provider: null,
        llm_model: "model-b-after-reset",
        tts_provider: null,
        has_stt_key: false,
        has_llm_key: false,
        has_tts_key: false,
        stt_status: "unconfigured",
        llm_status: "unconfigured",
        tts_status: "unconfigured",
      });

      const resultB = await promiseB!;
      expect(resultB).toEqual({ success: true });
      expect(useSettingsStore.getState().saving).toBe(false);
      expect(useSettingsStore.getState().settings?.llm_model).toBe("model-b-after-reset");

      unsubscribe();
    });

    it("TH-09: 旧 A updateSettings 仍在途挂起晚成，新身份 B 的保存不受干扰，旧 A 响应不污染 store 且不清除 B 的 saving", async () => {
      let resolvePutA!: (s: api.UserSettingsResponse) => void;
      let resolvePutB!: (s: api.UserSettingsResponse) => void;

      vi.mocked(api.updateUserSettings)
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolvePutA = resolve;
            }),
        )
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolvePutB = resolve;
            }),
        );

      // 1. 用户 A 发起 updateSettings，请求在途挂起
      const promiseA = useSettingsStore.getState().updateSettings({
        is_custom_mode: true,
        llm_model: "model-user-a",
      });
      expect(useSettingsStore.getState().saving).toBe(true);
      expect(api.updateUserSettings).toHaveBeenCalledTimes(1);

      // 2. 身份切换为用户 B
      vi.mocked(auth.getAuthSnapshot).mockReturnValue({
        state: "authenticated",
        principal: { issuer: "urn:echotalk:auth:dev", subject: "user-b" },
      });
      vi.mocked(auth.getAuthRevision).mockReturnValue(2);

      // 3. 用户 B 发起 updateSettings，也在途中
      const promiseB = useSettingsStore.getState().updateSettings({
        is_custom_mode: true,
        llm_model: "model-user-b",
      });
      expect(useSettingsStore.getState().saving).toBe(true);
      expect(api.updateUserSettings).toHaveBeenCalledTimes(2);

      // 4. 用户 A 的旧请求迟到返回
      resolvePutA({
        is_custom_mode: true,
        is_custom_verified: true,
        theme: "warm",
        stt_provider: null,
        llm_provider: null,
        llm_model: "model-user-a-leaked",
        tts_provider: null,
        has_stt_key: false,
        has_llm_key: false,
        has_tts_key: false,
        stt_status: "unconfigured",
        llm_status: "unconfigured",
        tts_status: "unconfigured",
      });

      const resA = await promiseA;
      expect(resA).toEqual({ success: false, error: "stale" });

      // 核心断言：A 的迟到返回绝不能把 B 在途的 saving 置 false，也不能把 A 的 model 写入 store！
      expect(useSettingsStore.getState().saving).toBe(true);
      expect(useSettingsStore.getState().settings).toBeNull();

      // 5. 用户 B 的请求正常返回
      resolvePutB({
        is_custom_mode: true,
        is_custom_verified: true,
        theme: "warm",
        stt_provider: null,
        llm_provider: null,
        llm_model: "model-user-b-correct",
        tts_provider: null,
        has_stt_key: false,
        has_llm_key: false,
        has_tts_key: false,
        stt_status: "unconfigured",
        llm_status: "unconfigured",
        tts_status: "unconfigured",
      });

      const resB = await promiseB;
      expect(resB).toEqual({ success: true });
      expect(useSettingsStore.getState().saving).toBe(false);
      expect(useSettingsStore.getState().settings?.llm_model).toBe("model-user-b-correct");
    });

    it("TH-09: 旧 A updateSettings 仍在途挂起晚成返回错误，旧 A 的 catch 绝不写入 error 且不清除 B 的 saving", async () => {
      let rejectPutA!: (err: Error) => void;
      let resolvePutB!: (s: api.UserSettingsResponse) => void;

      vi.mocked(api.updateUserSettings)
        .mockImplementationOnce(
          () =>
            new Promise((_, reject) => {
              rejectPutA = reject;
            }),
        )
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolvePutB = resolve;
            }),
        );

      const promiseA = useSettingsStore.getState().updateSettings({
        is_custom_mode: true,
        llm_model: "model-user-a",
      });

      vi.mocked(auth.getAuthSnapshot).mockReturnValue({
        state: "authenticated",
        principal: { issuer: "urn:echotalk:auth:dev", subject: "user-b" },
      });
      vi.mocked(auth.getAuthRevision).mockReturnValue(2);

      const promiseB = useSettingsStore.getState().updateSettings({
        is_custom_mode: true,
        llm_model: "model-user-b",
      });

      // A 发生网络错误
      rejectPutA(new Error("500 User A network error"));

      const resA = await promiseA;
      expect(resA).toEqual({ success: false, error: "stale" });

      // 核心断言：A 的错误绝不污染 store.error，也绝不清除 B 的 saving！
      expect(useSettingsStore.getState().error).toBeNull();
      expect(useSettingsStore.getState().saving).toBe(true);

      // B 成功完成
      resolvePutB({
        is_custom_mode: true,
        is_custom_verified: true,
        theme: "warm",
        stt_provider: null,
        llm_provider: null,
        llm_model: "model-user-b-success",
        tts_provider: null,
        has_stt_key: false,
        has_llm_key: false,
        has_tts_key: false,
        stt_status: "unconfigured",
        llm_status: "unconfigured",
        tts_status: "unconfigured",
      });

      const resB = await promiseB;
      expect(resB).toEqual({ success: true });
      expect(useSettingsStore.getState().saving).toBe(false);
      expect(useSettingsStore.getState().error).toBeNull();
      expect(useSettingsStore.getState().settings?.llm_model).toBe("model-user-b-success");
    });

    it("TH-11: 同账号 revision 变动时在途串行等待，不并发发出第二个 PUT，旧请求迟到不发布，旧释放后末值推进", async () => {
      let resolveFirstPut!: (s: api.UserSettingsResponse) => void;
      let resolveSecondPut!: (s: api.UserSettingsResponse) => void;

      vi.mocked(api.updateUserSettings)
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveFirstPut = resolve;
            }),
        )
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveSecondPut = resolve;
            }),
        );

      // 1. 用户 A 选 dark，300ms 后触发第一个 PUT
      useSettingsStore.getState().setTheme("dark");
      vi.advanceTimersByTime(300);
      expect(api.updateUserSettings).toHaveBeenCalledTimes(1);
      expect(api.updateUserSettings).toHaveBeenLastCalledWith({ theme: "dark" });

      // 2. 同账号 token 刷新，revision 从 1 变为 2（principal 与代际均不变）
      vi.mocked(auth.getAuthRevision).mockReturnValue(2);

      // 3. 用户 A 选 cool，300ms 到期
      useSettingsStore.getState().setTheme("cool");
      vi.advanceTimersByTime(300);

      // 核心断言：物理在途保持串行占用，绝不并发发出第二个 PUT！
      expect(api.updateUserSettings).toHaveBeenCalledTimes(1);

      // 4. 第一个旧 PUT (dark) 迟到返回
      resolveFirstPut({
        is_custom_mode: false,
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
      for (let i = 0; i < 5; i++) {
        await Promise.resolve();
      }

      // 核心断言：旧 revision 回调失去发布资格，绝不能把 cool 覆盖回 dark！
      expect(useSettingsStore.getState().theme).toBe("cool");
      expect(useSettingsStore.getState().settings?.theme).toBeUndefined();

      // 5. 旧在途释放后，末值 cool 自动串行发出！
      expect(api.updateUserSettings).toHaveBeenCalledTimes(2);
      expect(api.updateUserSettings).toHaveBeenLastCalledWith({ theme: "cool" });

      // 6. 第二个 PUT 完成
      resolveSecondPut({
        is_custom_mode: false,
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
      for (let i = 0; i < 5; i++) {
        await Promise.resolve();
      }

      expect(useSettingsStore.getState().theme).toBe("cool");
      expect(useSettingsStore.getState().settings?.theme).toBe("cool");
    });

    it("TH-11: 同账号 revision 变动旧请求网络失败释放后，末值正常推进发出", async () => {
      let rejectFirstPut!: (err: Error) => void;
      let resolveSecondPut!: (s: api.UserSettingsResponse) => void;

      vi.mocked(api.updateUserSettings)
        .mockImplementationOnce(
          () =>
            new Promise((_, reject) => {
              rejectFirstPut = reject;
            }),
        )
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveSecondPut = resolve;
            }),
        );

      useSettingsStore.getState().setTheme("dark");
      vi.advanceTimersByTime(300);
      expect(api.updateUserSettings).toHaveBeenCalledTimes(1);

      vi.mocked(auth.getAuthRevision).mockReturnValue(2);

      useSettingsStore.getState().setTheme("cool");
      vi.advanceTimersByTime(300);

      // 串行无并发
      expect(api.updateUserSettings).toHaveBeenCalledTimes(1);

      // 旧 PUT 发生网络错误
      rejectFirstPut(new Error("500 Server error"));
      for (let i = 0; i < 5; i++) {
        await Promise.resolve();
      }

      // 释放后末值 cool 发出
      expect(api.updateUserSettings).toHaveBeenCalledTimes(2);
      expect(api.updateUserSettings).toHaveBeenLastCalledWith({ theme: "cool" });

      resolveSecondPut({
        is_custom_mode: false,
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
      for (let i = 0; i < 5; i++) {
        await Promise.resolve();
      }

      expect(useSettingsStore.getState().theme).toBe("cool");
    });

    it("TH-12: setTheme 同步订阅换号并立即选择新主题，outer A 不清除用户 B 的 pendingIntent 与计时器", async () => {
      let switched = false;
      const unsubscribe = useSettingsStore.subscribe((state) => {
        if (state.theme === "dark" && !switched) {
          switched = true;
          // 同步换号并启动 B 的 setTheme
          vi.mocked(auth.getAuthSnapshot).mockReturnValue({
            state: "authenticated",
            principal: { issuer: "urn:echotalk:auth:dev", subject: "user-b" },
          });
          vi.mocked(auth.getAuthRevision).mockReturnValue(2);

          useSettingsStore.getState().setTheme("cool");
        }
      });

      vi.mocked(api.updateUserSettings).mockResolvedValueOnce({
        is_custom_mode: false,
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

      // UI 立即对齐为 cool
      expect(useSettingsStore.getState().theme).toBe("cool");

      // 用户 B 的 300ms 防抖到期
      vi.advanceTimersByTime(300);
      for (let i = 0; i < 5; i++) {
        await Promise.resolve();
      }

      // 核心断言：用户 B 的 PUT 必须成功发出恰好 1 次，payload 为 cool，绝无 outer A 的 dark！
      expect(api.updateUserSettings).toHaveBeenCalledTimes(1);
      expect(api.updateUserSettings).toHaveBeenLastCalledWith({ theme: "cool" });

      unsubscribe();
    });

    it("TH-12: setTheme 同步订阅 reset 后同身份立即选择新主题，outer A 不清除 reset 后的新 pendingIntent", async () => {
      let switched = false;
      const unsubscribe = useSettingsStore.subscribe((state) => {
        if (state.theme === "dark" && !switched) {
          switched = true;
          useSettingsStore.getState().reset();
          useSettingsStore.getState().setTheme("cool");
        }
      });

      vi.mocked(api.updateUserSettings).mockResolvedValueOnce({
        is_custom_mode: false,
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
      expect(useSettingsStore.getState().theme).toBe("cool");

      vi.advanceTimersByTime(300);
      for (let i = 0; i < 5; i++) {
        await Promise.resolve();
      }

      // reset 后的 cool 正常发出
      expect(api.updateUserSettings).toHaveBeenCalledTimes(1);
      expect(api.updateUserSettings).toHaveBeenLastCalledWith({ theme: "cool" });

      unsubscribe();
    });
  });
});
