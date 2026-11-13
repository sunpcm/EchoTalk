/**
 * 显式结束活动记录：确认意图绑定认证代际，单次提交，失败保留目标供显式重试。
 */

import { useRef, useState, type RefObject } from "react";
import { endSession } from "@/lib/api";
import type { ActiveSessionList } from "./useActiveSessionList";
import {
  captureAuthIdentity,
  isAuthIdentityCurrent,
  isLifecycleBlocked,
  isRequestCurrent,
  type ActiveSessionsRuntime,
  type ConfirmIntent,
} from "./shared";

export interface SessionEndFlow {
  confirmingSessionId: string | null;
  isEnding: boolean;
  endError: boolean;
  /** 打开结束确认；被在途操作或未认证拒绝时返回 false。 */
  beginConfirm: (sessionId: string) => boolean;
  cancelConfirm: () => void;
  confirmEnd: (sessionId: string) => void;
  /** 打开恢复确认时收起结束面板（保留既有意图与错误状态）。 */
  hidePanel: () => void;
  resetForAuthChange: () => void;
  invalidateOnUnmount: () => void;
}

export function useSessionEndFlow(
  runtimeRef: RefObject<ActiveSessionsRuntime>,
  list: ActiveSessionList,
  isStarting: boolean,
): SessionEndFlow {
  const [confirmingSessionId, setConfirmingSessionId] = useState<string | null>(null);
  const [isEnding, setIsEnding] = useState<boolean>(false);
  const [endError, setEndError] = useState<boolean>(false);

  const requestIdRef = useRef<number>(0);
  const intentRef = useRef<ConfirmIntent | null>(null);

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
    // 绑定选择时的认证 principal 与 revision，防止旧意图被后续新认证代际误用
    intentRef.current = { sessionId, ...identity };
    setConfirmingSessionId(sessionId);
    setEndError(false);
    return true;
  };

  const cancelConfirm = () => {
    if (runtimeRef.current.endInFlight) {
      return;
    }
    intentRef.current = null;
    setConfirmingSessionId(null);
    setEndError(false);
  };

  const confirmEnd = (targetSessionId: string) => {
    const runtime = runtimeRef.current;
    // 1. 在途禁重复提交
    if (runtime.endInFlight || runtime.resumeInFlight || isStarting) {
      return;
    }

    // 2. 校验确认意图是否存在且目标匹配
    const intent = intentRef.current;
    if (!intent || intent.sessionId !== targetSessionId) {
      return;
    }

    // 3. 当前认证必须与确认意图发起时的代际严格一致
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

    // 6. 结束前作废当前列表请求与更多页请求
    list.cancelInFlightRequests();

    // 7. 标记结束请求在途并推进
    runtime.endInFlight = true;
    const reqId = ++requestIdRef.current;
    const isCurrent = () => isRequestCurrent(runtime, reqId, requestIdRef.current, intent);

    setIsEnding(true);
    setEndError(false);

    endSession(targetSessionId)
      .then((session) => {
        if (!isCurrent()) return;

        // 仅收到 id 与目标匹配且 status=completed 的 Session 响应才确认成功
        if (session && session.id === targetSessionId && session.status === "completed") {
          list.removeEndedSession(targetSessionId);
          intentRef.current = null;
          setConfirmingSessionId(null);
          setEndError(false);
        } else {
          setEndError(true);
        }
      })
      .catch(() => {
        if (!isCurrent()) return;
        // 失败保留目标和安全本地化错误，不回显服务端异常/正文
        setEndError(true);
      })
      .finally(() => {
        if (reqId === requestIdRef.current) {
          runtime.endInFlight = false;
        }
        if (isCurrent()) {
          setIsEnding(false);
        }
      });
  };

  const hidePanel = () => setConfirmingSessionId(null);

  const invalidateOnUnmount = () => {
    requestIdRef.current++;
    runtimeRef.current.endInFlight = false;
    intentRef.current = null;
  };

  const resetForAuthChange = () => {
    invalidateOnUnmount();
    setConfirmingSessionId(null);
    setIsEnding(false);
    setEndError(false);
  };

  return {
    confirmingSessionId,
    isEnding,
    endError,
    beginConfirm,
    cancelConfirm,
    confirmEnd,
    hidePanel,
    resetForAuthChange,
    invalidateOnUnmount,
  };
}
