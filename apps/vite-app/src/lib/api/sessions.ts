/**
 * 会话（sessions）相关 API 与类型。
 */

import type { ApiRequestOptions, ApiSchemas, WithRequired } from "./client";
import { request } from "./client";
import { getZonedWeekWindows } from "../localDayWindow";
import {
  isNonNegativeSafeInteger,
  isValidIsoCalendarTimestamp,
  isValidUuid,
  validateCallLeaseOwner,
  validateUuid,
  type CallLeaseOwner,
} from "./callLease";

/** 转录记录类型 */
export type Transcript = Omit<
  WithRequired<ApiSchemas["TranscriptResponse"], "audio_url">,
  "role"
> & {
  role: "user" | "assistant";
};

/** 会话对象类型 */
export type Session = Omit<
  WithRequired<ApiSchemas["SessionResponse"], "ended_at">,
  "transcripts"
> & {
  transcripts: Transcript[];
};

/** 令牌响应类型 */
export interface TokenResponse {
  token: string;
  ws_url: string;
}

/** 会话列表项（不含转录）；保留客户端要求 ended_at 必须存在的既有契约。 */
export type SessionListItem = WithRequired<ApiSchemas["SessionListItem"], "ended_at">;

/** 会话分页列表响应；items 复用同一领域适配类型，next_cursor 保持必需。 */
export type SessionListResponse = Omit<
  WithRequired<ApiSchemas["SessionListResponse"], "next_cursor">,
  "items"
> & {
  items: SessionListItem[];
};

/** 每日进度聚合统计响应 */
export type DailyProgressResponse = ApiSchemas["DailyProgressResponse"];

/** 由主控原生生成的新 schema 提供；不手写 api.generated.ts。 */
export type WeeklyProgressResponse = ApiSchemas["WeeklyProgressResponse"];
export type WeeklyProgressDay = WeeklyProgressResponse["days"][number];

export type AnalysisJobStatus = "pending" | "running" | "succeeded" | "failed";

export type AnalysisStatusResponse = Omit<
  WithRequired<ApiSchemas["AnalysisStatusResponse"], "error_code" | "started_at" | "finished_at">,
  "status"
> & {
  status: AnalysisJobStatus;
};

/** 文档对话上下文 */
export type DocContext = ApiSchemas["DocContext"];

/** 创建会话请求体 */
export type CreateSessionBody = Omit<ApiSchemas["SessionCreate"], "doc_context"> & {
  doc_context?: DocContext;
};

/** 创建会话 */
export function createSession(
  mode: string,
  docContext?: DocContext,
  options?: ApiRequestOptions,
): Promise<Session> {
  const body: CreateSessionBody = { mode };
  if (docContext) {
    body.doc_context = docContext;
  }
  return request<Session>("/sessions", {
    method: "POST",
    body: JSON.stringify(body),
    signal: options?.signal,
  });
}

/** 获取 LiveKit 房间令牌（支持可选通话租约 owner 门禁） */
export async function getSessionToken(
  sessionId: string,
  owner?: CallLeaseOwner,
  options?: ApiRequestOptions,
): Promise<TokenResponse> {
  if (owner === undefined) {
    return request<TokenResponse>(`/sessions/${sessionId}/token`, {
      signal: options?.signal,
    });
  }
  validateUuid(sessionId, "sessionId");
  const validatedOwner = validateCallLeaseOwner(owner);
  return request<TokenResponse>(`/sessions/${sessionId}/token`, {
    headers: {
      "X-Call-Device-Id": validatedOwner.device_id,
      "X-Call-Generation": String(validatedOwner.generation),
    },
    signal: options?.signal,
  });
}

/** 结束会话 */
export function endSession(sessionId: string, options?: ApiRequestOptions): Promise<Session> {
  return request<Session>(`/sessions/${sessionId}/end`, {
    method: "POST",
    signal: options?.signal,
  });
}

/** 请求后端调度 AI Agent 进入房间（前端已连接后调用，支持可选通话租约 owner 门禁） */
export async function dispatchAgent(
  sessionId: string,
  owner?: CallLeaseOwner,
  options?: ApiRequestOptions,
): Promise<{ dispatched: boolean }> {
  if (owner === undefined) {
    return request<{ dispatched: boolean }>(`/sessions/${sessionId}/dispatch`, {
      method: "POST",
      signal: options?.signal,
    });
  }
  validateUuid(sessionId, "sessionId");
  const validatedOwner = validateCallLeaseOwner(owner);
  return request<{ dispatched: boolean }>(`/sessions/${sessionId}/dispatch`, {
    method: "POST",
    headers: {
      "X-Call-Device-Id": validatedOwner.device_id,
      "X-Call-Generation": String(validatedOwner.generation),
    },
    signal: options?.signal,
  });
}

