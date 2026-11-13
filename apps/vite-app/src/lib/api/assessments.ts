/**
 * 评估（assessments）与课程推荐相关 API 与类型。
 */

import type { ApiRequestOptions, ApiSchemas, WithRequired } from "./client";
import { request } from "./client";
import { getZonedWeekWindows } from "../localDayWindow";
import {
  isNonNegativeSafeInteger,
  isPositiveSafeInteger,
  isValidIsoCalendarTimestamp,
} from "./callLease";

// ─── 评估相关类型 ───

/** 音素对齐条目 */
export type PhonemeAlignmentItem = Omit<ApiSchemas["PhonemeAlignmentItem"], "type"> & {
  type: "correct" | "substitution" | "deletion" | "insertion";
};

/** 发音评估响应 */
export type AssessmentResponse = Omit<
  WithRequired<
    ApiSchemas["AssessmentResponse"],
    "confidence" | "model_version" | "provider" | "provider_response_ref"
  >,
  "phoneme_alignment"
> & {
  phoneme_alignment: PhonemeAlignmentItem[];
};

/** 语法错误响应 */
export type GrammarErrorResponse = WithRequired<
  ApiSchemas["GrammarErrorResponse"],
  "confidence" | "model_version" | "provider"
>;

/** 知识状态响应 */
export type KnowledgeStateResponse = Omit<
  ApiSchemas["KnowledgeStateResponse"],
  "skill_category"
> & {
  skill_category: "pronunciation" | "grammar";
};

/** 技能定义响应 */
export type SkillResponse = Omit<
  WithRequired<ApiSchemas["SkillResponse"], "description">,
  "category"
> & {
  category: "pronunciation" | "grammar";
};

// ─── 课程推荐相关类型 ───

/** 单个课程推荐 */
export type CurriculumRecommendation = ApiSchemas["CurriculumRecommendation"];

/** 课程推荐响应 */
export type CurriculumNextResponse = ApiSchemas["CurriculumNextResponse"];

/** 由主控原生生成的新 schema 提供；不手写 api.generated.ts。 */
export type WeeklyGrammarSummary = ApiSchemas["WeeklyGrammarSummary"];
export type WeeklyGrammarItem = WeeklyGrammarSummary["items"][number];
export type WeeklyGrammarSkillTag = WeeklyGrammarItem["skill_tag"];

export function getAssessment(
  sessionId: string,
  options?: ApiRequestOptions,
): Promise<AssessmentResponse> {
  return request<AssessmentResponse>(`/assessments/${sessionId}`, {
    signal: options?.signal,
  });
}

/** 获取语法错误列表 */
export function getGrammarErrors(
  sessionId: string,
  options?: ApiRequestOptions,
): Promise<GrammarErrorResponse[]> {
  return request<GrammarErrorResponse[]>(`/assessments/${sessionId}/grammar`, {
    signal: options?.signal,
  });
}

/** 获取当前用户知识状态 */
export function getKnowledgeStates(options?: ApiRequestOptions): Promise<KnowledgeStateResponse[]> {
  return request<KnowledgeStateResponse[]>("/assessments/knowledge/states", {
    signal: options?.signal,
  });
}

/** 获取技能列表 */
export function getSkills(options?: ApiRequestOptions): Promise<SkillResponse[]> {
  return request<SkillResponse[]>("/assessments/knowledge/skills", {
    signal: options?.signal,
  });
}

// ─── 课程推荐 API ───

/** 获取自适应课程推荐 */
export function getRecommendedCurriculum(
  options?: ApiRequestOptions,
): Promise<CurriculumNextResponse> {
  return request<CurriculumNextResponse>("/curriculum/next", {
    signal: options?.signal,
  });
}

/** 七天语法聚合严格绑定本次请求的当地日期、时区与固定 Top 3 契约。 */
export function parseWeeklyGrammarSummary(
  data: unknown,
  endDate: string,
  timezone: string,
): WeeklyGrammarSummary {
  const windows = getZonedWeekWindows(endDate, timezone);
  const firstDay = windows[0];
  const lastDay = windows[windows.length - 1];
  const fail = () => new Error("Invalid weekly grammar response");
  const utcInstant = (value: unknown, expected: string): string => {
    if (
      typeof value !== "string" ||
      !isValidIsoCalendarTimestamp(value) ||
      !/(Z|\+00:00)$/.test(value) ||
      Date.parse(value) !== Date.parse(expected)
    ) {
      throw fail();
    }
    return value;
  };
  const skillTags: readonly WeeklyGrammarSkillTag[] = [
    "article_usage",
    "verb_tense_past",
    "verb_tense_present",
    "subject_verb_agreement",
    "preposition",
    "other",
  ];
  const validTag = (value: unknown): value is WeeklyGrammarSkillTag =>
    typeof value === "string" && skillTags.includes(value as WeeklyGrammarSkillTag);

  if (!data || typeof data !== "object" || Array.isArray(data)) throw fail();
  const root = data as Record<string, unknown>;
  if (Object.keys(root).length !== 4 || !Array.isArray(root.items)) throw fail();
  const start = utcInstant(root.start, firstDay.start);
  const end = utcInstant(root.end, lastDay.end);
  if (!isNonNegativeSafeInteger(root.total_errors) || root.items.length > 3) {
    throw fail();
  }

  const items = root.items.map((raw: unknown): WeeklyGrammarItem => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw fail();
    const item = raw as Record<string, unknown>;
    if (Object.keys(item).length !== 2 || !validTag(item.skill_tag)) throw fail();
    if (!isPositiveSafeInteger(item.count)) throw fail();
    return { skill_tag: item.skill_tag, count: item.count };
  });
  if (
    new Set(items.map((item) => item.skill_tag)).size !== items.length ||
    items.some((item, index) => index > 0 && items[index - 1].count < item.count) ||
    items.some(
      (item, index) =>
        index > 0 &&
        items[index - 1].count === item.count &&
        items[index - 1].skill_tag > item.skill_tag,
    ) ||
    items.reduce((sum, item) => sum + item.count, 0) > root.total_errors ||
    (root.total_errors === 0 && items.length > 0) ||
    (root.total_errors > 0 && items.length === 0)
  ) {
    throw fail();
  }
  return { start, end, total_errors: root.total_errors, items };
}

export async function getWeeklyGrammar(
  endDate: string,
  timezone: string,
  options?: ApiRequestOptions,
): Promise<WeeklyGrammarSummary> {
  getZonedWeekWindows(endDate, timezone);
  const query = new URLSearchParams({ end_date: endDate, timezone });
  const raw = await request<unknown>(`/assessments/weekly-grammar?${query.toString()}`, {
    cache: "no-store",
    signal: options?.signal,
  });
  return parseWeeklyGrammarSummary(raw, endDate, timezone);
}
