/**
 * 对话状态管理 (zustand store)。
 * 管理 "未连接 -> 连接中 -> 对话中 -> 已结束" 的状态流转，
 * 以及 Dashboard / Session 视图切换。
 */

import { create } from "zustand";
import {
  createSession,
  getSessionDetail,
  getSessionToken,
  endSession as apiEndSession,
  checkHealthReady,
  getCallCapabilities,
  isValidUuid,
} from "@/lib/api";
import type { CurriculumRecommendation, DocContext } from "@/lib/api";
import {
  getAuthSnapshot,
  getAuthRevision,
  arePrincipalsEqual,
  subscribeAuthSnapshot,
  type AuthPrincipal,
} from "@/lib/auth";
import {
  createLifecycleAdapter,
  detectPlatform,
  type LifecycleAdapter,
  type LifecycleOptions,
} from "@/platform";
import { zhCN } from "@/i18n/zh-CN";
import {
  canStartConversationSession,
  conversationSessionStateFromProjection,
  createCredentialsReadyConversationSessionState,
  createIdleConversationSessionState,
  hasRoomConnection,
  isConnectingOrActiveConversationSession,
  isStartingConversationSession,
  projectConversationSessionState,
  reduceConversationSession,
  type ConnectionState,
  type ConversationSessionEvent,
  type ConversationSessionProjection,
  type ConversationSessionState,
} from "./conversationState";

export type { ConnectionState } from "./conversationState";

interface ActiveStartupTracker {
  readonly gen: number;
  readonly principal: AuthPrincipal;
  readonly revision: number;
  readonly adapter: LifecycleAdapter;
  isDisposed: boolean;
  cleanup: () => void;
}

let currentStartupTracker: ActiveStartupTracker | null = null;
let testingLifecycleOptions: LifecycleOptions | null = null;

/** 测试注入生命周期选项（仅用于测试，生产为 null 使用真实环境） */
export function _setLifecycleOptionsForTesting(options: LifecycleOptions | null): void {
  testingLifecycleOptions = options;
}

function isNativeIos(options?: LifecycleOptions | null): boolean {
  const resolved =
    options?.platform ??
    detectPlatform({
      window: options?.webOptions?.window,
      navigator: options?.webOptions?.navigator as { userAgent?: string } | undefined,
    });
  return resolved === "ios";
}

function isValidOrigin(origin: unknown): origin is { principal: AuthPrincipal; revision: number } {
  if (
    !origin ||
    typeof origin !== "object" ||
    !("principal" in origin) ||
    !("revision" in origin)
  ) {
    return false;
  }
  const o = origin as { principal?: unknown; revision?: unknown };
  if (
    !o.principal ||
    typeof o.principal !== "object" ||
    !("issuer" in o.principal) ||
    !("subject" in o.principal)
  ) {
    return false;
  }
  const p = o.principal as { issuer?: unknown; subject?: unknown };
  if (
    typeof p.issuer !== "string" ||
    p.issuer.trim() === "" ||
    typeof p.subject !== "string" ||
    p.subject.trim() === ""
  ) {
    return false;
  }
  if (typeof o.revision !== "number" || !Number.isSafeInteger(o.revision) || o.revision <= 0) {
    return false;
  }
  return true;
}

/** 顶层视图枚举 */
export type AppView = "dashboard" | "session" | "doc-chat-setup";

/** Store 类型定义 */
interface ConversationStore {
  /** 内部判别联合真值；扁平连接字段是它的兼容投影 */
  _sessionState: ConversationSessionState;
  /** 会话代际标识（用于防迟到响应污染） */
  sessionGen: number;
  /** 当前连接状态 */
  connectionState: ConnectionState;
  /** 顶层视图 */
  appView: AppView;
  /** 会话 ID */
  sessionId: string | null;
  /** LiveKit 房间令牌 */
  token: string | null;
  /** LiveKit WebSocket 地址 */
  wsUrl: string | null;
  /** 错误信息 */
  error: string | null;
  /** 用户选中的推荐场景 */
  selectedScenario: CurriculumRecommendation | null;
  /** Agent DataChannel 错误（自定义轨 fail-fast） */
  agentError: { code: string; message: string } | null;
  /** 已调度的会话 ID 与代际（用于 LiveKit dispatchAgent 单次去重） */
  dispatchedGen: number | null;
  dispatchedSessionId: string | null;
  /** 检查并标记本次会话代际已发起调度，成功返回 true，已调度过返回 false */
  markDispatched: (sessionId: string, forGen: number) => boolean;
  /** 标记 Agent 调度失败：立即清除 Token/URL，状态进入 dispatch_failed */
  failDispatch: (forSessionId?: string, forGen?: number) => void;
  /** 标记语音连接失败或中断：立即清除 Token/URL，状态进入 connection_failed */
  failConnection: (forSessionId?: string, forGen?: number) => void;

