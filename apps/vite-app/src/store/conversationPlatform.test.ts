import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import * as auth from "@/lib/auth";
import { zhCN } from "@/i18n/zh-CN";
import { useAppStore } from "./appStore";
import { createFakeApp, installPlatformLifecycle } from "./conversationLifecycle.test-support";

vi.mock("@/lib/api", async (importOriginal) => {
  const { ApiError } = await importOriginal<typeof import("@/lib/api")>();
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return {
    ApiError,
    getCallCapabilities: vi.fn(),
    checkHealthReady: vi.fn(),
    createSession: vi.fn(),
    getSessionDetail: vi.fn(),
    getSessionToken: vi.fn(),
    endSession: vi.fn(),
    isValidUuid: vi.fn(
      (val: unknown): val is string => typeof val === "string" && UUID_REGEX.test(val),
    ),
  };
});

vi.mock("@/lib/auth", () => ({
  getAuthSnapshot: vi.fn(),
  getAuthRevision: vi.fn(),
  arePrincipalsEqual: vi.fn(
    (a: unknown, b: unknown) =>
      a === b ||
      (!!a &&
        !!b &&
        (a as { issuer: string }).issuer === (b as { issuer: string }).issuer &&
        (a as { subject: string }).subject === (b as { subject: string }).subject),
  ),
  subscribeAuthSnapshot: vi.fn(() => () => {}),
}));

const principal = { issuer: "https://auth.example.com", subject: "platform-owner" };
const disabled = { protocol_version: 1, call_lease_mode: "disabled" } as const;
const validUuid = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const validOrigin = { principal, revision: 1 };

function activeSession(id = "sess-platform-1"): api.Session {
  return {
    id,
    user_id: "u1",
    mode: "free_talk",
    status: "active",
    started_at: "2026-11-16T00:00:00Z",
    ended_at: null,
    transcripts: [],
  };
}

function webFastPathOptions() {
  return {
    window: { addEventListener: vi.fn(), removeEventListener: vi.fn() },
    document: {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      visibilityState: "unknown",
    },
    navigator: {},
  };
}

