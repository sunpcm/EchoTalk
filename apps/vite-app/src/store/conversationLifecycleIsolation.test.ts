import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "zustand";
import type { StoreApi, UseBoundStore } from "zustand";
import {
  createConversationSlice,
  type ConversationSlice,
  type ConversationSliceCoordinator,
} from "./conversationSlice";
import type {
  LifecycleAdapter,
  LifecycleCapabilities,
  WebLifecycleEvent,
  WebLifecycleSnapshot,
} from "@/platform";
import { createLifecycleAdapter, detectPlatform } from "@/platform";
import * as api from "@/lib/api";
import * as auth from "@/lib/auth";

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

const authListeners = new Set<(snap: auth.AuthSnapshot) => void>();

vi.mock("@/lib/auth", () => ({
  getAuthSnapshot: vi.fn(),
  getAuthRevision: vi.fn(),
  arePrincipalsEqual: vi.fn(
    (a: auth.AuthPrincipal, b: auth.AuthPrincipal) =>
      a === b || (a && b && a.issuer === b.issuer && a.subject === b.subject),
  ),
  subscribeAuthSnapshot: vi.fn((listener: (snap: auth.AuthSnapshot) => void) => {
    authListeners.add(listener);
    return () => {
      authListeners.delete(listener);
    };
  }),
}));

vi.mock("@/platform", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/platform")>();
  return {
    ...actual,
    detectPlatform: vi.fn(() => "ios"),
    createLifecycleAdapter: vi.fn(),
  };
});

interface ControlledAdapter {
  adapter: LifecycleAdapter;
  dispose: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  listeners: Array<(event: WebLifecycleEvent) => void>;
  resolveWhenReady: () => void;
  rejectWhenReady: (error: unknown) => void;
}

function createControlledAdapter(): ControlledAdapter {
  const listeners: Array<(event: WebLifecycleEvent) => void> = [];
  let resolveWhenReady!: () => void;
  let rejectWhenReady!: (error: unknown) => void;
  const whenReady = new Promise<void>((resolve, reject) => {
    resolveWhenReady = resolve;
    rejectWhenReady = reject;
  });
  const dispose = vi.fn();
  const subscribe = vi.fn((listener: (event: WebLifecycleEvent) => void) => {
    listeners.push(listener);
    return () => {
      const index = listeners.indexOf(listener);
      if (index >= 0) listeners.splice(index, 1);
    };
  });
  const capabilities: LifecycleCapabilities = { webEvents: true, nativeAppState: true };
  const adapter: LifecycleAdapter = {
    capabilities,
    getSnapshot: (): WebLifecycleSnapshot => ({ visibility: "visible", online: true }),
    subscribe,
    dispose,
    whenReady: () => whenReady,
  };
  return { adapter, dispose, subscribe, listeners, resolveWhenReady, rejectWhenReady };
}

const coordinator: ConversationSliceCoordinator<ConversationSlice> = {
  beginConnectingPatch: () => ({}),
  credentialsReadyPatch: () => ({}),
  startupClosedPatch: () => ({}),
  isRoomOwningState: () => true,
};

function createTestStore(): UseBoundStore<StoreApi<ConversationSlice>> {
  return create<ConversationSlice>((set, get) => ({
    ...createConversationSlice(
      set as unknown as (partial: object | ((state: ConversationSlice) => object)) => void,
      get,
      coordinator,
    ),
  }));
}

const validUuid = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const principal = { issuer: "https://auth.example.com", subject: "user-1" };

