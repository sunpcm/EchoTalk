import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import * as auth from "@/lib/auth";
import * as platform from "@/platform";
import { zhCN } from "@/i18n/zh-CN";
import { useAppStore } from "./appStore";
import { _setLifecycleOptionsForTesting } from "./conversation";
import {
  createConversationStartup,
  type ActiveStartupTracker,
  type StartupPorts,
} from "./conversationStartup";
import {
  createIdleConversationSessionState,
  reduceConversationSession,
  type ConversationSessionEvent,
  type ConversationSessionState,
} from "./conversationState";

vi.mock("@/lib/api", async (importOriginal) => {
  const { ApiError } = await importOriginal<typeof import("@/lib/api")>();
  return {
    ApiError,
    getCallCapabilities: vi.fn(),
    checkHealthReady: vi.fn(),
    createSession: vi.fn(),
    getSessionDetail: vi.fn(),
    getSessionToken: vi.fn(),
    endSession: vi.fn(),
    isValidUuid: vi.fn(
      (value: unknown): value is string =>
        typeof value === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value),
    ),
  };
});

const authEvents = vi.hoisted(() => ({
  listeners: new Set<(snapshot: auth.AuthSnapshot) => void>(),
}));
vi.mock("@/lib/auth", () => ({
  getAuthSnapshot: vi.fn(),
  getAuthRevision: vi.fn(),
  arePrincipalsEqual: vi.fn(
    (left: auth.AuthPrincipal | null, right: auth.AuthPrincipal | null) =>
      left === right ||
      Boolean(left && right && left.issuer === right.issuer && left.subject === right.subject),
  ),
  subscribeAuthSnapshot: vi.fn((listener: (snapshot: auth.AuthSnapshot) => void) => {
    authEvents.listeners.add(listener);
    return () => authEvents.listeners.delete(listener);
  }),
}));

