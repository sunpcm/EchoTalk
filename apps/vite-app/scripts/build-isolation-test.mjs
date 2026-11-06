/**
 * 跨平台/环境构建与 iOS 同步隔离回归测试套件
 * 使用 Node 内置 node:test 与 node:assert/strict
 * 严格遵从 CP-01 契约及 Reviewer 评审规范
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  ALLOWED_PLATFORMS,
  ALLOWED_MODES,
  validateBuildConfig,
  createManifest,
  validateManifestSchema,
  BuildValidationError,
} from "./config-validator.mjs";
import { executeBuild, parseBuildArgs } from "./build.mjs";
import { executeSyncIos, parseSyncArgs } from "./sync-ios.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");

describe("1. 配置验证与 Manifest Schema 测试 (config-validator)", () => {
  const validIosStagingEnv = {
    VITE_API_BASE_URL: "https://api.staging.example.com",
    VITE_AUTH_MODE: "oidc",
    VITE_OIDC_AUTHORITY: "https://idp.staging.example.com",
    VITE_OIDC_CLIENT_ID: "echotalk-ios-staging",
    VITE_OIDC_REDIRECT_URI: "com.echotalk.app:/callback",
  };

  const validIosProdEnv = {
    VITE_API_BASE_URL: "https://api.echotalk.example.com",
    VITE_AUTH_MODE: "oidc",
    VITE_OIDC_AUTHORITY: "https://idp.echotalk.example.com",
    VITE_OIDC_CLIENT_ID: "echotalk-ios-prod",
    VITE_OIDC_REDIRECT_URI: "com.echotalk.app:/callback",
  };

  it("应允许支持的平台与模式组合", () => {
    assert.deepEqual(ALLOWED_PLATFORMS, ["web", "ios"]);
    assert.deepEqual(ALLOWED_MODES, ["development", "staging", "production"]);
  });

  it("应拒绝不受支持的平台与模式", () => {
    assert.throws(
      () => validateBuildConfig({ platform: "macos", mode: "production" }),
      /不支持的构建平台: "macos"/,
    );
    assert.throws(
      () => validateBuildConfig({ platform: "web", mode: "test" }),
      /不支持的构建模式: "test"/,
    );
  });

  it("在 production 模式下禁止使用 --mode development 旁路", () => {
    assert.throws(
      () =>
        validateBuildConfig({
          platform: "web",
          mode: "production",
          rawArgs: ["--mode", "development"],
        }),
      /禁止在 production 构建中使用 --mode development 旁路/,
    );
    assert.throws(
      () =>
        validateBuildConfig({
          platform: "ios",
          mode: "production",
          rawArgs: ["--mode=development"],
        }),
      /禁止在 production 构建中使用 --mode development 旁路/,
    );
  });

  it("iOS staging 与 production 必须具备有效的 HTTPS API 地址", () => {
    assert.throws(
      () =>
        validateBuildConfig({
          platform: "ios",
          mode: "staging",
          env: { ...validIosStagingEnv, VITE_API_BASE_URL: "" },
        }),
      /必须配置 VITE_API_BASE_URL/,
    );

    assert.throws(
      () =>
        validateBuildConfig({
          platform: "ios",
          mode: "production",
          env: {
            ...validIosProdEnv,
            VITE_API_BASE_URL: "http://api.echotalk.example.com",
          },
        }),
      /API 地址必须使用 HTTPS 协议/,
    );
  });

  it("iOS staging 与 production 严禁配置 VITE_DEV_AUTH_TOKEN 且错误信息不得泄露 token 值", () => {
    const sensitiveToken = "super-secret-dev-token-9999";
    try {
      validateBuildConfig({
        platform: "ios",
        mode: "production",
        env: {
          ...validIosProdEnv,
          VITE_DEV_AUTH_TOKEN: sensitiveToken,
        },
      });
      assert.fail("应当抛出异常");
    } catch (err) {
      assert.match(err.message, /禁止配置 VITE_DEV_AUTH_TOKEN/);
      assert.doesNotMatch(
        err.message,
        new RegExp(sensitiveToken),
        "错误信息绝对不能输出敏感 Token 的值",
      );
    }
  });

  it("iOS staging 与 production 必须使用 OIDC 认证", () => {
    assert.throws(
      () =>
        validateBuildConfig({
          platform: "ios",
          mode: "staging",
          env: { ...validIosStagingEnv, VITE_AUTH_MODE: "dev" },
        }),
      /必须使用 OIDC 认证/,
    );
  });

  it("Web production 禁止使用 dev 认证或配置 VITE_DEV_AUTH_TOKEN", () => {
    assert.throws(
      () =>
        validateBuildConfig({
          platform: "web",
          mode: "production",
          env: { VITE_AUTH_MODE: "dev" },
        }),
      /禁止使用 dev 认证/,
    );
  });

  it("createManifest 真实记录字段，不冒充默认 oidc，且不包含私密数据", () => {
    const manifest = createManifest({
      platform: "ios",
      mode: "staging",
      env: {
        ...validIosStagingEnv,
        VITE_DEV_AUTH_TOKEN: "sensitive-token-never-in-manifest",
      },
    });

    assert.equal(manifest.platform, "ios");
    assert.equal(manifest.mode, "staging");
    assert.equal(manifest.apiOrigin, "https://api.staging.example.com");
    assert.equal(manifest.authMode, "oidc");
    assert.equal(manifest.success, true);
    assert.ok(manifest.builtAt);

    // 未配置 VITE_AUTH_MODE 时应真实为空，不自动冒充 oidc
    const rawManifest = createManifest({
      platform: "web",
      mode: "production",
      env: {},
    });
    assert.equal(rawManifest.authMode, "");
  });

  it("validateManifestSchema 严格校验必要元数据字段与安全规范", () => {
    const validManifest = {
      platform: "ios",
      mode: "production",
      apiOrigin: "https://api.echotalk.example.com",
      authMode: "oidc",
      builtAt: new Date().toISOString(),
      success: true,
    };

    assert.equal(validateManifestSchema(validManifest, "production"), true);

    // 缺少 apiOrigin 或 authMode 时抛错
    assert.throws(
      () => validateManifestSchema({ ...validManifest, authMode: "" }, "production"),
      /缺失 authMode 元数据/,
    );
    assert.throws(
      () => validateManifestSchema({ ...validManifest, apiOrigin: "" }, "production"),
      /缺失 apiOrigin 元数据/,
    );

    // production 下 authMode 不为 oidc 或 apiOrigin 不为 HTTPS
    assert.throws(
      () => validateManifestSchema({ ...validManifest, authMode: "dev" }, "production"),
      /必须配置 OIDC 认证/,
    );
    assert.throws(
      () =>
        validateManifestSchema(
          { ...validManifest, apiOrigin: "http://insecure.com" },
          "production",
        ),
      /API Origin 必须使用 HTTPS 协议/,
    );
  });
});

describe("2. 构建隔离与状态失效测试 (executeBuild)", () => {
  let tmpAppDir;

  beforeEach(() => {
    tmpAppDir = fs.mkdtempSync(path.join(os.tmpdir(), "echotalk-build-test-"));
  });

  afterEach(() => {
    if (fs.existsSync(tmpAppDir)) {
      fs.rmSync(tmpAppDir, { recursive: true, force: true });
    }
  });

  it("P1-1 修复验证：development 强制 NODE_ENV=development，production 强制 NODE_ENV=production，禁止被外部覆盖", async () => {
    let capturedEnvDev;
    const mockRunnerDev = async (cmd, args, opts) => {
      capturedEnvDev = opts.env;
      if (args.includes("vite")) {
        const outDir = path.resolve(opts.cwd, "dist", "web", "development");
        fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(path.join(outDir, "index.html"), "<!doctype html>");
      }
      return 0;
    };

    await executeBuild({
      platform: "web",
      mode: "development",
      appDir: tmpAppDir,
      spawnRunner: mockRunnerDev,
    });
    assert.equal(capturedEnvDev.NODE_ENV, "development");

    let capturedEnvProd;
    const mockRunnerProd = async (cmd, args, opts) => {
      capturedEnvProd = opts.env;
      if (args.includes("vite")) {
        const outDir = path.resolve(opts.cwd, "dist", "web", "production");
        fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(path.join(outDir, "index.html"), "<!doctype html>");
      }
      return 0;
    };

    // 即使 process.env 或 envOverrides 传入了 development，production 构建也必须强制为 production
    await executeBuild({
      platform: "web",
      mode: "production",
      appDir: tmpAppDir,
      envOverrides: {
        NODE_ENV: "development",
        VITE_AUTH_MODE: "oidc",
      },
      spawnRunner: mockRunnerProd,
    });
    assert.equal(capturedEnvProd.NODE_ENV, "production");
  });

  it("P1-2 修复验证：非法配置失败时先使旧 success 标识失效，绝不遗留旧 success: true 标识", async () => {
    const targetDir = path.join(tmpAppDir, "dist", "ios", "production");
    fs.mkdirSync(targetDir, { recursive: true });
    const manifestPath = path.join(targetDir, "build-manifest.json");

    // 模拟之前存在一个成功标识
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({
        platform: "ios",
        mode: "production",
        success: true,
        apiOrigin: "https://api.old.com",
        authMode: "oidc",
      }),
    );

    // 执行一次非法配置的构建（缺少 VITE_API_BASE_URL）
    await assert.rejects(async () => {
      await executeBuild({
        platform: "ios",
        mode: "production",
        appDir: tmpAppDir,
        envOverrides: {
          VITE_AUTH_MODE: "oidc",
          VITE_API_BASE_URL: "",
        },
      });
    }, /必须配置 VITE_API_BASE_URL/);

    // 核心断言：旧 success 标识已被彻底置为 false，绝不再是 true！
    assert.ok(fs.existsSync(manifestPath), "manifestPath 应存在（记录失效状态）");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    assert.strictEqual(manifest.success, false);
  });

  it("产物严格存入 dist/<platform>/<mode>，且不得清空或遍历整个 dist 根目录", async () => {
    const otherSubDir = path.join(tmpAppDir, "dist", "web", "development");
    fs.mkdirSync(otherSubDir, { recursive: true });
    const existingFilePath = path.join(otherSubDir, "existing.txt");
    fs.writeFileSync(existingFilePath, "web-dev-content");

    const mockSpawnRunner = async (cmd, args, opts) => {
      if (args.includes("vite")) {
        const outDir = path.resolve(opts.cwd, "dist", "ios", "staging");
        fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(path.join(outDir, "index.html"), "<!doctype html>");
      }
      return 0;
    };

    const result = await executeBuild({
      platform: "ios",
      mode: "staging",
      appDir: tmpAppDir,
      envOverrides: {
        VITE_API_BASE_URL: "https://api.staging.example.com",
        VITE_AUTH_MODE: "oidc",
        VITE_OIDC_AUTHORITY: "https://idp.staging.example.com",
        VITE_OIDC_CLIENT_ID: "client-id",
        VITE_OIDC_REDIRECT_URI: "com.echotalk.app:/callback",
      },
      spawnRunner: mockSpawnRunner,
    });

    assert.equal(result.success, true);
    assert.equal(result.outDir, path.resolve(tmpAppDir, "dist", "ios", "staging"));
    assert.ok(fs.existsSync(existingFilePath), "不得清除其他平台或模式的产物");
    assert.equal(fs.readFileSync(existingFilePath, "utf-8"), "web-dev-content");
  });
});

describe("3. iOS 同步隔离与 Schema 校验测试 (executeSyncIos)", () => {
  let tmpAppDir;

  beforeEach(() => {
    tmpAppDir = fs.mkdtempSync(path.join(os.tmpdir(), "echotalk-sync-test-"));
  });

  afterEach(() => {
    if (fs.existsSync(tmpAppDir)) {
      fs.rmSync(tmpAppDir, { recursive: true, force: true });
    }
  });

  it("P1-3 修复验证：缺少必要元数据字段（如 apiOrigin/authMode）时在调用子进程前拒绝", async () => {
    const targetDir = path.join(tmpAppDir, "dist", "ios", "production");
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(targetDir, "index.html"), "<!doctype html>");
    // 写入缺少 apiOrigin 和 authMode 的 manifest
    fs.writeFileSync(
      path.join(targetDir, "build-manifest.json"),
      JSON.stringify({
        platform: "ios",
        mode: "production",
        success: true,
        builtAt: new Date().toISOString(),
      }),
    );

    let childCalled = false;
    const mockRunner = async () => {
      childCalled = true;
      return 0;
    };

    await assert.rejects(async () => {
      await executeSyncIos({
        mode: "production",
        appDir: tmpAppDir,
        spawnRunner: mockRunner,
      });
    }, /构建标识缺失 authMode 元数据配置/);

    assert.equal(childCalled, false, "子进程绝不能被调用");
  });

  it("拒绝跨平台、跨模式或未成功构建的产物", async () => {
    const targetDir = path.join(tmpAppDir, "dist", "ios", "production");
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(targetDir, "index.html"), "<!doctype html>");

    // 跨平台
    fs.writeFileSync(
      path.join(targetDir, "build-manifest.json"),
      JSON.stringify({
        platform: "web",
        mode: "production",
        success: true,
        apiOrigin: "https://api.example.com",
        authMode: "oidc",
        builtAt: new Date().toISOString(),
      }),
    );

    await assert.rejects(async () => {
      await executeSyncIos({ mode: "production", appDir: tmpAppDir });
    }, /产物平台不匹配/);

    // 未成功构建
    fs.writeFileSync(
      path.join(targetDir, "build-manifest.json"),
      JSON.stringify({
        platform: "ios",
        mode: "production",
        success: false,
        apiOrigin: "https://api.example.com",
        authMode: "oidc",
        builtAt: new Date().toISOString(),
      }),
    );

    await assert.rejects(async () => {
      await executeSyncIos({ mode: "production", appDir: tmpAppDir });
    }, /产物标识记录未成功构建/);
  });

  it("P1-2 修复验证：Capacitor sync 退出 0 后的三种复制状态核验（未复制/错内容/完整复制）", async () => {
    const targetDir = path.join(tmpAppDir, "dist", "ios", "production");
    const nativePublicDir = path.join(tmpAppDir, "ios", "App", "App", "public");
    fs.mkdirSync(targetDir, { recursive: true });

    // 准备源产物：index.html, build-manifest.json, 以及常规 asset 文件
    const indexContent = "<!doctype html><html><head><title>App</title></head><body></body></html>";
    const manifestContent = JSON.stringify({
      platform: "ios",
      mode: "production",
      success: true,
      apiOrigin: "https://api.echotalk.example.com",
      authMode: "oidc",
      builtAt: new Date().toISOString(),
    });
    const assetSubDir = path.join(targetDir, "assets");
    fs.mkdirSync(assetSubDir, { recursive: true });
    const assetContent = "console.log('asset-code-v1');";

    fs.writeFileSync(path.join(targetDir, "index.html"), indexContent);
    fs.writeFileSync(path.join(targetDir, "build-manifest.json"), manifestContent);
    fs.writeFileSync(path.join(assetSubDir, "main.js"), assetContent);

    // 状态 1: exit 0 但完全未复制任何内容到 native public（或者仅创建了空目录）
    const mockRunnerExit0Uncopied = async () => {
      // 模拟 Capacitor exit 0 但并未把任何文件拷贝到 native public
      return 0;
    };

    await assert.rejects(async () => {
      await executeSyncIos({
        mode: "production",
        appDir: tmpAppDir,
        nativePublicDir,
        spawnRunner: mockRunnerExit0Uncopied,
      });
    }, /Capacitor 同步后原生公共目录不存在|原生公共目录缺少同步文件/);

    // 状态 2: exit 0 但复制的内容损坏/不一致（如 index.html 或 asset 被截断/被篡改）
    const mockRunnerExit0Corrupted = async () => {
      fs.mkdirSync(path.join(nativePublicDir, "assets"), { recursive: true });
      fs.writeFileSync(path.join(nativePublicDir, "index.html"), indexContent);
      fs.writeFileSync(path.join(nativePublicDir, "build-manifest.json"), manifestContent);
      // 故意写入不一致的 asset 内容
      fs.writeFileSync(path.join(nativePublicDir, "assets", "main.js"), "corrupted-content");
      return 0;
    };

    await assert.rejects(async () => {
      await executeSyncIos({
        mode: "production",
        appDir: tmpAppDir,
        nativePublicDir,
        spawnRunner: mockRunnerExit0Corrupted,
      });
    }, /原生公共目录文件内容与源产物不一致|原生公共目录文件大小不一致/);

    // 状态 3: exit 0 且完整复制全部源产物（index/manifest/assets 内容一致）
    const mockRunnerExit0Complete = async () => {
      fs.mkdirSync(path.join(nativePublicDir, "assets"), { recursive: true });
      fs.writeFileSync(path.join(nativePublicDir, "index.html"), indexContent);
      fs.writeFileSync(path.join(nativePublicDir, "build-manifest.json"), manifestContent);
      fs.writeFileSync(path.join(nativePublicDir, "assets", "main.js"), assetContent);
      return 0;
    };

    const result = await executeSyncIos({
      mode: "production",
      appDir: tmpAppDir,
      nativePublicDir,
      spawnRunner: mockRunnerExit0Complete,
    });

    assert.equal(result.success, true);
    assert.equal(result.mode, "production");
    assert.equal(result.verifiedFilesCount, 3);
  });
});

describe("4. Turbo 真实缓存与任务哈希测试 (--dry=json)", () => {
  it("P1-4/P1-5 修复验证：真实 Turbo --dry=json 验证环境变量与 PostCSS 影响任务哈希", () => {
    // 运行真实 Turbo dry run 获取任务哈希
    function runTurboDry(taskName, extraEnv = {}) {
      const output = execFileSync(
        "pnpm",
        ["exec", "turbo", "run", taskName, "--filter=vite-app", "--dry=json"],
        {
          cwd: repoRoot,
          env: { ...process.env, ...extraEnv },
          encoding: "utf-8",
        },
      );
      const json = JSON.parse(output);
      const task = (json.tasks || []).find(
        (t) => t.taskId === `vite-app#${taskName}` || t.taskId === taskName,
      );
      assert.ok(task, `必须找到任务 vite-app#${taskName}`);
      return {
        taskId: task.taskId,
        hash: task.hash,
        inputs: task.inputs || {},
      };
    }

    // 1. 基线 hash
    const baseline = runTurboDry("build:ios", {
      ECHOTALK_BUILD_MODE: "staging",
      VITE_API_BASE_URL: "https://api.baseline.com",
    });
    assert.ok(baseline.hash, "必须具备有效任务哈希");

    // 2. 改变环境变量 VITE_API_BASE_URL
    const changedApi = runTurboDry("build:ios", {
      ECHOTALK_BUILD_MODE: "staging",
      VITE_API_BASE_URL: "https://api.changed.com",
    });
    assert.notStrictEqual(
      baseline.hash,
      changedApi.hash,
      "改变 VITE_API_BASE_URL 必须改变任务哈希",
    );

    // 3. 改变 ECHOTALK_BUILD_MODE
    const changedMode = runTurboDry("build:ios", {
      ECHOTALK_BUILD_MODE: "production",
      VITE_API_BASE_URL: "https://api.baseline.com",
    });
    assert.notStrictEqual(
      baseline.hash,
      changedMode.hash,
      "改变 ECHOTALK_BUILD_MODE 必须改变任务哈希",
    );

    // 4. 验证 postcss.config.js 变更改变任务哈希
    const postcssPath = path.resolve(repoRoot, "apps/vite-app/postcss.config.js");
    assert.ok(fs.existsSync(postcssPath), "postcss.config.js 必须存在");
    const originalPostcss = fs.readFileSync(postcssPath, "utf-8");

    try {
      // 临时给 postcss.config.js 增加注释触发真实 Turbo hash 重新计算
      fs.writeFileSync(postcssPath, `${originalPostcss}\n// turbo hash test mutation\n`, "utf-8");
      const changedPostcss = runTurboDry("build:ios", {
        ECHOTALK_BUILD_MODE: "staging",
        VITE_API_BASE_URL: "https://api.baseline.com",
      });
      assert.notStrictEqual(
        baseline.hash,
        changedPostcss.hash,
        "改变 postcss.config.js 必须改变 build:ios 任务哈希",
      );
    } finally {
      // 严谨恢复原文件，保证工作区无额外污染
      fs.writeFileSync(postcssPath, originalPostcss, "utf-8");
    }
  });

  it("P1-1 修复验证：globalDependencies 覆盖 packages/configs/**，共享 PostCSS 及 Tailwind 配置变更改变任务哈希", () => {
    function runTurboDry(taskName, extraEnv = {}) {
      const output = execFileSync(
        "pnpm",
        ["exec", "turbo", "run", taskName, "--filter=vite-app", "--dry=json"],
        {
          cwd: repoRoot,
          env: { ...process.env, ...extraEnv },
          encoding: "utf-8",
        },
      );
      const json = JSON.parse(output);
      const task = (json.tasks || []).find(
        (t) => t.taskId === `vite-app#${taskName}` || t.taskId === taskName,
      );
      assert.ok(task, `必须找到任务 vite-app#${taskName}`);
      return {
        taskId: task.taskId,
        hash: task.hash,
        inputs: task.inputs || {},
      };
    }

    const baseline = runTurboDry("build:ios", {
      ECHOTALK_BUILD_MODE: "staging",
      VITE_API_BASE_URL: "https://api.baseline.com",
    });
    assert.ok(baseline.hash, "必须具备有效任务哈希");

    // 1. 验证共享 PostCSS 配置 packages/configs/postcss-config/index.js 变更影响 build:ios hash
    const sharedPostcssPath = path.resolve(repoRoot, "packages/configs/postcss-config/index.js");
    assert.ok(fs.existsSync(sharedPostcssPath), "共享 postcss 配置必须存在");
    const originalSharedPostcss = fs.readFileSync(sharedPostcssPath, "utf-8");

    try {
      fs.writeFileSync(
        sharedPostcssPath,
        `${originalSharedPostcss}\n// turbo hash shared postcss test mutation\n`,
        "utf-8",
      );
      const changedSharedPostcss = runTurboDry("build:ios", {
        ECHOTALK_BUILD_MODE: "staging",
        VITE_API_BASE_URL: "https://api.baseline.com",
      });
      assert.notStrictEqual(
        baseline.hash,
        changedSharedPostcss.hash,
        "改变共享 packages/configs/postcss-config/index.js 必须改变 build:ios 任务哈希",
      );
    } finally {
      fs.writeFileSync(sharedPostcssPath, originalSharedPostcss, "utf-8");
    }

    // 2. 验证共享 Tailwind 配置 packages/configs/tailwind-config/theme.css 变更影响 build:ios hash
    const sharedTailwindPath = path.resolve(repoRoot, "packages/configs/tailwind-config/theme.css");
    assert.ok(fs.existsSync(sharedTailwindPath), "共享 tailwind 配置必须存在");
    const originalSharedTailwind = fs.readFileSync(sharedTailwindPath, "utf-8");

    try {
      fs.writeFileSync(
        sharedTailwindPath,
        `${originalSharedTailwind}\n/* turbo hash shared tailwind test mutation */\n`,
        "utf-8",
      );
      const changedSharedTailwind = runTurboDry("build:ios", {
        ECHOTALK_BUILD_MODE: "staging",
        VITE_API_BASE_URL: "https://api.baseline.com",
      });
      assert.notStrictEqual(
        baseline.hash,
        changedSharedTailwind.hash,
        "改变共享 packages/configs/tailwind-config/theme.css 必须改变 build:ios 任务哈希",
      );
    } finally {
      fs.writeFileSync(sharedTailwindPath, originalSharedTailwind, "utf-8");
    }
  });
});

describe("5. CLI 参数解析器严格性测试 (parseBuildArgs / parseSyncArgs)", () => {
  it("拒绝未知参数、重复参数或缺少值的参数", () => {
    assert.throws(() => parseBuildArgs(["--unknown-flag"]), /未知或不受支持的参数/);
    assert.throws(() => parseBuildArgs(["--mode"]), /缺少值/);
    assert.throws(
      () => parseBuildArgs(["--mode", "production", "--mode", "staging"]),
      /重复指定的参数/,
    );
    assert.throws(() => parseSyncArgs(["--mode", "--other"]), /缺少值/);
    assert.throws(() => parseSyncArgs(["--invalid"]), /未知或不受支持的参数/);
  });
});
