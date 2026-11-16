import React from "react";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "zustand";
import type { StoreApi, UseBoundStore } from "zustand";
import {
  createConversationSlice,
  type ConversationSlice,
  type ConversationSliceCoordinator,
  type SessionPresentation,
} from "./conversationSlice";
import { AuthGate } from "@/components/auth/AuthGate";
import { useAppStore } from "@/store/appStore";
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
  initializeAuthSnapshot: vi.fn(),
  beginLogin: vi.fn(),
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

/**
 * 会话展示元信息（本卡约定，与后续产品代码保持一致）。
 * 归属 (sessionId, sessionGen) 用于防止迟到响应/旧代际污染新会话页头。
 */
function presentationOf(
  store: Pick<StoreApi<ConversationSlice>, "getState">,
): SessionPresentation | null {
  return store.getState().sessionPresentation ?? null;
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const sessionAId = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const sessionBId = "6ca1f7da-e36d-4d13-8f5e-17b720634df2";
const resumeSessionId = "a82d93c4-0bbf-4e1c-b09f-c02ef0780037";
const userId = "bd0cd0c7-8f48-4619-bc09-bf7bd2cb100f";
const principal = { issuer: "https://auth.example.com", subject: "user-1" };
const startedAt = "2026-11-15T10:00:00.000Z";
const endedAt = "2026-11-15T10:05:00.000Z";

function makeSession({
  id = sessionAId,
  mode = "scenario",
  sessionStartedAt = startedAt,
  status = "active",
  sessionEndedAt = null,
}: {
  id?: string;
  mode?: string;
  sessionStartedAt?: string;
  status?: string;
  sessionEndedAt?: string | null;
} = {}): api.Session {
  return {
    id,
    user_id: userId,
    mode,
    started_at: sessionStartedAt,
    status,
    transcripts: [],
    ended_at: sessionEndedAt,
  };
}

function makeScenario(scenarioName: string): api.CurriculumRecommendation {
  return {
    category: "travel",
    difficulty_cefr: "B1",
    focus_skills: ["conversation"],
    scenario_name: scenarioName,
    system_prompt_template: "Run a short travel-planning conversation.",
  };
}

describe("R2-11 conversation presentation (sessionPresentation)", () => {
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
    vi.mocked(auth.initializeAuthSnapshot).mockResolvedValue({
      state: "authenticated",
      principal,
    });

    vi.mocked(api.getCallCapabilities).mockResolvedValue({
      protocol_version: 1,
      call_lease_mode: "disabled",
    });
    vi.mocked(api.checkHealthReady).mockResolvedValue({ status: "ready" });
    vi.mocked(api.createSession).mockResolvedValue(makeSession());
    vi.mocked(api.getSessionToken).mockResolvedValue({ token: "tok-a", ws_url: "wss://a.test" });
    vi.mocked(api.getSessionDetail).mockResolvedValue(
      makeSession({
        id: resumeSessionId,
        mode: "free_talk",
        sessionStartedAt: "2026-11-15T09:00:00.000Z",
      }),
    );
    vi.mocked(api.endSession).mockResolvedValue(
      makeSession({
        status: "completed",
        sessionEndedAt: endedAt,
      }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function waitForLatestAdapter(callCountBefore: number): Promise<ControlledAdapter> {
    await vi.waitFor(() =>
      expect(createLifecycleAdapter).toHaveBeenCalledTimes(callCountBefore + 1),
    );
    const adapter = mountedAdapters.at(-1);
    if (!adapter) throw new Error("lifecycle adapter was not mounted");
    return adapter;
  }

  async function startToReady(
    store: Pick<StoreApi<ConversationSlice>, "getState">,
    mode: string,
  ): Promise<void> {
    const callCountBefore = vi.mocked(createLifecycleAdapter).mock.calls.length;
    const pending = store.getState().startSession(mode);
    const adapter = await waitForLatestAdapter(callCountBefore);
    adapter.resolveWhenReady();
    await pending;
  }

  async function resumeToReady(store: UseBoundStore<StoreApi<ConversationSlice>>): Promise<void> {
    const callCountBefore = vi.mocked(createLifecycleAdapter).mock.calls.length;
    const pending = store.getState().resumeSession(resumeSessionId, { principal, revision: 1 });
    const adapter = await waitForLatestAdapter(callCountBefore);
    adapter.resolveWhenReady();
    await pending;
  }

  it("startScenario：首个 await 前快照场景，展示对象归属与字段正确", async () => {
    const store = createTestStore();
    store.getState().setSelectedScenario(makeScenario("Travel Planning"));

    const callCountBefore = vi.mocked(createLifecycleAdapter).mock.calls.length;
    const pending = store.getState().startSession("scenario");
    const adapter = await waitForLatestAdapter(callCountBefore);
    store.getState().setSelectedScenario(makeScenario("Late Selection"));
    adapter.resolveWhenReady();
    await pending;

    expect(presentationOf(store)).toEqual({
      sessionId: sessionAId,
      sessionGen: 1,
      startedAt,
      mode: "scenario",
      scenarioName: "Travel Planning",
    });
  });

  it("startFreeTalk：残留 selectedScenario 不得被当作当前场景", async () => {
    vi.mocked(api.createSession).mockResolvedValueOnce(makeSession({ mode: "free_talk" }));
    const store = createTestStore();
    store.getState().setSelectedScenario(makeScenario("Travel Planning"));

    await startToReady(store, "free_talk");

    expect(presentationOf(store)).toEqual({
      sessionId: sessionAId,
      sessionGen: 1,
      startedAt,
      mode: "free_talk",
      scenarioName: null,
    });
  });

  it("resume：展示对象来自 getSessionDetail，场景名恒为 null（恢复不串场景）", async () => {
    const store = createTestStore();
    store.getState().setSelectedScenario(makeScenario("Stale Dashboard Selection"));

    await resumeToReady(store);

    expect(presentationOf(store)).toEqual({
      sessionId: resumeSessionId,
      sessionGen: 1,
      startedAt: "2026-11-15T09:00:00.000Z",
      mode: "free_talk",
      scenarioName: null,
    });
  });

  it("start 中途失败（能力检查失败）不产生展示对象", async () => {
    vi.mocked(api.getCallCapabilities).mockRejectedValue(new Error("capabilities-failed"));
    const store = createTestStore();

    const callCountBefore = vi.mocked(createLifecycleAdapter).mock.calls.length;
    const pending = store.getState().startSession("free_talk");
    const adapter = await waitForLatestAdapter(callCountBefore);
    adapter.resolveWhenReady();
    await pending;

    expect(presentationOf(store)).toBeNull();
  });

  it("resume 中途失败（详情获取失败）不产生展示对象", async () => {
    vi.mocked(api.getSessionDetail).mockRejectedValue(new Error("detail-failed"));
    const store = createTestStore();

    const callCountBefore = vi.mocked(createLifecycleAdapter).mock.calls.length;
    const pending = store.getState().resumeSession(resumeSessionId, { principal, revision: 1 });
    const adapter = await waitForLatestAdapter(callCountBefore);
    adapter.resolveWhenReady();
    await pending;

    expect(presentationOf(store)).toBeNull();
  });

  it("取消（启动中 reset）不得写入展示对象", async () => {
    const store = createTestStore();

    const callCountBefore = vi.mocked(createLifecycleAdapter).mock.calls.length;
    const pending = store.getState().startSession("free_talk");
    const adapter = await waitForLatestAdapter(callCountBefore);
    store.getState().reset();
    adapter.resolveWhenReady();
    await pending;

    expect(presentationOf(store)).toBeNull();
  });

  it("新 start 取代旧启动后，旧 createSession 的迟到响应不得覆盖新展示", async () => {
    const oldResponse = createDeferred<api.Session>();
    vi.mocked(api.createSession)
      .mockImplementationOnce(() => oldResponse.promise)
      .mockResolvedValueOnce(makeSession({ id: sessionBId, mode: "free_talk" }));
    const store = createTestStore();

    const firstCallCount = vi.mocked(createLifecycleAdapter).mock.calls.length;
    const oldPending = store.getState().startSession("scenario");
    const oldAdapter = await waitForLatestAdapter(firstCallCount);
    oldAdapter.resolveWhenReady();
    await vi.waitFor(() => expect(api.createSession).toHaveBeenCalledTimes(1));

    store.getState().reset();
    const secondCallCount = vi.mocked(createLifecycleAdapter).mock.calls.length;
    const newPending = store.getState().startSession("free_talk");
    const newAdapter = await waitForLatestAdapter(secondCallCount);
    newAdapter.resolveWhenReady();
    await newPending;

    expect(presentationOf(store)).toMatchObject({
      sessionId: sessionBId,
      mode: "free_talk",
      scenarioName: null,
    });

    oldResponse.resolve(makeSession({ mode: "scenario" }));
    await oldPending;

    expect(presentationOf(store)).toMatchObject({
      sessionId: sessionBId,
      mode: "free_talk",
      scenarioName: null,
    });
  });

  it("reset / resetWithShellCoordination 清空展示对象（身份切换/失败/reset 收敛点）", async () => {
    const store = createTestStore();
    await startToReady(store, "free_talk");
    expect(presentationOf(store)).not.toBeNull();

    store.getState().reset();
    expect(presentationOf(store)).toBeNull();

    await startToReady(store, "scenario");
    expect(presentationOf(store)).not.toBeNull();

    store.getState().resetWithShellCoordination({});
    expect(presentationOf(store)).toBeNull();
  });

  it("连接失败切换新代际时清空展示对象", async () => {
    const store = createTestStore();
    await startToReady(store, "free_talk");
    expect(presentationOf(store)).not.toBeNull();

    store.getState().failConnection(sessionAId, 1);

    expect(presentationOf(store)).toBeNull();
  });

  it("Agent 调度失败时清空展示对象", async () => {
    const store = createTestStore();
    await startToReady(store, "free_talk");
    expect(presentationOf(store)).not.toBeNull();

    store.getState().failDispatch(sessionAId, 1);

    expect(presentationOf(store)).toBeNull();
  });

  it("主动结束会话时清空展示对象", async () => {
    const store = createTestStore();
    await startToReady(store, "free_talk");
    expect(presentationOf(store)).not.toBeNull();

    await store.getState().endSession();

    expect(presentationOf(store)).toBeNull();
  });

  it("已有会话展示对象后，真实 AuthGate 收到匿名快照时清空", async () => {
    const store = useAppStore;
    const callCountBefore = vi.mocked(createLifecycleAdapter).mock.calls.length;
    const pending = store.getState().startSession("free_talk");
    const adapter = await waitForLatestAdapter(callCountBefore);
    adapter.resolveWhenReady();
    await pending;
    expect(presentationOf(store)).not.toBeNull();

    render(React.createElement(AuthGate, null, React.createElement("div")));
    await act(async () => {});
    expect(authListeners.size).toBeGreaterThan(0);

    for (const listener of [...authListeners]) {
      await act(async () => {
        listener({ state: "anonymous", principal: null });
      });
    }

    expect(presentationOf(store)).toBeNull();
  });

  it("身份切换（启动中认证变化）中止启动且不产生展示对象", async () => {
    const store = createTestStore();

    const callCountBefore = vi.mocked(createLifecycleAdapter).mock.calls.length;
    const pending = store.getState().startSession("free_talk");
    const adapter = await waitForLatestAdapter(callCountBefore);
    // 模拟账号切换：认证快照变为未认证
    for (const listener of [...authListeners]) {
      listener({ state: "anonymous", principal: null });
    }
    adapter.resolveWhenReady();
    await pending;

    expect(presentationOf(store)).toBeNull();
  });
});
