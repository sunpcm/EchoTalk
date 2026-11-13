/**
 * 显式恢复已有记录：确认意图绑定认证代际，结果只认 resumeSession 的返回值。
 */

import { useRef, useState, type RefObject } from "react";
import { useConversationStore } from "@/store/conversation";
import type { ActiveSessionList } from "./useActiveSessionList";
import {
  captureAuthIdentity,
  isAuthIdentityCurrent,
  isLifecycleBlocked,
  isRequestCurrent,
  type ActiveSessionsRuntime,
  type ConfirmIntent,
} from "./shared";

type ConversationStoreState = ReturnType<typeof useConversationStore.getState>;

export interface SessionResumeFlow {
  resumingConfirmId: string | null;
  isResuming: boolean;
  resumeError: boolean;
  /** 打开恢复确认；被在途操作或未认证拒绝时返回 false。 */
  beginConfirm: (sessionId: string) => boolean;
  cancelConfirm: () => void;
  confirmResume: (sessionId: string) => Promise<void>;
  /** 打开结束确认时作废恢复意图并收起恢复面板。 */
  dismissForEndConfirm: () => void;
  /** 挂起/离线，或 store 已取消本次启动：释放恢复在途槽位。 */
  releaseInFlight: () => void;
  /** 跟随 store 的会话代际；启动被 reset/goHome 取消时同步释放恢复槽位。 */
  syncWithStore: (state: ConversationStoreState) => void;
  resetForAuthChange: () => void;
  invalidateOnUnmount: () => void;
}

export function useSessionResumeFlow(
  runtimeRef: RefObject<ActiveSessionsRuntime>,
  list: ActiveSessionList,
  isStarting: boolean,
): SessionResumeFlow {
  const resumeSession = useConversationStore((s) => s.resumeSession);

  const [resumingConfirmId, setResumingConfirmId] = useState<string | null>(null);
  const [isResuming, setIsResuming] = useState<boolean>(false);
  const [resumeError, setResumeError] = useState<boolean>(false);

  const requestIdRef = useRef<number>(0);
  const intentRef = useRef<ConfirmIntent | null>(null);
  const resumeGenRef = useRef<number>(useConversationStore.getState().sessionGen);

  const beginConfirm = (sessionId: string): boolean => {
    const runtime = runtimeRef.current;
    // 结束在途、恢复/新建启动在途时禁重复或替换在途目标
    if (runtime.endInFlight || runtime.resumeInFlight || isStarting) {
      return false;
    }
    const identity = captureAuthIdentity();
    if (!identity) {
      return false;
    }
    requestIdRef.current++;
    intentRef.current = { sessionId, ...identity };
    setResumingConfirmId(sessionId);
    setResumeError(false);
    return true;
  };

  const cancelConfirm = () => {
    if (runtimeRef.current.resumeInFlight) {
      return;
    }
    intentRef.current = null;
    requestIdRef.current++;
    setResumingConfirmId(null);
    setResumeError(false);
  };

  const confirmResume = async (targetSessionId: string) => {
    const runtime = runtimeRef.current;
    // 1. 在途禁重复提交
    if (runtime.resumeInFlight || runtime.endInFlight || isStarting) {
      return;
    }

    // 2. 校验恢复意图是否存在且目标匹配
    const intent = intentRef.current;
    if (!intent || intent.sessionId !== targetSessionId) {
      return;
    }

    // 3. 当前认证必须与意图发起时的代际严格一致
    if (!captureAuthIdentity() || !isAuthIdentityCurrent(intent)) {
      return;
    }

    // 4. 校验目标仍属于当前列表
    if (!list.hasSession(targetSessionId)) {
      return;
    }

    // 5. 前台/在线门禁
    if (isLifecycleBlocked(runtime)) {
      return;
    }

    // 6. 恢复前作废当前列表请求与更多页请求
    list.cancelInFlightRequests();

    // 7. 标记恢复在途并绑定操作代际
    runtime.resumeInFlight = true;
    const reqId = ++requestIdRef.current;
    resumeGenRef.current = useConversationStore.getState().sessionGen;
    const isCurrent = () => isRequestCurrent(runtime, reqId, requestIdRef.current, intent);

    setIsResuming(true);
    setResumeError(false);

    try {
      const res = await resumeSession(targetSessionId, {
        principal: intent.principal,
        revision: intent.revision,
      });

      if (!isCurrent()) return;

      // 明确成功判定：未返回 false 且未抛错（绝不把全局 store.error 当来源判定）
      if (res !== false) {
        intentRef.current = null;
        setResumingConfirmId(null);
        setResumeError(false);
      } else {
        setResumeError(true);
      }
    } catch {
      if (!isCurrent()) return;
      setResumeError(true);
    } finally {
      if (reqId === requestIdRef.current) {
        runtime.resumeInFlight = false;
      }
      if (isCurrent()) {
        setIsResuming(false);
      }
    }
  };

  const dismissForEndConfirm = () => {
    requestIdRef.current++;
    intentRef.current = null;
    setResumingConfirmId(null);
  };

  const releaseInFlight = () => {
    const runtime = runtimeRef.current;
    if (runtime.resumeInFlight) {
      requestIdRef.current++;
      runtime.resumeInFlight = false;
      setIsResuming(false);
    }
  };

  const syncWithStore = (state: ConversationStoreState) => {
    if (
      state.connectionState === "checking_health" ||
      state.connectionState === "connecting" ||
      state.connectionState === "active"
    ) {
      resumeGenRef.current = state.sessionGen;
    }
    // 恢复在途期间，store 回到 idle/ended 且会话代际被作废（reset / goHome / 生命周期取消），
    // 说明本次启动已被取消，组件同步作废对应 UI 代际并释放恢复槽位
    if (
      (state.connectionState === "idle" || state.connectionState === "ended") &&
      state.sessionGen !== resumeGenRef.current
    ) {
      releaseInFlight();
    }
  };

  const invalidateOnUnmount = () => {
    requestIdRef.current++;
    runtimeRef.current.resumeInFlight = false;
    intentRef.current = null;
  };

  const resetForAuthChange = () => {
    invalidateOnUnmount();
    setResumingConfirmId(null);
    setIsResuming(false);
    setResumeError(false);
  };

  return {
    resumingConfirmId,
    isResuming,
    resumeError,
    beginConfirm,
    cancelConfirm,
    confirmResume,
    dismissForEndConfirm,
    releaseInFlight,
    syncWithStore,
    resetForAuthChange,
    invalidateOnUnmount,
  };
}
