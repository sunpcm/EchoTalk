/**
 * Fake API 真实子进程与契约回归测试套件
 * 使用 Node 原生 node:test 与 node:assert/strict
 * 严格遵从 CP-06 与 A29 契约规范
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fakeApiScript = path.resolve(__dirname, "../e2e/fake-api.mjs");

const READY_LINE_REGEX = /^\[fake-api\] ready on http:\/\/(127\.0\.0\.1):(\d+)$/;
const VALID_TOKEN = "e2e-dev-token";
const AUTH_HEADER = { Authorization: `Bearer ${VALID_TOKEN}` };

/**
 * 判断指定 PID 对应的操作系统进程是否仍然存活
 */
function isPidAlive(pid) {
  if (typeof pid !== "number" || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * 有界请求封装，确保“请求 + 响应体读取”全生命周期均处于同一个 deadline 内
 */
function timedFetch(url, options = {}, timeoutMs = 5_000) {
  const controller = new AbortController();
  let timer = setTimeout(() => controller.abort(), timeoutMs);

  return fetch(url, { ...options, signal: controller.signal })
    .then((res) => {
      const originalJson = res.json.bind(res);
      const originalText = res.text.bind(res);
      let cleared = false;

      const clear = () => {
        if (!cleared) {
          cleared = true;
          if (timer) {
            clearTimeout(timer);
            timer = null;
          }
        }
      };

      res.json = async () => {
        try {
          return await originalJson();
        } finally {
          clear();
        }
      };

      res.text = async () => {
        try {
          return await originalText();
        } finally {
          clear();
        }
      };

      return res;
    })
    .catch((err) => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      throw err;
    });
}

/**
 * 优雅终止子进程并确认真实退出（两段有界等待，不以 killed 信号标志为退出）
 */
function terminateServer(child, gracefulTimeoutMs = 2_000, forceTimeoutMs = 2_000) {
  if (!child) return Promise.resolve();

  // 严格依据 exitCode / signalCode 判定是否真正已退出
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }

  if (child._terminatePromise) {
    return child._terminatePromise;
  }

  child._terminatePromise = new Promise((resolve, reject) => {
    let resolved = false;
    let gracefulTimer = null;
    let forceTimer = null;

    const cleanup = () => {
      if (gracefulTimer) clearTimeout(gracefulTimer);
      if (forceTimer) clearTimeout(forceTimer);
      child.removeListener("exit", onExit);
    };

    const onExit = (code, signal) => {
      if (!resolved) {
        resolved = true;
        cleanup();
        resolve({ code, signal });
      }
    };

    child.once("exit", onExit);

    // 阶段 1: 发送 SIGTERM
    try {
      child.kill("SIGTERM");
    } catch (err) {
      cleanup();
      if (err.code === "ESRCH") {
        resolve({ code: child.exitCode, signal: child.signalCode });
        return;
      }
      reject(err);
      return;
    }

    // 阶段 2: SIGTERM 有界超时，未退出则升级为 SIGKILL
    gracefulTimer = setTimeout(() => {
      if (child.exitCode !== null || child.signalCode !== null) {
        onExit(child.exitCode, child.signalCode);
        return;
      }
      try {
        child.kill("SIGKILL");
      } catch (err) {
        if (err.code === "ESRCH") {
          onExit(child.exitCode, child.signalCode);
          return;
        }
        cleanup();
        reject(err);
        return;
      }

      // 阶段 3: SIGKILL 第二段有界超时确认真实退出
      forceTimer = setTimeout(() => {
        cleanup();
        if (child.exitCode !== null || child.signalCode !== null) {
          resolve({ code: child.exitCode, signal: child.signalCode });
        } else {
          reject(
            new Error(`子进程 (PID=${child.pid}) 在 SIGKILL 后 ${forceTimeoutMs}ms 内仍未真实退出`),
          );
        }
      }, forceTimeoutMs);
    }, gracefulTimeoutMs);
  });

  return child._terminatePromise;
}

/**
 * 启动真实 Fake API 进程并解析动态端口，启动失败/异常时有界清理并等待退出
 */
