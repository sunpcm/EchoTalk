import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserSettingsResponse } from "@/lib/api";
import * as authModule from "@/lib/auth";
import { zhCN } from "@/i18n/zh-CN";
import { useSettingsStore } from "@/store/settings";
import { SettingsDrawer } from "./SettingsDrawer";
import * as settingsPayloadModule from "./settingsPayload";

vi.mock("@/lib/auth", () => ({
  beginLogout: vi.fn(async () => {}),
  getAuthMode: vi.fn(() => "invalid" as const),
  getAuthSnapshot: vi.fn(() => ({ state: "anonymous" as const, principal: null })),
  getAuthRevision: vi.fn(() => 1),
  arePrincipalsEqual: vi.fn(
    (
      left: { issuer: string; subject: string } | null,
      right: { issuer: string; subject: string } | null,
    ) => left?.issuer === right?.issuer && left?.subject === right?.subject,
  ),
}));

const t = zhCN.settings;

type UpdateResult = { success: boolean; error?: string };
type SettingsStoreState = ReturnType<typeof useSettingsStore.getState>;

const DEFAULT_SETTINGS: UserSettingsResponse = {
  is_custom_mode: true,
  subscription_tier: "vip",
  theme: "warm",
  stt_provider: "deepgram",
  llm_provider: "siliconflow",
  llm_model: "test-model-1",
  tts_provider: "cartesia",
  has_stt_key: true,
  has_llm_key: false,
  has_tts_key: false,
  stt_status: "verified",
  llm_status: "unconfigured",
  tts_status: "unconfigured",
};

