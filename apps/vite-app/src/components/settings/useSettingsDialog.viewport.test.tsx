import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserSettingsResponse } from "@/lib/api";
import * as authModule from "@/lib/auth";
import { zhCN } from "@/i18n/zh-CN";
import { useSettingsStore } from "@/store/settings";
import { SettingsDrawer } from "./SettingsDrawer";

vi.mock("@/lib/auth", () => ({
  beginLogout: vi.fn(async () => {}),
  getAuthMode: vi.fn(() => "invalid" as const),
  getAuthSnapshot: vi.fn(() => ({ state: "anonymous" as const, principal: null })),
  getAuthRevision: vi.fn(() => 1),
  subscribeAuthSnapshot: vi.fn(() => () => {}),
  arePrincipalsEqual: vi.fn(
    (
      left: { issuer: string; subject: string } | null,
      right: { issuer: string; subject: string } | null,
    ) => left?.issuer === right?.issuer && left?.subject === right?.subject,
  ),
}));

const t = zhCN.settings;
const STT_DRAFT = "synthetic-viewport-stt-draft";
const SETTINGS: UserSettingsResponse = {
  is_custom_mode: true,
  is_custom_verified: true,
  subscription_tier: "vip",
  theme: "warm",
  stt_provider: "deepgram",
  llm_provider: "siliconflow",
  llm_model: "synthetic/viewport-model",
  tts_provider: "cartesia",
  has_stt_key: true,
  has_llm_key: true,
  has_tts_key: true,
  stt_status: "verified",
  llm_status: "verified",
  tts_status: "verified",
};

type SettingsStoreState = ReturnType<typeof useSettingsStore.getState>;

let frameCallbacks = new Map<number, FrameRequestCallback>();
let nextFrameId = 1;
let resizeObserverInstances: ResizeObserverMock[] = [];
let requestAnimationFrameMock: ReturnType<typeof vi.fn>;
let cancelAnimationFrameMock: ReturnType<typeof vi.fn>;
let scrollIntoViewMock: ReturnType<typeof vi.fn>;
let originalShowModal: typeof HTMLDialogElement.prototype.showModal;
let originalClose: typeof HTMLDialogElement.prototype.close;
let originalScrollIntoView: PropertyDescriptor | undefined;
let originalVisualViewport: PropertyDescriptor | undefined;
let originalFetchSettings: SettingsStoreState["fetchSettings"];
let originalUpdateSettings: SettingsStoreState["updateSettings"];

class ResizeObserverMock implements ResizeObserver {
  readonly observedTargets = new Set<Element>();
  readonly observe = vi.fn((target: Element) => {
    this.observedTargets.add(target);
  });
  readonly unobserve = vi.fn((target: Element) => {
    this.observedTargets.delete(target);
  });
  readonly disconnect = vi.fn(() => {
    this.observedTargets.clear();
  });

  constructor(readonly callback: ResizeObserverCallback) {
    resizeObserverInstances.push(this);
  }

  emit() {
    this.callback([], this);
  }
}

class VisualViewportMock {
  readonly resizeListeners = new Set<EventListenerOrEventListenerObject>();
  readonly addEventListener = vi.fn(
    (type: string, listener: EventListenerOrEventListenerObject) => {
      if (type === "resize") this.resizeListeners.add(listener);
    },
  );
  readonly removeEventListener = vi.fn(
    (type: string, listener: EventListenerOrEventListenerObject) => {
      if (type === "resize") this.resizeListeners.delete(listener);
    },
  );

  emitResize() {
    for (const listener of this.resizeListeners) {
      if (typeof listener === "function") {
        listener(new Event("resize"));
      } else {
        listener.handleEvent(new Event("resize"));
      }
    }
  }
}

function installStore() {
  const fetchSettings = vi.fn().mockResolvedValue(undefined);
  const updateSettings = vi.fn().mockResolvedValue({ success: true });

  useSettingsStore.setState({
    settings: SETTINGS,
    loading: false,
    saving: false,
    error: null,
    theme: "warm",
    fetchSettings,
    updateSettings,
  });

  return {
    fetchSettings: useSettingsStore.getState().fetchSettings,
    updateSettings: useSettingsStore.getState().updateSettings,
  };
}

function installVisualViewport(): VisualViewportMock {
  const visualViewport = new VisualViewportMock();
  Object.defineProperty(window, "visualViewport", {
    configurable: true,
    value: visualViewport as unknown as VisualViewport,
  });
  return visualViewport;
}

