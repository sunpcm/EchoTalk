/**
 * R2-12：macOS 静态构建产物与同步前校验测试。
 *
 * 本文件只使用 Node 内置测试能力、临时目录和注入的 runner。它不会启动
 * Tauri、Cargo、Xcode、Capacitor，也不代表原生壳或设备能力已验收。
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ALLOWED_MODES,
  ALLOWED_PLATFORMS,
  BuildValidationError,
  createManifest,
  validateBuildConfig,
  validateManifestSchema,
} from "./config-validator.mjs";
import { executeBuild } from "./build.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(appDir, "../..");
const realMacosShellDir = path.join(appDir, "src-tauri");
const loadSyncMacos = () => import("./sync-macos.mjs");

function temporaryApp(t, label = "macos-build") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `echotalk-${label}-`));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const fixtureAppDir = path.join(root, "app");
  fs.mkdirSync(fixtureAppDir, { recursive: true });
  return fixtureAppDir;
}

function putFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf-8");
  return filePath;
}

function putJson(filePath, value) {
  return putFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function publicEnv(mode) {
  if (mode === "development") {
    return {
      VITE_API_BASE_URL: "http://127.0.0.1:8000",
      VITE_AUTH_MODE: "dev",
    };
  }

  return {
    VITE_API_BASE_URL: `https://api.${mode}.example.test`,
    VITE_AUTH_MODE: "oidc",
    VITE_OIDC_AUTHORITY: `https://idp.${mode}.example.test`,
    VITE_OIDC_CLIENT_ID: `echotalk-macos-${mode}`,
    VITE_OIDC_REDIRECT_URI: "echotalk://auth/callback",
  };
}

function manifestFor(mode, overrides = {}) {
  const env = publicEnv(mode);
  return {
    platform: "macos",
    mode,
    apiOrigin: env.VITE_API_BASE_URL,
    authMode: env.VITE_AUTH_MODE,
    builtAt: "2026-11-13T00:00:00.000Z",
    success: true,
    ...overrides,
  };
}

function tauriConfig(frontendDist = "../dist/web/production") {
  return {
    $schema: "https://schema.tauri.app/config/2",
    productName: "EchoTalk",
    version: "0.0.0",
    identifier: "com.echotalk.test",
    build: {
      frontendDist,
    },
    app: {
      windows: [{ title: "EchoTalk" }],
      security: { csp: null },
    },
    bundle: {
      active: true,
      targets: "all",
    },
  };
}

function putNativeConfig(fixtureAppDir, frontendDist) {
  return putJson(
    path.join(fixtureAppDir, "src-tauri", "tauri.conf.json"),
    tauriConfig(frontendDist),
  );
}

function putMacosArtifact(
  fixtureAppDir,
  mode,
  { manifest = manifestFor(mode), includeIndex = true, includeNativeConfig = true } = {},
) {
  const targetDir = path.join(fixtureAppDir, "dist", "macos", mode);
  fs.mkdirSync(targetDir, { recursive: true });
  if (includeIndex) {
    putFile(path.join(targetDir, "index.html"), "<!doctype html><title>macOS fixture</title>");
  }
  putJson(path.join(targetDir, "build-manifest.json"), manifest);
  if (includeNativeConfig) {
    putNativeConfig(fixtureAppDir);
  }
  return targetDir;
}

function expectNoSpawn() {
  const calls = [];
  return {
    calls,
    runner: async (command, args, options) => {
      calls.push({ command, args, options });
      return 0;
    },
  };
}

function successfulBuildRunner(mode, calls) {
  return async (command, args, options) => {
    calls.push({ command, args, options });
    if (command === "pnpm" && args[1] === "vite") {
      const outDirIndex = args.indexOf("--outDir");
      assert.notEqual(outDirIndex, -1, "Vite 必须显式收到 --outDir");
      const outDir = path.resolve(options.cwd, args[outDirIndex + 1]);
      assert.equal(outDir, path.resolve(options.cwd, "dist", "macos", mode));
      putFile(
        path.join(outDir, "index.html"),
        "<!doctype html><title>synthetic macOS build</title>",
      );
    }
    return 0;
  };
}

describe("macOS 平台、安全配置与 manifest", () => {
  test("macOS 在三个模式均可校验，manifest schema 必须显式指定平台", () => {
    assert.ok(ALLOWED_PLATFORMS.includes("macos"));
    assert.deepEqual(ALLOWED_MODES, ["development", "staging", "production"]);

    for (const mode of ALLOWED_MODES) {
      assert.equal(
        validateBuildConfig({
          platform: "macos",
          mode,
          env: publicEnv(mode),
        }),
        true,
      );
      assert.equal(validateManifestSchema(manifestFor(mode), mode, "macos"), true);
    }

    assert.throws(
      () => validateManifestSchema(manifestFor("production"), "production"),
      /平台|ios|macos/iu,
      "未显式传 expectedPlatform 时必须保持 iOS 默认并拒绝 macOS",
    );
  });

  test("staging/production 强制 HTTPS API、OIDC 必要配置并拒绝 dev token", () => {
    const token = "synthetic-dev-token-must-not-leak";

    for (const mode of ["staging", "production"]) {
      const env = publicEnv(mode);
      assert.equal(validateBuildConfig({ platform: "macos", mode, env }), true);

      assert.throws(
        () =>
          validateBuildConfig({
            platform: "macos",
            mode,
            env: { ...env, VITE_AUTH_MODE: "dev" },
          }),
        /OIDC/u,
      );
      assert.throws(
        () =>
          validateBuildConfig({
            platform: "macos",
            mode,
            env: { ...env, VITE_API_BASE_URL: "http://api.insecure.example.test" },
          }),
        /HTTPS/u,
      );
      assert.throws(
        () =>
          validateBuildConfig({
            platform: "macos",
            mode,
            env: { ...env, VITE_OIDC_AUTHORITY: "http://idp.insecure.example.test" },
          }),
        /HTTPS/u,
      );

      let tokenError;
      try {
        validateBuildConfig({
          platform: "macos",
          mode,
          env: { ...env, VITE_DEV_AUTH_TOKEN: token },
        });
      } catch (error) {
        tokenError = error;
      }
      assert.ok(tokenError instanceof BuildValidationError);
      assert.match(tokenError.message, /禁止配置 VITE_DEV_AUTH_TOKEN/u);
      assert.equal(tokenError.message.includes(token), false);
    }
  });

  test("manifest 不含额外秘密，并严格拒绝错误平台、模式与坏结构", () => {
    const secret = "synthetic-secret-never-serialize";
    const manifest = createManifest({
      platform: "macos",
      mode: "production",
      env: {
        ...publicEnv("production"),
        VITE_DEV_AUTH_TOKEN: secret,
        VITE_OIDC_CLIENT_SECRET: secret,
      },
    });

    assert.equal(manifest.platform, "macos");
    assert.equal(manifest.mode, "production");
    assert.equal(manifest.apiOrigin, "https://api.production.example.test");
    assert.equal(manifest.authMode, "oidc");
    assert.equal(manifest.success, true);
    assert.equal(JSON.stringify(manifest).includes(secret), false);

    const valid = manifestFor("production");
    assert.throws(
      () => validateManifestSchema({ ...valid, platform: "web" }, "production", "macos"),
      /平台不匹配/u,
    );
    assert.throws(
      () => validateManifestSchema({ ...valid, platform: "ios" }, "production", "macos"),
      /平台不匹配/u,
    );
    assert.throws(
      () => validateManifestSchema({ ...valid, mode: "staging" }, "production", "macos"),
      /模式不匹配/u,
    );
    assert.throws(() => validateManifestSchema(null, "production", "macos"), /格式非法/u);
    assert.throws(
      () => validateManifestSchema({ ...valid, success: false }, "production", "macos"),
      /未成功构建/u,
    );
    assert.throws(
      () => validateManifestSchema({ ...valid, builtAt: "" }, "production", "macos"),
      /builtAt/u,
    );
    assert.throws(
      () => validateManifestSchema({ ...valid, authMode: "" }, "production", "macos"),
      /authMode/u,
    );
    assert.throws(
      () => validateManifestSchema({ ...valid, apiOrigin: "" }, "production", "macos"),
      /apiOrigin/u,
    );
    assert.throws(
      () =>
        validateManifestSchema(
          { ...valid, apiOrigin: "http://api.insecure.example.test" },
          "production",
          "macos",
        ),
      /HTTPS/u,
    );
  });
});

describe("macOS 构建路径、manifest 与隔离", () => {
  for (const mode of ALLOWED_MODES) {
    test(`${mode} 产物写入 dist/macos/${mode} 且不清除其他平台或模式`, async (t) => {
      const fixtureAppDir = temporaryApp(t, `build-${mode}`);
      const keepers = [
        putFile(path.join(fixtureAppDir, "dist", "web", "production", "keep.txt"), "web-keep"),
        putFile(path.join(fixtureAppDir, "dist", "ios", "staging", "keep.txt"), "ios-keep"),
      ];

      for (const otherMode of ALLOWED_MODES.filter((candidate) => candidate !== mode)) {
        keepers.push(
          putFile(
            path.join(fixtureAppDir, "dist", "macos", otherMode, "keep.txt"),
            `macos-${otherMode}-keep`,
          ),
        );
      }

      const calls = [];
      const result = await executeBuild({
        platform: "macos",
        mode,
        appDir: fixtureAppDir,
        envOverrides: publicEnv(mode),
        spawnRunner: successfulBuildRunner(mode, calls),
      });

      assert.deepEqual(
        calls.map(({ command, args }) => ({ command, args })),
        [
          {
            command: "pnpm",
            args: ["exec", "tsc", "-p", "tsconfig.json", "--noEmit"],
          },
          {
            command: "pnpm",
            args: ["exec", "vite", "build", "--mode", mode, "--outDir", `dist/macos/${mode}`],
          },
        ],
      );
      for (const call of calls) {
        assert.equal(call.options.cwd, fixtureAppDir);
        assert.equal(call.options.shell, false);
        assert.equal(call.options.env.ECHOTALK_BUILD_PLATFORM, "macos");
        assert.equal(call.options.env.ECHOTALK_BUILD_MODE, mode);
        assert.equal(
          call.options.env.NODE_ENV,
          mode === "development" ? "development" : "production",
        );
      }

      const targetDir = path.join(fixtureAppDir, "dist", "macos", mode);
      assert.equal(result.success, true);
      assert.equal(result.platform, "macos");
      assert.equal(result.mode, mode);
      assert.equal(result.outDir, targetDir);
      assert.ok(fs.existsSync(path.join(targetDir, "index.html")));
      assert.equal(fs.existsSync(path.join(targetDir, "manifest.json")), false);

      const manifest = JSON.parse(
        fs.readFileSync(path.join(targetDir, "build-manifest.json"), "utf-8"),
      );
      assert.equal(manifest.platform, "macos");
      assert.equal(manifest.mode, mode);
      assert.equal(manifest.authMode, publicEnv(mode).VITE_AUTH_MODE);
      assert.equal(manifest.success, true);

      for (const keeper of keepers) {
        assert.ok(fs.existsSync(keeper), `不得删除其他产物: ${keeper}`);
      }
      assert.equal(fs.readFileSync(keepers[0], "utf-8"), "web-keep", "不得改写其他平台产物");
      assert.equal(fs.readFileSync(keepers[1], "utf-8"), "ios-keep", "不得改写其他平台产物");
      assert.equal(fs.existsSync(realMacosShellDir), false, "测试不得在正式 lane 创建 src-tauri");
    });
  }

  test("配置或 Vite 失败会先使同目标旧 success 失效，同时保留其他产物", async (t) => {
    const fixtureAppDir = temporaryApp(t, "build-invalidation");
    const productionDir = path.join(fixtureAppDir, "dist", "macos", "production");
    const stagingDir = path.join(fixtureAppDir, "dist", "macos", "staging");
    const webDir = path.join(fixtureAppDir, "dist", "web", "production");
    const productionManifest = putJson(
      path.join(productionDir, "build-manifest.json"),
      manifestFor("production"),
    );
    const stagingKeep = putFile(path.join(stagingDir, "keep.txt"), "staging-preserved");
    const webKeep = putFile(path.join(webDir, "keep.txt"), "web-preserved");

    const rejectedBuild = expectNoSpawn();
    await assert.rejects(
      executeBuild({
        platform: "macos",
        mode: "production",
        appDir: fixtureAppDir,
        envOverrides: {
          ...publicEnv("production"),
          VITE_API_BASE_URL: "",
        },
        spawnRunner: rejectedBuild.runner,
      }),
      /必须配置 VITE_API_BASE_URL/u,
    );
    assert.equal(rejectedBuild.calls.length, 0, "配置失败必须在任何 runner 前结束");

    assert.equal(JSON.parse(fs.readFileSync(productionManifest, "utf-8")).success, false);
    assert.equal(fs.readFileSync(stagingKeep, "utf-8"), "staging-preserved");
    assert.equal(fs.readFileSync(webKeep, "utf-8"), "web-preserved");

    putJson(productionManifest, manifestFor("production"));
    const runnerCalls = [];
    await assert.rejects(
      executeBuild({
        platform: "macos",
        mode: "production",
        appDir: fixtureAppDir,
        envOverrides: publicEnv("production"),
        spawnRunner: async (command, args, options) => {
          runnerCalls.push({ command, args, options });
          return args[1] === "vite" ? 23 : 0;
        },
      }),
      /Vite 构建未通过.*23/u,
    );
    assert.equal(runnerCalls.length, 2);
    assert.equal(JSON.parse(fs.readFileSync(productionManifest, "utf-8")).success, false);
    assert.equal(fs.readFileSync(stagingKeep, "utf-8"), "staging-preserved");
    assert.equal(fs.readFileSync(webKeep, "utf-8"), "web-preserved");
  });
});

describe("sync-macos 严格 CLI", () => {
  test("接受精确 mode，拒绝重复、未知、缺值与路径穿越", async () => {
    const { parseSyncArgs } = await loadSyncMacos();

    assert.equal(parseSyncArgs(["--mode", "staging"]).mode, "staging");
    assert.equal(parseSyncArgs(["--mode=development"]).mode, "development");

    const invalidArgs = [
      ["--mode"],
      ["--mode=production", "--mode", "staging"],
      ["--mode", "production", "--mode=production"],
      ["--unknown"],
      ["--mode=../production"],
      ["--mode", "../production"],
      ["--mode=production/../../staging"],
      ["--mode", "/tmp/production"],
      ["--mode=..%2Fproduction"],
    ];
    for (const args of invalidArgs) {
      assert.throws(
        () => parseSyncArgs(args),
        /未知|重复|缺少|模式|路径|非法|支持/u,
        `必须拒绝参数: ${args.join(" ")}`,
      );
    }
  });
});

const preflightCases = [
  {
    name: "缺少 macos 目标且只有旧 dist 时禁止回退",
    mode: "production",
    pattern: /dist\/macos|目标构建产物目录/u,
    prepare(fixtureAppDir) {
      putFile(
        path.join(fixtureAppDir, "dist", "index.html"),
        "<!doctype html><title>legacy</title>",
      );
      putMacosArtifact(fixtureAppDir, "production");
      fs.renameSync(
        path.join(fixtureAppDir, "dist", "macos", "production"),
        path.join(fixtureAppDir, "dist", "legacy-copy"),
      );
      putJson(
        path.join(fixtureAppDir, "dist", "web", "production", "build-manifest.json"),
        manifestFor("production", { platform: "web" }),
      );
      putNativeConfig(fixtureAppDir);
    },
  },
  {
    name: "缺少 index.html",
    mode: "production",
    pattern: /index\.html/u,
    prepare(fixtureAppDir) {
      putMacosArtifact(fixtureAppDir, "production", { includeIndex: false });
    },
  },
  {
    name: "缺少 build-manifest.json",
    mode: "production",
    pattern: /manifest|构建标识/u,
    prepare(fixtureAppDir) {
      putFile(
        path.join(fixtureAppDir, "dist", "macos", "production", "index.html"),
        "<!doctype html>",
      );
      putNativeConfig(fixtureAppDir);
    },
  },
  {
    name: "manifest JSON 损坏",
    mode: "production",
    pattern: /损坏|解析|manifest/u,
    prepare(fixtureAppDir) {
      const targetDir = path.join(fixtureAppDir, "dist", "macos", "production");
      putFile(path.join(targetDir, "index.html"), "<!doctype html>");
      putFile(path.join(targetDir, "build-manifest.json"), "{not-json");
      putNativeConfig(fixtureAppDir);
    },
  },
  {
    name: "失败产物 success=false",
    mode: "production",
    pattern: /未成功构建|success|成功构建/u,
    prepare(fixtureAppDir) {
      putMacosArtifact(fixtureAppDir, "production", {
        manifest: manifestFor("production", { success: false }),
      });
    },
  },
  {
    name: "web 产物伪装成 macos",
    mode: "production",
    pattern: /平台不匹配/u,
    prepare(fixtureAppDir) {
      putMacosArtifact(fixtureAppDir, "production", {
        manifest: manifestFor("production", { platform: "web" }),
      });
    },
  },
  {
    name: "iOS 产物伪装成 macos",
    mode: "production",
    pattern: /平台不匹配/u,
    prepare(fixtureAppDir) {
      putMacosArtifact(fixtureAppDir, "production", {
        manifest: manifestFor("production", { platform: "ios" }),
      });
    },
  },
  {
    name: "跨模式产物",
    mode: "production",
    pattern: /模式不匹配/u,
    prepare(fixtureAppDir) {
      putMacosArtifact(fixtureAppDir, "production", {
        manifest: manifestFor("production", { mode: "staging" }),
      });
    },
  },
  {
    name: "staging/production 元数据非 HTTPS",
    mode: "production",
    pattern: /HTTPS/u,
    prepare(fixtureAppDir) {
      putMacosArtifact(fixtureAppDir, "production", {
        manifest: manifestFor("production", {
          apiOrigin: "http://api.insecure.example.test",
        }),
      });
    },
  },
  {
    name: "staging/production 缺少 OIDC authMode",
    mode: "staging",
    pattern: /authMode|OIDC/u,
    prepare(fixtureAppDir) {
      putMacosArtifact(fixtureAppDir, "staging", {
        manifest: manifestFor("staging", { authMode: "" }),
      });
    },
  },
  {
    name: "缺少 src-tauri/tauri.conf.json",
    mode: "production",
    pattern: /src-tauri|tauri\.conf\.json|原生配置/u,
    prepare(fixtureAppDir) {
      putMacosArtifact(fixtureAppDir, "production", { includeNativeConfig: false });
    },
  },
];

describe("sync-macos 在任何 runner 之前的拒绝路径", () => {
  for (const testCase of preflightCases) {
    test(testCase.name, async (t) => {
      const { executeSyncMacos } = await loadSyncMacos();
      const fixtureAppDir = temporaryApp(t, "sync-preflight");
      testCase.prepare(fixtureAppDir);
      const child = expectNoSpawn();

      await assert.rejects(
        executeSyncMacos({
          mode: testCase.mode,
          appDir: fixtureAppDir,
          spawnRunner: child.runner,
        }),
        testCase.pattern,
      );
      assert.equal(child.calls.length, 0, "不合法输入必须保持零 spawn");
    });
  }
});

describe("sync-macos 有效输入与子进程结果", () => {
  for (const mode of ALLOWED_MODES) {
    test(`${mode} 使用 --config 将 frontendDist 解析到本 fixture 且不修改源配置`, async (t) => {
      const { executeSyncMacos } = await loadSyncMacos();
      const fixtureAppDir = temporaryApp(t, `sync-valid-${mode}`);
      putMacosArtifact(fixtureAppDir, mode);
      const expectedFrontendDir = path.join(fixtureAppDir, "dist", "macos", mode);
      const sourceConfigPath = path.join(fixtureAppDir, "src-tauri", "tauri.conf.json");
      const sourceConfigBefore = fs.readFileSync(sourceConfigPath, "utf-8");
      const calls = [];

      const result = await executeSyncMacos({
        mode,
        appDir: fixtureAppDir,
        spawnRunner: async (command, args, options) => {
          const configIndex = args.indexOf("--config");
          assert.notEqual(configIndex, -1, "必须显式传递 --config");
          const configValue = args[configIndex + 1];
          assert.equal(typeof configValue, "string");

          let override;
          let configBaseDir;
          if (configValue.trimStart().startsWith("{")) {
            override = JSON.parse(configValue);
            configBaseDir = path.dirname(sourceConfigPath);
          } else {
            const configPath = path.isAbsolute(configValue)
              ? configValue
              : path.resolve(options.cwd, configValue);
            assert.notEqual(
              path.resolve(configPath),
              path.resolve(sourceConfigPath),
              "不得原地改写正式壳配置",
            );
            override = JSON.parse(fs.readFileSync(configPath, "utf-8"));
            configBaseDir = path.dirname(configPath);
          }
          assert.equal(typeof override.build?.frontendDist, "string");
          assert.equal(
            path.resolve(configBaseDir, override.build.frontendDist),
            expectedFrontendDir,
            "frontendDist 必须相对实际配置来源解析到本 fixture 的 macOS 产物",
          );
          calls.push({ command, args, options, configValue, override, configBaseDir });
          return 0;
        },
      });

      assert.equal(calls.length, 1);
      const [call] = calls;
      assert.equal(call.command, "pnpm");
      assert.deepEqual(call.args, ["exec", "tauri", "build", "--config", call.configValue]);
      assert.equal(call.options.cwd, fixtureAppDir);
      assert.equal(call.options.shell, false);
      assert.equal(call.options.env.ECHOTALK_BUILD_PLATFORM, "macos");
      assert.equal(call.options.env.ECHOTALK_BUILD_MODE, mode);
      assert.equal(result.success, true);
      assert.equal(result.platform, "macos");
      assert.equal(result.mode, mode);
      assert.equal(fs.readFileSync(sourceConfigPath, "utf-8"), sourceConfigBefore);
      assert.equal(fs.existsSync(realMacosShellDir), false, "测试不得在正式 lane 创建 src-tauri");
    });
  }

  test("runner 非零退出或启动错误都不能返回 success", async (t) => {
    const { executeSyncMacos } = await loadSyncMacos();
    const fixtureAppDir = temporaryApp(t, "sync-runner-failure");
    putMacosArtifact(fixtureAppDir, "production");
    const calls = [];

    await assert.rejects(
      executeSyncMacos({
        mode: "production",
        appDir: fixtureAppDir,
        spawnRunner: async (command, args, options) => {
          calls.push({ command, args, options });
          return 31;
        },
      }),
      /31|失败|非零/u,
    );
    assert.equal(calls.length, 1);

    await assert.rejects(
      executeSyncMacos({
        mode: "production",
        appDir: fixtureAppDir,
        spawnRunner: async () => {
          throw new Error("synthetic runner launch failure");
        },
      }),
      /synthetic runner launch failure/u,
    );
  });
});

describe("package 与 Turbo 静态契约", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(appDir, "package.json"), "utf-8"));
  const turboJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "turbo.json"), "utf-8"));

  test("package 暴露 macOS 构建/同步命令并接入新测试", () => {
    assert.equal(packageJson.scripts["build:macos"], "node scripts/build.mjs --platform macos");
    assert.equal(packageJson.scripts["sync:macos"], "node scripts/sync-macos.mjs");
    assert.match(packageJson.scripts["test:build"], /scripts\/build-isolation-test\.mjs/u);
    assert.match(packageJson.scripts["test:build"], /scripts\/macos-build-test\.mjs/u);
    assert.match(packageJson.scripts["test:build"], /^node --test/u);

    assert.equal(packageJson.dependencies?.["@tauri-apps/api"], undefined);
    assert.equal(packageJson.devDependencies?.["@tauri-apps/cli"], undefined);
  });

  test("Turbo 新增 macOS 缓存输入输出且不缩窄旧任务", () => {
    const buildMacosTask = turboJson.tasks["build:macos"];
    assert.ok(buildMacosTask, "必须新增 build:macos task");
    for (const envName of ["VITE_*", "ECHOTALK_BUILD_*"]) {
      assert.ok(buildMacosTask.env.includes(envName), `build:macos 必须包含 env ${envName}`);
    }
    for (const input of [
      "src/**",
      "public/**",
      "index.html",
      "package.json",
      "tsconfig*.json",
      "postcss.config.*",
      "vite.config.*",
      "scripts/**",
      ".env",
      ".env.*",
      "src-tauri/tauri.conf.json",
    ]) {
      assert.ok(buildMacosTask.inputs.includes(input), `build:macos 必须包含输入 ${input}`);
    }
    assert.ok(
      buildMacosTask.inputs.includes("$ANALYZE") || buildMacosTask.env.includes("ANALYZE"),
      "ANALYZE 必须通过 env 或 $ANALYZE 输入参与 build:macos hash",
    );
    for (const output of ["dist/macos/**", "stats.html"]) {
      assert.ok(buildMacosTask.outputs.includes(output), `build:macos 必须缓存输出 ${output}`);
    }

    assert.ok(turboJson.tasks.build.outputs.includes("dist/**"));
    assert.ok(turboJson.tasks.build.outputs.includes("stats.html"));
    assert.ok(
      turboJson.tasks.build.inputs.includes("$ANALYZE") ||
        turboJson.tasks.build.env.includes("ANALYZE"),
    );
    assert.ok(turboJson.tasks["build:web"].outputs.includes("dist/web/**"));
    assert.ok(turboJson.tasks["build:ios"].outputs.includes("dist/ios/**"));
    for (const taskName of ["build", "build:web", "build:ios"]) {
      for (const envName of ["VITE_*", "ECHOTALK_BUILD_*"]) {
        assert.ok(
          turboJson.tasks[taskName].env.includes(envName),
          `${taskName} 必须保留 env ${envName}`,
        );
      }
    }
  });

  test("Turbo hash 在临时工作区分别响应配置、脚本、ANALYZE、API 与 mode", (t) => {
    assert.equal(
      fs.existsSync(realMacosShellDir),
      false,
      "hash 测试开始前正式 lane 不得存在 src-tauri",
    );

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "echotalk-turbo-macos-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const fixtureAppDir = path.join(root, "apps", "vite-app");
    const nativeConfigPath = path.join(fixtureAppDir, "src-tauri", "tauri.conf.json");
    const scriptInputPath = path.join(fixtureAppDir, "scripts", "fixture-build.mjs");

    putJson(path.join(root, "package.json"), {
      name: "macos-turbo-fixture",
      private: true,
      packageManager: "pnpm@10.26.0",
    });
    putFile(path.join(root, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n");
    putJson(path.join(root, "turbo.json"), turboJson);
    putJson(path.join(fixtureAppDir, "package.json"), {
      name: "macos-hash-fixture",
      private: true,
      scripts: {
        "build:macos": "node scripts/fixture-build.mjs",
      },
    });
    putFile(path.join(fixtureAppDir, "src", "fixture.ts"), "export const fixture = 1;\n");
    putFile(path.join(fixtureAppDir, "public", "fixture.txt"), "synthetic public fixture\n");
    putFile(path.join(fixtureAppDir, "index.html"), "<!doctype html>\n");
    putFile(path.join(fixtureAppDir, "tsconfig.json"), "{}\n");
    putFile(path.join(fixtureAppDir, "postcss.config.js"), "export default {};\n");
    putFile(path.join(fixtureAppDir, "vite.config.js"), "export default {};\n");
    putFile(scriptInputPath, "process.exitCode = 0;\n");
    putNativeConfig(fixtureAppDir, "../dist/macos/staging");

    const turboExecutable = path.join(repoRoot, "node_modules", ".bin", "turbo");
    assert.ok(fs.existsSync(turboExecutable), "必须使用已安装的 Turbo，不安装新依赖");

    const baseEnv = {
      PATH: process.env.PATH ?? "",
      TMPDIR: process.env.TMPDIR ?? os.tmpdir(),
      CI: "1",
      DO_NOT_TRACK: "1",
      TURBO_TELEMETRY_DISABLED: "1",
      TURBO_CACHE_DIR: path.join(root, ".turbo-cache"),
      VITE_API_BASE_URL: "https://api.staging.example.test",
      ECHOTALK_BUILD_MODE: "staging",
      ANALYZE: "false",
    };
    if (process.env.HOME !== undefined) baseEnv.HOME = process.env.HOME;

    function runTurboDry(envOverrides = {}) {
      const result = spawnSync(
        turboExecutable,
        ["run", "build:macos", "--filter=macos-hash-fixture", "--dry=json"],
        {
          cwd: root,
          env: { ...baseEnv, ...envOverrides },
          encoding: "utf-8",
          timeout: 20_000,
        },
      );
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr);
      const dryRun = JSON.parse(result.stdout);
      const task = (dryRun.tasks ?? []).find(
        (candidate) =>
          candidate.taskId === "macos-hash-fixture#build:macos" ||
          candidate.taskId === "build:macos",
      );
      assert.ok(task, "Turbo dry-run 必须包含 macOS 构建任务");
      assert.match(task.hash, /^[0-9a-f]+$/u);
      return task.hash;
    }

    const baseline = runTurboDry();

    putNativeConfig(fixtureAppDir, "../dist/macos/production");
    const changedNative = runTurboDry();
    assert.notEqual(changedNative, baseline, "native 配置变化必须改变任务 hash");

    putNativeConfig(fixtureAppDir, "../dist/macos/staging");
    putFile(scriptInputPath, "process.exitCode = 0;\n// hash fixture change\n");
    const changedScript = runTurboDry();
    assert.notEqual(changedScript, baseline, "相关脚本变化必须改变任务 hash");

    putFile(scriptInputPath, "process.exitCode = 0;\n");
    const changedAnalyze = runTurboDry({ ANALYZE: "true" });
    assert.notEqual(changedAnalyze, baseline, "ANALYZE 变化必须改变任务 hash");

    const changedApi = runTurboDry({
      VITE_API_BASE_URL: "https://api.changed.example.test",
    });
    assert.notEqual(changedApi, baseline, "仅 VITE_API_BASE_URL 变化必须改变任务 hash");

    const changedMode = runTurboDry({
      ECHOTALK_BUILD_MODE: "production",
    });
    assert.notEqual(changedMode, baseline, "仅 ECHOTALK_BUILD_MODE 变化必须改变任务 hash");

    assert.equal(
      fs.existsSync(realMacosShellDir),
      false,
      "临时 Turbo hash 合成不得在正式 lane 创建 src-tauri",
    );
  });
});
