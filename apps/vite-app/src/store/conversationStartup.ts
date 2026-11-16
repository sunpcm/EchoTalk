/** Startup orchestration with live ports; construction performs no runtime reads. */
import type { AuthPrincipal } from "@/lib/auth";
import type { DocContext, SessionGoalBindingInput } from "@/lib/api";
import type { LifecycleAdapter, LifecycleOptions } from "@/platform";
import {
  canStartConversationSession,
  createCredentialsReadyConversationSessionState,
  isStartingConversationSession,
  type ConversationSessionEvent,
  type ConversationSessionState,
} from "./conversationState";

type Api = typeof import("@/lib/api");
type Auth = typeof import("@/lib/auth");
type Messages = (typeof import("@/i18n/zh-CN"))["zhCN"]["conversation"];

export interface ActiveStartupTracker {
  readonly gen: number;
  readonly principal: AuthPrincipal;
  readonly revision: number;
  readonly adapter: LifecycleAdapter;
  isDisposed: boolean;
  cleanup: () => void;
}

export interface StartupSelection {
  readonly scenarioName: string | null;
  readonly goalBinding: SessionGoalBindingInput | null;
}

export interface StartupPorts {
  get(): { readonly sessionGen: number; readonly _sessionState: ConversationSessionState };
  readStartSelection?(mode: string): StartupSelection;
  emit(event: ConversationSessionEvent, extra?: () => object): void;
  readTracker(): ActiveStartupTracker | null;
  writeTracker(value: ActiveStartupTracker | null): void;
  clearReadinessWatch(): void;
  watchReadinessAuth(principal: AuthPrincipal, revision: number, gen: number): void;
  auth: Pick<
    Auth,
    "getAuthSnapshot" | "getAuthRevision" | "arePrincipalsEqual" | "subscribeAuthSnapshot"
  >;
  getLifecycleOptions(): LifecycleOptions | null;
  createLifecycleAdapter(options?: LifecycleOptions): LifecycleAdapter;
  isNativeIos(): boolean;
  api: Pick<
    Api,
    "getCallCapabilities" | "checkHealthReady" | "createSession" | "getSessionToken" | "endSession"
  >;
  beginConnectingPatch(): object;
  startupClosedPatch(): object;
  classifyPracticeReadiness: typeof import("@/lib/practiceReadiness").classifyPracticeReadiness;
  resolveStartErrorMessage(error: unknown): string;
  messages(): Messages;
}