const principal = { issuer: "https://auth.example.com", subject: "startup-owner" };
const disabled = { protocol_version: 1, call_lease_mode: "disabled" } as const;
function session(id = "00000000-0000-4000-8000-000000000001"): api.Session {
  return {
    id,
    user_id: "00000000-0000-4000-8000-000000000002",
    mode: "free_talk",
    status: "active",
    started_at: "2026-11-15T00:00:00Z",
    ended_at: null,
    transcripts: [],
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function adapterFixture(visibility: platform.WebLifecycleVisibility = "unknown") {
  let snapshot: platform.WebLifecycleSnapshot = { visibility, online: null };
  const ready = deferred<void>();
  const listeners = new Set<(event: platform.WebLifecycleEvent) => void>();
  const unsubscribe = vi.fn();
  const adapter = {
    capabilities: { webEvents: true, nativeAppState: false },
    getSnapshot: vi.fn(() => snapshot),
    whenReady: vi.fn(() => ready.promise),
    subscribe: vi.fn((listener: (event: platform.WebLifecycleEvent) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        unsubscribe();
      };
    }),
    dispose: vi.fn(),
  } satisfies platform.LifecycleAdapter;
  return {
    adapter,
    ready,
    unsubscribe,
    setVisible() {
      snapshot = { visibility: "visible", online: true };
    },
  };
}

const cleanups: Array<() => void> = [];
function startupFixture() {
  let state: {
    sessionGen: number;
    _sessionState: ConversationSessionState;
    error?: string | null;
    readinessNotice?: boolean;
    selectedScenario?: unknown;
    shell?: string;
  } = { sessionGen: 0, _sessionState: createIdleConversationSessionState() };
  let tracker: ActiveStartupTracker | null = null;
  let revision = 1;
  let options: platform.LifecycleOptions | null = null;
  let native = false;
  let afterEmit: (event: ConversationSessionEvent) => void = () => {};
  const life = adapterFixture();
  const events: Array<{ event: ConversationSessionEvent; phase: string; shell?: string }> = [];
  const authListeners = new Set<(snapshot: auth.AuthSnapshot) => void>();
  const unsubscribeAuth = vi.fn();
  const apiPorts = {
    getCallCapabilities: vi
      .fn<StartupPorts["api"]["getCallCapabilities"]>()
      .mockResolvedValue(disabled),
    checkHealthReady: vi
      .fn<StartupPorts["api"]["checkHealthReady"]>()
      .mockResolvedValue({ status: "ready" }),
    createSession: vi.fn<StartupPorts["api"]["createSession"]>().mockResolvedValue(session()),
    getSessionToken: vi
      .fn<StartupPorts["api"]["getSessionToken"]>()
      .mockResolvedValue({ token: "token", ws_url: "wss://test" }),
    endSession: vi.fn<StartupPorts["api"]["endSession"]>().mockResolvedValue({
      ...session(),
      status: "ended",
    }),
  };
  const ports = {
    get: vi.fn(() => state),
    emit: vi.fn((event: ConversationSessionEvent, extra?: () => object) => {
      state = {
        ...state,
        _sessionState: reduceConversationSession(state._sessionState, event),
        ...extra?.(),
      };
      events.push({ event, phase: state._sessionState.phase, shell: state.shell });
      afterEmit(event);
    }),
    readTracker: vi.fn(() => tracker),
    writeTracker: vi.fn((value: ActiveStartupTracker | null) => {
      tracker = value;
    }),
    clearReadinessWatch: vi.fn(),
    watchReadinessAuth: vi.fn(),
    auth: {
      getAuthSnapshot: vi.fn<StartupPorts["auth"]["getAuthSnapshot"]>(() => ({
        state: "authenticated",
        principal,
      })),
      getAuthRevision: vi.fn(() => revision),
      arePrincipalsEqual: vi.fn<StartupPorts["auth"]["arePrincipalsEqual"]>(
        (a, b) => a?.issuer === b?.issuer && a?.subject === b?.subject,
      ),
      subscribeAuthSnapshot: vi.fn((listener: (snapshot: auth.AuthSnapshot) => void) => {
        authListeners.add(listener);
        return () => {
          authListeners.delete(listener);
          unsubscribeAuth();
        };
      }),
    },
    getLifecycleOptions: vi.fn(() => options),
    createLifecycleAdapter: vi.fn<StartupPorts["createLifecycleAdapter"]>(() => life.adapter),
    isNativeIos: vi.fn(() => native),
    api: apiPorts,
    beginConnectingPatch: vi.fn(() => ({ shell: "session" })),
    startupClosedPatch: vi.fn(() => ({ shell: "dashboard" })),
    classifyPracticeReadiness: vi.fn<StartupPorts["classifyPracticeReadiness"]>(() => ({
      code: "unknown",
      message: "safe readiness",
      canOpenSettings: false,
    })),
    resolveStartErrorMessage: vi.fn(() => zhCN.conversation.startFailed),
    messages: vi.fn(() => zhCN.conversation),
  } satisfies StartupPorts;
  cleanups.push(() => tracker?.cleanup());
  return {
    ports,
    life,
    events,
    unsubscribeAuth,
    state: () => state,
    tracker: () => tracker,
    setOptions: (value: platform.LifecycleOptions | null) => {
      options = value;
    },
    setNative: () => {
      native = true;
    },
    invalidateAuth: () => {
      revision++;
    },
    afterEmit: (callback: typeof afterEmit) => {
      afterEmit = callback;
    },
    cancelGeneration: () => {
      state = {
        ...state,
        sessionGen: state.sessionGen + 1,
        _sessionState: createIdleConversationSessionState(),
      };
    },
  };
}

beforeEach(() => {
  useAppStore.getState().goHome();
  vi.clearAllMocks();
  authEvents.listeners.clear();
  _setLifecycleOptionsForTesting(null);
  vi.mocked(auth.getAuthSnapshot).mockReturnValue({ state: "authenticated", principal });
  vi.mocked(auth.getAuthRevision).mockReturnValue(1);
  vi.mocked(api.getCallCapabilities).mockResolvedValue(disabled);
  vi.mocked(api.checkHealthReady).mockResolvedValue({ status: "ready" });
  vi.mocked(api.createSession).mockResolvedValue(session());
  vi.mocked(api.getSessionToken).mockResolvedValue({ token: "token", ws_url: "wss://test" });
  vi.mocked(api.endSession).mockResolvedValue({ ...session(), status: "ended" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  useAppStore.getState().goHome();
  for (const cleanup of cleanups.splice(0)) cleanup();
  _setLifecycleOptionsForTesting(null);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("createConversationStartup direct contract", () => {
  it("constructs without even reading a port, calling a dependency, or scheduling a timer", () => {
    const h = startupFixture();
    const reads: PropertyKey[] = [];
    const timeout = vi.spyOn(globalThis, "setTimeout");
    const interval = vi.spyOn(globalThis, "setInterval");
    const ports = new Proxy(h.ports, {
      get(target, key, receiver) {
        reads.push(key);
        return Reflect.get(target, key, receiver);
      },
    });
    expect(createConversationStartup(ports)).toBeTypeOf("function");
    expect(reads).toEqual([]);
    expect(timeout).not.toHaveBeenCalled();
    expect(interval).not.toHaveBeenCalled();
  });

  it("keeps the Web prefix synchronous and preserves API arguments, order and atomic connecting patch", async () => {
    const h = startupFixture();
    const run = createConversationStartup(h.ports);
    const capabilities =
      deferred<Awaited<ReturnType<StartupPorts["api"]["getCallCapabilities"]>>>();
    h.ports.api.getCallCapabilities.mockReturnValue(capabilities.promise);
    const doc: api.DocContext = {
      content_type: "text/markdown",
      prompt: "Discuss",
      raw_text: "Text",
    };
    const pending = run("doc_chat", doc);
    expect(h.state()).toMatchObject({ sessionGen: 1, _sessionState: { phase: "checking_health" } });
    expect(h.ports.api.getCallCapabilities).toHaveBeenCalledTimes(1);
    expect(h.life.adapter.whenReady).not.toHaveBeenCalled();
    expect(h.ports.api.checkHealthReady).not.toHaveBeenCalled();
    await run("free_talk");
    expect(h.ports.createLifecycleAdapter).toHaveBeenCalledTimes(1);
    capabilities.resolve(disabled);
    await pending;
    expect(h.ports.api.getCallCapabilities.mock.calls).toEqual([[]]);
    expect(h.ports.api.checkHealthReady.mock.calls).toEqual([[]]);
    expect(h.ports.api.createSession.mock.calls).toEqual([["doc_chat", doc]]);
    expect(h.ports.api.getSessionToken.mock.calls).toEqual([[session().id]]);
    const apiOrder = [
      h.ports.api.getCallCapabilities,
      h.ports.api.checkHealthReady,
      h.ports.api.createSession,
      h.ports.api.getSessionToken,
    ].map((fn) => fn.mock.invocationCallOrder[0]);
    expect(apiOrder).toEqual([...apiOrder].sort((a, b) => a - b));
    expect(h.events.map(({ event }) => event.type)).toEqual([
      "begin_checking",
      "begin_connecting",
      "session_created",
      "credentials_ready",
    ]);
    expect(h.events[1]).toMatchObject({ phase: "creating_session", shell: "session" });
    expect(h.state()._sessionState).toEqual({
      phase: "credentials_ready",
      sessionId: session().id,
      token: "token",
      wsUrl: "wss://test",
    });
    expect(h.ports.api.endSession).not.toHaveBeenCalled();
    expect(h.life.adapter.dispose).toHaveBeenCalledTimes(1);
    expect(h.unsubscribeAuth).toHaveBeenCalledTimes(1);
    expect(h.life.unsubscribe).toHaveBeenCalledTimes(1);
    expect(h.tracker()).toBeNull();
  });

  it("rechecks auth immediately after the synchronous slot write, before creating any adapter", async () => {
    const h = startupFixture();
    h.afterEmit((event) => {
      if (event.type === "begin_checking") h.invalidateAuth();
    });
    await createConversationStartup(h.ports)("free_talk");
    expect(h.state()._sessionState.phase).toBe("idle");
    expect(h.ports.createLifecycleAdapter).not.toHaveBeenCalled();
    expect(h.ports.auth.subscribeAuthSnapshot).not.toHaveBeenCalled();
    expect(h.ports.api.getCallCapabilities).not.toHaveBeenCalled();
  });

  it("reads replaced lifecycle options and API ports after construction, and waits for native readiness", async () => {
    const h = startupFixture();
    const run = createConversationStartup(h.ports);
    const options: platform.LifecycleOptions = { platform: "ios" };
    h.setOptions(options);
    h.setNative();
    h.ports.api.getCallCapabilities = vi
      .fn<StartupPorts["api"]["getCallCapabilities"]>()
      .mockResolvedValue(disabled);
    const pending = run("free_talk");
    expect(h.ports.createLifecycleAdapter.mock.calls).toEqual([[options]]);
    expect(h.life.adapter.whenReady).toHaveBeenCalledTimes(1);
    expect(h.ports.api.getCallCapabilities).not.toHaveBeenCalled();
    h.life.setVisible();
    h.life.ready.resolve();
    await pending;
    expect(h.state()._sessionState.phase).toBe("credentials_ready");
    expect(h.ports.api.getCallCapabilities).toHaveBeenCalledTimes(1);
  });

  it("keeps a pending native startup alive at 9999ms and closes it at exactly 10000ms", async () => {
    const h = startupFixture();
    const run = createConversationStartup(h.ports);
    vi.useFakeTimers();
    h.setNative();
    const pending = run("free_talk");
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(9999);
    expect(h.state()._sessionState.phase).toBe("checking_health");
    expect(h.life.adapter.dispose).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(h.state()).toMatchObject({
      _sessionState: { phase: "idle" },
      error: zhCN.conversation.lifecycleUnavailable,
    });
    expect(h.ports.api.getCallCapabilities).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(h.life.adapter.dispose).toHaveBeenCalledTimes(1);
  });

  it("blocks non-disabled call capabilities before health or credentials", async () => {
    const h = startupFixture();
    h.ports.api.getCallCapabilities.mockResolvedValue({
      protocol_version: 1,
      call_lease_mode: "livekit_cloud",
    });
    await createConversationStartup(h.ports)("free_talk");
    expect(h.state()).toMatchObject({
      _sessionState: { phase: "idle" },
      error: zhCN.conversation.capabilitiesUnsupported,
    });
    expect(h.ports.api.checkHealthReady).not.toHaveBeenCalled();
    expect(h.ports.api.createSession).not.toHaveBeenCalled();
    expect(h.ports.api.getSessionToken).not.toHaveBeenCalled();
  });

  it("stops a readiness-only success before create/token and installs its separate auth watcher", async () => {
    const h = startupFixture();
    await createConversationStartup(h.ports)("doc_chat", undefined, true);
    expect(h.state()).toMatchObject({
      _sessionState: { phase: "idle" },
      readinessNotice: true,
      selectedScenario: null,
    });
    expect(h.ports.api.checkHealthReady).toHaveBeenCalledTimes(1);
    expect(h.ports.api.createSession).not.toHaveBeenCalled();
    expect(h.ports.api.getSessionToken).not.toHaveBeenCalled();
    expect(h.ports.watchReadinessAuth).toHaveBeenCalledWith(principal, 1, 1);
    expect(h.tracker()).toBeNull();
  });

  it.each(["rejection", "blank credentials"])(
    "compensates the current session once for token %s",
    async (failure) => {
      const h = startupFixture();
      if (failure === "rejection")
        h.ports.api.getSessionToken.mockRejectedValue(new Error("private token error"));
      else h.ports.api.getSessionToken.mockResolvedValue({ token: " ", ws_url: "wss://test" });
      await createConversationStartup(h.ports)("free_talk");
      expect(h.ports.api.endSession.mock.calls).toEqual([[session().id]]);
      expect(h.state()).toMatchObject({
        _sessionState: { phase: "idle" },
        error: zhCN.conversation.startFailed,
      });
      expect(h.life.adapter.dispose).toHaveBeenCalledTimes(1);
      expect(h.tracker()).toBeNull();
    },
  );

  it("drops a cancelled late create without changing the existing compensation policy", async () => {
    const h = startupFixture();
    const created = deferred<api.Session>();
    h.ports.api.createSession.mockReturnValueOnce(created.promise);
    const pending = createConversationStartup(h.ports)("free_talk");
    await vi.waitFor(() => expect(h.ports.api.createSession).toHaveBeenCalledTimes(1));
    h.cancelGeneration();
    created.resolve(session());
    await pending;
    expect(h.state()._sessionState.phase).toBe("idle");
    expect(h.ports.api.getSessionToken).not.toHaveBeenCalled();
    expect(h.ports.api.endSession).not.toHaveBeenCalled();
    expect(h.life.adapter.dispose).toHaveBeenCalledTimes(1);
  });

  it("does not let an old tracker or its late native result release the new tracker, timer or adapter", async () => {
    vi.useFakeTimers();
    const h = startupFixture();
    h.setNative();
    const next = adapterFixture("hidden");
    h.ports.createLifecycleAdapter
      .mockReturnValueOnce(h.life.adapter)
      .mockReturnValueOnce(next.adapter);
    const run = createConversationStartup(h.ports);
    const first = run("free_talk");
    const oldTracker = h.tracker()!;
    h.cancelGeneration();
    const second = run("scenario");
    const newTracker = h.tracker();
    expect(newTracker).not.toBe(oldTracker);
    expect(vi.getTimerCount()).toBe(1);
    oldTracker.cleanup();
    h.life.ready.resolve();
    await first;
    expect(h.tracker()).toBe(newTracker);
    expect(next.adapter.dispose).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
    expect(h.ports.api.getCallCapabilities).not.toHaveBeenCalled();
    next.setVisible();
    next.ready.resolve();
    await second;
    expect(h.state()._sessionState.phase).toBe("credentials_ready");
    expect(h.life.adapter.dispose).toHaveBeenCalledTimes(1);
    expect(next.adapter.dispose).toHaveBeenCalledTimes(1);
    expect(h.ports.api.getCallCapabilities).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not clear a newer register installed synchronously while disposing the old adapter", async () => {
    const h = startupFixture();
    const next = adapterFixture();
    const oldCapabilities =
      deferred<Awaited<ReturnType<StartupPorts["api"]["getCallCapabilities"]>>>();
    h.ports.api.getCallCapabilities.mockReturnValueOnce(oldCapabilities.promise);
    h.ports.createLifecycleAdapter
      .mockReturnValueOnce(h.life.adapter)
      .mockReturnValueOnce(next.adapter);
    const run = createConversationStartup(h.ports);
    const first = run("free_talk");
    const oldTracker = h.tracker()!;
    let second: Promise<void> | undefined;
    let newTracker: ActiveStartupTracker | null = null;
    h.life.adapter.dispose.mockImplementation(() => {
      h.cancelGeneration();
      second = run("scenario");
      newTracker = h.tracker();
    });
    oldTracker.cleanup();
    expect(newTracker).not.toBeNull();
    expect(h.tracker()).toBe(newTracker);
    expect(next.adapter.dispose).not.toHaveBeenCalled();
    oldCapabilities.resolve(disabled);
    await Promise.all([first, second]);
    expect(h.state()._sessionState.phase).toBe("credentials_ready");
    expect(h.ports.api.createSession.mock.calls).toEqual([["scenario", undefined]]);
    expect(h.life.adapter.dispose).toHaveBeenCalledTimes(1);
    expect(next.adapter.dispose).toHaveBeenCalledTimes(1);
  });
});

describe("real appStore slice wiring through original barrels", () => {
  it("reads options separately at adapter creation and iOS detection after the store already exists", async () => {
    const life = adapterFixture("hidden");
    const webOptions: platform.LifecycleOptions = { platform: "web" };
    _setLifecycleOptionsForTesting(webOptions);
    const createAdapter = vi.spyOn(platform, "createLifecycleAdapter").mockImplementation(() => {
      _setLifecycleOptionsForTesting({ platform: "ios" });
      return life.adapter;
    });
    const pending = useAppStore.getState().startSession("free_talk");
    expect(createAdapter.mock.calls).toEqual([[webOptions]]);
    expect(life.adapter.whenReady).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().connectionState).toBe("checking_health");
    expect(api.getCallCapabilities).not.toHaveBeenCalled();
    life.setVisible();
    life.ready.resolve();
    await pending;
    expect(api.createSession).toHaveBeenCalledWith("free_talk", undefined);
    expect(useAppStore.getState()).toMatchObject({
      connectionState: "connecting",
      token: "token",
      wsUrl: "wss://test",
    });
    expect(life.adapter.dispose).toHaveBeenCalledTimes(1);
  });

  it("handles a real synchronous store subscriber changing auth before any adapter side effect", async () => {
    const life = adapterFixture();
    const createAdapter = vi
      .spyOn(platform, "createLifecycleAdapter")
      .mockReturnValue(life.adapter);
    const unsubscribe = useAppStore.subscribe((state) => {
      if (state.connectionState === "checking_health")
        vi.mocked(auth.getAuthRevision).mockReturnValue(2);
    });
    try {
      await useAppStore.getState().startSession("free_talk");
      expect(useAppStore.getState().connectionState).toBe("idle");
      expect(createAdapter).not.toHaveBeenCalled();
      expect(api.getCallCapabilities).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });

  it("keeps the readiness auth observer alive after startup cleanup and clears it on auth loss", async () => {
    const initialLife = adapterFixture();
    const life = adapterFixture();
    vi.spyOn(platform, "createLifecycleAdapter")
      .mockReturnValueOnce(initialLife.adapter)
      .mockReturnValue(life.adapter);
    vi.mocked(api.checkHealthReady).mockRejectedValueOnce(
      new api.ApiError(503, "private readiness error", {
        detail: { status: "not_ready", code: "settings_required", errors: { config: "private" } },
      }),
    );
    await useAppStore.getState().startSession("free_talk");
    expect(useAppStore.getState().readinessIssue?.code).toBe("settings_required");
    expect(initialLife.adapter.dispose).toHaveBeenCalledTimes(1);
    await useAppStore.getState().recheckReadiness();
    expect(useAppStore.getState().readinessNotice).toBe(true);
    expect(life.adapter.dispose).toHaveBeenCalledTimes(1);
    expect(authEvents.listeners.size).toBe(1);
    expect(api.createSession).not.toHaveBeenCalled();
    expect(api.getSessionToken).not.toHaveBeenCalled();
    const anonymous: auth.AuthSnapshot = { state: "anonymous", principal: null };
    vi.mocked(auth.getAuthSnapshot).mockReturnValue(anonymous);
    vi.mocked(auth.getAuthRevision).mockReturnValue(2);
    for (const listener of [...authEvents.listeners]) listener(anonymous);
    expect(useAppStore.getState()).toMatchObject({
      connectionState: "idle",
      readinessNotice: false,
    });
    expect(authEvents.listeners.size).toBe(0);
  });
});
