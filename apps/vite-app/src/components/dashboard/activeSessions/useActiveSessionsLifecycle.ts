/**
 * 活动会话的订阅中枢：生命周期事件、认证快照与会话 store。
 * 只在这里决定何时只读刷新列表、何时作废在途操作；不发起任何写请求。
 */

import { useEffect, useRef, useState, type RefObject } from "react";
import {
  arePrincipalsEqual,
  getAuthRevision,
  getAuthSnapshot,
  subscribeAuthSnapshot,
  type AuthPrincipal,
  type AuthSnapshot,
} from "@/lib/auth";
import { createLifecycleAdapter, type WebLifecycleEvent } from "@/platform";
import { useConversationStore } from "@/store/conversation";
import type { ActiveSessionList } from "./useActiveSessionList";
import type { SessionEndFlow } from "./useSessionEndFlow";
import type { SessionResumeFlow } from "./useSessionResumeFlow";
import type { ActiveSessionsRuntime } from "./shared";

interface LifecycleFlows {
  list: ActiveSessionList;
  end: SessionEndFlow;
  resume: SessionResumeFlow;
}

export interface ActiveSessionsLifecycle {
  snapshot: AuthSnapshot;
  /** 订阅回调最近一次确认的认证 revision，用于判断列表是否属于当前代际。 */
  activeRevision: number;
}

export function useActiveSessionsLifecycle(
  runtimeRef: RefObject<ActiveSessionsRuntime>,
  flows: LifecycleFlows,
  isStarting: boolean,
): ActiveSessionsLifecycle {
  const [snapshot, setSnapshot] = useState<AuthSnapshot>(() => getAuthSnapshot());
  const activePrincipalRef = useRef<AuthPrincipal | null>(snapshot.principal);
  const activeRevisionRef = useRef<number>(getAuthRevision());

  // 订阅只建立一次；回调通过 ref 调用各流程最新的函数（它们只读写 ref 与 setState）。
  const flowsRef = useRef<LifecycleFlows>(flows);
  flowsRef.current = flows;

  // 既有行为：生命周期事件里的“启动在途”判断取自挂载时的渲染值，订阅期间不更新。
  // 这里按原样保留，不在重构中改变；列表刷新自身会读取 store 的实时启动状态。
  const isStartingAtMountRef = useRef<boolean>(isStarting);

  useEffect(() => {
    const runtime = runtimeRef.current;
    let isEffectActive = true;
    runtime.isMounted = true;

    const adapter = createLifecycleAdapter();
    runtime.lifecycleAdapter = adapter;

    const resetAllForAuthChange = () => {
      const { list, end, resume } = flowsRef.current;
      end.resetForAuthChange();
      resume.resetForAuthChange();
      list.resetForAuthChange();
    };

    const handleLifecycleEvent = (event: WebLifecycleEvent) => {
      if (!isEffectActive || !runtime.isMounted) return;
      const { list, resume } = flowsRef.current;

      // suspend 或离线：作废列表请求并退出 loading，保留同一账号已展示列表、不新增错误提示。
      // 结束槽位不因挂起/离线释放，也不自动重发已发送的 POST；
      // 恢复在途若被 store 取消，同步释放恢复槽位。
      if (
        event.type === "suspend" ||
        event.snapshot.visibility === "hidden" ||
        event.snapshot.online === false
      ) {
        list.suspendRequests();
        resume.releaseInFlight();
      }

      // 结束在途或启动/恢复在途暂停列表刷新且不排队
      if (runtime.endInFlight || runtime.resumeInFlight || isStartingAtMountRef.current) {
        return;
      }

      if (event.type === "resume") {
        // resume 事件仅 visibility 为 visible 且 online 不是 false 时刷新
        if (event.snapshot.visibility === "visible" && event.snapshot.online !== false) {
          list.fetchActiveSessions();
        }
      } else if (event.type === "connectivity") {
        // connectivity 事件仅 online 为 true 且 visibility 不是 hidden 时刷新
        if (event.snapshot.online === true && event.snapshot.visibility !== "hidden") {
          list.fetchActiveSessions();
        }
      }
    };

    // 先订阅后读取当前快照
    const unsubscribeLifecycle = adapter.subscribe(handleLifecycleEvent);
    const initialLifeSnap = adapter.getSnapshot();

    const handleSnapshotChange = (nextSnap: AuthSnapshot) => {
      if (!isEffectActive || !runtime.isMounted) return;

      const nextRev = getAuthRevision();
      const nextPrincipal = nextSnap.principal;
      const principalChanged = !arePrincipalsEqual(activePrincipalRef.current, nextPrincipal);
      const revisionChanged = nextRev !== activeRevisionRef.current;

      activePrincipalRef.current = nextPrincipal;
      activeRevisionRef.current = nextRev;
      setSnapshot(nextSnap);

      if (nextSnap.state !== "authenticated" || !nextPrincipal) {
        // 认证失效/退出：清除确认与错误、作废旧操作及列表请求
        resetAllForAuthChange();
        return;
      }

      // principal 变更，或同 principal 下 revision 递增（例如同账号退出重登）
      if (principalChanged || revisionChanged) {
        resetAllForAuthChange();
        flowsRef.current.list.fetchActiveSessions();
      }
    };

    const unsubscribeAuth = subscribeAuthSnapshot(handleSnapshotChange);

    const unsubscribeStore = useConversationStore.subscribe((state) => {
      if (!isEffectActive || !runtime.isMounted) return;
      flowsRef.current.resume.syncWithStore(state);
    });

    const initialSnap = getAuthSnapshot();
    activePrincipalRef.current = initialSnap.principal;
    activeRevisionRef.current = getAuthRevision();
    setSnapshot(initialSnap);

    if (initialSnap.state === "authenticated" && initialSnap.principal) {
      if (initialLifeSnap.visibility !== "hidden" && initialLifeSnap.online !== false) {
        flowsRef.current.list.fetchActiveSessions();
      } else {
        flowsRef.current.list.stopLoading();
      }
    } else {
      flowsRef.current.list.clearForUnauthenticated();
    }

    return () => {
      isEffectActive = false;
      runtime.isMounted = false;
      // 卸载时作废在途请求与操作，消除 StrictMode 下的残留阻断
      const { list, end, resume } = flowsRef.current;
      list.invalidateOnUnmount();
      end.invalidateOnUnmount();
      resume.invalidateOnUnmount();
      unsubscribeStore();
      unsubscribeAuth();
      unsubscribeLifecycle();
      adapter.dispose();
      runtime.lifecycleAdapter = null;
    };
  }, [runtimeRef]);

  return { snapshot, activeRevision: activeRevisionRef.current };
}