function makeSettings(overrides: Partial<UserSettingsResponse> = {}): UserSettingsResponse {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function installStore(
  settings: UserSettingsResponse | null,
  overrides: Partial<SettingsStoreState> = {},
) {
  const fetchSettings = vi.fn().mockResolvedValue(undefined);
  const updateSettings = vi.fn().mockResolvedValue({ success: true });

  useSettingsStore.setState({
    settings,
    loading: false,
    saving: false,
    error: null,
    theme: "warm",
    fetchSettings,
    updateSettings,
    ...overrides,
  });

  const installed = useSettingsStore.getState();
  return {
    fetchSettings: installed.fetchSettings,
    updateSettings: installed.updateSettings,
  };
}

async function resolveDeferred<T>(pending: ReturnType<typeof deferred<T>>, value: T) {
  await act(async () => {
    pending.resolve(value);
    await pending.promise;
  });
}

async function rejectDeferred<T>(pending: ReturnType<typeof deferred<T>>, reason: Error) {
  await act(async () => {
    pending.reject(reason);
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("SettingsDrawer Component", () => {
  let originalShowModal: typeof HTMLDialogElement.prototype.showModal;
  let originalClose: typeof HTMLDialogElement.prototype.close;
  let originalFetchSettings: SettingsStoreState["fetchSettings"];
  let originalUpdateSettings: SettingsStoreState["updateSettings"];

  beforeEach(() => {
    const store = useSettingsStore.getState();
    originalFetchSettings = store.fetchSettings;
    originalUpdateSettings = store.updateSettings;

    originalShowModal = HTMLDialogElement.prototype.showModal;
    originalClose = HTMLDialogElement.prototype.close;

    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.open = true;
    });
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
      this.open = false;
    });

    vi.clearAllMocks();
    vi.mocked(authModule.getAuthMode).mockReset().mockReturnValue("invalid");
    vi.mocked(authModule.getAuthSnapshot).mockReset().mockReturnValue({
      state: "anonymous",
      principal: null,
    });
    vi.mocked(authModule.getAuthRevision).mockReset().mockReturnValue(1);
    vi.mocked(authModule.beginLogout).mockReset().mockResolvedValue(undefined);
    vi.mocked(authModule.arePrincipalsEqual).mockImplementation(
      (left, right) => left?.issuer === right?.issuer && left?.subject === right?.subject,
    );

    localStorage.clear();
    document.body.style.overflow = "";
    useSettingsStore.getState().reset();
    installStore(makeSettings());
  });

  afterEach(() => {
    cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();

    HTMLDialogElement.prototype.showModal = originalShowModal;
    HTMLDialogElement.prototype.close = originalClose;

    useSettingsStore.setState({
      fetchSettings: originalFetchSettings,
      updateSettings: originalUpdateSettings,
    });
    useSettingsStore.getState().reset();
    document.body.style.overflow = "";
    localStorage.clear();
  });

  it("does not render when open is false", () => {
    const { fetchSettings } = installStore(makeSettings());

    render(<SettingsDrawer open={false} onClose={vi.fn()} />);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(fetchSettings).not.toHaveBeenCalled();
  });

  it("renders the accessible native modal, locks scroll, and restores it on unmount", () => {
    const { unmount } = render(<SettingsDrawer open={true} onClose={vi.fn()} />);

    const dialog = screen.getByRole("dialog", { name: t.title });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-labelledby", "settings-drawer-title");
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledTimes(1);
    expect(document.body.style.overflow).toBe("hidden");

    unmount();

    expect(document.body.style.overflow).toBe("");
    expect(HTMLDialogElement.prototype.close).toHaveBeenCalledTimes(1);
  });

  it("closes from the close button", () => {
    const onClose = vi.fn();
    render(<SettingsDrawer open={true} onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: t.closeAriaLabel || t.close }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("runs dialog lifecycle only on open transitions and keeps the draft across theme changes and close/reopen", () => {
    const settings = makeSettings();
    const { fetchSettings, updateSettings } = installStore(settings);
    const { rerender } = render(<SettingsDrawer open={true} onClose={vi.fn()} />);

    const llmKeyInput = screen.getByLabelText(t.apiKey, { selector: "#llm-key-input" });
    fireEvent.change(llmKeyInput, { target: { value: "draft-key" } });

    act(() => {
      useSettingsStore.getState().setTheme("dark");
    });
    rerender(<SettingsDrawer open={true} onClose={vi.fn()} />);

    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledTimes(1);
    expect(llmKeyInput).toHaveValue("draft-key");
    expect(screen.getByRole("radio", { name: `${t.themeDark}${t.themeTitle}` })).toBeChecked();

    rerender(<SettingsDrawer open={false} onClose={vi.fn()} />);
    expect(screen.queryByRole("dialog")).toBeNull();

    rerender(<SettingsDrawer open={true} onClose={vi.fn()} />);

    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText(t.apiKey, { selector: "#llm-key-input" })).toHaveValue(
      "draft-key",
    );
    expect(fetchSettings).toHaveBeenCalledTimes(2);
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("preserves provider defaults, order, status, theme local-first behavior and free-account constraint", () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const { updateSettings } = installStore(
      makeSettings({
        subscription_tier: "free",
        is_custom_mode: true,
        stt_provider: null,
        llm_provider: "openrouter",
        llm_status: "error",
        tts_provider: null,
      }),
    );

    render(<SettingsDrawer open={true} onClose={vi.fn()} />);

    const sttSelect = screen.getByLabelText(t.sttProvider);
    const llmSelect = screen.getByLabelText(t.llmProvider);
    const ttsSelect = screen.getByLabelText(t.ttsProvider);

    expect(sttSelect).toHaveValue("deepgram");
    expect(llmSelect).toHaveValue("openrouter");
    expect(ttsSelect).toHaveValue("cartesia");
    expect(Array.from(sttSelect.querySelectorAll("option")).map((option) => option.value)).toEqual([
      "deepgram",
    ]);
    expect(Array.from(sttSelect.querySelectorAll("option")).map((option) => option.text)).toEqual([
      "Deepgram",
    ]);
    expect(Array.from(llmSelect.querySelectorAll("option")).map((option) => option.value)).toEqual([
      "siliconflow",
      "openrouter",
    ]);
    expect(Array.from(llmSelect.querySelectorAll("option")).map((option) => option.text)).toEqual([
      "SiliconFlow",
      "OpenRouter",
    ]);
    expect(Array.from(ttsSelect.querySelectorAll("option")).map((option) => option.value)).toEqual([
      "cartesia",
    ]);
    expect(Array.from(ttsSelect.querySelectorAll("option")).map((option) => option.text)).toEqual([
      "Cartesia",
    ]);
    expect(screen.getByText(t.statusVerified)).toBeInTheDocument();
    expect(screen.getByText(t.statusError)).toBeInTheDocument();
    expect(screen.getByText(t.statusUnconfigured)).toBeInTheDocument();
    expect(screen.getByLabelText(t.apiKey, { selector: "#stt-key-input" })).toHaveAttribute(
      "placeholder",
      t.apiKeyConfiguredPlaceholder,
    );

    fireEvent.click(screen.getByRole("switch", { name: t.customModeLabel }));
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("switch", { name: t.customModeLabel })).toBeChecked();

    fireEvent.click(screen.getByRole("radio", { name: `${t.themeCool}${t.themeTitle}` }));
    expect(screen.getByRole("radio", { name: `${t.themeCool}${t.themeTitle}` })).toBeChecked();
    expect(useSettingsStore.getState().theme).toBe("cool");
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("hydrates provider and free-text model values when the settings reference changes", () => {
    installStore(
      makeSettings({
        stt_provider: null,
        llm_provider: null,
        llm_model: null,
        tts_provider: null,
      }),
    );
    const { rerender } = render(<SettingsDrawer open={true} onClose={vi.fn()} />);

    expect(screen.getByLabelText(t.sttProvider)).toHaveValue("deepgram");
    expect(screen.getByLabelText(t.llmProvider)).toHaveValue("siliconflow");
    expect(screen.getByLabelText(t.ttsProvider)).toHaveValue("cartesia");
    expect(screen.getByLabelText(t.llmModel)).toHaveValue("");

    act(() => {
      useSettingsStore.setState({
        settings: makeSettings({
          stt_provider: "deepgram",
          llm_provider: "openrouter",
          llm_model: "custom/user-model",
          tts_provider: "cartesia",
        }),
      });
    });
    rerender(<SettingsDrawer open={true} onClose={vi.fn()} />);

    expect(screen.getByLabelText(t.sttProvider)).toHaveValue("deepgram");
    expect(screen.getByLabelText(t.llmProvider)).toHaveValue("openrouter");
    expect(screen.getByLabelText(t.ttsProvider)).toHaveValue("cartesia");
    expect(screen.getByLabelText(t.llmModel)).toHaveValue("custom/user-model");
  });

  it("uses buildSettingsUpdate and passes the exact custom-mode payload", async () => {
    const pending = deferred<UpdateResult>();
    const llmKeyDraft = "  llm-draft-value  ";
    const { updateSettings } = installStore(makeSettings(), {
      updateSettings: vi.fn(() => pending.promise),
    });
    const buildSpy = vi.spyOn(settingsPayloadModule, "buildSettingsUpdate");

    render(<SettingsDrawer open={true} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(t.apiKey, { selector: "#llm-key-input" }), {
      target: { value: llmKeyDraft },
    });
    fireEvent.click(screen.getByRole("button", { name: t.save }));

    expect(buildSpy).toHaveBeenCalledTimes(1);
    expect(buildSpy).toHaveBeenCalledWith({
      isCustomMode: true,
      sttProvider: "deepgram",
      llmProvider: "siliconflow",
      llmModel: "test-model-1",
      ttsProvider: "cartesia",
      sttKey: "",
      llmKey: llmKeyDraft,
      ttsKey: "",
    });
    expect(updateSettings).toHaveBeenCalledWith({
      is_custom_mode: true,
      stt_provider: "deepgram",
      llm_provider: "siliconflow",
      tts_provider: "cartesia",
      llm_model: "test-model-1",
      llm_key: llmKeyDraft.trim(),
    });
    expect(updateSettings).toHaveBeenCalledTimes(1);

    await resolveDeferred(pending, { success: true });
  });

  it("trims custom-mode-off payload to is_custom_mode only", () => {
    const { updateSettings } = installStore(makeSettings({ is_custom_mode: false }));

    render(<SettingsDrawer open={true} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: t.save }));

    expect(updateSettings).toHaveBeenCalledWith({ is_custom_mode: false });
  });

  it("gives every repeated error its own full three-second timer", async () => {
    vi.useFakeTimers();
    const first = deferred<UpdateResult>();
    const second = deferred<UpdateResult>();
    installStore(makeSettings(), {
      updateSettings: vi
        .fn()
        .mockImplementationOnce(() => first.promise)
        .mockImplementationOnce(() => second.promise),
    });

    render(<SettingsDrawer open={true} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: t.save }));
    await resolveDeferred(first, { success: false, error: "first-error" });
    expect(screen.getByText("first-error")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    fireEvent.click(screen.getByRole("button", { name: t.save }));
    await resolveDeferred(second, { success: false, error: "second-error" });
    expect(screen.getByText("second-error")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2999);
    });
    expect(screen.getByText("second-error")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText("second-error")).toBeNull();
  });

  it("keeps the current success notice for two seconds", async () => {
    vi.useFakeTimers();
    const pending = deferred<UpdateResult>();
    installStore(makeSettings(), { updateSettings: vi.fn(() => pending.promise) });

    render(<SettingsDrawer open={true} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: t.save }));
    await resolveDeferred(pending, { success: true });
    expect(screen.getByText(t.saveSuccess)).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1999);
    });
    expect(screen.getByText(t.saveSuccess)).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText(t.saveSuccess)).toBeNull();
  });

  it.each([
    {
      name: "an old failure",
      staleResult: { success: false, error: "old-error" },
      currentResult: { success: true },
      currentText: t.saveSuccess,
      staleText: "old-error",
    },
    {
      name: "an old success",
      staleResult: { success: true },
      currentResult: { success: false, error: "current-error" },
      currentText: "current-error",
      staleText: t.saveSuccess,
    },
  ])(
    "ignores $name after close/reopen and lets the current save recover",
    async ({ staleResult, currentResult, currentText, staleText }) => {
      vi.useFakeTimers();
      const stale = deferred<UpdateResult>();
      const current = deferred<UpdateResult>();
      installStore(makeSettings(), {
        updateSettings: vi
          .fn()
          .mockImplementationOnce(() => stale.promise)
          .mockImplementationOnce(() => current.promise),
      });

      const { rerender } = render(<SettingsDrawer open={true} onClose={vi.fn()} />);
      fireEvent.click(screen.getByRole("button", { name: t.save }));

      rerender(<SettingsDrawer open={false} onClose={vi.fn()} />);
      rerender(<SettingsDrawer open={true} onClose={vi.fn()} />);

      fireEvent.click(screen.getByRole("button", { name: t.save }));
      await resolveDeferred(current, currentResult);
      expect(screen.getByText(currentText)).toBeInTheDocument();

      await resolveDeferred(stale, staleResult);
      expect(screen.getByText(currentText)).toBeInTheDocument();
      expect(screen.queryByText(staleText)).toBeNull();
    },
  );

  it("has zero local side effects when an in-flight save settles after unmount", async () => {
    vi.useFakeTimers();
    const pending = deferred<UpdateResult>();
    installStore(makeSettings(), { updateSettings: vi.fn(() => pending.promise) });

    const { unmount } = render(<SettingsDrawer open={true} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: t.save }));
    unmount();

    await resolveDeferred(pending, { success: false, error: "late-after-unmount" });

    expect(screen.queryByText("late-after-unmount")).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("silently drops a current stale result and lets the next save show its own result", async () => {
    vi.useFakeTimers();
    const stale = deferred<UpdateResult>();
    const next = deferred<UpdateResult>();
    installStore(makeSettings(), {
      updateSettings: vi
        .fn()
        .mockImplementationOnce(() => stale.promise)
        .mockImplementationOnce(() => next.promise),
    });

    render(<SettingsDrawer open={true} onClose={vi.fn()} />);
    act(() => {
      vi.advanceTimersByTime(20);
    });

    fireEvent.click(screen.getByRole("button", { name: t.save }));
    await resolveDeferred(stale, { success: false, error: "stale" });

    expect(screen.queryByText("stale")).toBeNull();
    expect(screen.queryByText(t.saveError)).toBeNull();
    expect(vi.getTimerCount()).toBe(0);

    fireEvent.click(screen.getByRole("button", { name: t.save }));
    await resolveDeferred(next, { success: false, error: "next-error" });
    expect(screen.getByText("next-error")).toBeInTheDocument();
  });

  it("keeps a current logout failure until the next operation while ignoring a prior-cycle failure", async () => {
    vi.useFakeTimers();
    vi.mocked(authModule.getAuthMode).mockReturnValue("oidc");
    const staleLogout = deferred<void>();
    vi.mocked(authModule.beginLogout).mockImplementationOnce(() => staleLogout.promise);

    const { rerender } = render(<SettingsDrawer open={true} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: t.logout }));

    rerender(<SettingsDrawer open={false} onClose={vi.fn()} />);
    rerender(<SettingsDrawer open={true} onClose={vi.fn()} />);

    await rejectDeferred(staleLogout, new Error("late logout failure"));
    expect(screen.queryByText(t.logoutError)).toBeNull();

    const currentLogout = deferred<void>();
    vi.mocked(authModule.beginLogout).mockImplementationOnce(() => currentLogout.promise);
    fireEvent.click(screen.getByRole("button", { name: t.logout }));
    await rejectDeferred(currentLogout, new Error("current logout failure"));

    expect(screen.getByText(t.logoutError)).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.getByText(t.logoutError)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: t.save }));
    expect(screen.queryByText(t.logoutError)).toBeNull();
  });

  it("keeps the store-level error as the existing bottom error surface", () => {
    installStore(makeSettings(), { error: "store-error" });

    render(<SettingsDrawer open={true} onClose={vi.fn()} />);

    expect(screen.getByText("store-error")).toBeInTheDocument();
  });
});
