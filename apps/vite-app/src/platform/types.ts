export type PlatformType = "ios" | "android" | "macos" | "windows" | "web";

export interface PlatformDetectionOptions {
  window?: unknown;
  navigator?: { userAgent?: string };
}

export interface ApiBaseUrlOptions {
  platform?: PlatformType;
  isDev?: boolean;
  envApiBaseUrl?: string | null;
  storage?: Pick<Storage, "getItem"> | null;
}

export interface LiveKitUrlOptions {
  platform?: PlatformType;
  isDev?: boolean;
  tokenWsUrl?: string | null;
  envLiveKitUrl?: string | null;
  direct?: boolean;
  forceProxy?: boolean;
  apiBaseUrl?: string | null;
  location?: { protocol: string; host: string } | null;
}

export class PlatformConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlatformConfigError";
  }
}