function flushAnimationFrames() {
  const queued = [...frameCallbacks.entries()];
  act(() => {
    for (const [id, callback] of queued) {
      if (!frameCallbacks.delete(id)) continue;
      callback(0);
    }
  });
}

function renderOpenDrawer() {
  const view = render(<SettingsDrawer open={true} onClose={vi.fn()} />);
  flushAnimationFrames();
  return view;
}

function getScrollContainer(input: HTMLElement) {
  const scroller = input.closest<HTMLElement>(".overflow-y-auto");
  if (!scroller) throw new Error("settings scroll container missing");
  return scroller;
}

function getSingleObserver() {
  expect(resizeObserverInstances).toHaveLength(1);
  return resizeObserverInstances[0];
}

function triggerGeometryChange(observer: ResizeObserverMock, visualViewport: VisualViewportMock) {
  act(() => {
    window.dispatchEvent(new Event("resize"));
    visualViewport.emitResize();
    observer.emit();
  });
}

beforeEach(() => {
  const state = useSettingsStore.getState();
  originalFetchSettings = state.fetchSettings;
  originalUpdateSettings = state.updateSettings;
  originalShowModal = HTMLDialogElement.prototype.showModal;
  originalClose = HTMLDialogElement.prototype.close;
  originalScrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
  originalVisualViewport = Object.getOwnPropertyDescriptor(window, "visualViewport");

  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.open = true;
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.open = false;
  });

  frameCallbacks = new Map();
  nextFrameId = 1;
  resizeObserverInstances = [];
  requestAnimationFrameMock = vi.fn((callback: FrameRequestCallback) => {
    const id = nextFrameId++;
    frameCallbacks.set(id, callback);
    return id;
  });
  cancelAnimationFrameMock = vi.fn((id: number) => {
    frameCallbacks.delete(id);
  });
  vi.stubGlobal("requestAnimationFrame", requestAnimationFrameMock);
  vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrameMock);
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);

  scrollIntoViewMock = vi.fn();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    writable: true,
    value: scrollIntoViewMock,
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

  document.body.style.overflow = "";
  useSettingsStore.getState().reset();
  installStore();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();

  HTMLDialogElement.prototype.showModal = originalShowModal;
  HTMLDialogElement.prototype.close = originalClose;
  if (originalScrollIntoView) {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", originalScrollIntoView);
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  }
  if (originalVisualViewport) {
    Object.defineProperty(window, "visualViewport", originalVisualViewport);
  } else {
    Reflect.deleteProperty(window, "visualViewport");
  }

  useSettingsStore.setState({
    fetchSettings: originalFetchSettings,
    updateSettings: originalUpdateSettings,
  });
  useSettingsStore.getState().reset();
  document.body.style.overflow = "";
});

