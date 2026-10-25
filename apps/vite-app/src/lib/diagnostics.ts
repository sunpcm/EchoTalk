/**
 * 本地安全诊断日志辅助模块 (CP-06 一期)
 *
 * 遵循严格白名单与脱敏契约：
 * 1. 结构化 record 输出，严禁包含任何 URL/path/header/body/token/key/message/正文/用户指纹。
 * 2. 字段从零显式构造，禁止 spread 或正则后脱敏。
 * 3. 拒绝未知 event；status 限 100..599 整数；agent_code 严格白名单，其余非字符串/未知均映射为 unknown。
 * 4. 自身抛错局部隔离，绝不阻断业务逻辑。
 */

import pkg from "../../package.json";
import { detectPlatform } from "@/platform/detection";
import type { PlatformType } from "@/platform/types";

export const DIAGNOSTIC_PREFIX = "[diagnostic]";

export const ALLOWED_DIAGNOSTIC_EVENTS = [
  "api_network_failed",
  "api_http_failed",
  "lifecycle_audio_interrupted",
  "native_lifecycle_ready_timeout",
  "agent_dispatch_failed",
  "livekit_connection_failed",
  "livekit_disconnected",
  "agent_error_received",
] as const;

export type DiagnosticEvent = (typeof ALLOWED_DIAGNOSTIC_EVENTS)[number];

export const ALLOWED_AGENT_CODES = [
  "ERR_CUSTOM_KEY_INVALID",
  "ERR_SESSION_NOT_FOUND",
  "ERR_CUSTOM_RUNTIME_AUTH",
  "ERR_CUSTOM_RUNTIME",
  "ERR_SYSTEM_RUNTIME",
] as const;

export type AllowedAgentCode = (typeof ALLOWED_AGENT_CODES)[number];

const KNOWN_PLATFORMS: ReadonlySet<string> = new Set(["ios", "android", "macos", "windows", "web"]);

export interface DiagnosticRecord {
  schema_version: 1;
  app_version: string;
  platform: PlatformType | "unknown";
  event: DiagnosticEvent;
  status?: number;
  agent_code?: string;
}

export interface DiagnosticLogOptions {
  status?: unknown;
  agent_code?: unknown;
}

/**
 * 记录结构化安全诊断日志。
 * 仅向控制台输出固定前缀与纯净白名单 record。
 *
 * @param eventName 诊断事件名称
 * @param options 可选上下文参数 (status / agent_code)
 * @returns 构造出的纯净 DiagnosticRecord，若事件非法或处理失败则返回 null
 */
export function logDiagnostic(
  eventName: string,
  options?: DiagnosticLogOptions,
): DiagnosticRecord | null {
  try {
    // 1. 严格事件校验：拒绝未知 event，不输出原值
    if (!ALLOWED_DIAGNOSTIC_EVENTS.includes(eventName as DiagnosticEvent)) {
      return null;
    }
    const validEvent = eventName as DiagnosticEvent;

    // 2. 平台检测容错：已知集合，检测异常或未知一律映射为 "unknown"
    let platform: PlatformType | "unknown" = "unknown";
    try {
      const detected = detectPlatform();
      if (typeof detected === "string" && KNOWN_PLATFORMS.has(detected)) {
        platform = detected;
      }
    } catch {
      platform = "unknown";
    }

    // 3. 版本号：从 package.json 获取
    const app_version =
      typeof pkg === "object" && pkg !== null && typeof pkg.version === "string"
        ? pkg.version
        : "unknown";

    // 4. 从零构造白名单记录
    const record: DiagnosticRecord = {
      schema_version: 1,
      app_version,
      platform,
      event: validEvent,
    };

    // 5. 事件特异性字段附加 (严格隔离与校验)
    if (validEvent === "api_http_failed") {
      const s = options?.status;
      if (typeof s === "number" && Number.isInteger(s) && s >= 100 && s <= 599) {
        record.status = s;
      }
    } else if (validEvent === "agent_error_received") {
      const c = options?.agent_code;
      if (typeof c === "string" && ALLOWED_AGENT_CODES.includes(c as AllowedAgentCode)) {
        record.agent_code = c;
      } else {
        record.agent_code = "unknown";
      }
    }

    // 6. 控制台分级输出 (保留现有 warn/log/error 映射)
    try {
      if (
        validEvent === "lifecycle_audio_interrupted" ||
        validEvent === "native_lifecycle_ready_timeout"
      ) {
        console.warn(DIAGNOSTIC_PREFIX, record);
      } else if (validEvent === "livekit_disconnected") {
        console.log(DIAGNOSTIC_PREFIX, record);
      } else {
        console.error(DIAGNOSTIC_PREFIX, record);
      }
    } catch {
      // 控制台 sink 抛错不得影响产品流程
    }

    return record;
  } catch {
    // 兜底保护，绝不向上抛错
    return null;
  }
}
