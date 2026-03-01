/**
 * 后端 API 客户端封装。
 * 所有对 FastAPI 后端的请求通过此模块统一管理。
 */

const BASE_URL = "/api";

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
    throw new Error(body.detail || `请求失败: ${res.status}`);
  }

  return res.json();
}

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
