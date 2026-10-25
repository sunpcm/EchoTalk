/**
 * 后端 API 客户端封装。
 * 所有对 FastAPI 后端的请求通过此模块统一管理。
 */

import { getApiBaseUrl } from "@/utils/env";
import { getAccessToken, getAuthRevision, invalidateAuthSession } from "@/lib/auth";
import { zhCN } from "@/i18n/zh-CN";
import { logDiagnostic } from "@/lib/diagnostics";

let cachedBaseUrl: string | null = null;
export function getBaseUrl(): string {
  if (cachedBaseUrl === null) {
    cachedBaseUrl = getApiBaseUrl();
  }
  return cachedBaseUrl;
}

/** API 错误类，携带 HTTP 状态码用于区分 404 等场景 */
export class ApiError extends Error {
  public data?: any;
  constructor(
    public readonly status: number,
    message: string,
    data?: any,
  ) {
    super(message);
    this.name = "ApiError";
    this.data = data;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getFirstTruthyString(record: Record<string, unknown>): string | null {
  const values = Object.values(record);
  if (values.length > 0 && typeof values[0] === "string" && values[0]) {
    return values[0];
  }
  return null;
}

/** 通用请求封装 */
async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const baseUrl = getBaseUrl();
  const reqRevision = getAuthRevision();
  const accessToken = await getAccessToken();

  if (getAuthRevision() !== reqRevision) {
    throw new Error(zhCN.auth.sessionChanged);
  }

  const headers = new Headers(options?.headers);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }
  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers,
    });
  } catch (error) {
    logDiagnostic("api_network_failed");
    throw error;
  }

  if (!res.ok) {
    logDiagnostic("api_http_failed", { status: res.status });
    if (res.status === 401) {
      invalidateAuthSession(reqRevision);
    }
    const body = await res.json().catch(() => ({}));

    let message = `请求失败: ${res.status}`;
    if (isRecord(body)) {
      if (typeof body.detail === "string") {
        // 1. 标准 FastAPI 异常 (HTTPException(detail="xxx"))
        message = body.detail;
      } else if (Array.isArray(body.detail) && body.detail.length > 0) {
        // 2. FastAPI 验证异常 (422 Unprocessable Entity - validation errors)
        const firstError = body.detail[0];
        if (isRecord(firstError) && typeof firstError.msg === "string") {
          let errorLoc = "Unknown";
          if (Array.isArray(firstError.loc)) {
            const isAllValid = firstError.loc.every(
              (part): part is string | number =>
                typeof part === "string" || typeof part === "number",
            );
            if (isAllValid) {
              errorLoc = firstError.loc.join(".");
            }
          }
          message = `数据验证失败 (${errorLoc}): ${firstError.msg}`;
        }
      } else if (isRecord(body.detail)) {
        // 3. 嵌套的自定义字典对象 (如 /health/ready 的 detail: { errors: {...} })
        if (isRecord(body.detail.errors)) {
          const firstErr = getFirstTruthyString(body.detail.errors);
          if (firstErr) {
            message = firstErr;
          }
        } else if (typeof body.detail.message === "string" && body.detail.message) {
          message = body.detail.message;
        } else if (
          !("errors" in body.detail) &&
          (!("message" in body.detail) || body.detail.message === "")
        ) {
          try {
            message = JSON.stringify(body.detail); // 兜底返回完整 JSON 字符串避免 [object Object]
          } catch {
            // 忽略序列化异常，保留原 message 兜底
          }
        }
      } else if (isRecord(body.errors)) {
        // 4. 其他结构或未通过 detail 包装的字典
        const firstErr = getFirstTruthyString(body.errors);
        if (firstErr) {
          message = firstErr;
        }
      } else if (typeof body.message === "string") {
        // 5. 兜底解析 message 字段
        message = body.message;
      }
    }

    throw new ApiError(res.status, message, body);
  }

  return res.json();
}

// ─── 会话相关类型 ───

/** 会话对象类型 */
export interface Session {
  id: string;
  user_id: string;
  mode: string;
  status: string;
  started_at: string;
  ended_at: string | null;
  transcripts: Transcript[];
}