  /** 开始新会话：创建 session -> 获取 token -> 切换到 session 视图 */
  startSession: (mode: string, docContext?: DocContext) => Promise<void>;
  /** 恢复已有会话：独立校验 -> 能力检查 -> 会话详情 -> 健康检查 -> 获取令牌 -> 切换到 session 视图 */
  resumeSession: (
    sessionId: string,
    origin: { principal: AuthPrincipal; revision: number },
  ) => Promise<boolean>;
  /** 结束当前会话 */
  endSession: () => Promise<void>;
  /** LiveKit 房间连接成功后调用，切换到 active 状态 */
  setActive: (forSessionId?: string, forGen?: number) => void;
  /** 设置选中的推荐场景 */
  setSelectedScenario: (scenario: CurriculumRecommendation | null) => void;
  /** 记录 Agent DataChannel 错误；仅在 ownership 匹配的可用 Room 中接收 */
  setAgentError: (
    error: { code: string; message: string },
    ownership: { readonly sessionId: string; readonly sessionGen: number },
  ) => boolean;
  /** 重置连接状态（不切换视图） */
  reset: () => void;
  /** 返回主页：重置所有状态并切换到 Dashboard */
  goHome: () => void;
}

type SessionStatePatch = Pick<
  ConversationStore,
  "_sessionState" | "connectionState" | "sessionId" | "token" | "wsUrl"
>;

const SESSION_PATCH_KEYS = ["connectionState", "sessionId", "token", "wsUrl"] as const;

function projectSessionState(state: ConversationSessionState): SessionStatePatch {
  return {
    _sessionState: state,
    ...projectConversationSessionState(state),
  };
}

function reduceStoreSession(
  state: ConversationSessionState,
  event: ConversationSessionEvent,
): SessionStatePatch {
  return projectSessionState(reduceConversationSession(state, event));
}

const hasOwn = (value: object, key: PropertyKey): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

function isSameProjection(
  left: ConversationSessionProjection,
  right: ConversationSessionProjection,
): boolean {
  return (
    left.connectionState === right.connectionState &&
    left.sessionId === right.sessionId &&
    left.token === right.token &&
    left.wsUrl === right.wsUrl
  );
}

function normalizeSessionPatch(
  state: ConversationStore,
  patch: Partial<ConversationStore>,
): Partial<ConversationStore> {
  if (patch === state) return state;

  const hasFlatSessionPatch = SESSION_PATCH_KEYS.some((key) => hasOwn(patch, key));
  const current = projectConversationSessionState(state._sessionState);
  const projectedPatch: ConversationSessionProjection = {
    connectionState: patch.connectionState ?? current.connectionState,
    sessionId: hasOwn(patch, "sessionId") ? (patch.sessionId ?? null) : current.sessionId,
    token: hasOwn(patch, "token") ? (patch.token ?? null) : current.token,
    wsUrl: hasOwn(patch, "wsUrl") ? (patch.wsUrl ?? null) : current.wsUrl,
  };
  const hasFlatSessionChange = hasFlatSessionPatch && !isSameProjection(projectedPatch, current);
  const patchedSessionState = patch._sessionState;

  // A different internal model reference is an explicit model transition. An
  // unchanged reference carried by {...state, ...flatChanges} yields to those
  // explicit flat changes, which are then normalized back into one model.
  if (patchedSessionState && patchedSessionState !== state._sessionState) {
    return {
      ...patch,
      ...projectSessionState(patchedSessionState),
    };
  }

  if (hasFlatSessionChange) {
    return {
      ...patch,
      ...projectSessionState(conversationSessionStateFromProjection(projectedPatch)),
    };
  }

  return patchedSessionState
    ? {
        ...patch,
        ...projectSessionState(patchedSessionState),
      }
    : patch;
}