function startFakeApiServer(extraEnv = {}, options = {}) {
  const startupTimeoutMs = options.startupTimeoutMs ?? 10_000;
  const scriptArgs = options.scriptArgs ?? [fakeApiScript];
  const terminateFn = options.terminateFn ?? terminateServer;

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, scriptArgs, {
      env: {
        ...process.env,
        E2E_API_PORT: "0",
        ...extraEnv,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    options.onSpawn?.(child);

    let settled = false;
    let outputBuffer = "";
    let errorBuffer = "";
    let startupTimer = null;

    const fail = async (err) => {
      if (settled) return;
      settled = true;
      if (startupTimer) clearTimeout(startupTimer);
      child.stdout?.removeAllListeners("data");
      child.stderr?.removeAllListeners("data");
      try {
        await terminateFn(child, 1_000, 1_000);
      } catch (cleanupErr) {
        // 绝不吞掉清理失败！同时暴露启动错误与清理错误
        const combinedError = new AggregateError(
          [err, cleanupErr],
          `Fake API 启动失败且清理异常: ${err.message}; 清理错误: ${cleanupErr.message}`,
        );
        combinedError.cause = cleanupErr;
        reject(combinedError);
        return;
      }
      reject(err);
    };

    startupTimer = setTimeout(() => {
      fail(new Error(`Fake API 启动超时 (${startupTimeoutMs}ms)。Stderr: ${errorBuffer}`));
    }, startupTimeoutMs);

    child.stdout.on("data", (chunk) => {
      outputBuffer += chunk.toString("utf8");
      const lines = outputBuffer.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        const match = trimmed.match(READY_LINE_REGEX);
        if (match && !settled) {
          settled = true;
          if (startupTimer) clearTimeout(startupTimer);
          const host = match[1];
          const port = Number(match[2]);
          resolve({
            child,
            host,
            port,
            readyMessage: trimmed,
            baseUrl: `http://${host}:${port}`,
          });
          return;
        }
      }
    });

    child.stderr.on("data", (chunk) => {
      errorBuffer += chunk.toString("utf8");
    });

    child.once("error", (err) => {
      fail(err);
    });

    child.once("exit", (code, signal) => {
      fail(
        new Error(
          `Fake API 进程在就绪前退出 (code=${code}, signal=${signal}). Stderr: ${errorBuffer}`,
        ),
      );
    });
  });
}