/** 转录记录类型 */
export interface Transcript {
  id: number;
  session_id: string;
  role: "user" | "assistant";
  content: string;
  audio_url: string | null;
  timestamp_ms: number;
}

/** 令牌响应类型 */
export interface TokenResponse {
  token: string;
  ws_url: string;
}

// ─── 评估相关类型 ───

/** 音素对齐条目 */
export interface PhonemeAlignmentItem {
  position: number;
  phoneme: string;
  expected: string | null;
  actual: string | null;
  type: "correct" | "substitution" | "deletion" | "insertion";
}

/** 发音评估响应 */
export interface AssessmentResponse {
  id: string;
  session_id: string;
  overall_score: number;
  phoneme_alignment: PhonemeAlignmentItem[];
  source: string;
  provider: string | null;
  model_version: string | null;
  is_synthetic: boolean;
  confidence: number | null;
  provider_response_ref: string | null;
  created_at: string;
}

/** 语法错误响应 */
export interface GrammarErrorResponse {
  id: string;
  session_id: string;
  skill_tag: string;
  original: string;
  corrected: string;
  error_type: string;
  source: string;
  provider: string | null;
  model_version: string | null;
  is_synthetic: boolean;
  confidence: number | null;
  created_at: string;
}

/** 知识状态响应 */
export interface KnowledgeStateResponse {
  id: string;
  user_id: string;
  skill_id: string;
  skill_name: string;
  skill_category: "pronunciation" | "grammar";
  p_mastery: number;
  updated_at: string;
}

/** 技能定义响应 */
export interface SkillResponse {
  id: string;
  name: string;
  category: "pronunciation" | "grammar";
  description: string | null;
}

// ─── 课程推荐相关类型 ───

/** 单个课程推荐 */
export interface CurriculumRecommendation {
  scenario_name: string;
  difficulty_cefr: string;
  category: string;
  focus_skills: string[];
  system_prompt_template: string;
}

/** 课程推荐响应 */
export interface CurriculumNextResponse {
  weakest_skill: string;
  weakest_skill_mastery: number;
  target_level: string;
  recommendations: CurriculumRecommendation[];
}

/** 会话列表项（不含转录） */
export interface SessionListItem {
  id: string;
  mode: string;
  status: string;
  started_at: string;
  ended_at: string | null;
}

/** 会话分页列表响应 */
export interface SessionListResponse {
  items: SessionListItem[];
  next_cursor: string | null;
}

/** 每日进度聚合统计响应 */
export interface DailyProgressResponse {
  completed_sessions: number;
  total_turns: number;
}

export type AnalysisJobStatus = "pending" | "running" | "succeeded" | "failed";

export interface AnalysisStatusResponse {
  session_id: string;
  status: AnalysisJobStatus;
  attempt_count: number;
  error_code: string | null;
  retryable: boolean;
  started_at: string | null;
  finished_at: string | null;
  updated_at: string;
}

// ─── 通话能力 API ───

export type CallLeaseMode = "disabled" | "livekit_cloud";

export interface CallCapabilitiesResponse {
  protocol_version: 1;
  call_lease_mode: CallLeaseMode;
}

/** 校验并解析通话协议能力响应，严格要求精确两字段、protocol_version=1 及合法 mode */
export function parseCallCapabilities(data: unknown): CallCapabilitiesResponse {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("Invalid capabilities response: expected an object");
  }
  const keys = Object.keys(data);
  if (
    keys.length !== 2 ||
    !keys.includes("protocol_version") ||
    !keys.includes("call_lease_mode")
  ) {
    throw new Error(
      `Invalid capabilities response: expected exactly protocol_version and call_lease_mode, got [${keys.join(", ")}]`,
    );
  }
  const obj = data as Record<string, unknown>;
  if (obj.protocol_version !== 1) {
    throw new Error(`Unsupported capabilities protocol_version: ${String(obj.protocol_version)}`);
  }
  if (obj.call_lease_mode !== "disabled" && obj.call_lease_mode !== "livekit_cloud") {
    throw new Error(`Unsupported call_lease_mode: ${String(obj.call_lease_mode)}`);
  }
  return {
    protocol_version: 1,
    call_lease_mode: obj.call_lease_mode,
  };
}

