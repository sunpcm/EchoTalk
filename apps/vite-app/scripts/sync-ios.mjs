/**
 * iOS 同步隔离脚本 (Capacitor Sync iOS)
 * 遵守 docs/CROSS_PLATFORM_ARCHITECTURE.md §8.2 契约
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
 * 解析 CLI 参数（严格校验未知/重复/缺值参数）
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
      const val = arg.split("=").slice(1).join("=");
      if (!val) {
        throw new Error('[EchoTalk Sync] 参数 "--mode" 缺少值');
      }
      mode = val;
    } else {
      throw new Error(`[EchoTalk Sync] 未知或不受支持的参数: "${arg}"`);
    }
  }

  return {
    mode: mode || process.env.ECHOTALK_BUILD_MODE || "production",
  };
}

/**
 * 递归收集目录下的所有常规文件相对路径
 */
export function getAllRelativeFiles(dir, base = dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...getAllRelativeFiles(fullPath, base));
    } else if (entry.isFile()) {
      files.push(path.relative(base, fullPath));
    }
  }
  return files;
}

/**
 * 核验源目录与目标原生公共目录的所有常规文件内容一致性
 * 应对 Capacitor 8.5+ 可能捕获 copy 异常后只记录日志仍退出 0 的静默失败风险
 */
export function verifyCopiedPublicAssets(sourceDir, nativePublicDir) {
  if (!fs.existsSync(nativePublicDir)) {
    throw new Error(
      `[EchoTalk Sync] Capacitor 同步后原生公共目录不存在: ${nativePublicDir}。复制可能静默失败。`,
    );
  }

  const sourceFiles = getAllRelativeFiles(sourceDir);
  if (sourceFiles.length === 0) {
    throw new Error(`[EchoTalk Sync] 源构建产物目录为空: ${sourceDir}`);
  }

  for (const relFile of sourceFiles) {
    const srcFilePath = path.join(sourceDir, relFile);
    const destFilePath = path.join(nativePublicDir, relFile);

    if (!fs.existsSync(destFilePath)) {
      throw new Error(
        `[EchoTalk Sync] 原生公共目录缺少同步文件: ${relFile}。Capacitor 复制未完成。`,
      );
    }

    const srcStat = fs.statSync(srcFilePath);
    const destStat = fs.statSync(destFilePath);
    if (!destStat.isFile()) {
      throw new Error(`[EchoTalk Sync] 原生公共目录目标路径不是常规文件: ${relFile}`);
    }

    if (srcStat.size !== destStat.size) {
      throw new Error(
        `[EchoTalk Sync] 原生公共目录文件大小不一致: ${relFile} (源: ${srcStat.size} 字节, 目标: ${destStat.size} 字节)`,
      );
    }

    const srcBuffer = fs.readFileSync(srcFilePath);
    const destBuffer = fs.readFileSync(destFilePath);
    if (!srcBuffer.equals(destBuffer)) {
      throw new Error(`[EchoTalk Sync] 原生公共目录文件内容与源产物不一致: ${relFile}`);
    }
  }

  return {
    verifiedCount: sourceFiles.length,
    files: sourceFiles,
  };
}

/**
 * iOS 同步核心纯函数
 */
export async function executeSyncIos({
  mode = "production",
  appDir = path.resolve(__dirname, ".."),
  nativePublicDir = path.resolve(appDir, "ios", "App", "App", "public"),
  spawnRunner = defaultSpawnRunner,
} = {}) {
  if (!ALLOWED_MODES.includes(mode)) {
    throw new Error(
      `[EchoTalk Sync] 不支持的构建模式: "${mode}"，仅支持: ${ALLOWED_MODES.join(", ")}`,
    );
  }

  const targetSubDir = path.join("dist", "ios", mode);
  const outDir = path.resolve(appDir, targetSubDir);

  // 1. 检查目标目录是否存在
  if (!fs.existsSync(outDir)) {
    throw new Error(
      `[EchoTalk Sync] 目标构建产物目录不存在: ${targetSubDir}。请先执行构建 (build:ios --mode ${mode})。`,
    );
  }

  // 2. 检查关键入口 index.html 是否存在
  const indexHtmlPath = path.join(outDir, "index.html");
  if (!fs.existsSync(indexHtmlPath)) {
    throw new Error(
      `[EchoTalk Sync] 目标构建产物缺少 index.html: ${targetSubDir}/index.html。禁止同步损坏产物。`,
    );
  }

  // 3. 检查 manifest 是否存在（仅支持 build-manifest.json，不使用兼容别名）
  const manifestPath = path.join(outDir, "build-manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(
      `[EchoTalk Sync] 目标构建产物缺少构建标识 manifest: ${targetSubDir}。禁止静默回退默认 dist。`,
    );
  }

  // 4. 解析并核验 manifest 内容 Schema
  let manifest;
  try {
    const content = fs.readFileSync(manifestPath, "utf-8");
    manifest = JSON.parse(content);
  } catch {
    throw new Error(`[EchoTalk Sync] 构建标识 manifest 损坏无法解析: ${manifestPath}`);
  }

  // 执行完整的 Manifest Schema 与安全元数据验证
  validateManifestSchema(manifest, mode);

  // 5. 校验全部通过后调用 cap sync ios，传递特定环境变量
  const syncEnv = {
    ...process.env,
    ECHOTALK_BUILD_PLATFORM: "ios",
    ECHOTALK_BUILD_MODE: mode,
  };

  const syncCode = await spawnRunner("pnpm", ["exec", "cap", "sync", "ios"], {
    cwd: appDir,
    env: syncEnv,
    shell: false,
  });

  if (syncCode !== 0) {
    throw new Error(`[EchoTalk Sync] Capacitor sync 失败 (退出码: ${syncCode})`);
  }

  // 6. 核验原生 public 目录与源产物一致性（防止 Capacitor 静默 swallow copy 错误）
  const verification = verifyCopiedPublicAssets(outDir, nativePublicDir);

  return {
    success: true,
    platform: "ios",
    mode,
    targetDir: targetSubDir,
    verifiedFilesCount: verification.verifiedCount,
  };
}

/**
 * CLI 入口判定
 */
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const cliArgs = process.argv.slice(2);
  const { mode } = parseSyncArgs(cliArgs);

  executeSyncIos({
    mode,
  })
    .then((result) => {
      console.log(
        `[EchoTalk Sync] iOS 同步成功: mode=${result.mode}, targetDir=${result.targetDir}`,
      );
      process.exit(0);
    })
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
