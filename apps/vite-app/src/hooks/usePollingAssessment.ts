/**
 * 轮询获取评估数据的自定义 Hook。
 * 当 sessionId 非空时轮询显式任务状态；成功或失败后停止。
 */

import { useEffect, useRef, useCallback } from "react";
import { useAssessmentStore } from "@/store/assessment";
import type { AssessmentLoadState } from "@/store/assessment";

/** 轮询配置 */
const INITIAL_DELAY_MS = 1000;
const MAX_DELAY_MS = 5000;
const BACKOFF_FACTOR = 2;

export function usePollingAssessment(sessionId: string | null): AssessmentLoadState {
  const refreshAnalysis = useAssessmentStore((s) => s.refreshAnalysis);
  const fetchKnowledgeStates = useAssessmentStore((s) => s.fetchKnowledgeStates);
  const loadState = useAssessmentStore((s) => s.loadState);
  const pollVersion = useAssessmentStore((s) => s.pollVersion);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retriesRef = useRef(0);
  const cancelledRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!sessionId) return;

    cancelledRef.current = false;
    retriesRef.current = 0;

    const attempt = async () => {
      if (cancelledRef.current) return;

      try {
        const status = await refreshAnalysis(sessionId);
        if (cancelledRef.current) return;

        if (status === "succeeded") {
          void fetchKnowledgeStates();
          return;
        }
        if (status === "failed") return;

        retriesRef.current += 1;
        if (cancelledRef.current) return;

        const delay = Math.min(
          INITIAL_DELAY_MS * Math.pow(BACKOFF_FACTOR, retriesRef.current - 1),
          MAX_DELAY_MS,
        );
        timerRef.current = setTimeout(attempt, delay);
      } catch {
        // 网络或协议错误由 store 显示；停止自动重试，避免请求风暴。
      }
    };

    // 首次立即执行
    void attempt();

    return () => {
      cancelledRef.current = true;
      clearTimer();
    };
  }, [sessionId, pollVersion, refreshAnalysis, fetchKnowledgeStates, clearTimer]);

  return loadState;
}