/** 获取通话协议能力，设置 fetch 的 cache: "no-store" */
export async function getCallCapabilities(): Promise<CallCapabilitiesResponse> {
  const raw = await request<unknown>("/call-capabilities", {
    cache: "no-store",
  });
  return parseCallCapabilities(raw);
}

// ─── 通话占用 API（CP-02 §9） ───

export interface CallLeaseOwner {
  device_id: string;
  generation: number;
}

export interface CallLeaseResponse {
  session_id: string;
  device_id: string;
  generation: number;
  state: "held";
  expires_at: string;
}

export interface CallReleaseResponse {
  released: true;
  generation: number;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(val: unknown): val is string {
  return typeof val === "string" && UUID_REGEX.test(val);
}

export function isPositiveSafeInteger(val: unknown): val is number {
  return typeof val === "number" && Number.isSafeInteger(val) && val > 0;
}

export function isNonNegativeSafeInteger(val: unknown): val is number {
  return typeof val === "number" && Number.isSafeInteger(val) && val >= 0;
}

const ISO_DATE_REGEX =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/;

/**
 * 严格校验 ISO 8601 日历时间戳及明确时区（Z 或 ±HH:MM）。
 * 不使用仅靠 Date.parse 会把不存在的日历日期（如平年 2-29 或 4-31）自动滚进归一化的宽松解析。
 */
export function isValidIsoCalendarTimestamp(val: unknown): val is string {
  if (typeof val !== "string") return false;
  const match = ISO_DATE_REGEX.exec(val);
  if (!match) return false;

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);
  const hour = parseInt(match[4], 10);
  const minute = parseInt(match[5], 10);
  const second = parseInt(match[6], 10);
  const tz = match[8];

  if (year < 1 || year > 9999) return false;
  if (month < 1 || month > 12) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;

  const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day < 1 || day > daysInMonth[month - 1]) return false;

  if (tz !== "Z") {
    const tzH = parseInt(tz.slice(1, 3), 10);
    const tzM = parseInt(tz.slice(4, 6), 10);
    if (tzH > 23 || tzM > 59) return false;
  }

  return !Number.isNaN(Date.parse(val));
}

function validateUuid(value: unknown, name: string): string {
  if (!isValidUuid(value)) {
    throw new Error(`Invalid ${name}: expected a valid UUID string`);
  }
  return value;
}

function validatePositiveSafeInteger(value: unknown, name: string): number {
  if (!isPositiveSafeInteger(value)) {
    throw new Error(`Invalid ${name}: expected a positive safe integer`);
  }
  return value;
}

export function validateCallLeaseOwner(owner: unknown): CallLeaseOwner {
  if (typeof owner !== "object" || owner === null || Array.isArray(owner)) {
    throw new Error("Invalid owner: expected an object");
  }
  const o = owner as Partial<CallLeaseOwner>;
  validateUuid(o.device_id, "owner.device_id");
  validatePositiveSafeInteger(o.generation, "owner.generation");
  return {
    device_id: o.device_id as string,
    generation: o.generation as number,
  };
}

