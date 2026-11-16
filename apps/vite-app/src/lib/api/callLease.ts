/**
 * 通话能力与通话占用（call lease）API。
 */

import type { ApiRequestOptions, ApiSchemas, WithRequired } from "./client";
import { request } from "./client";

// ─── 通话能力 API ───

export type CallCapabilitiesResponse = WithRequired<
  ApiSchemas["CallCapabilitiesResponse"],
  "protocol_version" | "call_lease_mode"
>;

export type CallLeaseMode = CallCapabilitiesResponse["call_lease_mode"];

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
export async function getCallCapabilities(
  options?: ApiRequestOptions,
): Promise<CallCapabilitiesResponse> {
  const raw = await request<unknown>("/call-capabilities", {
    cache: "no-store",
    signal: options?.signal,
  });
  return parseCallCapabilities(raw);
}

// ─── 通话占用 API（CP-02 §9） ───

export type CallLeaseOwner = Pick<ApiSchemas["CallHeartbeatRequest"], "device_id" | "generation">;

/** 从生成契约派生字段，同时保留客户端对成功状态的窄字面量约束。 */
export type CallLeaseResponse = Omit<ApiSchemas["CallLeaseResponse"], "state"> & {
  state: "held";
};

export type CallReleaseResponse = Omit<ApiSchemas["CallReleaseResponse"], "released"> & {
  released: true;
};

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

export function validateUuid(value: unknown, name: string): string {
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
  options?: ApiRequestOptions,
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
    signal: options?.signal,
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
  options?: ApiRequestOptions,
): Promise<CallLeaseResponse> {
  validateUuid(sessionId, "sessionId");
  const validatedOwner = validateCallLeaseOwner(owner);

  const raw = await request<unknown>(`/sessions/${sessionId}/call/heartbeat`, {
    method: "POST",
    body: JSON.stringify({
      device_id: validatedOwner.device_id,
      generation: validatedOwner.generation,
    }),
    signal: options?.signal,
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
  options?: ApiRequestOptions,
): Promise<CallReleaseResponse> {
  validateUuid(sessionId, "sessionId");
  const validatedOwner = validateCallLeaseOwner(owner);

  const raw = await request<unknown>(`/sessions/${sessionId}/call/release`, {
    method: "POST",
    body: JSON.stringify({
      device_id: validatedOwner.device_id,
      generation: validatedOwner.generation,
    }),
    signal: options?.signal,
  });

  return parseCallReleaseResponse(raw, validatedOwner.generation);
}
