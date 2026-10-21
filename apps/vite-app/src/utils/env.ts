/**
 * 跨平台环境探测与 BaseURL 解析工具。
 * 委托至 @/platform 底座并保持向后兼容。
 */

export type {
  PlatformType,
  PlatformDetectionOptions,
  ApiBaseUrlOptions,
  LiveKitUrlOptions,
} from "@/platform";

export {
  detectPlatform,
  isNativePlatform,
  resolveApiBaseUrl,
  getApiBaseUrl,
  validateAndNormalizeApiUrl,
  validateAndNormalizeWsUrl,
  resolveLiveKitUrl,
  getLiveKitWsUrl,
  PlatformConfigError,
} from "@/platform";