/** 校验并解析 claim/heartbeat 成功响应，精确五字段、UUID 对应、正安全整数 generation、held 状态及严格日历 ISO 时间 */
export function parseCallLeaseResponse(
  data: unknown,
  expectedSessionId: string,
  expectedDeviceId: string,
  expectedGeneration?: number,
): CallLeaseResponse {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("Invalid lease response: expected an object");
  }
  const keys = Object.keys(data);
  const requiredKeys = ["session_id", "device_id", "generation", "state", "expires_at"];
  if (
    keys.length !== 5 ||
    !requiredKeys.every((k) => Object.prototype.hasOwnProperty.call(data, k))
  ) {
    throw new Error(
      `Invalid lease response: expected exactly [${requiredKeys.join(", ")}], got [${keys.join(", ")}]`,
    );
  }
  const obj = data as Record<string, unknown>;

  if (!isValidUuid(obj.session_id)) {
    throw new Error("Invalid lease response: session_id must be a valid UUID string");
  }
  if (obj.session_id.toLowerCase() !== expectedSessionId.toLowerCase()) {
    throw new Error(
      `Mismatched lease response session_id: expected ${expectedSessionId}, got ${obj.session_id}`,
    );
  }

  if (!isValidUuid(obj.device_id)) {
    throw new Error("Invalid lease response: device_id must be a valid UUID string");
  }
  if (obj.device_id.toLowerCase() !== expectedDeviceId.toLowerCase()) {
    throw new Error(
      `Mismatched lease response device_id: expected ${expectedDeviceId}, got ${obj.device_id}`,
    );
  }

  if (!isPositiveSafeInteger(obj.generation)) {
    throw new Error("Invalid lease response: generation must be a positive safe integer");
  }
  if (expectedGeneration !== undefined && obj.generation !== expectedGeneration) {
    throw new Error(
      `Mismatched lease response generation: expected ${expectedGeneration}, got ${obj.generation}`,
    );
  }

  if (obj.state !== "held") {
    throw new Error(`Invalid lease response: state must be 'held', got ${String(obj.state)}`);
  }

  if (!isValidIsoCalendarTimestamp(obj.expires_at)) {
    throw new Error(
      `Invalid lease response: expires_at must be a valid ISO 8601 calendar timestamp with timezone, got ${String(obj.expires_at)}`,
    );
  }

  return {
    session_id: obj.session_id,
    device_id: obj.device_id,
    generation: obj.generation,
    state: "held",
    expires_at: obj.expires_at,
  };
}

/** 校验并解析 release 成功响应，精确二字段 released: true 与匹配代际 */
export function parseCallReleaseResponse(
  data: unknown,
  expectedGeneration: number,
): CallReleaseResponse {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("Invalid release response: expected an object");
  }
  const keys = Object.keys(data);
  const requiredKeys = ["released", "generation"];
  if (
    keys.length !== 2 ||
    !requiredKeys.every((k) => Object.prototype.hasOwnProperty.call(data, k))
  ) {
    throw new Error(
      `Invalid release response: expected exactly [${requiredKeys.join(", ")}], got [${keys.join(", ")}]`,
    );
  }
  const obj = data as Record<string, unknown>;

  if (obj.released !== true) {
    throw new Error(`Invalid release response: released must be true, got ${String(obj.released)}`);
  }

  if (!isPositiveSafeInteger(obj.generation)) {
    throw new Error("Invalid release response: generation must be a positive safe integer");
  }
  if (obj.generation !== expectedGeneration) {
    throw new Error(
      `Mismatched release response generation: expected ${expectedGeneration}, got ${obj.generation}`,
    );
  }

  return {
    released: true,
    generation: obj.generation,
  };
}

/**
 * 请求获得/接管通话租约
 * 默认不接管（takeover=false），单次请求，无自动重试与补偿
 */
export async function claimCallLease(
  sessionId: string,
  deviceId: string,
  takeover: boolean = false,
): Promise<CallLeaseResponse> {
  validateUuid(sessionId, "sessionId");
  validateUuid(deviceId, "deviceId");
  if (typeof takeover !== "boolean") {
    throw new Error("Invalid takeover: expected a boolean");
  }

  const raw = await request<unknown>(`/sessions/${sessionId}/call/claim`, {
    method: "POST",
    body: JSON.stringify({
      device_id: deviceId,
      takeover,
    }),
  });

  return parseCallLeaseResponse(raw, sessionId, deviceId);
}

/**
 * 心跳续期通话租约
 * 校验 held owner 匹配且代际一致，单次请求，无自动重试与补偿
 */
