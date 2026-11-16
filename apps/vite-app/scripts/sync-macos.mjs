/**
 * macOS 同步前校验与 Tauri v2 CLI 隔离脚本
 * 本轮只验证静态构建产物与配置，不创建或验收正式原生壳。
 */

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ALLOWED_MODES, validateManifestSchema } from "./config-validator.mjs";

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
 * 解析 CLI 参数（严格校验未知、重复、缺值与非固定模式）
 */
export function parseSyncArgs(args = []) {
  let mode = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--mode") {
      if (mode !== null) {
        throw new Error('[EchoTalk Sync] 重复指定的参数: "--mode"');
      }
      if (i + 1 >= args.length || args[i + 1].startsWith("--")) {
        throw new Error('[EchoTalk Sync] 参数 "--mode" 缺少值');
      }
      mode = args[++i];
    } else if (arg.startsWith("--mode=")) {
      if (mode !== null) {
        throw new Error('[EchoTalk Sync] 重复指定的参数: "--mode"');
      }
      const value = arg.slice("--mode=".length);
      if (!value) {
        throw new Error('[EchoTalk Sync] 参数 "--mode" 缺少值');
      }
      mode = value;
    } else {
      throw new Error(`[EchoTalk Sync] 未知或不受支持的参数: "${arg}"`);
    }
  }

  const resolvedMode = mode || process.env.ECHOTALK_BUILD_MODE || "production";
  if (!ALLOWED_MODES.includes(resolvedMode)) {
    throw new Error(
      `[EchoTalk Sync] 不支持的构建模式: "${resolvedMode}"，仅支持: ${ALLOWED_MODES.join(", ")}`,
    );
  }

  return { mode: resolvedMode };
}

/**
 * macOS 同步核心纯函数
 */
export async function executeSyncMacos({
  mode = "production",
  appDir = path.resolve(__dirname, ".."),
  spawnRunner = defaultSpawnRunner,
} = {}) {
  if (!ALLOWED_MODES.includes(mode)) {
    throw new Error(
      `[EchoTalk Sync] 不支持的构建模式: "${mode}"，仅支持: ${ALLOWED_MODES.join(", ")}`,
    );
  }

  const targetSubDir = path.join("dist", "macos", mode);
  const outDir = path.resolve(appDir, targetSubDir);

  // 所有产物与原生配置校验完成前，绝不启动外部工具。
  if (!fs.existsSync(outDir) || !fs.statSync(outDir).isDirectory()) {
    throw new Error(
      `[EchoTalk Sync] 目标构建产物目录不存在: ${targetSubDir}。请先执行构建 (build:macos --mode ${mode})。`,
    );
  }

  const indexHtmlPath = path.join(outDir, "index.html");
  if (!fs.existsSync(indexHtmlPath) || !fs.statSync(indexHtmlPath).isFile()) {
    throw new Error(
      `[EchoTalk Sync] 目标构建产物缺少 index.html: ${targetSubDir}/index.html。禁止同步损坏产物。`,
    );
  }

  const manifestPath = path.join(outDir, "build-manifest.json");
  if (!fs.existsSync(manifestPath) || !fs.statSync(manifestPath).isFile()) {
    throw new Error(
      `[EchoTalk Sync] 目标构建产物缺少构建标识 manifest: ${targetSubDir}。禁止静默回退默认 dist。`,
    );
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  } catch {
    throw new Error(`[EchoTalk Sync] 构建标识 manifest 损坏无法解析: ${manifestPath}`);
  }

  validateManifestSchema(manifest, mode, "macos");

  const nativeConfigPath = path.resolve(appDir, "src-tauri", "tauri.conf.json");
  if (!fs.existsSync(nativeConfigPath) || !fs.statSync(nativeConfigPath).isFile()) {
    throw new Error(
      `[EchoTalk Sync] 原生配置不存在: ${nativeConfigPath}。本轮不会创建正式 src-tauri 壳。`,
    );
  }

  try {
    const nativeConfig = JSON.parse(fs.readFileSync(nativeConfigPath, "utf-8"));
    if (!nativeConfig || typeof nativeConfig !== "object" || Array.isArray(nativeConfig)) {
      throw new Error();
    }
  } catch {
    throw new Error(`[EchoTalk Sync] 原生配置损坏无法解析: ${nativeConfigPath}`);
  }

  // inline JSON 相对源 src-tauri/tauri.conf.json 所在目录解析，不改写源配置字节。
  const configOverride = JSON.stringify({
    build: {
      frontendDist: `../dist/macos/${mode}`,
    },
  });
  const syncEnv = {
    ...process.env,
    ECHOTALK_BUILD_PLATFORM: "macos",
    ECHOTALK_BUILD_MODE: mode,
  };

  const syncCode = await spawnRunner(
    "pnpm",
    ["exec", "tauri", "build", "--config", configOverride],
    {
      cwd: appDir,
      env: syncEnv,
      shell: false,
    },
  );

  if (syncCode !== 0) {
    throw new Error(`[EchoTalk Sync] Tauri 构建失败 (退出码: ${syncCode})`);
  }

  return {
    success: true,
    platform: "macos",
    mode,
    targetDir: targetSubDir,
  };
}

/**
 * CLI 入口判定
 */
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const cliArgs = process.argv.slice(2);
  const { mode } = parseSyncArgs(cliArgs);

  executeSyncMacos({ mode })
    .then((result) => {
      console.log(
        `[EchoTalk Sync] macOS 同步成功: mode=${result.mode}, targetDir=${result.targetDir}`,
      );
      process.exit(0);
    })
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
