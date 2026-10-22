/**
 * CP-02 §10 独立客户端通话占用控制器。
 * 纯客户端状态机，不接 conversation/UI、不开 Cloud 门禁、不创建会话/Token、不采音、不持久化。
 */

import {
  type CallLeaseResponse,
  type CallLeaseOwner,
  type CallReleaseResponse,
  isValidUuid,
  isPositiveSafeInteger,
  isValidIsoCalendarTimestamp,
} from "./api";

export type { CallLeaseResponse, CallLeaseOwner, CallReleaseResponse };

export type CallLeaseStatus =
  | "idle"
  | "claiming"
  | "held"
  | "releasing"
  | "release_failed"
  | "lost";

export type CallLeaseReason =
  | null
  | "claim_failed"
  | "heartbeat_failed"
  | "release_failed"
  | "invalidated"
  | "expired";

export interface CallLeaseSnapshot {
  status: CallLeaseStatus;
  lease: CallLeaseResponse | null;
  reason: CallLeaseReason;
}

export interface CallLeaseControllerDeps {
  claim: (sessionId: string, deviceId: string, takeover?: boolean) => Promise<CallLeaseResponse>;
  heartbeat: (sessionId: string, owner: CallLeaseOwner) => Promise<CallLeaseResponse>;
  release: (sessionId: string, owner: CallLeaseOwner) => Promise<CallReleaseResponse>;
  isCurrent: () => boolean;
  onChange?: (snapshot: CallLeaseSnapshot) => void;
  now?: () => number;
  setTimeout?: (handler: () => void, timeout?: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

export interface CallLeaseController {
  getSnapshot(): CallLeaseSnapshot;
  claim(sessionId: string, deviceId: string, takeover?: boolean): Promise<void>;
  release(): Promise<void>;
  invalidate(): void;
  dispose(): void;
}

function cloneLease(l: CallLeaseResponse | null): CallLeaseResponse | null {
  if (!l) return null;
  return {
    session_id: l.session_id,
    device_id: l.device_id,
    generation: l.generation,
    state: "held",
    expires_at: l.expires_at,
  };
}

/**
 * 创建独立的通话占用控制器。
 * 显式工厂函数，无模块加载副作用，不创建单例。
 */
export function createCallLeaseController(deps: CallLeaseControllerDeps): CallLeaseController {
  const getNow = deps.now ?? Date.now;
  const setTimer =
    deps.setTimeout ??
    ((handler: () => void, timeout?: number) => globalThis.setTimeout(handler, timeout));
  const clearTimer =
    deps.clearTimeout ??
    ((handle: unknown) => {
      globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>);
    });

  let status: CallLeaseStatus = "idle";
  let currentLease: CallLeaseResponse | null = null;
  let reason: CallLeaseReason = null;
  let disposed = false;

  // 异步操作代际，防止迟到回调覆盖新状态
  let currentOpId = 0;

  let inFlightClaimOpId: number | null = null;
  let inFlightClaimPromise: Promise<void> | null = null;
  let inFlightReleaseOpId: number | null = null;
  let inFlightReleasePromise: Promise<void> | null = null;
  let inFlightHeartbeatOpId: number | null = null;

  let heartbeatTimerHandle: unknown = null;
  let watchdogTimerHandle: unknown = null;

  function getSnapshot(): CallLeaseSnapshot {
    return {
      status,
      lease: cloneLease(currentLease),
      reason,
    };
  }

  function notify(): void {
    if (deps.onChange) {
      try {
        deps.onChange(getSnapshot());
      } catch {
        // onChange 若抛错不应破坏状态清理、计时或异步操作结算
      }
    }
  }

  function clearTimers(): void {
    if (heartbeatTimerHandle !== null) {
      clearTimer(heartbeatTimerHandle);
      heartbeatTimerHandle = null;
    }
    if (watchdogTimerHandle !== null) {
      clearTimer(watchdogTimerHandle);
      watchdogTimerHandle = null;
    }
  }

  /**
   * 控制器内层二次校验：验证返回 tuple 与请求匹配、held 及合法未来 expires_at
   */
  function validateReturnedLease(
    lease: unknown,
    expectedSessionId: string,
    expectedDeviceId: string,
    expectedGeneration?: number,
  ): CallLeaseResponse | null {
    if (typeof lease !== "object" || lease === null || Array.isArray(lease)) {
      return null;
    }
    const l = lease as Partial<CallLeaseResponse>;
    if (
      !isValidUuid(l.session_id) ||
      l.session_id.toLowerCase() !== expectedSessionId.toLowerCase()
    ) {
      return null;
    }
    if (!isValidUuid(l.device_id) || l.device_id.toLowerCase() !== expectedDeviceId.toLowerCase()) {
      return null;
    }
    if (!isPositiveSafeInteger(l.generation)) {
      return null;
    }
    if (expectedGeneration !== undefined && l.generation !== expectedGeneration) {
      return null;
    }
    if (l.state !== "held") {
      return null;
    }
    if (!isValidIsoCalendarTimestamp(l.expires_at)) {
      return null;
    }
    const expiresMs = Date.parse(l.expires_at);
    if (Number.isNaN(expiresMs) || expiresMs <= getNow()) {
      return null;
    }
    return {
      session_id: l.session_id,
      device_id: l.device_id,
      generation: l.generation,
      state: "held",
      expires_at: l.expires_at,
    };
  }

  function scheduleTimers(opId: number): void {
    clearTimers();
    if (disposed || opId !== currentOpId || status !== "held" || !currentLease) {
      return;
    }

    const expiresMs = Date.parse(currentLease.expires_at);
    const msUntilExpiry = expiresMs - getNow();
    if (msUntilExpiry <= 0) {
      clearTimers();
      currentLease = null;
      status = "lost";
      reason = "expired";
      notify();
      return;
    }

    // 1. 独立 expires_at 到期 watchdog
    watchdogTimerHandle = setTimer(() => {
      watchdogTimerHandle = null;
      if (disposed || opId !== currentOpId || status !== "held" || !currentLease) {
        return;
      }
      if (getNow() >= Date.parse(currentLease.expires_at)) {
        ++currentOpId;
        inFlightHeartbeatOpId = null;
        clearTimers();
        currentLease = null;
        status = "lost";
        reason = "expired";
        notify();
      }
    }, msUntilExpiry);

    // 2. 20秒串行 heartbeat
    heartbeatTimerHandle = setTimer(() => {
      heartbeatTimerHandle = null;
      void runHeartbeat(opId);
    }, 20_000);
  }

  async function runHeartbeat(opId: number): Promise<void> {
    if (disposed || opId !== currentOpId || status !== "held" || !currentLease) {
      return;
    }

    // 发送前核对归属及到期
    if (!deps.isCurrent()) {
      clearTimers();
      currentLease = null;
      status = "lost";
      reason = null;
      notify();
      return;
    }

    if (getNow() >= Date.parse(currentLease.expires_at)) {
      ++currentOpId;
      inFlightHeartbeatOpId = null;
      clearTimers();
      currentLease = null;
      status = "lost";
      reason = "expired";
      notify();
      return;
    }

    // 前次未结束不发送下一次（对当前代际串行）
    if (inFlightHeartbeatOpId === opId) {
      return;
    }

    inFlightHeartbeatOpId = opId;
    const sessionId = currentLease.session_id;
    const owner: CallLeaseOwner = {
      device_id: currentLease.device_id,
      generation: currentLease.generation,
    };

    try {
      const res = await deps.heartbeat(sessionId, owner);

      if (disposed || opId !== currentOpId || status !== "held") {
        return;
      }

      if (!deps.isCurrent()) {
        clearTimers();
        currentLease = null;
        status = "lost";
        reason = null;
        notify();
        return;
      }

      const validLease = validateReturnedLease(res, sessionId, owner.device_id, owner.generation);

      if (!validLease) {
        clearTimers();
        currentLease = null;
        status = "lost";
        reason = "heartbeat_failed";
        notify();
        return;
      }

      currentLease = validLease;
      status = "held";
      reason = null;
      notify();
      scheduleTimers(opId);
    } catch {
      if (disposed || opId !== currentOpId || status !== "held") {
        return;
      }
      clearTimers();
      currentLease = null;
      status = "lost";
      reason = "heartbeat_failed";
      notify();
    } finally {
      if (inFlightHeartbeatOpId === opId) {
        inFlightHeartbeatOpId = null;
      }
    }
  }

  function claim(sessionId: string, deviceId: string, takeover: boolean = false): Promise<void> {
    if (disposed) {
      return Promise.resolve();
    }

    if (status === "claiming" && inFlightClaimPromise) {
      return inFlightClaimPromise;
    }

    // 显式 claim 只允许 idle/lost
    if (status !== "idle" && status !== "lost") {
      return Promise.resolve();
    }

    // 无当前身份时进入 lost 且不发请求
    if (!deps.isCurrent()) {
      clearTimers();
      currentLease = null;
      status = "lost";
      reason = null;
      notify();
      return Promise.resolve();
    }

    // 输入校验
    const isInputValid =
      isValidUuid(sessionId) &&
      isValidUuid(deviceId) &&
      (takeover === undefined || typeof takeover === "boolean");

    if (!isInputValid) {
      clearTimers();
      currentLease = null;
      status = "idle";
      reason = "claim_failed";
      notify();
      return Promise.resolve();
    }

    const effectiveTakeover = takeover === true;
    const opId = ++currentOpId;

    clearTimers();
    currentLease = null;
    status = "claiming";
    reason = null;
    notify();

    // CC-02: notify 之后在实际发请求前核验操作仍然有效（观察者可能同步调用 dispose/invalidate）
    if (disposed || opId !== currentOpId || !deps.isCurrent()) {
      if (!deps.isCurrent() && !disposed && opId === currentOpId) {
        clearTimers();
        currentLease = null;
        status = "lost";
        reason = null;
        notify();
      }
      return Promise.resolve();
    }

    inFlightClaimOpId = opId;

    const claimPromise = (async () => {
      try {
        const res = await deps.claim(sessionId, deviceId, effectiveTakeover);

        if (disposed || opId !== currentOpId) {
          return;
        }

        if (!deps.isCurrent()) {
          clearTimers();
          currentLease = null;
          status = "lost";
          reason = null;
          notify();
          return;
        }

        const validLease = validateReturnedLease(res, sessionId, deviceId);
        if (!validLease) {
          clearTimers();
          currentLease = null;
          status = "idle";
          reason = "claim_failed";
          notify();
          return;
        }

        currentLease = validLease;
        status = "held";
        reason = null;
        notify();
        scheduleTimers(opId);
      } catch {
        if (disposed || opId !== currentOpId) {
          return;
        }
        if (!deps.isCurrent()) {
          clearTimers();
          currentLease = null;
          status = "lost";
          reason = null;
          notify();
          return;
        }
        clearTimers();
        currentLease = null;
        status = "idle";
        reason = "claim_failed";
        notify();
      } finally {
        if (inFlightClaimOpId === opId) {
          inFlightClaimOpId = null;
          inFlightClaimPromise = null;
        }
      }
    })();

    inFlightClaimPromise = claimPromise;
    return claimPromise;
  }

  function release(): Promise<void> {
    if (disposed) {
      return Promise.resolve();
    }

    if (status === "releasing" && inFlightReleasePromise) {
      return inFlightReleasePromise;
    }

    // release 在 held/release_failed 且有 owner 时才发同 tuple 一次
    if ((status !== "held" && status !== "release_failed") || !currentLease) {
      return Promise.resolve();
    }

    // CC-02: held 时发送前核对 isCurrent；若失效则清空 owner/定时器并进入 lost，不发请求
    if (!deps.isCurrent()) {
      clearTimers();
      currentLease = null;
      status = "lost";
      reason = null;
      notify();
      return Promise.resolve();
    }

    // 立即取消 heartbeat/watchdog 并置 releasing
    clearTimers();
    const sessionId = currentLease.session_id;
    const owner: CallLeaseOwner = {
      device_id: currentLease.device_id,
      generation: currentLease.generation,
    };
    const capturedOpId = currentOpId;

    status = "releasing";
    reason = null;
    notify();

    // CC-02: notify 之后在实际发请求前核验操作仍然有效（观察者可能同步调用 dispose/invalidate）
    if (disposed || capturedOpId !== currentOpId || !deps.isCurrent()) {
      if (!deps.isCurrent() && !disposed && capturedOpId === currentOpId) {
        clearTimers();
        currentLease = null;
        status = "lost";
        reason = null;
        notify();
      }
      return Promise.resolve();
    }

    inFlightReleaseOpId = capturedOpId;

    const releasePromise = (async () => {
      try {
        const res = await deps.release(sessionId, owner);

        if (disposed || capturedOpId !== currentOpId) {
          return;
        }

        if (!deps.isCurrent()) {
          clearTimers();
          currentLease = null;
          status = "lost";
          reason = null;
          notify();
          return;
        }

        if (
          typeof res !== "object" ||
          res === null ||
          res.released !== true ||
          res.generation !== owner.generation
        ) {
          status = "release_failed";
          reason = "release_failed";
          notify();
          return;
        }

        clearTimers();
        currentLease = null;
        status = "idle";
        reason = null;
        notify();
      } catch {
        if (disposed || capturedOpId !== currentOpId) {
          return;
        }
        if (!deps.isCurrent()) {
          clearTimers();
          currentLease = null;
          status = "lost";
          reason = null;
          notify();
          return;
        }
        status = "release_failed";
        reason = "release_failed";
        notify();
      } finally {
        if (inFlightReleaseOpId === capturedOpId) {
          inFlightReleaseOpId = null;
          inFlightReleasePromise = null;
        }
      }
    })();

    inFlightReleasePromise = releasePromise;
    return releasePromise;
  }

  function invalidate(): void {
    if (disposed) {
      return;
    }
    ++currentOpId;
    inFlightHeartbeatOpId = null;
    inFlightClaimOpId = null;
    inFlightClaimPromise = null;
    inFlightReleaseOpId = null;
    inFlightReleasePromise = null;
    clearTimers();
    currentLease = null;
    status = "lost";
    reason = "invalidated";
    notify();
  }

  function dispose(): void {
    if (disposed) {
      return;
    }
    disposed = true;
    ++currentOpId;
    inFlightHeartbeatOpId = null;
    inFlightClaimOpId = null;
    inFlightClaimPromise = null;
    inFlightReleaseOpId = null;
    inFlightReleasePromise = null;
    clearTimers();
    currentLease = null;
    status = "lost";
    reason = "invalidated";
    notify();
  }

  return {
    getSnapshot,
    claim,
    release,
    invalidate,
    dispose,
  };
}