export async function heartbeatCallLease(
  sessionId: string,
  owner: CallLeaseOwner,
): Promise<CallLeaseResponse> {
  validateUuid(sessionId, "sessionId");
  const validatedOwner = validateCallLeaseOwner(owner);

  const raw = await request<unknown>(`/sessions/${sessionId}/call/heartbeat`, {
    method: "POST",
    body: JSON.stringify({
      device_id: validatedOwner.device_id,
      generation: validatedOwner.generation,
    }),
  });

  return parseCallLeaseResponse(
    raw,
    sessionId,
    validatedOwner.device_id,
    validatedOwner.generation,
  );
}

/**
 * 主动释放通话租约
 * 校验代际匹配，单次请求，无自动重试与补偿
 */
export async function releaseCallLease(
  sessionId: string,
  owner: CallLeaseOwner,
): Promise<CallReleaseResponse> {
  validateUuid(sessionId, "sessionId");
  const validatedOwner = validateCallLeaseOwner(owner);

  const raw = await request<unknown>(`/sessions/${sessionId}/call/release`, {
    method: "POST",
    body: JSON.stringify({
      device_id: validatedOwner.device_id,
      generation: validatedOwner.generation,
    }),
  });

  return parseCallReleaseResponse(raw, validatedOwner.generation);
}

// ─── 健康检查 API ───

export interface HealthReadyResponse {
  status: string;
}

/** 深度健康检查，验证 DB、LiveKit 等是否已就绪 */
export function checkHealthReady(): Promise<HealthReadyResponse> {
  return request<HealthReadyResponse>("/health/ready");
}

// ─── 会话 API ───

/** 文档对话上下文 */
export interface DocContext {
  content_type: string;
  raw_text: string;
  prompt: string;
}

/** 创建会话请求体 */
export interface CreateSessionBody {
  mode: string;
  doc_context?: DocContext;
}

