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
import { getAuthRevision, subscribeAuthSnapshot } from "@/lib/auth";

export const DIAGNOSTIC_PREFIX = "[diagnostic]";

export const ALLOWED_DIAGNOSTIC_EVENTS = [
  "api_network_failed",
  "api_request_timeout",
  "api_request_aborted",
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

// 只有 logDiagnostic 能写入；不导出接收外部 record/payload 的入口。
const BUFFER_LIMIT = 50;
type DiagnosticSnapshot = readonly Readonly<DiagnosticRecord>[];
let snapshot: DiagnosticSnapshot = Object.freeze([]);
let bufferAuthRevision: number | null = null;
let bufferGeneration = 0;
const bufferListeners = new Set<() => void>();
let notifying = false;

function notifyBufferListeners(): void {
  // 同步订阅者可以清空或写日志；重入不递归，也不回写旧快照。
  if (notifying) return;
  notifying = true;
  try {
    for (const listener of Array.from(bufferListeners)) {
      if (!bufferListeners.has(listener)) continue;
      try {
        listener();
      } catch {
        // 一个 UI/订阅者失败不能影响日志、认证清理或其他订阅者。
      }
    }
  } finally {
    notifying = false;
  }
}

function resetDiagnosticBuffer(): void {
  snapshot = Object.freeze([]);
  bufferGeneration += 1;
  notifyBufferListeners();
}

function syncDiagnosticAuthRevision(): void {
  const revision = getAuthRevision();
  if (bufferAuthRevision === revision) return;
  bufferAuthRevision = revision;
  resetDiagnosticBuffer();
}

/** 稳定、深度只读的内存快照；每次访问均核对认证代际，不暴露身份。 */
export function getDiagnosticSnapshot(): DiagnosticSnapshot {
  syncDiagnosticAuthRevision();
  return snapshot;
}

/** 清空/认证变化使复制结果失效；新日志本身不会作废用户已发起的复制。 */
export function getDiagnosticGeneration(): number {
  syncDiagnosticAuthRevision();
  return bufferGeneration;
}

/** 账号清理链直接调用，即使诊断 UI 从未挂载也会清理。 */
export function clearDiagnosticBuffer(): void {
  bufferAuthRevision = getAuthRevision();
  resetDiagnosticBuffer();
}

export function subscribeDiagnosticBuffer(listener: () => void): () => void {
  const subscription = () => listener();
  bufferListeners.add(subscription);
  // 仅活跃消费者拥有监听；无消费者时，读/写仍按 revision 失效旧记录。
  let unsubscribeAuth: (() => void) | undefined;
  try {
    unsubscribeAuth = subscribeAuthSnapshot(syncDiagnosticAuthRevision);
  } catch {
    // 认证监听不可用时仍可显式读/写；不会绕过每次访问的 revision 校验。
  }
  syncDiagnosticAuthRevision();
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    bufferListeners.delete(subscription);
    try {
      unsubscribeAuth?.();
    } catch {
      // 释放失败不阻断 UI 卸载，buffer listener 已同步移除。
    }
  };
}

/**
 * 记录结构化安全诊断日志。
 * 向控制台与最多 50 条的内存缓冲输出同一纯净白名单 record。
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
    syncDiagnosticAuthRevision();
    const generation = bufferGeneration;

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

    // 6. 冻结后再发布，console、返回值与快照均不能被调用方扩写污染。
    Object.freeze(record);
    syncDiagnosticAuthRevision();
    if (generation === bufferGeneration) {
      snapshot = Object.freeze([...snapshot.slice(-(BUFFER_LIMIT - 1)), record]);
      notifyBufferListeners();
    }

    // 7. 控制台分级输出 (保留现有 warn/log/error 映射)
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