describe("A18P2 conversation slice instance isolation", () => {
  let mountedAdapters: ControlledAdapter[];

  beforeEach(() => {
    mountedAdapters = [];
    vi.clearAllMocks();
    authListeners.clear();

    vi.mocked(detectPlatform).mockReturnValue("ios");
    vi.mocked(createLifecycleAdapter).mockImplementation(() => {
      const controlled = createControlledAdapter();
      mountedAdapters.push(controlled);
      return controlled.adapter;
    });

    vi.mocked(auth.getAuthSnapshot).mockReturnValue({
      state: "authenticated",
      principal,
    });
    vi.mocked(auth.getAuthRevision).mockReturnValue(1);

    vi.mocked(api.getCallCapabilities).mockResolvedValue({
      protocol_version: 1,
      call_lease_mode: "disabled",
    });
    vi.mocked(api.checkHealthReady).mockResolvedValue({ status: "ready" });
    vi.mocked(api.createSession).mockResolvedValue({ id: "sess-a" } as api.Session);
    vi.mocked(api.getSessionToken).mockResolvedValue({ token: "tok-a", ws_url: "wss://a.test" });
    vi.mocked(api.getSessionDetail).mockResolvedValue({
      id: validUuid,
      status: "active",
      ended_at: null,
    } as api.Session);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function waitForAdapterMounts(count: number): Promise<void> {
    await vi.waitFor(() => expect(createLifecycleAdapter).toHaveBeenCalledTimes(count));
  }

  type StoreAction = (store: UseBoundStore<StoreApi<ConversationSlice>>) => Promise<unknown>;

  const startAction: StoreAction = (store) => store.getState().startSession("free_talk");
  const resumeAction: StoreAction = (store) =>
    store.getState().resumeSession(validUuid, { principal, revision: 1 });

  async function expectCrossIsolation(actionA: StoreAction, actionB: StoreAction): Promise<void> {
    const storeA = createTestStore();
    const storeB = createTestStore();

    const pendingA = actionA(storeA);
    const pendingB = actionB(storeB);

    try {
      await waitForAdapterMounts(2);
      const adapterA = mountedAdapters[0];
      const adapterB = mountedAdapters[1];

      // 第二实例启动/恢复不得 dispose 或退订第一实例。
      expect(adapterA.dispose).not.toHaveBeenCalled();
      expect(adapterA.subscribe).toHaveBeenCalledTimes(1);

      adapterB.resolveWhenReady();
      await pendingB;

      // 完成第二实例后，第一实例资源仍归第一实例所有。
      expect(adapterA.dispose).not.toHaveBeenCalled();
      expect(adapterA.listeners).toHaveLength(1);

      adapterA.resolveWhenReady();
      await pendingA;

      expect(adapterA.dispose).toHaveBeenCalledTimes(1);
      expect(adapterB.dispose).toHaveBeenCalledTimes(1);
      expect(storeA.getState().connectionState).toBe("connecting");
      expect(storeB.getState().connectionState).toBe("connecting");
    } finally {
      // 异常安全夹具清理：取消各自 store，释放本例挂起 ready，并收束 pending。
      storeA.getState().reset();
      storeB.getState().reset();
      for (const adapter of mountedAdapters) {
        adapter.resolveWhenReady();
      }
      await Promise.allSettled([pendingA, pendingB]);
    }
  }

  it("A18P2 start/start: second instance does not dispose or unsubscribe the first", async () => {
    await expectCrossIsolation(startAction, startAction);
  });

  it("A18P2 start/resume: cross-action instances keep their own lifecycle resources", async () => {
    await expectCrossIsolation(startAction, resumeAction);
  });

  it("A18P2 resume/start: cross-action instances keep their own lifecycle resources", async () => {
    await expectCrossIsolation(resumeAction, startAction);
  });

  it("A18P2 resume/resume: second instance does not dispose or unsubscribe the first", async () => {
    await expectCrossIsolation(resumeAction, resumeAction);
  });

  it("A18P2 cancel one instance does not affect the other and late results stay isolated", async () => {
    const storeA = createTestStore();
    const storeB = createTestStore();

    const pendingA = storeA.getState().startSession("free_talk");
    const pendingB = storeB.getState().startSession("free_talk");

    try {
      await waitForAdapterMounts(2);
      const adapterA = mountedAdapters[0];
      const adapterB = mountedAdapters[1];

      // 取消第一实例只应释放第一实例自己的 tracker/adapter。
      storeA.getState().reset();
      expect(adapterA.dispose).toHaveBeenCalledTimes(1);
      expect(adapterB.dispose).not.toHaveBeenCalled();
      expect(adapterB.listeners).toHaveLength(1);

      // 第一实例迟到就绪不得写回或影响第二实例。
      adapterA.resolveWhenReady();
      await pendingA;
      expect(storeA.getState().connectionState).toBe("idle");
      expect(storeB.getState().connectionState).toBe("checking_health");

      // 第二实例仍可独立完成。
      adapterB.resolveWhenReady();
      await pendingB;
      expect(storeB.getState().connectionState).toBe("connecting");
      expect(storeB.getState().sessionId).toBe("sess-a");
      expect(storeA.getState().sessionId).toBeNull();
    } finally {
      // 异常安全夹具清理：取消各自 store，释放本例挂起 ready，并收束 pending。
      storeA.getState().reset();
      storeB.getState().reset();
      for (const adapter of mountedAdapters) {
        adapter.resolveWhenReady();
      }
      await Promise.allSettled([pendingA, pendingB]);
    }
  });
});
