/**
 * 轮询获取评估数据的自定义 Hook。
 * 接入跨平台生命周期适配器与认证代际隔离：
 * - 当 sessionId 非空且已认证时启动轮询；
 * - 页面后台/离线时立即作废本轮读取并清理定时器；
 * - 恢复前台或网络时立即重新发起查询，在途请求自动合并；
 * - 认证变更/卸载/代际变更时全面隔离旧响应。
 */

import { useEffect } from "react";
import { useAssessmentStore } from "@/store/assessment";
import type { AssessmentLoadState } from "@/store/assessment";
import {
  getAuthSnapshot,
  getAuthRevision,
  subscribeAuthSnapshot,
  arePrincipalsEqual,
} from "@/lib/auth";
import {
  createLifecycleAdapter,
  type WebLifecycleOptions,
  type WebLifecycleSnapshot,
  type WebLifecycleEvent,
} from "@/platform";

/** 轮询配置 */
const INITIAL_DELAY_MS = 1000;
const MAX_DELAY_MS = 5000;
const BACKOFF_FACTOR = 2;

export interface UsePollingAssessmentOptions {
  lifecycleOptions?: WebLifecycleOptions;
}

export function usePollingAssessment(
  sessionId: string | null,
  options?: UsePollingAssessmentOptions,
): AssessmentLoadState {
  const refreshAnalysis = useAssessmentStore((s) => s.refreshAnalysis);
  const fetchKnowledgeStates = useAssessmentStore((s) => s.fetchKnowledgeStates);
  const loadState = useAssessmentStore((s) => s.loadState);
  const pollVersion = useAssessmentStore((s) => s.pollVersion);

  useEffect(() => {
    if (!sessionId) {
      return;
    }

    // 初始认证检查：非空 sessionId 且认证快照 authenticated/principal 有效才自动读取
    // 无 session/无认证不读或监听
    const initialAuthSnap = getAuthSnapshot();
    const initialAuthRevision = getAuthRevision();
    if (initialAuthSnap.state !== "authenticated" || !initialAuthSnap.principal) {
      return;
    }

    const boundRevision = initialAuthRevision;
    const boundPrincipal = initialAuthSnap.principal;

    let isEffectActive = true;
    let cycleId = 0;
    let inFlight = false;
    let retriesCount = 0;
    let timerId: ReturnType<typeof setTimeout> | null = null;

    const clearTimer = () => {
      if (timerId !== null) {
        clearTimeout(timerId);
        timerId = null;
      }
    };

    const isAuthValid = () => {
      if (getAuthRevision() !== boundRevision) return false;
      const snap = getAuthSnapshot();
      if (snap.state !== "authenticated" || !snap.principal) return false;
      return arePrincipalsEqual(snap.principal, boundPrincipal);
    };

    // 先 subscribe 再 getSnapshot 消除空窗
    const adapter = createLifecycleAdapter({
      webOptions: options?.lifecycleOptions,
    });

    const isEligibleSnapshot = (snapshot: WebLifecycleSnapshot): boolean => {
      return snapshot.visibility !== "hidden" && snapshot.online !== false;
    };

    const invalidateCycle = () => {
      cycleId++;
      clearTimer();
      inFlight = false;
    };

    const attempt = async () => {
      if (!isEffectActive || !isAuthValid()) {
        return;
      }
      if (inFlight) {
        return;
      }

      const activeCycle = cycleId;
      inFlight = true;

      const isCurrent = () => {
        if (!isEffectActive) return false;
        if (cycleId !== activeCycle) return false;
        if (!isAuthValid()) return false;
        const snap = adapter.getSnapshot();
        if (snap.visibility === "hidden" || snap.online === false) return false;
        return true;
      };

      try {
        const status = await refreshAnalysis(sessionId, isCurrent);

        // 读取 success 后的同步 store 通知可能取消/换号，必须再次核验后才发 knowledge/排 timer
        if (!isCurrent()) {
          return;
        }

        if (status === "succeeded") {
          await fetchKnowledgeStates(isCurrent);
          return;
        }

        if (status === "failed") {
          return;
        }

        if (status === "pending" || status === "running") {
          retriesCount += 1;
          const delay = Math.min(
            INITIAL_DELAY_MS * Math.pow(BACKOFF_FACTOR, retriesCount - 1),
            MAX_DELAY_MS,
          );
          clearTimer();
          timerId = setTimeout(() => {
            timerId = null;
            void attempt();
          }, delay);
        }
      } catch {
        // 网络或协议错误由 store 显示；停止自动重试，避免请求风暴。
      } finally {
        if (cycleId === activeCycle) {
          inFlight = false;
        }
      }
    };

    const triggerRead = () => {
      if (!isEffectActive || !isAuthValid()) {
        return;
      }
      // 重复合格事件和 timer 在当前有效请求在途时合并，不排队
      if (inFlight) {
        return;
      }
      clearTimer();
      void attempt();
    };

    const unsubLifecycle = adapter.subscribe((event: WebLifecycleEvent) => {
      if (!isEffectActive || !isAuthValid()) {
        return;
      }

      if (
        event.type === "suspend" ||
        (event.type === "connectivity" && event.snapshot.online === false)
      ) {
        // suspend/pagehide 或 online=false 立即作废本轮读取/清 timer 并释放槽位
        invalidateCycle();
        return;
      }

      if (event.type === "resume") {
        // 恢复事件仅 visible 且非 offline 时立即读一次
        if (event.snapshot.visibility === "visible" && event.snapshot.online !== false) {
          triggerRead();
        }
        return;
      }

      if (event.type === "connectivity") {
        // connectivity 仅 online true 且非 hidden 时立即读一次
        if (event.snapshot.online === true && event.snapshot.visibility !== "hidden") {
          triggerRead();
        }
        return;
      }
    });

    const unsubAuth = subscribeAuthSnapshot((nextSnap) => {
      if (
        !isEffectActive ||
        nextSnap.state !== "authenticated" ||
        !arePrincipalsEqual(nextSnap.principal, boundPrincipal) ||
        getAuthRevision() !== boundRevision
      ) {
        invalidateCycle();
      }
    });

    // 先 subscribe 再 getSnapshot 消除空窗
    const initialLifecycleSnapshot = adapter.getSnapshot();
    if (isEligibleSnapshot(initialLifecycleSnapshot)) {
      triggerRead();
    }

    return () => {
      isEffectActive = false;
      invalidateCycle();
      unsubAuth();
      unsubLifecycle();
      adapter.dispose();
    };
  }, [sessionId, pollVersion, refreshAnalysis, fetchKnowledgeStates, options?.lifecycleOptions]);

  return loadState;
}
