import type { CapacitorConfig } from "@capacitor/cli";

// 显式平台与模式环境变量映射；未指定时保留 "dist" 以兼容无环境变量的默认场景；显式非法时报错
const buildPlatform = process.env.ECHOTALK_BUILD_PLATFORM;
const buildMode = process.env.ECHOTALK_BUILD_MODE;

const ALLOWED_MODES = ["development", "staging", "production"];

let webDir = "dist";
if (buildPlatform !== undefined || buildMode !== undefined) {
  if (buildPlatform !== "ios") {
    throw new Error(
      `[EchoTalk Capacitor] 非法的 ECHOTALK_BUILD_PLATFORM: "${buildPlatform}"，仅支持 "ios"`,
    );
  }
  if (!buildMode || !ALLOWED_MODES.includes(buildMode)) {
    throw new Error(
      `[EchoTalk Capacitor] 非法的 ECHOTALK_BUILD_MODE: "${buildMode}"，仅支持: ${ALLOWED_MODES.join(", ")}`,
    );
  }
  webDir = `dist/ios/${buildMode}`;
}

const config: CapacitorConfig = {
  appId: "com.echotalk.app",
  appName: "EchoTalk",
  webDir,
  server: {
    androidScheme: "https",
    iosScheme: "capacitor",
  },
};

export default config;
