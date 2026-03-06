/**
 * 后端 API 客户端封装。
 * 所有对 FastAPI 后端的请求通过此模块统一管理。
 */

const BASE_URL = "/api";

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

/** 通用请求封装 */
async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer mock-token",
      // TODO: 后续接入真实 JWT，从 Auth 模块获取 token
    },
    ...options,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));

    let message = `请求失败: ${res.status}`;
    if (body) {
      if (typeof body.detail === "string") {
        // 1. 标准 FastAPI 异常 (HTTPException(detail="xxx"))
        message = body.detail;
      } else if (Array.isArray(body.detail) && body.detail.length > 0) {
        // 2. FastAPI 验证异常 (422 Unprocessable Entity - validation errors)
        const firstError = body.detail[0];
        const errorLoc = firstError.loc ? firstError.loc.join(".") : "Unknown";
        message = `数据验证失败 (${errorLoc}): ${firstError.msg}`;
      } else if (body.detail && typeof body.detail === "object") {
        // 3. 嵌套的自定义字典对象 (如 /health/ready 的 detail: { errors: {...} })
        if (body.detail.errors && typeof body.detail.errors === "object") {
          message = (Object.values(body.detail.errors)[0] as string) || message;
        } else if (body.detail.message && typeof body.detail.message === "string") {
          message = body.detail.message;
        } else {
          message = JSON.stringify(body.detail); // 兜底返回完整 JSON 字符串避免 [object Object]
        }
      } else if (body.errors && typeof body.errors === "object") {
        // 4. 其他结构或未通过 detail 包装的字典
        message = (Object.values(body.errors)[0] as string) || message;
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
  elsa_response: Record<string, unknown> | null;
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

// ─── 健康检查 API ───

export interface HealthReadyResponse {
  status: string;
}

/** 深度健康检查，验证 DB、LiveKit 等是否已就绪 */
export function checkHealthReady(): Promise<HealthReadyResponse> {
  return request<HealthReadyResponse>("/health/ready");
}

// ─── 会话 API ───

/** 创建会话 */
export function createSession(mode: string): Promise<Session> {
  return request<Session>("/sessions", {
    method: "POST",
    body: JSON.stringify({ mode }),
  });
}

/** 获取 LiveKit 房间令牌 */
export function getSessionToken(sessionId: string): Promise<TokenResponse> {
  return request<TokenResponse>(`/sessions/${sessionId}/token`);
}

/** 结束会话 */
export function endSession(sessionId: string): Promise<Session> {
  return request<Session>(`/sessions/${sessionId}/end`, {
    method: "POST",
  });
}

/** 请求后端调度 AI Agent 进入房间（前端已连接后调用） */
export function dispatchAgent(sessionId: string): Promise<{ dispatched: boolean }> {
  return request<{ dispatched: boolean }>(`/sessions/${sessionId}/dispatch`, {
    method: "POST",
  });
}

/** 列出当前用户的所有会话 */
export function listSessions(): Promise<SessionListItem[]> {
  return request<SessionListItem[]>("/sessions");
}

/** 获取会话详情（含转录记录） */
export function getSessionDetail(sessionId: string): Promise<Session> {
  return request<Session>(`/sessions/${sessionId}`);
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
  stt_provider: string | null;
  llm_provider: string | null;
  llm_model: string | null;
  tts_provider: string | null;
  has_stt_key: boolean;
  has_llm_key: boolean;
  has_tts_key: boolean;
}

/** 用户双轨制配置更新（PUT 请求体） */
export interface UserSettingsUpdate {
  is_custom_mode?: boolean;
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