/** Returns the original async startup sequence, without introducing an await boundary. */
export function createConversationStartup(ports: StartupPorts) {
  const runStartup = async (mode: string, docContext?: DocContext, readinessOnly = false) => {
    // 1. 防止重复调用（如双击或 StrictMode 双渲染），在途能力查询和启动去重
    if (!canStartConversationSession(ports.get()._sessionState)) return;

    // 在任何 await 前冻结本次选择；后续 Dashboard 选择变化不得串入本会话。
    const startSelection = ports.readStartSelection?.(mode) ?? {
      scenarioName: null,
      goalBinding: null,
    };
    ports.clearReadinessWatch();

    // 2. 必须具备有效认证快照，否则不发起开始
    const authSnapshot = ports.auth.getAuthSnapshot();
    if (authSnapshot.state !== "authenticated" || !authSnapshot.principal) {
      ports.emit({ type: "reset" }, () => ({
        ...ports.startupClosedPatch(),
        error: ports.messages().notAuthenticated,
        readinessIssue: null,
        readinessNotice: false,
        recheckingReadiness: false,
      }));
      return;
    }
    const startRevision = ports.auth.getAuthRevision();
    const startPrincipal = authSnapshot.principal;

    const targetGen = ports.get().sessionGen + 1;
    const resetStartup = (error: string | null): void => {
      ports.emit({ type: "reset" }, () => ({
        sessionGen: targetGen + 1,
        ...ports.startupClosedPatch(),
        error,
        recheckingReadiness: false,
      }));
    };

    // 3. 先保留共享去重槽位并递增代际，防双击/同步 store 订阅者重入或 addListener 同步重入创建两次
    ports.emit({ type: "begin_checking" }, () => ({
      sessionGen: targetGen,
      error: null,
      readinessIssue: null,
      readinessNotice: false,
      recheckingReadiness: readinessOnly,
    }));

    // 写后立即复核同步订阅者通知是否已取消或改变认证（START-01/02）
    if (ports.get().sessionGen !== targetGen) {
      return;
    }
    const postSetSnap = ports.auth.getAuthSnapshot();
    if (
      postSetSnap.state !== "authenticated" ||
      !postSetSnap.principal ||
      !ports.auth.arePrincipalsEqual(postSetSnap.principal, startPrincipal) ||
      ports.auth.getAuthRevision() !== startRevision
    ) {
      resetStartup(null);
      return;
    }

    // 清理先前可能遗留的 tracker
    if (ports.readTracker()) {
      (ports.readTracker() as ActiveStartupTracker).cleanup();
      ports.writeTracker(null);
    }

    let lifecycleAdapter: LifecycleAdapter;
    try {
      lifecycleAdapter = ports.createLifecycleAdapter(ports.getLifecycleOptions() ?? undefined);
    } catch {
      if (ports.get().sessionGen === targetGen) {
        resetStartup(ports.messages().lifecycleUnavailable);
      }
      return;
    }

    // 复核在 ports.createLifecycleAdapter / addListener 同步执行期间是否发生取消、换号或新意图
    if (ports.get().sessionGen !== targetGen) {
      lifecycleAdapter.dispose();
      return;
    }
    const postAdapterSnap = ports.auth.getAuthSnapshot();
    if (
      postAdapterSnap.state !== "authenticated" ||
      !postAdapterSnap.principal ||
      !ports.auth.arePrincipalsEqual(postAdapterSnap.principal, startPrincipal) ||
      ports.auth.getAuthRevision() !== startRevision
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
        if (ports.readTracker() === tracker) {
          ports.writeTracker(null);
        }
      },
    };
    ports.writeTracker(tracker);

    unsubscribeAuth = ports.auth.subscribeAuthSnapshot((nextSnapshot) => {
      if (ports.get().sessionGen !== targetGen || tracker.isDisposed) {
        tracker.cleanup();
        return;
      }
      const state = ports.get();
      const isStarting = isStartingConversationSession(state._sessionState);
      if (!isStarting) {
        return;
      }

      const currentRev = ports.auth.getAuthRevision();
      const isStillValid =
        nextSnapshot.state === "authenticated" &&
        nextSnapshot.principal !== null &&
        ports.auth.arePrincipalsEqual(nextSnapshot.principal, startPrincipal) &&
        currentRev === startRevision;

      if (!isStillValid) {
        tracker.cleanup();
        if (ports.get().sessionGen === targetGen) {
          resetStartup(null);
        }
      }
    });

    unsubscribeLifecycle = lifecycleAdapter.subscribe((event) => {
      if (ports.get().sessionGen !== targetGen || tracker.isDisposed) {
        tracker.cleanup();
        return;
      }
      const state = ports.get();
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
        if (ports.get().sessionGen === targetGen) {
          resetStartup(null);
        }
      }
    });

    const isGenCurrent = (): boolean => ports.get().sessionGen === targetGen && !tracker.isDisposed;
    const isAuthCurrent = (): boolean => {
      const currentSnap = ports.auth.getAuthSnapshot();
      if (currentSnap.state !== "authenticated" || !currentSnap.principal) return false;
      if (!ports.auth.arePrincipalsEqual(currentSnap.principal, startPrincipal)) return false;
      if (ports.auth.getAuthRevision() !== startRevision) return false;
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
        if (ports.get().sessionGen === targetGen) {
          resetStartup(customError !== undefined ? customError : null);
        }
        return false;
      }
      if (!isLifecycleCurrent()) {
        tracker.cleanup();
        if (ports.get().sessionGen === targetGen) {
          resetStartup(
            customError !== undefined ? customError : ports.messages().lifecycleUnavailable,
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
      if (ports.get().sessionGen === targetGen) {
        resetStartup(null);
      }
      return;
    }

    if (ports.isNativeIos()) {
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
        if (ports.get().sessionGen === targetGen) {
          resetStartup(null);
        }
        return;
      }

      // 真正就绪后核验原生状态与在线提示
      if (timedOut || readyFailed || !isLifecycleCurrent()) {
        tracker.cleanup();
        if (ports.get().sessionGen === targetGen) {
          resetStartup(ports.messages().lifecycleUnavailable);
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
        if (ports.get().sessionGen === targetGen) {
          resetStartup(null);
        }
        return;
      }
      if (!isLifecycleCurrent()) {
        tracker.cleanup();
        if (ports.get().sessionGen === targetGen) {
          resetStartup(ports.messages().lifecycleUnavailable);
        }
        return;
      }
      isReady = true;
    }

    // 5. 通话能力发现与门禁 (CP-02 §8)
    if (!checkOrRelease()) return;
    let capabilities;
    try {
      capabilities = await ports.api.getCallCapabilities();
    } catch {
      if (!checkOrRelease()) return;
      console.error("Call capabilities check failed:");
      tracker.cleanup();
      if (ports.get().sessionGen === targetGen) {
        ports.emit({ type: "reset" }, () => ({
          ...ports.startupClosedPatch(),
          error: ports.messages().capabilitiesFailed,
        }));
      }
      return;
    }

    if (!checkOrRelease()) return;

    if (capabilities.call_lease_mode !== "disabled") {
      tracker.cleanup();
      if (ports.get().sessionGen === targetGen) {
        ports.emit({ type: "reset" }, () => ({
          ...ports.startupClosedPatch(),
          error: ports.messages().capabilitiesUnsupported,
        }));
      }
      return;
    }

    // 6. 健康检查
    if (!checkOrRelease()) return;
    try {
      await ports.api.checkHealthReady();
    } catch (err) {
      if (!checkOrRelease()) return;
      tracker.cleanup();
      if (ports.get().sessionGen === targetGen) {
        const issue = ports.classifyPracticeReadiness(err);
        ports.emit({ type: "reset" }, () => ({
          ...ports.startupClosedPatch(),
          error: issue.message,
          readinessIssue: issue,
          selectedScenario: null,
          recheckingReadiness: false,
        }));
      }
      ports.watchReadinessAuth(startPrincipal, startRevision, targetGen);
      return;
    }

    if (!checkOrRelease()) return;
    if (readinessOnly) {
      tracker.cleanup();
      ports.emit({ type: "reset" }, () => ({
        ...ports.startupClosedPatch(),
        error: null,
        readinessNotice: true,
        recheckingReadiness: false,
        selectedScenario: null,
      }));
      ports.watchReadinessAuth(startPrincipal, startRevision, targetGen);
      return;
    }

    // 7. 进入连接编排并创建实际会话；组合层补丁与状态事件同次提交
    ports.emit({ type: "begin_connecting" }, () => ({
      ...ports.beginConnectingPatch(),
      error: null,
    }));
    if (!checkOrRelease()) return;

    // 创建成功后记录 id：后续取 Token 失败时由客户端显式结束，避免留下孤儿活动记录
    let createdSessionId: string | null = null;
    const endOrphanedSession = async (): Promise<void> => {
      const orphanId = createdSessionId;
      createdSessionId = null;
      if (orphanId === null) return;
      try {
        // end 幂等；失败时记录仍在活动会话中，由用户显式结束，不自动重试
        await ports.api.endSession(orphanId);
      } catch {
        console.error("End orphaned session failed:");
      }
    };

    try {
      const session = startSelection.goalBinding
        ? await ports.api.createSession(mode, docContext, {
            goalBinding: startSelection.goalBinding,
          })
        : await ports.api.createSession(mode, docContext);
      if (!checkOrRelease()) return;
      if (typeof session.id !== "string" || session.id.trim() === "") {
        throw new Error(ports.messages().startFailed);
      }
      createdSessionId = session.id;

      ports.emit({ type: "session_created", sessionId: session.id });
      if (!checkOrRelease()) return;

      const { token, ws_url } = await ports.api.getSessionToken(session.id);
      if (!checkOrRelease()) return;

      const readyState = createCredentialsReadyConversationSessionState({
        sessionId: session.id,
        token,
        wsUrl: ws_url,
      });
      if (!readyState) {
        await endOrphanedSession();
        if (!checkOrRelease()) return;
        tracker.cleanup();
        ports.emit({ type: "reset" }, () => ({
          ...ports.startupClosedPatch(),
          error: ports.messages().startFailed,
        }));
        return;
      }

      createdSessionId = null;
      const sessionMode = typeof session.mode === "string" ? session.mode : null;
      const sessionStartedAt = typeof session.started_at === "string" ? session.started_at : null;
      const scenarioName =
        sessionMode === "scenario" && mode === "scenario" ? startSelection.scenarioName : null;
      tracker.cleanup();
      ports.emit(
        {
          type: "credentials_ready",
          sessionId: session.id,
          token,
          wsUrl: ws_url,
        },
        () => ({
          sessionPresentation: {
            sessionId: session.id,
            sessionGen: targetGen,
            startedAt: sessionStartedAt,
            mode: sessionMode,
            scenarioName,
          },
        }),
      );
    } catch (err) {
      if (!checkOrRelease()) return;
      await endOrphanedSession();
      if (!checkOrRelease()) return;
      tracker.cleanup();
      if (ports.get().sessionGen === targetGen) {
        ports.emit({ type: "reset" }, () => ({
          ...ports.startupClosedPatch(),
          error: ports.resolveStartErrorMessage(err),
        }));
      }
    }
  };
  return runStartup;
}
