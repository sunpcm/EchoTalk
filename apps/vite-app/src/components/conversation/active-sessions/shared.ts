/**
 * 活动会话各流程共享的运行时门禁与认证代际工具。
 * 列表、结束、恢复三个流程通过同一个 runtime 对象互斥，不各自持有对方的状态。
 */

import {
  arePrincipalsEqual,
  getAuthRevision,
  getAuthSnapshot,
  type AuthPrincipal,
} from "@/lib/auth";
import type { LifecycleAdapter } from "@/platform";
import { zhCN } from "@/i18n/zh-CN";

const t = zhCN.activeSessions;

/** 组件实例级的可变门禁；只由 useRef 持有，不触发渲染。 */
export interface ActiveSessionsRuntime {
  isMounted: boolean;
  endInFlight: boolean;
  resumeInFlight: boolean;
  lifecycleAdapter: LifecycleAdapter | null;
}

export function createActiveSessionsRuntime(): ActiveSessionsRuntime {
  return { isMounted: true, endInFlight: false, resumeInFlight: false, lifecycleAdapter: null };
}

/** 请求或确认意图发起时绑定的认证身份。 */
export interface AuthIdentity {
  principal: AuthPrincipal;
  revision: number;
}

export interface ConfirmIntent extends AuthIdentity {
  sessionId: string;
}

/** 读取当前已认证身份；loading/anonymous/misconfigured 返回 null。 */
export function captureAuthIdentity(): AuthIdentity | null {
  const snap = getAuthSnapshot();
  if (snap.state !== "authenticated" || !snap.principal) {
    return null;
  }
  return { principal: snap.principal, revision: getAuthRevision() };
}

/** 当前认证是否仍是发起时的 principal 与 revision。 */
export function isAuthIdentityCurrent(identity: AuthIdentity): boolean {
  const snap = getAuthSnapshot();
  return (
    snap.state === "authenticated" &&
    arePrincipalsEqual(snap.principal, identity.principal) &&
    getAuthRevision() === identity.revision
  );
}

/**
 * 异步结果是否仍可写回：组件仍挂载、请求未被后续操作作废、认证代际一致。
 */
export function isRequestCurrent(
  runtime: ActiveSessionsRuntime,
  requestId: number,
  latestRequestId: number,
  identity: AuthIdentity,
): boolean {
  return runtime.isMounted && requestId === latestRequestId && isAuthIdentityCurrent(identity);
}

/**
 * 前台/在线门禁：hidden 或 offline 时不发请求。
 * unknown/null 代表未知而不是失败，允许继续。
 */
export function isLifecycleBlocked(runtime: ActiveSessionsRuntime): boolean {
  const adapter = runtime.lifecycleAdapter;
  if (!adapter) return false;
  const snap = adapter.getSnapshot();
  return snap.visibility === "hidden" || snap.online === false;
}

export function resolveModeLabel(mode: string): string {
  if (Object.prototype.hasOwnProperty.call(t.modes, mode)) {
    const label = t.modes[mode as keyof typeof t.modes];
    if (typeof label === "string" && label.length > 0) {
      return label;
    }
  }
  return t.unknownMode;
}

export function formatStartedAt(startedAt: string): string {
  try {
    const d = new Date(startedAt);
    if (isNaN(d.getTime())) return startedAt;
    return d.toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return startedAt;
  }
}