/** 创建会话 */
export function createSession(mode: string, docContext?: DocContext): Promise<Session> {
  const body: CreateSessionBody = { mode };
  if (docContext) {
    body.doc_context = docContext;
  }
  return request<Session>("/sessions", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** 获取 LiveKit 房间令牌（支持可选通话租约 owner 门禁） */
export async function getSessionToken(
  sessionId: string,
  owner?: CallLeaseOwner,
): Promise<TokenResponse> {
  if (owner === undefined) {
    return request<TokenResponse>(`/sessions/${sessionId}/token`);
  }
  validateUuid(sessionId, "sessionId");
  const validatedOwner = validateCallLeaseOwner(owner);
  return request<TokenResponse>(`/sessions/${sessionId}/token`, {
    headers: {
      "X-Call-Device-Id": validatedOwner.device_id,
      "X-Call-Generation": String(validatedOwner.generation),
    },
  });
}

/** 结束会话 */
export function endSession(sessionId: string): Promise<Session> {
  return request<Session>(`/sessions/${sessionId}/end`, {
    method: "POST",
  });
}

/** 请求后端调度 AI Agent 进入房间（前端已连接后调用，支持可选通话租约 owner 门禁） */
export async function dispatchAgent(
  sessionId: string,
  owner?: CallLeaseOwner,
): Promise<{ dispatched: boolean }> {
  if (owner === undefined) {
    return request<{ dispatched: boolean }>(`/sessions/${sessionId}/dispatch`, {
      method: "POST",
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
export async function listSessions(params?: ListSessionsParams): Promise<SessionListResponse> {
  const query = new URLSearchParams();
  if (params?.status) query.set("status", params.status);
  if (params?.start) query.set("start", params.start);
  if (params?.end) query.set("end", params.end);
  if (params?.limit !== undefined) query.set("limit", String(params.limit));
  if (params?.cursor) query.set("cursor", params.cursor);
  const qStr = query.toString();
  const raw = await request<unknown>(`/sessions${qStr ? `?${qStr}` : ""}`);
  return parseSessionListResponse(raw);
}

/** 列出当前已认证用户的活跃会话记录（支持 keyset 游标分页与时间窗口） */
export async function listActiveSessions(
  params?: ListActiveSessionsParams,
): Promise<SessionListResponse> {
  const query = new URLSearchParams();
  if (params?.start) query.set("start", params.start);
  if (params?.end) query.set("end", params.end);
  if (params?.limit !== undefined) query.set("limit", String(params.limit));
  if (params?.cursor) query.set("cursor", params.cursor);
  const qStr = query.toString();
  const raw = await request<unknown>(`/sessions/active${qStr ? `?${qStr}` : ""}`);
  return parseSessionListResponse(raw);
}

/** 获取每日练习聚合统计（单次服务端聚合指定窗口内已完成会话数及转录条数） */
export async function getDailyProgress(start: string, end: string): Promise<DailyProgressResponse> {
  const query = new URLSearchParams({ start, end });
  const raw = await request<unknown>(`/sessions/daily-progress?${query.toString()}`);
  return parseDailyProgressResponse(raw);
}

/** 获取会话详情（含转录记录） */
export function getSessionDetail(sessionId: string): Promise<Session> {
  return request<Session>(`/sessions/${sessionId}`);
}

/** 获取持久化分析任务状态 */
export function getAnalysisStatus(sessionId: string): Promise<AnalysisStatusResponse> {
  return request<AnalysisStatusResponse>(`/sessions/${sessionId}/analysis-status`);
}

/** 重试最终失败或已超时的分析任务 */
export function retryAnalysis(sessionId: string): Promise<AnalysisStatusResponse> {
  return request<AnalysisStatusResponse>(`/sessions/${sessionId}/analysis-retry`, {
    method: "POST",
  });
}

// ─── 评估 API ───

/** 获取发音评估结果 */
export function getAssessment(sessionId: string): Promise<AssessmentResponse> {
  return request<AssessmentResponse>(`/assessments/${sessionId}`);
}

/** 获取语法错误列表 */
export function getGrammarErrors(sessionId: string): Promise<GrammarErrorResponse[]> {
  return request<GrammarErrorResponse[]>(`/assessments/${sessionId}/grammar`);
}

/** 获取当前用户知识状态 */
export function getKnowledgeStates(): Promise<KnowledgeStateResponse[]> {
  return request<KnowledgeStateResponse[]>("/assessments/knowledge/states");
}

/** 获取技能列表 */
export function getSkills(): Promise<SkillResponse[]> {
  return request<SkillResponse[]>("/assessments/knowledge/skills");
}

// ─── 课程推荐 API ───

/** 获取自适应课程推荐 */
export function getRecommendedCurriculum(): Promise<CurriculumNextResponse> {
  return request<CurriculumNextResponse>("/curriculum/next");
}

// ─── 用户设置相关类型 ───

/** 用户双轨制配置（GET 响应） */
export interface UserSettingsResponse {
  is_custom_mode: boolean;
  is_custom_verified?: boolean;
  subscription_tier?: string;
  theme: "warm" | "cool" | "dark";
  stt_provider: string | null;
  llm_provider: string | null;
  llm_model: string | null;
  tts_provider: string | null;
  has_stt_key: boolean;
  has_llm_key: boolean;
  has_tts_key: boolean;

  stt_status: "verified" | "error" | "unconfigured";
  llm_status: "verified" | "error" | "unconfigured";
  tts_status: "verified" | "error" | "unconfigured";
}

/** 用户双轨制配置更新（PUT 请求体） */
export interface UserSettingsUpdate {
  is_custom_mode?: boolean;
  theme?: "warm" | "cool" | "dark";
  stt_provider?: "deepgram";
  llm_provider?: "siliconflow" | "openrouter";
  llm_model?: string;
  tts_provider?: "cartesia";
  stt_key?: string;
  llm_key?: string;
  tts_key?: string;
}

// ─── 用户设置 API ───

/** 获取当前用户的双轨制配置 */
export function getUserSettings(): Promise<UserSettingsResponse> {
  return request<UserSettingsResponse>("/user/settings");
}

/** 更新当前用户的双轨制配置（部分更新） */
export function updateUserSettings(data: UserSettingsUpdate): Promise<UserSettingsResponse> {
  return request<UserSettingsResponse>("/user/settings", {
    method: "PUT",
    body: JSON.stringify(data),
  });
}