describe("useSettingsDialog viewport resource lifecycle", () => {
  it("coalesces window, visualViewport, and observer signals into one reveal", () => {
    const visualViewport = installVisualViewport();
    const { updateSettings } = installStore();
    renderOpenDrawer();

    const input = screen.getByLabelText(t.apiKey, { selector: "#stt-key-input" });
    const scroller = getScrollContainer(input);
    const observer = getSingleObserver();
    expect(observer.observe).toHaveBeenCalledTimes(1);
    expect(observer.observedTargets).toEqual(new Set([scroller]));
    expect(visualViewport.resizeListeners.size).toBe(1);

    fireEvent.change(input, { target: { value: STT_DRAFT } });
    act(() => input.focus());
    triggerGeometryChange(observer, visualViewport);

    expect(frameCallbacks.size).toBe(1);
    expect(scrollIntoViewMock).not.toHaveBeenCalled();
    flushAnimationFrames();

    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
    expect(scrollIntoViewMock).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
    expect(input).toHaveFocus();
    expect(input).toHaveValue(STT_DRAFT);
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("reveals only the current input when focus changes before the queued frame", () => {
    const visualViewport = installVisualViewport();
    renderOpenDrawer();

    const sttInput = screen.getByLabelText(t.apiKey, { selector: "#stt-key-input" });
    const llmInput = screen.getByLabelText(t.apiKey, { selector: "#llm-key-input" });
    const observer = getSingleObserver();

    act(() => sttInput.focus());
    act(() => window.dispatchEvent(new Event("resize")));
    expect(sttInput).toHaveFocus();
    expect(frameCallbacks.size).toBe(1);

    act(() => llmInput.focus());
    flushAnimationFrames();

    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
    expect(scrollIntoViewMock).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
    expect(scrollIntoViewMock.mock.contexts[0]).toBe(llmInput);
    expect(llmInput).toHaveFocus();
    expect(sttInput).not.toHaveFocus();
    expect(observer.observedTargets).toContain(sttInput.closest(".overflow-y-auto"));
    expect(visualViewport.resizeListeners.size).toBe(1);
  });

  it("does not reveal focus that belongs outside the current settings scroll area", () => {
    const visualViewport = installVisualViewport();
    renderOpenDrawer();

    const input = screen.getByLabelText(t.apiKey, { selector: "#stt-key-input" });
    const observer = getSingleObserver();
    const closeButton = screen.getByRole("button", { name: t.closeAriaLabel || t.close });
    expect(input).not.toHaveFocus();
    expect(closeButton).toHaveFocus();

    triggerGeometryChange(observer, visualViewport);
    flushAnimationFrames();

    expect(scrollIntoViewMock).not.toHaveBeenCalled();
  });

  it.each(["close", "unmount"] as const)(
    "removes resources and ignores late callbacks on %s",
    (lifecycle) => {
      const visualViewport = installVisualViewport();
      const windowRemoveSpy = vi.spyOn(window, "removeEventListener");
      const { rerender, unmount } = renderOpenDrawer();
      const input = screen.getByLabelText(t.apiKey, { selector: "#stt-key-input" });
      const observer = getSingleObserver();
      const [visualResizeListener] = [...visualViewport.resizeListeners];

      act(() => input.focus());
      act(() => window.dispatchEvent(new Event("resize")));
      expect(frameCallbacks.size).toBe(1);
      const [pendingFrameId] = [...frameCallbacks.keys()];

      if (lifecycle === "close") {
        rerender(<SettingsDrawer open={false} onClose={vi.fn()} />);
      } else {
        unmount();
      }

      expect(observer.disconnect).toHaveBeenCalledTimes(1);
      expect(visualViewport.resizeListeners.size).toBe(0);
      expect(windowRemoveSpy).toHaveBeenCalledWith("resize", expect.any(Function));
      expect(cancelAnimationFrameMock).toHaveBeenCalledWith(pendingFrameId);
      expect(frameCallbacks.size).toBe(0);

      act(() => {
        observer.emit();
        if (typeof visualResizeListener === "function") {
          visualResizeListener(new Event("resize"));
        }
        window.dispatchEvent(new Event("resize"));
      });
      flushAnimationFrames();
      expect(frameCallbacks.size).toBe(0);
      expect(scrollIntoViewMock).not.toHaveBeenCalled();
    },
  );

  it("falls back safely when visualViewport or ResizeObserver is unavailable", () => {
    const visualViewport = installVisualViewport();
    vi.stubGlobal("ResizeObserver", undefined);
    renderOpenDrawer();

    const input = screen.getByLabelText(t.apiKey, { selector: "#stt-key-input" });
    fireEvent.change(input, { target: { value: STT_DRAFT } });
    act(() => input.focus());
    act(() => window.dispatchEvent(new Event("resize")));

    expect(frameCallbacks.size).toBe(1);
    flushAnimationFrames();
    expect(scrollIntoViewMock).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
    expect(input).toHaveFocus();
    expect(input).toHaveValue(STT_DRAFT);

    cleanup();
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: undefined,
    });
    visualViewport.resizeListeners.clear();
    scrollIntoViewMock.mockClear();

    renderOpenDrawer();
    const fallbackInput = screen.getByLabelText(t.apiKey, { selector: "#stt-key-input" });
    act(() => fallbackInput.focus());
    act(() => window.dispatchEvent(new Event("resize")));
    flushAnimationFrames();
    expect(scrollIntoViewMock).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
  });

  it("leaves only one active resource set after StrictMode replay and cleans it on unmount", () => {
    const visualViewport = installVisualViewport();
    const { unmount } = render(
      <StrictMode>
        <SettingsDrawer open={true} onClose={vi.fn()} />
      </StrictMode>,
    );

    expect(resizeObserverInstances.length).toBeGreaterThanOrEqual(2);
    expect(resizeObserverInstances[0].disconnect).toHaveBeenCalledTimes(1);
    expect(
      resizeObserverInstances.filter((observer) => observer.observedTargets.size === 1),
    ).toHaveLength(1);
    expect(visualViewport.resizeListeners.size).toBe(1);

    unmount();

    expect(
      resizeObserverInstances.filter((observer) => observer.observedTargets.size === 1),
    ).toHaveLength(0);
    expect(visualViewport.resizeListeners.size).toBe(0);
  });
});