beforeEach(() => {
  useAppStore.getState().goHome();
  vi.clearAllMocks();
  vi.mocked(auth.getAuthSnapshot).mockReturnValue({ state: "authenticated", principal });
  vi.mocked(auth.getAuthRevision).mockReturnValue(1);
  vi.mocked(api.getCallCapabilities).mockResolvedValue(disabled);
  vi.mocked(api.checkHealthReady).mockResolvedValue({ status: "ready" });
  vi.mocked(api.createSession).mockResolvedValue(activeSession());
  vi.mocked(api.getSessionDetail).mockResolvedValue(activeSession(validUuid));
  vi.mocked(api.getSessionToken).mockResolvedValue({
    token: "tok-platform",
    ws_url: "wss://lk.test",
  });
  vi.mocked(api.endSession).mockResolvedValue({ ...activeSession(), status: "ended" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  useAppStore.getState().goHome();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("appStore startup/resume platform boundary (real adapters)", () => {
  it("iOS start keeps pending with zero downstream calls and proceeds once native active", async () => {
    let resolveGetState!: (state: { isActive: boolean }) => void;
    const fakeApp = createFakeApp();
    fakeApp.getState.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveGetState = resolve;
        }),
    );
    installPlatformLifecycle({ platform: "ios", app: fakeApp });

    const pending = useAppStore.getState().startSession("free_talk");
    await vi.waitFor(() =>
      expect(fakeApp.addListener).toHaveBeenCalledWith("appStateChange", expect.any(Function)),
    );
    expect(useAppStore.getState().connectionState).toBe("checking_health");
    expect(api.getCallCapabilities).not.toHaveBeenCalled();
    expect(api.createSession).not.toHaveBeenCalled();

    resolveGetState({ isActive: true });
    await pending;
    expect(api.getCallCapabilities).toHaveBeenCalledTimes(1);
    expect(api.createSession).toHaveBeenCalledWith("free_talk", undefined);
    expect(useAppStore.getState().connectionState).toBe("connecting");
  });

  it("iOS resume keeps pending with zero downstream calls and proceeds once native active", async () => {
    let resolveGetState!: (state: { isActive: boolean }) => void;
    const fakeApp = createFakeApp();
    fakeApp.getState.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveGetState = resolve;
        }),
    );
    installPlatformLifecycle({ platform: "ios", app: fakeApp });

    const pending = useAppStore.getState().resumeSession(validUuid, validOrigin);
    await vi.waitFor(() =>
      expect(fakeApp.addListener).toHaveBeenCalledWith("appStateChange", expect.any(Function)),
    );
    expect(useAppStore.getState().connectionState).toBe("checking_health");
    expect(api.getCallCapabilities).not.toHaveBeenCalled();
    expect(api.getSessionDetail).not.toHaveBeenCalled();

    resolveGetState({ isActive: true });
    const result = await pending;
    expect(result).toBe(true);
    expect(api.getCallCapabilities).toHaveBeenCalledTimes(1);
    expect(api.getSessionDetail).toHaveBeenCalledWith(validUuid);
    expect(api.createSession).not.toHaveBeenCalled();
    expect(useAppStore.getState().connectionState).toBe("connecting");
  });

  it("iOS fails closed after native readiness timeout without downstream calls", async () => {
    vi.useFakeTimers();
    try {
      const fakeApp = createFakeApp();
      fakeApp.getState.mockImplementation(() => new Promise(() => {}));
      installPlatformLifecycle({ platform: "ios", app: fakeApp });

      const pending = useAppStore.getState().resumeSession(validUuid, validOrigin);
      await vi.advanceTimersByTimeAsync(10000);
      const result = await pending;

      expect(result).toBe(false);
      expect(useAppStore.getState().connectionState).toBe("idle");
      expect(useAppStore.getState().error).toBe(zhCN.conversation.lifecycleUnavailable);
      expect(api.getCallCapabilities).not.toHaveBeenCalled();
      expect(api.getSessionDetail).not.toHaveBeenCalled();
      expect(fakeApp.removeMock).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("Web start uses the fast path with unknown visibility and null online", async () => {
    installPlatformLifecycle({ platform: "web", webOptions: webFastPathOptions() });

    await useAppStore.getState().startSession("free_talk");

    expect(api.createSession).toHaveBeenCalled();
    expect(useAppStore.getState().connectionState).toBe("connecting");
  });

  it("Web hidden or offline refuses to start with lifecycleUnavailable", async () => {
    installPlatformLifecycle({
      platform: "web",
      webOptions: {
        window: { addEventListener: vi.fn(), removeEventListener: vi.fn() },
        document: {
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          visibilityState: "hidden",
        },
        navigator: { onLine: true },
      },
    });

    await useAppStore.getState().startSession("free_talk");

    expect(api.getCallCapabilities).not.toHaveBeenCalled();
    expect(useAppStore.getState().connectionState).toBe("idle");
    expect(useAppStore.getState().error).toBe(zhCN.conversation.lifecycleUnavailable);
  });

  it("reads platform per call, not cached from store construction", async () => {
    const controller = installPlatformLifecycle({
      platform: "web",
      webOptions: webFastPathOptions(),
    });

    await useAppStore.getState().startSession("free_talk");
    expect(useAppStore.getState().connectionState).toBe("connecting");

    useAppStore.getState().goHome();
    const fakeApp = createFakeApp(true);
    controller.setPlatform("ios");
    controller.setApp(fakeApp);

    await useAppStore.getState().startSession("free_talk");
    expect(fakeApp.addListener).toHaveBeenCalledWith("appStateChange", expect.any(Function));
    expect(useAppStore.getState().connectionState).toBe("connecting");
  });
});
