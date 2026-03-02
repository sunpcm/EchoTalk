/**
 * 轮询获取评估数据的自定义 Hook。
 * 当 sessionId 非空时开始获取；404 时指数退避重试；成功后停止。
 */

import { useEffect, useRef, useCallback } from "react";
import { useAssessmentStore } from "@/store/assessment";
import type { AssessmentLoadState } from "@/store/assessment";

/** 轮询配置 */
const INITIAL_DELAY_MS = 1000;
const MAX_DELAY_MS = 10000;
const BACKOFF_FACTOR = 2;
const MAX_RETRIES = 15;

export function usePollingAssessment(sessionId: string | null): AssessmentLoadState {
  const fetchAssessment = useAssessmentStore((s) => s.fetchAssessment);
  const fetchKnowledgeStates = useAssessmentStore((s) => s.fetchKnowledgeStates);
  const loadState = useAssessmentStore((s) => s.loadState);

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
        const loaded = await fetchAssessment(sessionId);
        if (cancelledRef.current) return;

        if (loaded) {
          // 成功 — 同时获取知识状态
          void fetchKnowledgeStates();
          return;
        }

        // 404 — 需要重试
        retriesRef.current += 1;
        if (retriesRef.current >= MAX_RETRIES || cancelledRef.current) {
          return;
        }

        const delay = Math.min(
          INITIAL_DELAY_MS * Math.pow(BACKOFF_FACTOR, retriesRef.current - 1),
          MAX_DELAY_MS,
        );
        timerRef.current = setTimeout(attempt, delay);
      } catch {
        // 真实错误（非 404），store 已设置 error 状态，停止轮询
      }
    };

    // 首次立即执行
    void attempt();

    return () => {
      cancelledRef.current = true;
      clearTimer();
    };
  }, [sessionId, fetchAssessment, fetchKnowledgeStates, clearTimer]);

  return loadState;
}
