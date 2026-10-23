/**
 * 评估数据状态管理 (zustand store)。
 * 管理发音评估、语法错误、知识状态的获取和加载状态。
 */

import { create } from "zustand";
import {
  getAssessment,
  getAnalysisStatus,
  getGrammarErrors,
  getKnowledgeStates,
  retryAnalysis,
  type AnalysisJobStatus,
  type AnalysisStatusResponse,
  type AssessmentResponse,
  type GrammarErrorResponse,
  type KnowledgeStateResponse,
} from "@/lib/api";

/** 评估数据加载状态 */
export type AssessmentLoadState =
  | "idle" // 未开始获取
  | "pending" // 分析任务排队中
  | "running" // Worker 正在分析
  | "loaded" // 数据加载完成
  | "failed" // 分析任务最终失败，可人工重试
  | "error"; // 非 404 的真实错误

/** Store 类型定义 */
interface AssessmentStore {
  /** 数据加载状态 */
  loadState: AssessmentLoadState;
  /** 发音评估数据 */
  assessment: AssessmentResponse | null;
  /** 语法错误列表 */
  grammarErrors: GrammarErrorResponse[];
  /** 知识状态列表 */
  knowledgeStates: KnowledgeStateResponse[];
  /** 错误信息 */
  error: string | null;
  /** 后端持久化任务状态 */
  job: AnalysisStatusResponse | null;
  /** 人工重试后触发 Hook 重建轮询循环 */
  pollVersion: number;

  /**
   * 刷新持久化任务状态；成功后并行加载评估和语法结果。
   * 支持可选 isCurrent 谓词参数，在发送前、状态后、结果GET前及数据/错误写入前核验。
   */
  refreshAnalysis: (
    sessionId: string,
    isCurrent?: () => boolean,
  ) => Promise<AnalysisJobStatus | null>;
  /** 人工重试最终失败或超时任务 */
  retryFailedAnalysis: (sessionId: string) => Promise<void>;
  /** 获取知识状态（静默，失败不阻塞，支持可选 isCurrent 谓词） */
  fetchKnowledgeStates: (isCurrent?: () => boolean) => Promise<void>;
  /** 重置 store（新一轮对话时调用，必须递增操作代际且不重置为0） */
  reset: () => void;
}

let assessmentGeneration = 0;

export const useAssessmentStore = create<AssessmentStore>((set) => ({
  loadState: "idle",
  assessment: null,
  grammarErrors: [],
  knowledgeStates: [],
  error: null,
  job: null,
  pollVersion: 0,

  refreshAnalysis: async (
    sessionId: string,
    isCurrent?: () => boolean,
  ): Promise<AnalysisJobStatus | null> => {
    const gen = assessmentGeneration;

    // 读取发送前核验
    if (isCurrent && !isCurrent()) {
      return null;
    }

    try {
      const job = await getAnalysisStatus(sessionId);

      // status 之后核验
      if (isCurrent && !isCurrent()) {
        return null;
      }
      if (assessmentGeneration !== gen) {
        return job.status;
      }

      if (job.status === "pending" || job.status === "running") {
        // 数据写前核验
        if (isCurrent && !isCurrent()) {
          return null;
        }
        set({ loadState: job.status, job, error: null });
        return job.status;
      }

      if (job.status === "failed") {
        // 失败写前核验
        if (isCurrent && !isCurrent()) {
          return null;
        }
        set({
          loadState: "failed",
          job,
          error: job.error_code ?? "analysis_failed",
        });
        return job.status;
      }

      // status 之后结果 GET 之前核验
      if (isCurrent && !isCurrent()) {
        return null;
      }

      const [assessment, grammarErrors] = await Promise.all([
        getAssessment(sessionId),
        getGrammarErrors(sessionId),
      ]);

      // 结果数据写前核验
      if (isCurrent && !isCurrent()) {
        return null;
      }
      if (assessmentGeneration !== gen) {
        return job.status;
      }

      set({
        loadState: "loaded",
        assessment,
        grammarErrors,
        job,
        error: null,
      });
      return job.status;
    } catch (err) {
      // 失败写前核验：predicate失效则不发后续请求、不写旧数据/错误，也不抛出未处理拒绝
      if (isCurrent && !isCurrent()) {
        return null;
      }
      if (assessmentGeneration === gen) {
        set({
          loadState: "error",
          error: err instanceof Error ? err.message : "加载评估数据失败",
        });
      }
      throw err;
    }
  },

  retryFailedAnalysis: async (sessionId: string) => {
    const gen = assessmentGeneration;
    try {
      const job = await retryAnalysis(sessionId);
      if (assessmentGeneration !== gen) {
        return;
      }
      set((state) => ({
        loadState: "pending",
        job,
        error: null,
        pollVersion: state.pollVersion + 1,
      }));
    } catch (err) {
      if (assessmentGeneration === gen) {
        set({
          loadState: "error",
          error: err instanceof Error ? err.message : "重试分析失败",
        });
      }
      throw err;
    }
  },

  fetchKnowledgeStates: async (isCurrent?: () => boolean) => {
    const gen = assessmentGeneration;

    // knowledge 发送前核验
    if (isCurrent && !isCurrent()) {
      return;
    }

    try {
      const states = await getKnowledgeStates();

      // knowledge 写入前核验
      if (isCurrent && !isCurrent()) {
        return;
      }
      if (assessmentGeneration !== gen) {
        return;
      }
      set({ knowledgeStates: states });
    } catch {
      // 知识状态加载失败不阻塞主流程
    }
  },

  reset: () => {
    assessmentGeneration += 1;
    set({
      loadState: "idle",
      assessment: null,
      grammarErrors: [],
      knowledgeStates: [],
      error: null,
      job: null,
      pollVersion: 0,
    });
  },
}));
