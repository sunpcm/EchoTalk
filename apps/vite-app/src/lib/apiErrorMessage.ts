/**
 * API 错误响应消息解析纯函数。
 * 纯计算模块，无网络、无 DOM、无认证与全局状态依赖。
 */

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

/**
 * 根据 HTTP 状态码与响应体解析适合展示的错误消息。
 * 严格保持 FastAPI / HTTPException / 422 验证异常及业务诊断既有优先级与兜底语义。
 */
export function getApiErrorMessage(status: number, body: unknown): string {
  let message = `请求失败: ${status}`;
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
            (part): part is string | number => typeof part === "string" || typeof part === "number",
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

  return message;
}