export interface ListSessionsParams {
  status?: string;
  start?: string;
  end?: string;
  limit?: number;
  cursor?: string;
}

export interface ListActiveSessionsParams {
  start?: string;
  end?: string;
  limit?: number;
  cursor?: string;
}

/** 校验并解析会话列表分页响应 */
export function parseSessionListResponse(data: unknown): SessionListResponse {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("Invalid session list response: expected an object");
  }
  const obj = data as Record<string, unknown>;
  if (!Array.isArray(obj.items)) {
    throw new Error("Invalid session list response: items must be an array");
  }
  if (obj.items.length > 100) {
    throw new Error("Invalid session list response: items length exceeds maximum limit of 100");
  }
  if (obj.next_cursor !== null) {
    if (typeof obj.next_cursor !== "string") {
      throw new Error("Invalid session list response: next_cursor must be string or null");
    }
    if (obj.next_cursor.length === 0) {
      throw new Error("Invalid session list response: next_cursor cannot be an empty string");
    }
    if (obj.next_cursor.length > 1024) {
      throw new Error("Invalid session list response: next_cursor length exceeds 1024");
    }
  }
  for (const rawItem of obj.items) {
    if (typeof rawItem !== "object" || rawItem === null || Array.isArray(rawItem)) {
      throw new Error("Invalid session list item: expected an object");
    }
    const item = rawItem as Record<string, unknown>;
    if (!isValidUuid(item.id)) {
      throw new Error("Invalid session list item: id must be a valid UUID string");
    }
    if (typeof item.mode !== "string" || item.mode.length === 0) {
      throw new Error("Invalid session list item: mode must be a non-empty string");
    }
    if (typeof item.status !== "string" || item.status.length === 0) {
      throw new Error("Invalid session list item: status must be a non-empty string");
    }
    if (!isValidIsoCalendarTimestamp(item.started_at)) {
      throw new Error(
        "Invalid session list item: started_at must be an ISO calendar timestamp with timezone",
      );
    }
    if (!("ended_at" in item)) {
      throw new Error("Invalid session list item: ended_at is required");
    }
    if (item.ended_at !== null) {
      if (!isValidIsoCalendarTimestamp(item.ended_at)) {
        throw new Error(
          "Invalid session list item: ended_at must be null or an ISO calendar timestamp with timezone",
        );
      }
    }
  }
  return {
    items: obj.items as SessionListItem[],
    next_cursor: obj.next_cursor as string | null,
  };
}

/** 校验并解析每日进度聚合统计响应 */
export function parseDailyProgressResponse(data: unknown): DailyProgressResponse {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("Invalid daily progress response: expected an object");
  }
  const obj = data as Record<string, unknown>;
  if (!isNonNegativeSafeInteger(obj.completed_sessions)) {
    throw new Error(
      "Invalid daily progress response: completed_sessions must be a non-negative integer",
    );
  }
  if (!isNonNegativeSafeInteger(obj.total_turns)) {
    throw new Error("Invalid daily progress response: total_turns must be a non-negative integer");
  }
  return {
    completed_sessions: obj.completed_sessions,
    total_turns: obj.total_turns,
  };
}

/** 列出当前用户的会话（支持 keyset 游标分页、状态过滤与时间窗口） */
export async function listSessions(
  params?: ListSessionsParams,
  options?: ApiRequestOptions,
): Promise<SessionListResponse> {
  const query = new URLSearchParams();
  if (params?.status) query.set("status", params.status);
  if (params?.start) query.set("start", params.start);
  if (params?.end) query.set("end", params.end);
  if (params?.limit !== undefined) query.set("limit", String(params.limit));
  if (params?.cursor) query.set("cursor", params.cursor);
  const qStr = query.toString();
  const raw = await request<unknown>(`/sessions${qStr ? `?${qStr}` : ""}`, {
    signal: options?.signal,
  });
  return parseSessionListResponse(raw);
}