export const useConversationStore = create<ConversationStore>((set, get) => {
  const setSession = (
    event: ConversationSessionEvent,
    extra: (state: ConversationStore) => Partial<ConversationStore> = () => ({}),
  ): void => {
    set((state) => ({
      ...reduceStoreSession(state._sessionState, event),
      ...extra(state),
    }));
  };

  return {
    sessionGen: 0,
    _sessionState: createIdleConversationSessionState(),
    connectionState: "idle",
    appView: "dashboard",
    sessionId: null,
    token: null,
    wsUrl: null,
    error: null,
    selectedScenario: null,
    agentError: null,
    dispatchedGen: null,
    dispatchedSessionId: null,

    markDispatched: (sessionId: string, forGen: number) => {
      const state = get();
      if (state.dispatchedSessionId === sessionId && state.dispatchedGen === forGen) {
        return false;
      }
      set({ dispatchedSessionId: sessionId, dispatchedGen: forGen });
      return true;
    },

    failDispatch: (forSessionId?: string, forGen?: number) => {
      const state = get();
      if (forSessionId && state.sessionId !== forSessionId) {
        return;
      }
      if (forGen !== undefined && state.sessionGen !== forGen) {
        return;
      }
      if (!isConnectingOrActiveConversationSession(state._sessionState)) {
        return;
      }
      setSession({ type: "fail_dispatch" }, () => ({
        error: null,
      }));
    },

    failConnection: (forSessionId?: string, forGen?: number) => {
      const state = get();
      if (forSessionId && state.sessionId !== forSessionId) {
        return;
      }
      if (forGen !== undefined && state.sessionGen !== forGen) {
        return;
      }
      if (!isConnectingOrActiveConversationSession(state._sessionState)) {
        return;
      }
      if (currentStartupTracker) {
        currentStartupTracker.cleanup();
        currentStartupTracker = null;
      }
      setSession({ type: "fail_connection" }, () => ({
        error: null,
      }));
    },

    startSession: async (mode: string, docContext?: DocContext) => {
      // 1. 防止重复调用（如双击或 StrictMode 双渲染），在途能力查询和启动去重
      if (!canStartConversationSession(get()._sessionState)) return;

      // 2. 必须具备有效认证快照，否则不发起开始
      const authSnapshot = getAuthSnapshot();
      if (authSnapshot.state !== "authenticated" || !authSnapshot.principal) {
        setSession({ type: "reset" }, () => ({
          appView: "dashboard",
          error: zhCN.conversation.notAuthenticated,
        }));
        return;
      }
      const startRevision = getAuthRevision();
      const startPrincipal = authSnapshot.principal;

      const targetGen = get().sessionGen + 1;
      const resetStartup = (error: string | null): void => {
        setSession({ type: "reset" }, () => ({
          sessionGen: targetGen + 1,
          appView: "dashboard",
          error,
        }));
      };

      // 3. 先保留共享去重槽位，不切换视图，代际递增，防双击/同步 store 订阅者重入或 addListener 同步重入创建两次
      setSession({ type: "begin_checking" }, () => ({
        sessionGen: targetGen,
        error: null,
      }));

      // 写后立即复核同步订阅者通知是否已取消或改变认证（START-01/02）
      if (get().sessionGen !== targetGen) {
        return;
      }
      const postSetSnap = getAuthSnapshot();
      if (
        postSetSnap.state !== "authenticated" ||
        !postSetSnap.principal ||
        !arePrincipalsEqual(postSetSnap.principal, startPrincipal) ||
        getAuthRevision() !== startRevision
      ) {
        resetStartup(null);
        return;
      }

      // 清理先前可能遗留的 tracker
      if (currentStartupTracker) {
        currentStartupTracker.cleanup();
        currentStartupTracker = null;
      }

      let lifecycleAdapter: LifecycleAdapter;
      try {
        lifecycleAdapter = createLifecycleAdapter(testingLifecycleOptions ?? undefined);
      } catch {
        if (get().sessionGen === targetGen) {
          resetStartup(zhCN.conversation.lifecycleUnavailable);
        }
        return;
      }

      // 复核在 createLifecycleAdapter / addListener 同步执行期间是否发生取消、换号或新意图
      if (get().sessionGen !== targetGen) {
        lifecycleAdapter.dispose();
        return;
      }
      const postAdapterSnap = getAuthSnapshot();
      if (
        postAdapterSnap.state !== "authenticated" ||
        !postAdapterSnap.principal ||
        !arePrincipalsEqual(postAdapterSnap.principal, startPrincipal) ||
        getAuthRevision() !== startRevision
      ) {
        lifecycleAdapter.dispose();
        resetStartup(null);
        return;
      }

      let isReady = false;
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      let unsubscribeAuth: () => void = () => {};
      let unsubscribeLifecycle: () => void = () => {};

      const tracker: ActiveStartupTracker = {
        gen: targetGen,
        principal: startPrincipal,
        revision: startRevision,
        adapter: lifecycleAdapter,
        isDisposed: false,
        cleanup: () => {
          if (tracker.isDisposed) return;
          tracker.isDisposed = true;
          if (timeoutId !== null) {
            clearTimeout(timeoutId);
            timeoutId = null;
          }
          unsubscribeAuth();
          unsubscribeLifecycle();
          try {
            lifecycleAdapter.dispose();
          } catch {
            // swallow
          }
          if (currentStartupTracker === tracker) {
            currentStartupTracker = null;
          }
        },
      };
      currentStartupTracker = tracker;

      unsubscribeAuth = subscribeAuthSnapshot((nextSnapshot) => {
        if (get().sessionGen !== targetGen || tracker.isDisposed) {
          tracker.cleanup();
          return;
        }
        const state = get();
        const isStarting = isStartingConversationSession(state._sessionState);
        if (!isStarting) {
          return;
        }

        const currentRev = getAuthRevision();
        const isStillValid =
          nextSnapshot.state === "authenticated" &&
          nextSnapshot.principal !== null &&
          arePrincipalsEqual(nextSnapshot.principal, startPrincipal) &&
          currentRev === startRevision;

        if (!isStillValid) {
          tracker.cleanup();
          if (get().sessionGen === targetGen) {
            resetStartup(null);
          }
        }
      });

      unsubscribeLifecycle = lifecycleAdapter.subscribe((event) => {
        if (get().sessionGen !== targetGen || tracker.isDisposed) {
          tracker.cleanup();
          return;
        }
        const state = get();
        const isStarting = isStartingConversationSession(state._sessionState);
        if (!isStarting) {
          return;
        }
        const shouldCancel =
          event.type === "suspend" ||
          event.snapshot.online === false ||
          (isReady && event.snapshot.visibility === "hidden");
        if (shouldCancel) {
          tracker.cleanup();
          if (get().sessionGen === targetGen) {
            resetStartup(null);
          }
        }
      });

      const isGenCurrent = (): boolean => get().sessionGen === targetGen && !tracker.isDisposed;
      const isAuthCurrent = (): boolean => {
        const currentSnap = getAuthSnapshot();
        if (currentSnap.state !== "authenticated" || !currentSnap.principal) return false;
        if (!arePrincipalsEqual(currentSnap.principal, startPrincipal)) return false;
        if (getAuthRevision() !== startRevision) return false;
        return true;
      };
      const isLifecycleCurrent = (): boolean => {
        const lifeSnap = lifecycleAdapter.getSnapshot();
        if (lifeSnap.visibility === "hidden" || lifeSnap.online === false) return false;
        return true;
      };

      const checkOrRelease = (customError?: string | null): boolean => {
        if (!isGenCurrent()) {
          tracker.cleanup();
          return false;
        }
        if (!isAuthCurrent()) {
          tracker.cleanup();
          if (get().sessionGen === targetGen) {
            resetStartup(customError !== undefined ? customError : null);
          }
          return false;
        }
        if (!isLifecycleCurrent()) {
          tracker.cleanup();
          if (get().sessionGen === targetGen) {
            resetStartup(
              customError !== undefined ? customError : zhCN.conversation.lifecycleUnavailable,
            );
          }
          return false;
        }
        return true;
      };

      // 复核在订阅建立过程中是否有变动（原生环境在就绪前处于 pending，不得在此阶段按未就绪快照拒绝）
      if (!isGenCurrent()) {
        tracker.cleanup();
        return;
      }
      if (!isAuthCurrent()) {
        tracker.cleanup();
        if (get().sessionGen === targetGen) {
          resetStartup(null);
        }
        return;
      }

      if (isNativeIos(testingLifecycleOptions)) {
        // 4. 原生环境：等待原生就绪门禁，最多 10 秒超时
        let timedOut = false;
        let readyFailed = false;
        const timeoutPromise = new Promise<void>((_, reject) => {
          timeoutId = setTimeout(() => {
            timedOut = true;
            reject(new Error("LIFECYCLE_TIMEOUT"));
          }, 10000);
        });

        try {
          await Promise.race([lifecycleAdapter.whenReady(), timeoutPromise]);
        } catch {
          // 超时或原生就绪抛错
          readyFailed = true;
        } finally {
          if (timeoutId !== null) {
            clearTimeout(timeoutId);
            timeoutId = null;
          }
        }

        if (!isGenCurrent()) {
          tracker.cleanup();
          return;
        }

        if (!isAuthCurrent()) {
          tracker.cleanup();
          if (get().sessionGen === targetGen) {
            resetStartup(null);
          }
          return;
        }

        // 真正就绪后核验原生状态与在线提示
        if (timedOut || readyFailed || !isLifecycleCurrent()) {
          tracker.cleanup();
          if (get().sessionGen === targetGen) {
            resetStartup(zhCN.conversation.lifecycleUnavailable);
          }
          return;
        }
        isReady = true;
      } else {
        // Web 环境：立即就绪，检查初始显式 hidden / offline
        if (!isGenCurrent()) {
          tracker.cleanup();
          return;
        }
        if (!isAuthCurrent()) {
          tracker.cleanup();
          if (get().sessionGen === targetGen) {
            resetStartup(null);
          }
          return;
        }
        if (!isLifecycleCurrent()) {
          tracker.cleanup();
          if (get().sessionGen === targetGen) {
            resetStartup(zhCN.conversation.lifecycleUnavailable);
          }
          return;
        }
        isReady = true;
      }

      // 5. 通话能力发现与门禁 (CP-02 §8)
      if (!checkOrRelease()) return;
      let capabilities;
      try {
        capabilities = await getCallCapabilities();
      } catch (err) {
        if (!checkOrRelease()) return;
        console.error("Call capabilities check failed:", err);
        tracker.cleanup();
        if (get().sessionGen === targetGen) {
          setSession({ type: "reset" }, () => ({
            appView: "dashboard",
            error: zhCN.conversation.capabilitiesFailed,
          }));
        }
        return;
      }

      if (!checkOrRelease()) return;

      if (capabilities.call_lease_mode !== "disabled") {
        tracker.cleanup();
        if (get().sessionGen === targetGen) {
          setSession({ type: "reset" }, () => ({
            appView: "dashboard",
            error: zhCN.conversation.capabilitiesUnsupported,
          }));
        }
        return;
      }

      // 6. 健康检查
      if (!checkOrRelease()) return;
      try {
        await checkHealthReady();
      } catch (err) {
        if (!checkOrRelease()) return;
        console.error("Health check failed:", err);
        tracker.cleanup();
        if (get().sessionGen === targetGen) {
          setSession({ type: "reset" }, () => ({
            appView: "dashboard",
            error: err instanceof Error ? err.message : "服务不可用，请稍后再试或检查相关配置",
          }));
        }
        return;
      }

      if (!checkOrRelease()) return;

      // 7. 切换到 session 视图并创建实际会话
      setSession({ type: "begin_connecting" }, () => ({
        appView: "session",
        error: null,
      }));
      if (!checkOrRelease()) return;

      try {
        const session = await createSession(mode, docContext);
        if (!checkOrRelease()) return;
        if (typeof session.id !== "string" || session.id.trim() === "") {
          throw new Error("连接失败");
        }

        setSession({ type: "session_created", sessionId: session.id });
        if (!checkOrRelease()) return;

        const { token, ws_url } = await getSessionToken(session.id);
        if (!checkOrRelease()) return;

        const readyState = createCredentialsReadyConversationSessionState({
          sessionId: session.id,
          token,
          wsUrl: ws_url,
        });
        if (!readyState) {
          tracker.cleanup();
          setSession({ type: "reset" }, () => ({
            appView: "dashboard",
            error: "连接失败",
          }));
          return;
        }

        tracker.cleanup();
        setSession({
          type: "credentials_ready",
          sessionId: session.id,
          token,
          wsUrl: ws_url,
        });
      } catch (err) {
        if (!checkOrRelease()) return;
        tracker.cleanup();
        if (get().sessionGen === targetGen) {
          setSession({ type: "reset" }, () => ({
            appView: "dashboard",
            error: err instanceof Error ? err.message : "连接失败",
          }));
        }
      }
    },

    resumeSession: async (
      sessionId: string,
      origin: { principal: AuthPrincipal; revision: number },
    ): Promise<boolean> => {
      // 1. 启动槽位去重（与 startSession 共享一个启动槽位）
      if (!canStartConversationSession(get()._sessionState)) return false;

      // 2. 独立校验 sessionId UUID 格式
      if (!isValidUuid(sessionId)) return false;

      // 3. 独立校验 origin 结构
      if (!isValidOrigin(origin)) return false;

      // 4. 独立校验 origin 与当前认证快照及 revision 严格一致
      const authSnapshot = getAuthSnapshot();
      if (
        authSnapshot.state !== "authenticated" ||
        !authSnapshot.principal ||
        !arePrincipalsEqual(authSnapshot.principal, origin.principal) ||
        getAuthRevision() !== origin.revision
      ) {
        return false;
      }

      const startRevision = origin.revision;
      const startPrincipal = origin.principal;
      const targetGen = get().sessionGen + 1;
      const resetResume = (error: string | null): void => {
        setSession({ type: "reset" }, () => ({
          sessionGen: targetGen + 1,
          appView: "dashboard",
          error,
        }));
      };
      const releaseResume = (error: string | null): void => {
        setSession({ type: "reset" }, () => ({
          appView: "dashboard",
          error,
        }));
      };

      // 5. 先保留共享去重槽位，不切换视图，代际递增，防双击/同步 store 订阅者重入或 addListener 同步重入
      setSession({ type: "begin_checking" }, () => ({
        sessionGen: targetGen,
        error: null,
      }));

      // 写后立即复核同步订阅者通知是否已取消或改变认证（START-01/02）
      if (get().sessionGen !== targetGen) {
        return false;
      }
      const postSetSnap = getAuthSnapshot();
      if (
        postSetSnap.state !== "authenticated" ||
        !postSetSnap.principal ||
        !arePrincipalsEqual(postSetSnap.principal, startPrincipal) ||
        getAuthRevision() !== startRevision
      ) {
        resetResume(null);
        return false;
      }

      // 清理先前可能遗留的 tracker
      if (currentStartupTracker) {
        currentStartupTracker.cleanup();
        currentStartupTracker = null;
      }

      let lifecycleAdapter: LifecycleAdapter;
      try {
        lifecycleAdapter = createLifecycleAdapter(testingLifecycleOptions ?? undefined);
      } catch {
        if (get().sessionGen === targetGen) {
          resetResume(zhCN.conversation.lifecycleUnavailable);
        }
        return false;
      }

      // 复核在 createLifecycleAdapter / addListener 同步执行期间是否发生取消、换号或新意图
      if (get().sessionGen !== targetGen) {
        lifecycleAdapter.dispose();
        return false;
      }
      const postAdapterSnap = getAuthSnapshot();
      if (
        postAdapterSnap.state !== "authenticated" ||
        !postAdapterSnap.principal ||
        !arePrincipalsEqual(postAdapterSnap.principal, startPrincipal) ||
        getAuthRevision() !== startRevision
      ) {
        lifecycleAdapter.dispose();
        resetResume(null);
        return false;
      }

      let isReady = false;
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      let unsubscribeAuth: () => void = () => {};
      let unsubscribeLifecycle: () => void = () => {};

      const tracker: ActiveStartupTracker = {
        gen: targetGen,
        principal: startPrincipal,
        revision: startRevision,
        adapter: lifecycleAdapter,
        isDisposed: false,
        cleanup: () => {
          if (tracker.isDisposed) return;
          tracker.isDisposed = true;
          if (timeoutId !== null) {
            clearTimeout(timeoutId);
            timeoutId = null;
          }
          unsubscribeAuth();
          unsubscribeLifecycle();
          try {
            lifecycleAdapter.dispose();
          } catch {
            // swallow
          }
          if (currentStartupTracker === tracker) {
            currentStartupTracker = null;
          }
        },
      };
      currentStartupTracker = tracker;

      unsubscribeAuth = subscribeAuthSnapshot((nextSnapshot) => {
        if (get().sessionGen !== targetGen || tracker.isDisposed) {
          tracker.cleanup();
          return;
        }
        const state = get();
        const isStarting = isStartingConversationSession(state._sessionState);
        if (!isStarting) {
          return;
        }

        const currentRev = getAuthRevision();
        const isStillValid =
          nextSnapshot.state === "authenticated" &&
          nextSnapshot.principal !== null &&
          arePrincipalsEqual(nextSnapshot.principal, startPrincipal) &&
          currentRev === startRevision;

        if (!isStillValid) {
          tracker.cleanup();
          if (get().sessionGen === targetGen) {
            resetResume(null);
          }
        }
      });

      unsubscribeLifecycle = lifecycleAdapter.subscribe((event) => {
        if (get().sessionGen !== targetGen || tracker.isDisposed) {
          tracker.cleanup();
          return;
        }
        const state = get();
        const isStarting = isStartingConversationSession(state._sessionState);
        if (!isStarting) {
          return;
        }
        const shouldCancel =
          event.type === "suspend" ||
          event.snapshot.online === false ||
          (isReady && event.snapshot.visibility === "hidden");
        if (shouldCancel) {
          tracker.cleanup();
          if (get().sessionGen === targetGen) {
            resetResume(null);
          }
        }
      });

      const isGenCurrent = (): boolean => get().sessionGen === targetGen && !tracker.isDisposed;
      const isAuthCurrent = (): boolean => {
        const currentSnap = getAuthSnapshot();
        if (currentSnap.state !== "authenticated" || !currentSnap.principal) return false;
        if (!arePrincipalsEqual(currentSnap.principal, startPrincipal)) return false;
        if (getAuthRevision() !== startRevision) return false;
        return true;
      };
      const isLifecycleCurrent = (): boolean => {
        const lifeSnap = lifecycleAdapter.getSnapshot();
        if (lifeSnap.visibility === "hidden" || lifeSnap.online === false) return false;
        return true;
      };

      const checkOrRelease = (customError?: string | null): boolean => {
        if (!isGenCurrent()) {
          tracker.cleanup();
          return false;
        }
        if (!isAuthCurrent()) {
          tracker.cleanup();
          if (get().sessionGen === targetGen) {
            resetResume(customError !== undefined ? customError : null);
          }
          return false;
        }
        if (!isLifecycleCurrent()) {
          tracker.cleanup();
          if (get().sessionGen === targetGen) {
            resetResume(
              customError !== undefined ? customError : zhCN.conversation.lifecycleUnavailable,
            );
          }
          return false;
        }
        return true;
      };

      // 复核在订阅建立过程中是否有变动（原生环境在就绪前处于 pending，不得在此阶段按未就绪快照拒绝）
      if (!isGenCurrent()) {
        tracker.cleanup();
        return false;
      }
      if (!isAuthCurrent()) {
        tracker.cleanup();
        if (get().sessionGen === targetGen) {
          resetResume(null);
        }
        return false;
      }

      if (isNativeIos(testingLifecycleOptions)) {
        // 原生环境：等待原生就绪门禁，最多 10 秒超时
        let timedOut = false;
        let readyFailed = false;
        const timeoutPromise = new Promise<void>((_, reject) => {
          timeoutId = setTimeout(() => {
            timedOut = true;
            reject(new Error("LIFECYCLE_TIMEOUT"));
          }, 10000);
        });

        try {
          await Promise.race([lifecycleAdapter.whenReady(), timeoutPromise]);
        } catch {
          // 超时或原生就绪抛错
          readyFailed = true;
        } finally {
          if (timeoutId !== null) {
            clearTimeout(timeoutId);
            timeoutId = null;
          }
        }

        if (!isGenCurrent()) {
          tracker.cleanup();
          return false;
        }

        if (!isAuthCurrent()) {
          tracker.cleanup();
          if (get().sessionGen === targetGen) {
            resetResume(null);
          }
          return false;
        }

        // 真正就绪后核验原生状态与在线提示
        if (timedOut || readyFailed || !isLifecycleCurrent()) {
          tracker.cleanup();
          if (get().sessionGen === targetGen) {
            resetResume(zhCN.conversation.lifecycleUnavailable);
          }
          return false;
        }
        isReady = true;
      } else {
        // Web 环境：立即就绪，检查初始显式 hidden / offline
        if (!isGenCurrent()) {
          tracker.cleanup();
          return false;
        }
        if (!isAuthCurrent()) {
          tracker.cleanup();
          if (get().sessionGen === targetGen) {
            resetResume(null);
          }
          return false;
        }
        if (!isLifecycleCurrent()) {
          tracker.cleanup();
          if (get().sessionGen === targetGen) {
            resetResume(zhCN.conversation.lifecycleUnavailable);
          }
          return false;
        }
        isReady = true;
      }

      // Step 1: getCallCapabilities
      if (!checkOrRelease()) return false;
      let capabilities;
      try {
        capabilities = await getCallCapabilities();
      } catch (err) {
        if (!checkOrRelease()) return false;
        console.error("Call capabilities check failed:", err);
        tracker.cleanup();
        if (get().sessionGen === targetGen) {
          releaseResume(zhCN.conversation.capabilitiesFailed);
        }
        return false;
      }

      if (!checkOrRelease()) return false;

      if (capabilities.call_lease_mode !== "disabled") {
        tracker.cleanup();
        if (get().sessionGen === targetGen) {
          releaseResume(zhCN.conversation.capabilitiesUnsupported);
        }
        return false;
      }

      // Step 2: getSessionDetail(sessionId)
      if (!checkOrRelease()) return false;
      let sessionDetail;
      try {
        sessionDetail = await getSessionDetail(sessionId);
      } catch (err) {
        if (!checkOrRelease()) return false;
        console.error("Get session detail failed:", err);
        tracker.cleanup();
        if (get().sessionGen === targetGen) {
          releaseResume(zhCN.activeSessions.resumeError);
        }
        return false;
      }

      if (!checkOrRelease()) return false;

      // 详情校验：只接受对象、id 与目标 UUID 大小写等价、status 严格 active 且 ended_at 严格 null
      const isValidDetail =
        sessionDetail &&
        typeof sessionDetail === "object" &&
        !Array.isArray(sessionDetail) &&
        typeof sessionDetail.id === "string" &&
        sessionDetail.id.toLowerCase() === sessionId.toLowerCase() &&
        sessionDetail.status === "active" &&
        sessionDetail.ended_at === null;

      if (!isValidDetail) {
        tracker.cleanup();
        if (get().sessionGen === targetGen) {
          releaseResume(zhCN.activeSessions.resumeError);
        }
        return false;
      }

      // Step 3: checkHealthReady
      if (!checkOrRelease()) return false;
      try {
        await checkHealthReady();
      } catch (err) {
        if (!checkOrRelease()) return false;
        console.error("Health check failed:", err);
        tracker.cleanup();
        if (get().sessionGen === targetGen) {
          releaseResume(zhCN.activeSessions.resumeError);
        }
        return false;
      }

      if (!checkOrRelease()) return false;

      // Step 4: getSessionToken(sessionId, 不传 owner)
      let tokenRes;
      try {
        tokenRes = await getSessionToken(sessionId);
      } catch (err) {
        if (!checkOrRelease()) return false;
        console.error("Get session token failed:", err);
        tracker.cleanup();
        if (get().sessionGen === targetGen) {
          releaseResume(zhCN.activeSessions.resumeError);
        }
        return false;
      }

      if (!checkOrRelease()) return false;

      // Token 结果校验：必须为非空字符串 token 和 ws_url
      const isValidToken =
        tokenRes &&
        typeof tokenRes === "object" &&
        typeof tokenRes.token === "string" &&
        tokenRes.token.trim() !== "" &&
        typeof tokenRes.ws_url === "string" &&
        tokenRes.ws_url.trim() !== "";

      if (!isValidToken) {
        tracker.cleanup();
        if (get().sessionGen === targetGen) {
          releaseResume(zhCN.activeSessions.resumeError);
        }
        return false;
      }

      if (!checkOrRelease()) return false;

      // Step 5: 有效 Token 完成后才原子发布 sessionId、token、wsUrl、connectionState=connecting 及 appView=session
      tracker.cleanup();
      setSession(
        {
          type: "credentials_ready",
          sessionId,
          token: tokenRes.token,
          wsUrl: tokenRes.ws_url,
        },
        () => ({
          appView: "session",
          error: null,
        }),
      );
      return true;
    },

    endSession: async () => {
      if (currentStartupTracker) {
        currentStartupTracker.cleanup();
        currentStartupTracker = null;
      }
      const state = get();
      // 1. 同一在途结束去重
      if (state._sessionState.phase === "ending") {
        return;
      }

      // 已经处于 idle 或 ended 状态，无需结束
      if (state._sessionState.phase === "idle" || state._sessionState.phase === "ended") {
        return;
      }

      const { sessionId } = state;
      const newGen = state.sessionGen + 1;

      // 2. 无论是否已有 sessionId，结束都必须取消本地启动代际，使在途的 health/create/token 结果失效
      if (!sessionId) {
        // 在 health/create 尚未返回、无 ID 时结束：取消本地启动代际，不伪称已关闭未知服务端记录
        setSession({ type: "begin_end" }, () => ({
          sessionGen: newGen,
          error: null,
        }));
        return;
      }

      const targetGen = newGen;
      const targetSessionId = sessionId;

      // 3. 结束发起前立即清除内存 Token/URL 并进入独立 ending 状态，使 LiveKitRoom 卸载/音轨释放
      setSession({ type: "begin_end" }, () => ({
        sessionGen: targetGen,
        error: null,
      }));

      try {
        await apiEndSession(targetSessionId);
        // 代际或会话已改变（如离开返回主页或进入新会话），静默丢弃
        if (get().sessionGen !== targetGen || get().sessionId !== targetSessionId) {
          return;
        }
        setSession({ type: "finish_end" }, () => ({
          error: null,
        }));
      } catch (err) {
        if (get().sessionGen !== targetGen || get().sessionId !== targetSessionId) {
          return;
        }
        // 失败 end_failed 显示本地音频停止、服务端待重试，只能显式重试同一 session
        setSession({ type: "fail_end" }, () => ({
          error: err instanceof Error ? err.message : "结束会话失败，请重试",
        }));
      }
    },

    setActive: (forSessionId?: string, forGen?: number) => {
      const state = get();
      if (forSessionId && state.sessionId !== forSessionId) {
        return;
      }
      if (forGen !== undefined && state.sessionGen !== forGen) {
        return;
      }
      // 只有凭据完整且仍处于连接就绪的内部阶段才能切换为 active。
      if (state._sessionState.phase !== "credentials_ready") {
        return;
      }
      setSession({ type: "activate" });
    },

    setSelectedScenario: (scenario) => {
      set({ selectedScenario: scenario });
    },

    setAgentError: (error, ownership) => {
      const matchesOwnership = (state: ConversationStore): boolean =>
        state.sessionId === ownership.sessionId &&
        state.sessionGen === ownership.sessionGen &&
        state.appView === "session" &&
        hasRoomConnection(state._sessionState);

      if (!matchesOwnership(get())) {
        return false;
      }

      if (currentStartupTracker) {
        currentStartupTracker.cleanup();
        currentStartupTracker = null;
      }

      let accepted = false;
      set((state) => {
        if (!matchesOwnership(state)) {
          return state;
        }
        accepted = true;
        return {
          ...reduceStoreSession(state._sessionState, { type: "agent_error" }),
          sessionGen: state.sessionGen + 1,
          agentError: error,
        };
      });
      return accepted;
    },

    reset: () => {
      if (currentStartupTracker) {
        currentStartupTracker.cleanup();
        currentStartupTracker = null;
      }
      setSession({ type: "reset" }, (state) => ({
        sessionGen: state.sessionGen + 1,
        error: null,
        agentError: null,
        dispatchedGen: null,
        dispatchedSessionId: null,
      }));
    },

    goHome: () => {
      if (currentStartupTracker) {
        currentStartupTracker.cleanup();
        currentStartupTracker = null;
      }
      setSession({ type: "reset" }, (state) => ({
        sessionGen: state.sessionGen + 1,
        appView: "dashboard",
        error: null,
        selectedScenario: null,
        agentError: null,
        dispatchedGen: null,
        dispatchedSessionId: null,
      }));
    },
  };
});

const rawSetState = useConversationStore.setState;
type ConversationStoreSetState = typeof useConversationStore.setState;

/** Keep legacy direct setState fixtures on the same atomic model/projection path. */
const setStateWithSessionProjection = (
  partial:
    | ConversationStore
    | Partial<ConversationStore>
    | ((state: ConversationStore) => ConversationStore | Partial<ConversationStore>),
  replace?: boolean,
): void => {
  if (replace === true) {
    rawSetState((state) => {
      const replacement = (
        typeof partial === "function" ? partial(state) : partial
      ) as ConversationStore;
      return normalizeSessionPatch(state, replacement) as ConversationStore;
    }, true);
    return;
  }

  rawSetState((state) => {
    const patch = typeof partial === "function" ? partial(state) : partial;
    return normalizeSessionPatch(state, patch);
  });
};

useConversationStore.setState = setStateWithSessionProjection as ConversationStoreSetState;