describe("Fake API 契约与真实进程回归测试", () => {
  let serverInstance = null;

  before(async () => {
    serverInstance = await startFakeApiServer();
  });

  after(async () => {
    if (serverInstance?.child) {
      await terminateServer(serverInstance.child);
      serverInstance = null;
    }
  });

  describe("1. 动态端口与稳定就绪输出", () => {
    it("就绪消息格式严格为 loopback 及合法端口，且不输出 env/凭据", () => {
      assert.ok(serverInstance, "服务实例必须已创建");
      assert.strictEqual(serverInstance.host, "127.0.0.1");
      assert.ok(
        serverInstance.port > 0 && serverInstance.port <= 65535,
        `端口必须为有效正整数: ${serverInstance.port}`,
      );
      assert.strictEqual(
        serverInstance.readyMessage,
        `[fake-api] ready on http://127.0.0.1:${serverInstance.port}`,
      );
      assert.doesNotMatch(serverInstance.readyMessage, /Bearer|token|secret|env/i);
    });
  });

  describe("2. 健康检查认证边界", () => {
    it("GET /api/health 无需 token 返回 200 与服务状态", async () => {
      const res = await timedFetch(`${serverInstance.baseUrl}/api/health`);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.headers.get("content-type"), "application/json; charset=utf-8");
      const json = await res.json();
      assert.deepStrictEqual(json, { status: "ok", service: "echotalk-e2e-fake" });
    });

    it("GET /api/health/ready 缺少 token 时返回 401", async () => {
      const res = await timedFetch(`${serverInstance.baseUrl}/api/health/ready`);
      assert.strictEqual(res.status, 401);
      const json = await res.json();
      assert.deepStrictEqual(json, { detail: "Authentication required." });
    });

    it("GET /api/health/ready 携带错误 token 时返回 401", async () => {
      const res = await timedFetch(`${serverInstance.baseUrl}/api/health/ready`, {
        headers: { Authorization: "Bearer wrong-token-xyz" },
      });
      assert.strictEqual(res.status, 401);
      const json = await res.json();
      assert.deepStrictEqual(json, { detail: "Authentication required." });
    });

    it("GET /api/health/ready 携带有效 token 时返回 200 与服务状态", async () => {
      const res = await timedFetch(`${serverInstance.baseUrl}/api/health/ready`, {
        headers: AUTH_HEADER,
      });
      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.deepStrictEqual(json, { status: "ok", service: "echotalk-e2e-fake" });
    });
  });

  describe("3. 鉴权门禁 (401)", () => {
    it("缺少 Authorization 请求头返回 401", async () => {
      const paths = [
        "/api/user/settings",
        "/api/call-capabilities",
        "/api/curriculum/next",
        "/api/assessments/analysis-success",
        "/api/assessments/analysis-success/grammar",
      ];
      for (const p of paths) {
        const res = await timedFetch(`${serverInstance.baseUrl}${p}`);
        assert.strictEqual(res.status, 401, `路径 ${p} 应返回 401`);
        const json = await res.json();
        assert.deepStrictEqual(json, { detail: "Authentication required." });
      }
    });

    it("提供错误 Token 返回 401", async () => {
      const res = await timedFetch(`${serverInstance.baseUrl}/api/user/settings`, {
        headers: { Authorization: "Bearer wrong-token-xyz" },
      });
      assert.strictEqual(res.status, 401);
      const json = await res.json();
      assert.deepStrictEqual(json, { detail: "Authentication required." });
    });
  });

  describe("4. GET /api/user/settings 契约", () => {
    it("返回既有必需 theme 字段且默认 warm，符合三值枚举契约", async () => {
      const res = await timedFetch(`${serverInstance.baseUrl}/api/user/settings`, {
        headers: AUTH_HEADER,
      });
      assert.strictEqual(res.status, 200);
      const json = await res.json();

      assert.strictEqual(json.theme, "warm", "默认 theme 必须为 warm");
      assert.ok(
        ["warm", "cool", "dark"].includes(json.theme),
        `theme 必须为 warm/cool/dark 三值之一: ${json.theme}`,
      );
      assert.strictEqual(json.is_custom_mode, false);
      assert.strictEqual(json.subscription_tier, "free");
      assert.strictEqual(json.has_stt_key, false);
      assert.strictEqual(json.stt_status, "unconfigured");
    });
  });

  describe("5. Assessment 路由精确解析与 session_id 契约", () => {
    const validCases = [
      { id: "analysis-success", expectedSessionId: "analysis-success" },
      { id: "analysis-failure", expectedSessionId: "analysis-failure" },
      { id: "analysis-success-chromium", expectedSessionId: "analysis-success-chromium" },
      { id: "analysis-failure-chromium", expectedSessionId: "analysis-failure-chromium" },
      { id: "analysis-success-webkit", expectedSessionId: "analysis-success-webkit" },
      { id: "analysis-failure-webkit", expectedSessionId: "analysis-failure-webkit" },
      {
        id: "analysis-success-sub-project-123",
        expectedSessionId: "analysis-success-sub-project-123",
      },
      {
        id: "analysis-failure-sub-project-123",
        expectedSessionId: "analysis-failure-sub-project-123",
      },
    ];

    for (const { id, expectedSessionId } of validCases) {
      it(`GET /api/assessments/${id} 返回完整数据且 session_id 完全匹配`, async () => {
        const res = await timedFetch(`${serverInstance.baseUrl}/api/assessments/${id}`, {
          headers: AUTH_HEADER,
        });
        assert.strictEqual(res.status, 200);
        const json = await res.json();
        assert.strictEqual(json.session_id, expectedSessionId);
        assert.strictEqual(typeof json.id, "string");
        assert.strictEqual(json.overall_score, 88);
        assert.ok(Array.isArray(json.phoneme_alignment));
        assert.strictEqual(json.source, "demo_mock");
        assert.strictEqual(json.is_synthetic, true);
      });
    }
  });

  describe("6. Grammar 路由精确解析与空数组契约", () => {
    const validGrammarCases = [
      "analysis-success",
      "analysis-failure",
      "analysis-success-chromium",
      "analysis-failure-chromium",
      "analysis-success-webkit",
      "analysis-failure-webkit",
      "analysis-success-my-slug-42",
      "analysis-failure-my-slug-42",
    ];

    for (const id of validGrammarCases) {
      it(`GET /api/assessments/${id}/grammar 精确返回空数组 []`, async () => {
        const res = await timedFetch(`${serverInstance.baseUrl}/api/assessments/${id}/grammar`, {
          headers: AUTH_HEADER,
        });
        assert.strictEqual(res.status, 200);
        const json = await res.json();
        assert.ok(Array.isArray(json));
        assert.strictEqual(json.length, 0);
      });
    }
  });

  describe("7. Assessment / Grammar 负向路由与 404", () => {
    const invalidPaths = [
      // lookalike prefix
      "/api/assessments/analysis-successful",
      "/api/assessments/analysis-successful/grammar",
      "/api/assessments/analysis-fail",
      "/api/assessments/analysis-failures",
      // 空后缀
      "/api/assessments/analysis-success-",
      "/api/assessments/analysis-success-/grammar",
      "/api/assessments/analysis-failure-",
      "/api/assessments/analysis-failure-/grammar",
      // 前缀垃圾
      "/api/assessments/foo-analysis-success",
      "/api/assessments/foo-analysis-success/grammar",
      "/api/assessments/not-analysis-failure",
      // 内部连续连字符或非法字符
      "/api/assessments/analysis-success--test",
      "/api/assessments/analysis-success--test/grammar",
      "/api/assessments/analysis-success-Chromium",
      "/api/assessments/analysis-success-test!",
      // 额外路径段
      "/api/assessments/analysis-success/extra",
      "/api/assessments/analysis-success/extra/grammar",
      "/api/assessments/analysis-success/grammar/extra",
      "/api/assessments/analysis-success/grammar/grammar",
      // /grammar 当作 ID
      "/api/assessments/grammar",
      // 空 ID
      "/api/assessments/",
    ];

    for (const p of invalidPaths) {
      it(`拒绝非法或类似路径并返回 404: ${p}`, async () => {
        const res = await timedFetch(`${serverInstance.baseUrl}${p}`, {
          headers: AUTH_HEADER,
        });
        assert.strictEqual(res.status, 404, `路径 ${p} 应返回 404`);
        const json = await res.json().catch(() => ({}));
        assert.match(json.detail ?? "", /No fake route for GET/);
      });
    }
  });

  describe("8. 请求与响应体全程有界 Deadline (FAKE-03 回归)", () => {
    it("服务器返回 headers 后若 body 挂起不结束，必须在同一 deadline 内超时拒绝", async () => {
      const connections = new Set();
      const hangServer = createServer((req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.write('{"partial":');
        // 故意不调用 res.end()，保持连接挂起
      });

      hangServer.on("connection", (socket) => {
        connections.add(socket);
        socket.once("close", () => connections.delete(socket));
      });

      await new Promise((resolve) => hangServer.listen(0, "127.0.0.1", resolve));
      const hangPort = hangServer.address().port;
      const hangUrl = `http://127.0.0.1:${hangPort}/test-hang`;

      try {
        // 50ms 紧凑 deadline
        const res = await timedFetch(hangUrl, {}, 50);
        assert.strictEqual(res.status, 200);

        // res.json 读取 body 必须在 50ms deadline 内被 AbortError 拒绝
        await assert.rejects(
          async () => {
            await res.json();
          },
          (err) => err.name === "AbortError",
        );
      } finally {
        for (const conn of connections) {
          conn.destroy();
        }
        await new Promise((resolve) => hangServer.close(resolve));
      }
    });
  });

  describe("9. 子进程生命周期、异常清理与真实退出确认 (FAKE-02/FAKE-04 回归)", () => {
    it("独立启动的子进程在 terminateServer 后真实退出且 OS 进程不残留", async () => {
      let independent = null;
      try {
        independent = await startFakeApiServer();
        assert.strictEqual(independent.host, "127.0.0.1");
        assert.ok(independent.port > 0);

        const res = await timedFetch(`${independent.baseUrl}/api/health`);
        assert.strictEqual(res.status, 200);
        await res.json();
      } finally {
        if (independent?.child) {
          await terminateServer(independent.child);
        }
      }

      assert.ok(
        independent.child.exitCode !== null || independent.child.signalCode !== null,
        "子进程 exitCode/signalCode 必须非 null",
      );
      assert.strictEqual(
        isPidAlive(independent.child.pid),
        false,
        "OS 进程必须已彻底退出 (PID not alive)",
      );

      // 再次向该端口发起请求必须被连接拒绝
      await assert.rejects(async () => {
        await timedFetch(`${independent.baseUrl}/api/health`, {}, 1_000);
      });
    });

    it("重复调用 terminateServer 保持幂等且安全", async () => {
      let independent = null;
      try {
        independent = await startFakeApiServer();
      } finally {
        if (independent?.child) {
          await terminateServer(independent.child);
          // 第二次调用已终止的子进程
          await terminateServer(independent.child);
        }
      }
      assert.ok(
        independent.child.exitCode !== null || independent.child.signalCode !== null,
        "子进程已确认退出",
      );
      assert.strictEqual(isPidAlive(independent.child.pid), false);
    });

    it("第一次 terminateServer 尚未结束时并发第二次调用，共享退出等待且安全退出", async () => {
      let independent = null;
      try {
        independent = await startFakeApiServer();
        const child = independent.child;

        // 并发触发两个 terminate 调用
        const p1 = terminateServer(child);
        const p2 = terminateServer(child);
        await Promise.all([p1, p2]);

        assert.ok(child.exitCode !== null || child.signalCode !== null);
        assert.strictEqual(isPidAlive(child.pid), false);
      } finally {
        if (independent?.child) {
          await terminateServer(independent.child);
        }
      }
    });

    it("子进程启动异常（如端口非法）时自动有界清理子进程并抛错", async () => {
      await assert.rejects(async () => {
        await startFakeApiServer({ E2E_API_PORT: "invalid-port-not-number" });
      }, /就绪前退出/);
    });

    it("子进程启动超时（永不就绪）时有界终止并确认真实退出", async () => {
      let spawnedChild = null;
      // 启动一个纯挂起但不输出就绪消息的 Node 脚本，短超时 150ms
      await assert.rejects(async () => {
        await startFakeApiServer(
          {},
          {
            scriptArgs: ["-e", "setInterval(() => {}, 1000)"],
            startupTimeoutMs: 150,
            onSpawn: (c) => {
              spawnedChild = c;
            },
          },
        );
      }, /启动超时/);
      assert.ok(spawnedChild, "子进程必须已创建");
      assert.ok(
        spawnedChild.exitCode !== null || spawnedChild.signalCode !== null,
        "超时后子进程必须已被标记退出",
      );
      assert.strictEqual(isPidAlive(spawnedChild.pid), false, "超时后 OS 进程必须已彻底退出");
    });

    it("子进程清理异常时错误不被吞掉，暴露原错误与清理错误 (AggregateError)", async () => {
      const mockCleanupErr = new Error("simulated cleanup reporting failure");
      const failingTerminate = async (child) => {
        // 先真实杀掉子进程以防泄漏
        await terminateServer(child);
        // 模拟清理上报环节抛出错误
        throw mockCleanupErr;
      };

      let errorCaught = null;
      try {
        await startFakeApiServer(
          { E2E_API_PORT: "invalid-port-for-fail" },
          { terminateFn: failingTerminate },
        );
      } catch (err) {
        errorCaught = err;
      }

      assert.ok(errorCaught instanceof AggregateError, "必须暴露 AggregateError");
      assert.ok(
        errorCaught.errors.some((e) => e.message.includes("simulated cleanup reporting failure")),
        "必须包含清理异常详情",
      );
    });

    it("测试用例异常时 finally 能可靠回收子进程", async () => {
      let independent = null;
      let caught = false;
      try {
        try {
          independent = await startFakeApiServer();
          assert.strictEqual(independent.host, "127.0.0.1");
          assert.fail("intentional test assertion error");
        } finally {
          if (independent?.child) {
            await terminateServer(independent.child);
          }
        }
      } catch (err) {
        if (err.message.includes("intentional test assertion error")) {
          caught = true;
        } else {
          throw err;
        }
      }

      assert.strictEqual(caught, true, "异常必须被正确捕获");
      assert.ok(independent?.child, "子进程实例必须存在");
      assert.ok(
        independent.child.exitCode !== null || independent.child.signalCode !== null,
        "子进程必须在 finally 中完成退出",
      );
      assert.strictEqual(isPidAlive(independent.child.pid), false, "OS 进程必须已终止");
    });
  });

  describe("10. 会话分页与每日聚合 Fake API 契约回归", () => {
    it("GET /api/sessions 返回分页包封 {items, next_cursor}", async () => {
      const res = await timedFetch(`${serverInstance.baseUrl}/api/sessions`, {
        headers: AUTH_HEADER,
      });
      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.ok(Array.isArray(json.items));
      assert.ok("next_cursor" in json);
    });

    it("GET /api/sessions/active 返回活跃会话分页包封", async () => {
      const res = await timedFetch(`${serverInstance.baseUrl}/api/sessions/active`, {
        headers: AUTH_HEADER,
      });
      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.ok(Array.isArray(json.items));
      assert.ok("next_cursor" in json);
    });

    it("GET /api/sessions 校验非法 limit 参数 (0, 101, 1.5, abc) 返回 422", async () => {
      for (const badLimit of ["0", "101", "1.5", "abc", "-10"]) {
        const res = await timedFetch(`${serverInstance.baseUrl}/api/sessions?limit=${badLimit}`, {
          headers: AUTH_HEADER,
        });
        assert.strictEqual(res.status, 422, `limit=${badLimit} 应返回 422`);
      }
    });

    it("GET /api/sessions 校验非法 status 参数返回 422", async () => {
      const res = await timedFetch(
        `${serverInstance.baseUrl}/api/sessions?status=unknown_bad_status`,
        {
          headers: AUTH_HEADER,
        },
      );
      assert.strictEqual(res.status, 422);
    });

    it("校验时间窗口规则：无时区、start >= end、>48h、单边缺失均返回 422", async () => {
      const badWindows = [
        "start=2026-10-25T00:00:00", // 缺少时区
        "start=2026-10-25T10:00:00Z&end=2026-10-25T09:00:00Z", // start > end
        "start=2026-10-20T00:00:00Z&end=2026-10-25T00:00:00Z", // 跨度 > 48h
        "start=2026-10-25T00:00:00Z", // 只有 start
        "end=2026-10-25T00:00:00Z", // 只有 end
      ];
      for (const qs of badWindows) {
        const res1 = await timedFetch(`${serverInstance.baseUrl}/api/sessions?${qs}`, {
          headers: AUTH_HEADER,
        });
        assert.strictEqual(res1.status, 422, `GET /api/sessions?${qs} 应返回 422`);

        const res2 = await timedFetch(
          `${serverInstance.baseUrl}/api/sessions/daily-progress?${qs}`,
          {
            headers: AUTH_HEADER,
          },
        );
        assert.strictEqual(res2.status, 422, `GET /api/sessions/daily-progress?${qs} 应返回 422`);
      }
    });

    it("校验坏游标及跨端点/跨条件复用返回 422", async () => {
      const badCursors = [
        "not-base64url-???",
        Buffer.from("abc").toString("base64url"),
        Buffer.from(JSON.stringify({ v: 1 })).toString("base64url"),
        Buffer.from(
          JSON.stringify({
            v: 1,
            u: "00000000-0000-0000-0000-000000000001",
            ep: "active", // 跨端点：发给 history
            st: null,
            s: null,
            e: null,
            t: "2026-10-25T10:00:00Z",
            id: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
          }),
        ).toString("base64url"),
        Buffer.from(
          JSON.stringify({
            v: 1,
            u: "00000000-0000-0000-0000-999999999999", // 错用户
            ep: "history",
            st: null,
            s: null,
            e: null,
            t: "2026-10-25T10:00:00Z",
            id: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
          }),
        ).toString("base64url"),
        Buffer.from(
          JSON.stringify({
            v: 1,
            u: "00000000-0000-0000-0000-000000000001",
            ep: "history",
            st: "completed", // 错筛选上下文
            s: null,
            e: null,
            t: "2026-10-25T10:00:00Z",
            id: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
          }),
        ).toString("base64url"),
        Buffer.from(
          JSON.stringify({
            v: 1,
            u: "00000000-0000-0000-0000-000000000001",
            ep: "history",
            st: null,
            s: null,
            e: null,
            t: "2026-10-25T10:00:00Z",
            id: "------------------------------------", // 36连字符坏UUID
          }),
        ).toString("base64url"),
        Buffer.from(
          JSON.stringify({
            v: true, // bool 版本
            u: "00000000-0000-0000-0000-000000000001",
            ep: "history",
            st: null,
            s: null,
            e: null,
            t: "2026-10-25T10:00:00Z",
            id: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
          }),
        ).toString("base64url"),
      ];

      for (const cursor of badCursors) {
        const res = await timedFetch(`${serverInstance.baseUrl}/api/sessions?cursor=${cursor}`, {
          headers: AUTH_HEADER,
        });
        assert.strictEqual(res.status, 422, `坏游标应返回 422: ${cursor}`);
      }
    });

    it("等价时区 offset 时间窗口正确返回 200 并按绝对数值比对", async () => {
      // 北京时间 (+08:00) 对应 UTC
      const res = await timedFetch(
        `${serverInstance.baseUrl}/api/sessions/daily-progress?start=2026-10-25T08:00:00%2B08:00&end=2026-10-25T20:00:00%2B08:00`,
        { headers: AUTH_HEADER },
      );
      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.strictEqual(typeof json.completed_sessions, "number");
      assert.strictEqual(typeof json.total_turns, "number");
    });

    it("独立Fake子进程完整遍历多页且准确聚合2个零转录completed会话(等价UTC与+08:00一致)", async () => {
      const isolatedServer = await startFakeApiServer();
      try {
        // 在隔离子进程中创建 3 个会话，分别记录 ID
        const s1Res = await timedFetch(`${isolatedServer.baseUrl}/api/sessions`, {
          method: "POST",
          headers: AUTH_HEADER,
          body: JSON.stringify({ mode: "free_talk" }),
        });
        assert.strictEqual(s1Res.status, 201);
        const s1 = await s1Res.json();

        const s2Res = await timedFetch(`${isolatedServer.baseUrl}/api/sessions`, {
          method: "POST",
          headers: AUTH_HEADER,
          body: JSON.stringify({ mode: "scenario" }),
        });
        assert.strictEqual(s2Res.status, 201);
        const s2 = await s2Res.json();

        const s3Res = await timedFetch(`${isolatedServer.baseUrl}/api/sessions`, {
          method: "POST",
          headers: AUTH_HEADER,
          body: JSON.stringify({ mode: "free_talk" }),
        });
        assert.strictEqual(s3Res.status, 201);
        const s3 = await s3Res.json();

        const expectedIds = new Set([s1.id, s2.id, s3.id]);
        assert.strictEqual(expectedIds.size, 3, "创建的 3 个会话 ID 必须互不相同");

        // 完整多页 keyset 游标遍历（limit=1），核对所有 ID 唯一且不遗漏
        const collectedIds = [];
        let currentCursor = null;
        let pageCount = 0;
        while (pageCount < 10) {
          pageCount++;
          const url = currentCursor
            ? `${isolatedServer.baseUrl}/api/sessions?limit=1&cursor=${currentCursor}`
            : `${isolatedServer.baseUrl}/api/sessions?limit=1`;
          const pageRes = await timedFetch(url, { headers: AUTH_HEADER });
          assert.strictEqual(pageRes.status, 200);
          const pageJson = await pageRes.json();
          assert.strictEqual(pageJson.items.length, 1);
          collectedIds.push(pageJson.items[0].id);

          if (!pageJson.next_cursor) {
            break;
          }
          currentCursor = pageJson.next_cursor;
        }

        assert.strictEqual(collectedIds.length, 3, "必须完整遍历 3 页");
        assert.strictEqual(new Set(collectedIds).size, 3, "遍历到的所有 ID 必须严格唯一");
        for (const id of expectedIds) {
          assert.ok(collectedIds.includes(id), `遍历结果中必须包含创建的会话 ID ${id}`);
        }

        // 结束前两个会话使其进入 completed 状态（0条转录），第三个保持 active
        const end1Res = await timedFetch(`${isolatedServer.baseUrl}/api/sessions/${s1.id}/end`, {
          method: "POST",
          headers: AUTH_HEADER,
        });
        assert.strictEqual(end1Res.status, 200);

        const end2Res = await timedFetch(`${isolatedServer.baseUrl}/api/sessions/${s2.id}/end`, {
          method: "POST",
          headers: AUTH_HEADER,
        });
        assert.strictEqual(end2Res.status, 200);

        // 构造覆盖这 2 个已完成会话的时间窗口（跨度 2 小时，绝对小于 48h 限制）
        const now = new Date();
        const startUtc = new Date(now.getTime() - 3600_000).toISOString();
        const endUtc = new Date(now.getTime() + 3600_000).toISOString();

        // 构造等价的 +08:00 offset ISO 字符串
        const formatOffsetIso = (isoStr, offsetHours = 8) => {
          const date = new Date(isoStr);
          const offsetMs = offsetHours * 3600_000;
          const local = new Date(date.getTime() + offsetMs);
          const y = local.getUTCFullYear();
          const m = String(local.getUTCMonth() + 1).padStart(2, "0");
          const d = String(local.getUTCDate()).padStart(2, "0");
          const h = String(local.getUTCHours()).padStart(2, "0");
          const min = String(local.getUTCMinutes()).padStart(2, "0");
          const s = String(local.getUTCSeconds()).padStart(2, "0");
          return `${y}-${m}-${d}T${h}:${min}:${s}+08:00`;
        };

        const startOffset = formatOffsetIso(startUtc, 8);
        const endOffset = formatOffsetIso(endUtc, 8);

        // 使用 UTC 窗口发起聚合统计查询，精确断言 completed_sessions 为 2，total_turns 为 0
        const progressUtcRes = await timedFetch(
          `${isolatedServer.baseUrl}/api/sessions/daily-progress?start=${encodeURIComponent(startUtc)}&end=${encodeURIComponent(endUtc)}`,
          { headers: AUTH_HEADER },
        );
        assert.strictEqual(progressUtcRes.status, 200);
        const progressUtcJson = await progressUtcRes.json();
        assert.strictEqual(
          progressUtcJson.completed_sessions,
          2,
          "独立进程聚合精确统计 2 个已完成会话",
        );
        assert.strictEqual(progressUtcJson.total_turns, 0, "零转录会话总轮次严格为 0");

        // 使用等价 +08:00 offset 窗口发起聚合统计查询，断言得到完全一致的数值
        const progressOffsetRes = await timedFetch(
          `${isolatedServer.baseUrl}/api/sessions/daily-progress?start=${encodeURIComponent(startOffset)}&end=${encodeURIComponent(endOffset)}`,
          { headers: AUTH_HEADER },
        );
        assert.strictEqual(progressOffsetRes.status, 200);
        const progressOffsetJson = await progressOffsetRes.json();
        assert.strictEqual(
          progressOffsetJson.completed_sessions,
          2,
          "等价时区 offset 聚合统计结果一致",
        );
        assert.strictEqual(progressOffsetJson.total_turns, 0, "等价时区 offset 轮次统计结果一致");
      } finally {
        await terminateServer(isolatedServer.child);
      }
    });
  });
});
