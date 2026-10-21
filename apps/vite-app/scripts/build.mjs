/**
 * 跨平台构建脚本 (Web / iOS)
 * 遵守 docs/CROSS_PLATFORM_ARCHITECTURE.md §8.2 契约
 */

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadEnv } from "vite";
import {
  ALLOWED_PLATFORMS,
  ALLOWED_MODES,
  BuildValidationError,
  validateBuildConfig,
  createManifest,
} from "./config-validator.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 默认子进程执行器（spawn 参数数组，shell: false）
 */
export function defaultSpawnRunner(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: false,
      ...options,
    });

    child.on("error", (err) => {
      reject(err);
    });

    child.on("close", (code) => {
      resolve(code ?? 1);
    });
  });
}

/**
 * 解析 CLI 参数（严格校验未知/重复/缺值参数）
 */
export function parseBuildArgs(args = []) {
  let platform = null;
  let mode = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--platform") {
      if (platform !== null) {
        throw new Error('[EchoTalk Build] 重复指定的参数: "--platform"');
      }
      if (i + 1 >= args.length || args[i + 1].startsWith("--")) {
        throw new Error('[EchoTalk Build] 参数 "--platform" 缺少值');
      }
      platform = args[++i];
    } else if (arg.startsWith("--platform=")) {
      if (platform !== null) {
        throw new Error('[EchoTalk Build] 重复指定的参数: "--platform"');
      }
      const val = arg.split("=").slice(1).join("=");
      if (!val) {
        throw new Error('[EchoTalk Build] 参数 "--platform" 缺少值');
      }
      platform = val;
    } else if (arg === "--mode") {
      if (mode !== null) {
        throw new Error('[EchoTalk Build] 重复指定的参数: "--mode"');
      }
      if (i + 1 >= args.length || args[i + 1].startsWith("--")) {
        throw new Error('[EchoTalk Build] 参数 "--mode" 缺少值');
      }
      mode = args[++i];
    } else if (arg.startsWith("--mode=")) {
      if (mode !== null) {
        throw new Error('[EchoTalk Build] 重复指定的参数: "--mode"');
      }
      const val = arg.split("=").slice(1).join("=");
      if (!val) {
        throw new Error('[EchoTalk Build] 参数 "--mode" 缺少值');
      }
      mode = val;
    } else {
      throw new Error(`[EchoTalk Build] 未知或不受支持的参数: "${arg}"`);
    }
  }

  return {
    platform: platform || process.env.ECHOTALK_BUILD_PLATFORM || "web",
    mode: mode || process.env.ECHOTALK_BUILD_MODE || "production",
  };
}

/**
 * 构建执行核心纯函数
 */
export async function executeBuild({
  platform,
  mode = "production",
  appDir = path.resolve(__dirname, ".."),
  envOverrides = {},
  spawnRunner = defaultSpawnRunner,
  rawArgs = [],
} = {}) {
  // 1. 先安全校验 platform 与 mode
  if (!ALLOWED_PLATFORMS.includes(platform)) {
    throw new BuildValidationError(
      `[EchoTalk Build] 不支持的构建平台: "${platform}"，仅支持: ${ALLOWED_PLATFORMS.join(", ")}`,
    );
  }

  if (!ALLOWED_MODES.includes(mode)) {
    throw new BuildValidationError(
      `[EchoTalk Build] 不支持的构建模式: "${mode}"，仅支持: ${ALLOWED_MODES.join(", ")}`,
    );
  }

  // 严禁在 production 构建中通过 --mode development 旁路
  if (mode === "production") {
    const hasDevBypass = rawArgs.some(
      (arg, idx) =>
        arg === "--mode=development" || (arg === "--mode" && rawArgs[idx + 1] === "development"),
    );
    if (hasDevBypass) {
      throw new BuildValidationError(
        "[EchoTalk Build] 禁止在 production 构建中使用 --mode development 旁路",
      );
    }
  }

  // 2. 目标输出子目录：严格限定为 dist/<platform>/<mode>
  // 契约规定：不得遍历或清空整个 dist 目录
  const targetSubDir = path.join("dist", platform, mode);
  const outDir = path.resolve(appDir, targetSubDir);
  const manifestPath = path.join(outDir, "build-manifest.json");
  const legacyManifestPath = path.join(outDir, "manifest.json");

  // 3. 在校验其他配置前，先使同目标的旧 success 标识失效！
  // 确保若随后的环境加载或配置校验失败，绝不会遗留旧的 success: true 标识被 sync 接纳
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  if (fs.existsSync(legacyManifestPath)) {
    fs.rmSync(legacyManifestPath, { force: true });
  }
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        platform,
        mode,
        success: false,
        invalidatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    "utf-8",
  );

  // 4. 从 appDir 加载环境配置，禁止读取根目录 .env
  const loadedEnv = loadEnv(mode, appDir, "VITE_");
  const mergedEnv = { ...loadedEnv, ...process.env, ...envOverrides };

  // 5. 校验完整构建配置
  validateBuildConfig({
    platform,
    mode,
    env: mergedEnv,
    rawArgs,
  });

  // 6. 确定固定且不可覆盖的 NODE_ENV
  // production/staging 必须为 production，development 必须为 development
  const fixedNodeEnv = mode === "development" ? "development" : "production";

  const runEnv = {
    ...process.env,
    ...mergedEnv,
    NODE_ENV: fixedNodeEnv,
    ECHOTALK_BUILD_PLATFORM: platform,
    ECHOTALK_BUILD_MODE: mode,
  };

  // 7. 执行类型检查 tsc -p tsconfig.json --noEmit
  const tscCode = await spawnRunner("pnpm", ["exec", "tsc", "-p", "tsconfig.json", "--noEmit"], {
    cwd: appDir,
    env: runEnv,
    shell: false,
  });
  if (tscCode !== 0) {
    throw new Error(`[EchoTalk Build] TypeScript 类型检查未通过 (退出码: ${tscCode})`);
  }

  // 8. 执行 Vite 构建，显式限定 --mode 与 --outDir
  const viteArgs = ["exec", "vite", "build", "--mode", mode, "--outDir", targetSubDir];
  const viteCode = await spawnRunner("pnpm", viteArgs, {
    cwd: appDir,
    env: runEnv,
    shell: false,
  });
  if (viteCode !== 0) {
    throw new Error(`[EchoTalk Build] Vite 构建未通过 (退出码: ${viteCode})`);
  }

  // 9. 校验关键产物 index.html 是否生成
  const indexHtmlPath = path.join(outDir, "index.html");
  if (!fs.existsSync(indexHtmlPath)) {
    throw new Error(`[EchoTalk Build] 构建产物缺失 index.html: ${indexHtmlPath}`);
  }

  // 10. 写入构建 Manifest 元数据（只保留 build-manifest.json 一种）
  const manifestData = createManifest({
    platform,
    mode,
    env: mergedEnv,
  });
  const manifestContent = JSON.stringify(manifestData, null, 2);
  fs.writeFileSync(manifestPath, manifestContent, "utf-8");

  return {
    success: true,
    platform,
    mode,
    outDir,
    manifest: manifestData,
  };
}

/**
 * CLI 入口判定
 */
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const cliArgs = process.argv.slice(2);
  const { platform, mode } = parseBuildArgs(cliArgs);

  executeBuild({
    platform,
    mode,
    rawArgs: cliArgs,
  })
    .then((result) => {
      console.log(
        `[EchoTalk Build] 构建成功: platform=${result.platform}, mode=${result.mode}, outDir=${result.outDir}`,
      );
      process.exit(0);
    })
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