/** 列出当前已认证用户的活跃会话记录（支持 keyset 游标分页与时间窗口） */
export async function listActiveSessions(
  params?: ListActiveSessionsParams,
  options?: ApiRequestOptions,
): Promise<SessionListResponse> {
  const query = new URLSearchParams();
  if (params?.start) query.set("start", params.start);
  if (params?.end) query.set("end", params.end);
  if (params?.limit !== undefined) query.set("limit", String(params.limit));
  if (params?.cursor) query.set("cursor", params.cursor);
  const qStr = query.toString();
  const raw = await request<unknown>(`/sessions/active${qStr ? `?${qStr}` : ""}`, {
    signal: options?.signal,
  });
  return parseSessionListResponse(raw);
}

/** 获取每日练习聚合统计（单次服务端聚合指定窗口内已完成会话数及转录条数） */
export async function getDailyProgress(
  start: string,
  end: string,
  options?: ApiRequestOptions,
): Promise<DailyProgressResponse> {
  const query = new URLSearchParams({ start, end });
  const raw = await request<unknown>(`/sessions/daily-progress?${query.toString()}`, {
    signal: options?.signal,
  });
  return parseDailyProgressResponse(raw);
}

/** 七桶严格绑定本次请求的当地日期和时区，不接受归属不明或部分成功。 */
export function parseWeeklyProgressResponse(
  data: unknown,
  endDate: string,
  timezone: string,
): WeeklyProgressResponse {
  const expected = getZonedWeekWindows(endDate, timezone);
  const fail = () => new Error("Invalid weekly progress response");
  if (!data || typeof data !== "object" || Array.isArray(data)) throw fail();
  const root = data as Record<string, unknown>;
  if (Object.keys(root).length !== 1 || !Array.isArray(root.days) || root.days.length !== 7) {
    throw fail();
  }
  const days = root.days.map((raw: unknown, index: number) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw fail();
    const day = raw as Record<string, unknown>;
    if (
      Object.keys(day).length !== 4 ||
      day.date !== expected[index].date ||
      !isValidIsoCalendarTimestamp(day.start) ||
      !isValidIsoCalendarTimestamp(day.end) ||
      !/(Z|\+00:00)$/.test(day.start) ||
      !/(Z|\+00:00)$/.test(day.end) ||
      Date.parse(day.start) !== Date.parse(expected[index].start) ||
      Date.parse(day.end) !== Date.parse(expected[index].end) ||
      !isNonNegativeSafeInteger(day.completed_sessions) ||
      (Date.parse(day.start) === Date.parse(day.end) && day.completed_sessions !== 0)
    ) {
      throw fail();
    }
    return {
      date: day.date as string,
      start: day.start,
      end: day.end,
      completed_sessions: day.completed_sessions,
    };
  });
  return { days };
}

export async function getWeeklyProgress(
  endDate: string,
  timezone: string,
  options?: ApiRequestOptions,
): Promise<WeeklyProgressResponse> {
  getZonedWeekWindows(endDate, timezone);
  const query = new URLSearchParams({ end_date: endDate, timezone });
  const raw = await request<unknown>(`/sessions/weekly-progress?${query.toString()}`, {
    cache: "no-store",
    signal: options?.signal,
  });
  return parseWeeklyProgressResponse(raw, endDate, timezone);
}

/** 七天语法聚合严格绑定本次请求的当地日期、时区与固定 Top 3 契约。 */

/** 获取会话详情（含转录记录） */
export function getSessionDetail(sessionId: string, options?: ApiRequestOptions): Promise<Session> {
  return request<Session>(`/sessions/${sessionId}`, {
    signal: options?.signal,
  });
}

/** 获取持久化分析任务状态 */
export function getAnalysisStatus(
  sessionId: string,
  options?: ApiRequestOptions,
): Promise<AnalysisStatusResponse> {
  return request<AnalysisStatusResponse>(`/sessions/${sessionId}/analysis-status`, {
    signal: options?.signal,
  });
}

/** 重试最终失败或已超时的分析任务 */
export function retryAnalysis(
  sessionId: string,
  options?: ApiRequestOptions,
): Promise<AnalysisStatusResponse> {
  return request<AnalysisStatusResponse>(`/sessions/${sessionId}/analysis-retry`, {
    method: "POST",
    signal: options?.signal,
  });
}
