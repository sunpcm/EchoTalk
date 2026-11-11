/**
 * Fake API 真实子进程与契约回归测试套件
 * 使用 Node 原生 node:test 与 node:assert/strict
 * 严格遵从 CP-06 与 A29 契约规范
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  auditJsonSchema,
  classifyOpenApiSuccessCoverage,
  compareOperationKeys,
  listOpenApiOperations,
  validateJsonSchema,
} from "./fake-api-contract.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fakeApiScript = path.resolve(__dirname, "../e2e/fake-api.mjs");
const openApiScript = path.resolve(__dirname, "../../../backend/openapi.json");

const READY_LINE_REGEX = /^\[fake-api\] ready on http:\/\/(127\.0\.0\.1):(\d+)$/;
const VALID_TOKEN = "e2e-dev-token";
const AUTH_HEADER = { Authorization: `Bearer ${VALID_TOKEN}` };

describe("七天聚合 Fake API 真实独立子进程契约", { timeout: 30_000 }, () => {
  let instance;
  before(async () => {
    instance = await startFakeApiServer();
  });
  after(async () => {
    await terminateServer(instance?.child);
  });
  const get = (query, fixture) =>
    timedFetch(`${instance.baseUrl}/api/sessions/weekly-progress?${new URLSearchParams(query)}`, {
      headers: { ...AUTH_HEADER, ...(fixture ? { "x-e2e-weekly-fixture": fixture } : {}) },
    });
  const getGrammar = (query, fixture, status) =>
    timedFetch(`${instance.baseUrl}/api/assessments/weekly-grammar?${new URLSearchParams(query)}`, {
      headers: {
        ...AUTH_HEADER,
        ...(fixture ? { "x-e2e-weekly-grammar-fixture": fixture } : {}),
        ...(status ? { "x-e2e-weekly-grammar-status": status } : {}),
      },
    });

  it("严格认证，静态路由不被详情吞掉", async () => {
    const res = await timedFetch(
      `${instance.baseUrl}/api/sessions/weekly-progress?end_date=2026-11-03&timezone=UTC`,
    );
    assert.equal(res.status, 401);
    await res.json();
    const valid = await get({ end_date: "2026-11-03", timezone: "UTC" });
    assert.equal(valid.status, 200);
    assert.equal((await valid.json()).days.length, 7);
  });

  it("空库严格返回有序七个零桶，固定日界而非七次日报", async () => {
    const res = await get({ end_date: "2026-11-03", timezone: "Asia/Singapore" });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(Object.keys(body), ["days"]);
    assert.deepEqual(
      body.days.map((day) => day.date),
      [
        "2026-10-28",
        "2026-10-29",
        "2026-10-30",
        "2026-10-31",
        "2026-11-01",
        "2026-11-02",
        "2026-11-03",
      ],
    );
    assert.deepEqual(
      body.days.map((day) => day.completed_sessions),
      [0, 0, 0, 0, 0, 0, 0],
    );
    assert.equal(body.days[0].start, "2026-10-27T16:00:00.000Z");
    assert.equal(body.days[6].end, "2026-11-03T16:00:00.000Z");
    body.days.slice(1).forEach((day, index) => assert.equal(day.start, body.days[index].end));
  });

  it("请求局部合成数据：55+1 零转录会话准确统计，active/其他用户排除，无全局播种", async () => {
    const res = await get({ end_date: "2026-11-03", timezone: "Asia/Singapore" }, "weekly");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(
      body.days.map((day) => day.completed_sessions),
      [0, 0, 0, 0, 0, 1, 55],
    );
    const untouched = await get({ end_date: "2026-11-03", timezone: "Asia/Singapore" });
    assert.equal(
      (await untouched.json()).days.reduce((sum, day) => sum + day.completed_sessions, 0),
      0,
    );
  });

  for (const [date, start, end, hours] of [
    ["2026-03-08", "2026-03-08T05:00:00.000Z", "2026-03-09T04:00:00.000Z", 23],
    ["2026-11-01", "2026-11-01T04:00:00.000Z", "2026-11-02T05:00:00.000Z", 25],
  ]) {
    it(`${date} 纽约 ${hours}h DST 半开窗口边界与用户/状态过滤`, async () => {
      const res = await get({ end_date: date, timezone: "America/New_York" }, "dst");
      assert.equal(res.status, 200);
      const days = (await res.json()).days;
      assert.deepEqual(days[6], { date, start, end, completed_sessions: 1 });
      assert.equal((Date.parse(end) - Date.parse(start)) / 3_600_000, hours);
      assert.equal(
        days.reduce((sum, day) => sum + day.completed_sessions, 0),
        1,
      );
    });
  }

  it("Samoa 极端跳日保留零长度零桶", async () => {
    const res = await get({ end_date: "2011-12-31", timezone: "Pacific/Apia" }, "dst");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.days[5], {
      date: "2011-12-30",
      start: "2011-12-30T10:00:00.000Z",
      end: "2011-12-30T10:00:00.000Z",
      completed_sessions: 0,
    });
  });

  it("缺参、严格日期、未知时区与溢出均 422", async () => {
    const bad = [
      {},
      { end_date: "2026-11-03" },
      { timezone: "UTC" },
      ...["", "2026-02-29", "2026-04-31", "2026-1-01", "20261103", "0001-01-06", "9999-12-31"].map(
        (end_date) => ({ end_date, timezone: "UTC" }),
      ),
      ...["", "Not/AZone", "a".repeat(129), "+08:00"].map((timezone) => ({
        end_date: "2026-11-03",
        timezone,
      })),
    ];
    for (const query of bad) {
      const res = await get(query);
      assert.equal(res.status, 422, JSON.stringify(query));
      await res.json();
    }
  });

  it("选择一天后真实 keyset 分页，不漏不重；旧 cursor 换日拒绝，旧48h限制保持", async () => {
    const headers = { ...AUTH_HEADER, "x-e2e-weekly-fixture": "weekly" };
    const query = {
      status: "completed",
      start: "2026-11-02T16:00:00Z",
      end: "2026-11-03T16:00:00Z",
      limit: "10",
    };
    const ids = [];
    let cursor = null;
    let firstCursor = null;
    for (let index = 0; index < 6; index++) {
      const qs = new URLSearchParams({ ...query, ...(cursor ? { cursor } : {}) });
      const res = await timedFetch(`${instance.baseUrl}/api/sessions?${qs}`, { headers });
      assert.equal(res.status, 200);
      const body = await res.json();
      ids.push(...body.items.map((entry) => entry.id));
      cursor = body.next_cursor;
      firstCursor ??= cursor;
      if (index < 5) assert.ok(cursor);
      else assert.equal(cursor, null);
    }
    assert.equal(ids.length, 55);
    assert.equal(new Set(ids).size, 55);
    assert.deepEqual(
      ids,
      Array.from(
        { length: 55 },
        (_, index) => `77300000-0000-4000-8000-${String(55 - index).padStart(12, "0")}`,
      ),
    );
    const changed = new URLSearchParams({
      ...query,
      start: "2026-11-01T16:00:00Z",
      end: "2026-11-02T16:00:00Z",
      cursor: firstCursor,
    });
    const badCursor = await timedFetch(`${instance.baseUrl}/api/sessions?${changed}`, { headers });
    assert.equal(badCursor.status, 422);
    await badCursor.json();
    const tooWide = new URLSearchParams({ ...query, start: "2026-10-27T16:00:00Z" });
    const wide = await timedFetch(`${instance.baseUrl}/api/sessions?${tooWide}`, { headers });
    assert.equal(wide.status, 422);
    await wide.json();
  });

  it("七天语法静态路由严格认证，空库返回零记录空列表", async () => {
    const anonymous = await timedFetch(
      `${instance.baseUrl}/api/assessments/weekly-grammar?end_date=2026-11-03&timezone=UTC`,
    );
    assert.equal(anonymous.status, 401);
    await anonymous.json();
    const res = await getGrammar({ end_date: "2026-11-03", timezone: "Asia/Singapore" });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), {
      start: "2026-10-27T16:00:00.000Z",
      end: "2026-11-03T16:00:00.000Z",
      total_errors: 0,
      items: [],
    });
  });

  it("七天语法固定聚合、过滤、unknown合并与稳定Top3，且fixture不污染下一次请求", async () => {
    const res = await getGrammar({ end_date: "2026-11-03", timezone: "Asia/Singapore" }, "weekly");
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), {
      start: "2026-10-27T16:00:00.000Z",
      end: "2026-11-03T16:00:00.000Z",
      total_errors: 15,
      items: [
        { skill_tag: "article_usage", count: 4 },
        { skill_tag: "other", count: 3 },
        { skill_tag: "verb_tense_past", count: 3 },
      ],
    });
    const untouched = await getGrammar({ end_date: "2026-11-03", timezone: "Asia/Singapore" });
    assert.equal((await untouched.json()).total_errors, 0);
  });

  it("七天语法缺参、非法日期时区422；未知参数忽略、同名取最后且可控失败503", async () => {
    const bad = [
      {},
      { end_date: "2026-11-03" },
      { timezone: "UTC" },
      ...["", "2026-02-29", "2026-04-31", "2026-1-01", "0001-01-06", "9999-12-31"].map(
        (end_date) => ({ end_date, timezone: "UTC" }),
      ),
      ...["", "Not/AZone", "a".repeat(129), "+08:00"].map((timezone) => ({
        end_date: "2026-11-03",
        timezone,
      })),
    ];
    for (const query of bad) {
      const res = await getGrammar(query);
      assert.equal(res.status, 422, JSON.stringify(query));
      await res.json();
    }
    const tolerated = await getGrammar({
      end_date: "2026-11-03",
      timezone: "UTC",
      extra: "ignored",
    });
    assert.equal(tolerated.status, 200);
    await tolerated.json();
    const duplicated = await timedFetch(
      `${instance.baseUrl}/api/assessments/weekly-grammar?end_date=1999-01-01&end_date=2026-11-03&timezone=Not%2FAZone&timezone=UTC&extra=ignored`,
      { headers: AUTH_HEADER },
    );
    assert.equal(duplicated.status, 200);
    assert.equal((await duplicated.json()).start, "2026-10-28T00:00:00.000Z");
    const failed = await getGrammar({ end_date: "2026-11-03", timezone: "UTC" }, undefined, "503");
    assert.equal(failed.status, 503);
    await failed.json();
  });
});

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

    it("grammar-only 返回一条语法记录，grammar-only-empty 返回空数组", async () => {
      const withHints = await timedFetch(
        `${serverInstance.baseUrl}/api/assessments/grammar-only/grammar`,
        { headers: AUTH_HEADER },
      );
      assert.strictEqual(withHints.status, 200);
      assert.strictEqual((await withHints.json()).length, 1);

      for (const id of ["grammar-only-empty", "grammar-only-empty-webkit"]) {
        const empty = await timedFetch(`${serverInstance.baseUrl}/api/assessments/${id}/grammar`, {
          headers: AUTH_HEADER,
        });
        assert.strictEqual(empty.status, 200);
        assert.deepStrictEqual(await empty.json(), []);
      }
    });
  });

  describe("6b. 会话 Token 与 dispatch 夹具契约", () => {
    it("活动会话返回假 Token 与不可达信令地址，dispatch 返回 dispatched", async () => {
      const created = await timedFetch(`${serverInstance.baseUrl}/api/sessions`, {
        method: "POST",
        headers: { ...AUTH_HEADER, "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "scenario" }),
      });
      assert.strictEqual(created.status, 201);
      const session = await created.json();

      const token = await timedFetch(`${serverInstance.baseUrl}/api/sessions/${session.id}/token`, {
        headers: AUTH_HEADER,
      });
      assert.strictEqual(token.status, 200);
      assert.deepStrictEqual(await token.json(), {
        token: "e2e-fake-livekit-token",
        ws_url: "wss://127.0.0.1:9",
      });

      const dispatched = await timedFetch(
        `${serverInstance.baseUrl}/api/sessions/${session.id}/dispatch`,
        { method: "POST", headers: AUTH_HEADER },
      );
      assert.strictEqual(dispatched.status, 200);
      assert.deepStrictEqual(await dispatched.json(), { dispatched: true });

      const ended = await timedFetch(`${serverInstance.baseUrl}/api/sessions/${session.id}/end`, {
        method: "POST",
        headers: AUTH_HEADER,
      });
      assert.strictEqual(ended.status, 200);

      const afterEnd = await timedFetch(
        `${serverInstance.baseUrl}/api/sessions/${session.id}/token`,
        { headers: AUTH_HEADER },
      );
      assert.strictEqual(afterEnd.status, 409);
    });

    it("未知会话的 Token 与 dispatch 返回 404，未认证返回 401", async () => {
      const unknown = "00000000-0000-4000-8000-00000000dead";
      const token = await timedFetch(`${serverInstance.baseUrl}/api/sessions/${unknown}/token`, {
        headers: AUTH_HEADER,
      });
      assert.strictEqual(token.status, 404);
      const dispatched = await timedFetch(
        `${serverInstance.baseUrl}/api/sessions/${unknown}/dispatch`,
        { method: "POST", headers: AUTH_HEADER },
      );
      assert.strictEqual(dispatched.status, 404);
      const anonymous = await timedFetch(`${serverInstance.baseUrl}/api/sessions/${unknown}/token`);
      assert.strictEqual(anonymous.status, 401);
    });
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

const openApi = JSON.parse(readFileSync(openApiScript, "utf8"));
const openApiOperations = listOpenApiOperations(openApi);
const openApiOperationsByKey = new Map(
  openApiOperations.map((operation) => [operation.key, operation]),
);

function sortedOperationKeys(operationKeys) {
  return [...operationKeys].sort(compareOperationKeys);
}

const MISSING_OPERATION_SESSION_ID = "00000000-0000-4000-8000-000000000099";
const MISSING_OPERATION_PROBES = [
  {
    operation: "POST /api/conversation/chat",
    method: "POST",
    path: "/api/conversation/chat",
  },
  {
    operation: "POST /api/sessions/{session_id}/call/claim",
    method: "POST",
    path: `/api/sessions/${MISSING_OPERATION_SESSION_ID}/call/claim`,
  },
  {
    operation: "POST /api/sessions/{session_id}/call/heartbeat",
    method: "POST",
    path: `/api/sessions/${MISSING_OPERATION_SESSION_ID}/call/heartbeat`,
  },
  {
    operation: "POST /api/sessions/{session_id}/call/release",
    method: "POST",
    path: `/api/sessions/${MISSING_OPERATION_SESSION_ID}/call/release`,
  },
  {
    operation: "PUT /api/user/settings",
    method: "PUT",
    path: "/api/user/settings",
  },
];
const EXPECTED_MISSING_OPERATIONS = MISSING_OPERATION_PROBES.map(({ operation }) => operation);

const EXPECTED_UNMODELED_RESPONSES = [
  { operation: "GET /api/health", status: "200" },
  { operation: "GET /api/health/ready", status: "200" },
  { operation: "GET /api/sessions/{session_id}/token", status: "200" },
  { operation: "POST /api/sessions/{session_id}/dispatch", status: "200" },
];

const EXPECTED_CONTRACT_DEVIATIONS = [
  {
    operation: "GET /api/assessments/{session_id}",
    actualStatus: 200,
    field: "$.session_id",
    keyword: "format",
    reason: "format: 值不符合 format=uuid",
  },
  {
    operation: "GET /api/assessments/{session_id}/grammar",
    actualStatus: 200,
    field: "$[0].session_id",
    keyword: "format",
    reason: "format: 值不符合 format=uuid",
  },
  {
    operation: "POST /api/sessions",
    actualStatus: 201,
    field: "status",
    keyword: "declared-success-status",
    reason: "Fake 返回 201，而 OpenAPI 仅声明 200",
  },
];

const FAKE_SUCCESS_CASES = [
  {
    operation: "GET /api/health",
    expectedStatus: 200,
    buildRequest: () => ({ method: "GET", path: "/api/health", authenticated: false }),
  },
  {
    operation: "GET /api/health/ready",
    expectedStatus: 200,
    buildRequest: () => ({
      method: "GET",
      path: "/api/health/ready",
      headers: { "x-e2e-readiness": "ready" },
    }),
  },
  {
    operation: "GET /api/call-capabilities",
    expectedStatus: 200,
    buildRequest: () => ({ method: "GET", path: "/api/call-capabilities" }),
  },
  {
    operation: "GET /api/user/settings",
    expectedStatus: 200,
    buildRequest: () => ({ method: "GET", path: "/api/user/settings" }),
  },
  {
    operation: "GET /api/curriculum/next",
    expectedStatus: 200,
    buildRequest: () => ({ method: "GET", path: "/api/curriculum/next" }),
  },
  {
    operation: "GET /api/assessments/knowledge/skills",
    expectedStatus: 200,
    buildRequest: () => ({ method: "GET", path: "/api/assessments/knowledge/skills" }),
  },
  {
    operation: "GET /api/assessments/knowledge/states",
    expectedStatus: 200,
    buildRequest: () => ({ method: "GET", path: "/api/assessments/knowledge/states" }),
  },
  {
    operation: "POST /api/sessions",
    expectedStatus: 201,
    buildRequest: () => ({
      method: "POST",
      path: "/api/sessions",
      body: { mode: "scenario" },
    }),
    capture: (body, context) => {
      context.sessionId = body.id;
      context.sessionStartedAt = body.started_at;
    },
  },
  {
    operation: "GET /api/sessions/{session_id}",
    expectedStatus: 200,
    buildRequest: (context) => ({
      method: "GET",
      path: `/api/sessions/${context.sessionId}`,
    }),
  },
  {
    operation: "GET /api/sessions/{session_id}/token",
    expectedStatus: 200,
    buildRequest: (context) => ({
      method: "GET",
      path: `/api/sessions/${context.sessionId}/token`,
    }),
  },
  {
    operation: "POST /api/sessions/{session_id}/dispatch",
    expectedStatus: 200,
    buildRequest: (context) => ({
      method: "POST",
      path: `/api/sessions/${context.sessionId}/dispatch`,
    }),
  },
  {
    operation: "POST /api/sessions/{session_id}/analysis-retry",
    expectedStatus: 200,
    buildRequest: (context) => ({
      method: "POST",
      path: `/api/sessions/${context.sessionId}/analysis-retry`,
    }),
  },
  {
    operation: "GET /api/sessions/{session_id}/analysis-status",
    expectedStatus: 200,
    buildRequest: (context) => ({
      method: "GET",
      path: `/api/sessions/${context.sessionId}/analysis-status`,
    }),
  },
  {
    operation: "GET /api/sessions",
    expectedStatus: 200,
    buildRequest: () => ({ method: "GET", path: "/api/sessions" }),
  },
  {
    operation: "GET /api/sessions/active",
    expectedStatus: 200,
    buildRequest: () => ({
      method: "GET",
      path: "/api/sessions/active",
      headers: { "x-e2e-weekly-fixture": "dst" },
    }),
  },
  {
    operation: "POST /api/sessions/{session_id}/end",
    expectedStatus: 200,
    buildRequest: (context) => ({
      method: "POST",
      path: `/api/sessions/${context.sessionId}/end`,
    }),
  },
  {
    operation: "GET /api/sessions/daily-progress",
    expectedStatus: 200,
    buildRequest: (context) => {
      const startedAt = Date.parse(context.sessionStartedAt);
      const query = new URLSearchParams({
        start: new Date(startedAt - 1_000).toISOString(),
        end: new Date(startedAt + 1_000).toISOString(),
      });
      return {
        method: "GET",
        path: `/api/sessions/daily-progress?${query}`,
      };
    },
  },
  {
    operation: "GET /api/sessions/weekly-progress",
    expectedStatus: 200,
    buildRequest: () => ({
      method: "GET",
      path: "/api/sessions/weekly-progress?end_date=2026-11-03&timezone=UTC",
      headers: { "x-e2e-weekly-fixture": "weekly" },
    }),
  },
  {
    operation: "GET /api/assessments/weekly-grammar",
    expectedStatus: 200,
    buildRequest: () => ({
      method: "GET",
      path: "/api/assessments/weekly-grammar?end_date=2026-11-03&timezone=UTC",
      headers: { "x-e2e-weekly-grammar-fixture": "weekly" },
    }),
  },
  {
    operation: "GET /api/assessments/{session_id}",
    expectedStatus: 200,
    buildRequest: () => ({
      method: "GET",
      path: "/api/assessments/analysis-success-contract",
    }),
  },
  {
    operation: "GET /api/assessments/{session_id}/grammar",
    expectedStatus: 200,
    buildRequest: () => ({
      method: "GET",
      path: "/api/assessments/grammar-only-contract/grammar",
    }),
  },
];

function contractDeviationsForResult(result) {
  const operation = openApiOperationsByKey.get(result.operation);
  assert.ok(operation, `OpenAPI 缺少已覆盖 operation: ${result.operation}`);
  const deviations = [];
  const declaredSuccessStatuses = operation.successResponses.map(({ status }) => status);
  if (!declaredSuccessStatuses.includes(String(result.status))) {
    deviations.push({
      operation: result.operation,
      actualStatus: result.status,
      field: "status",
      keyword: "declared-success-status",
      reason: `Fake 返回 ${result.status}，而 OpenAPI 仅声明 ${declaredSuccessStatuses.join(",")}`,
    });
  }

  const declaredResponse = operation.successResponses.find(
    ({ status }) => status === String(result.status),
  );
  const modeledResponse = declaredResponse
    ? Object.keys(declaredResponse.schema).length > 0
      ? declaredResponse
      : null
    : operation.successResponses.find(({ schema }) => Object.keys(schema).length > 0);
  if (modeledResponse) {
    for (const violation of validateJsonSchema(result.body, modeledResponse.schema, openApi)) {
      deviations.push({
        operation: result.operation,
        actualStatus: result.status,
        field: violation.path,
        keyword: violation.keyword,
        reason: `${violation.keyword}: ${violation.message}`,
      });
    }
  }
  return deviations;
}

function normalizedDeviations(deviations) {
  return [...deviations].sort(
    (left, right) =>
      left.operation.localeCompare(right.operation) ||
      left.actualStatus - right.actualStatus ||
      left.field.localeCompare(right.field) ||
      left.keyword.localeCompare(right.keyword),
  );
}

describe("Fake API 与 backend/openapi.json 成功响应契约", { timeout: 30_000 }, () => {
  let serverInstance = null;
  const context = {};
  const results = new Map();
  const missingResults = new Map();

  before(async () => {
    serverInstance = await startFakeApiServer();
    for (const testCase of FAKE_SUCCESS_CASES) {
      const request = testCase.buildRequest(context);
      const headers = {
        ...(request.authenticated === false ? {} : AUTH_HEADER),
        ...(request.headers ?? {}),
      };
      const options = { method: request.method, headers };
      if ("body" in request) {
        headers["Content-Type"] = "application/json";
        options.body = JSON.stringify(request.body);
      }
      const response = await timedFetch(`${serverInstance.baseUrl}${request.path}`, options);
      const contentType = response.headers.get("content-type") ?? "";
      assert.match(contentType, /^application\/json\b/i, testCase.operation);
      const body = await response.json();
      testCase.capture?.(body, context);
      results.set(testCase.operation, {
        operation: testCase.operation,
        status: response.status,
        body,
      });
    }

    for (const probe of MISSING_OPERATION_PROBES) {
      const response = await timedFetch(`${serverInstance.baseUrl}${probe.path}`, {
        method: probe.method,
        headers: {
          ...AUTH_HEADER,
          "Content-Type": "application/json",
        },
        body: "{}",
      });
      const contentType = response.headers.get("content-type") ?? "";
      const body = /^application\/json\b/i.test(contentType)
        ? await response.json()
        : await response.text();
      missingResults.set(probe.operation, {
        contentType,
        status: response.status,
        body,
      });
    }
  });

  after(async () => {
    if (serverInstance?.child) {
      await terminateServer(serverInstance.child);
      serverInstance = null;
    }
  });

  it("缺失 operation 由真实 fallback 验证，空 schema 清单固定且可输出", () => {
    const classification = classifyOpenApiSuccessCoverage(
      openApi,
      FAKE_SUCCESS_CASES.map(({ operation }) => operation),
    );
    assert.deepEqual(
      sortedOperationKeys(classification.missingOperations),
      sortedOperationKeys(EXPECTED_MISSING_OPERATIONS),
    );
    assert.deepEqual(classification.unmodeledResponses, EXPECTED_UNMODELED_RESPONSES);
    const actualMissingOperations = [];
    for (const probe of MISSING_OPERATION_PROBES) {
      const result = missingResults.get(probe.operation);
      assert.ok(result, `未取得 ${probe.operation} 的缺失路由探针响应`);
      assert.match(result.contentType, /^application\/json\b/i, probe.operation);
      assert.equal(result.status, 404, probe.operation);
      assert.equal(result.body.detail, `No fake route for ${probe.method} ${probe.path}`);
      actualMissingOperations.push(probe.operation);
    }
    assert.deepEqual(
      sortedOperationKeys(actualMissingOperations),
      sortedOperationKeys(EXPECTED_MISSING_OPERATIONS),
    );
    console.log(
      "[fake-api-contract]",
      JSON.stringify({
        missingOperations: sortedOperationKeys(actualMissingOperations),
        unmodeledResponses: classification.unmodeledResponses,
      }),
    );
  });

  it("Fake 成功路由恰好覆盖 OpenAPI 中除固定缺失项外的全部 operation", () => {
    const classification = classifyOpenApiSuccessCoverage(
      openApi,
      FAKE_SUCCESS_CASES.map(({ operation }) => operation),
    );
    const expectedCovered = classification.operations
      .map(({ key }) => key)
      .filter((key) => !EXPECTED_MISSING_OPERATIONS.includes(key));
    assert.deepEqual(
      sortedOperationKeys(FAKE_SUCCESS_CASES.map(({ operation: key }) => key)),
      sortedOperationKeys(expectedCovered),
    );
    assert.equal(results.size, expectedCovered.length);
  });

  for (const testCase of FAKE_SUCCESS_CASES) {
    it(`${testCase.operation} 返回真实成功响应并完成契约校验`, () => {
      const result = results.get(testCase.operation);
      assert.ok(result, `未取得 ${testCase.operation} 的真实 HTTP 响应`);
      assert.equal(result.status, testCase.expectedStatus);
      assert.notEqual(result.body, undefined);
      const expected = EXPECTED_CONTRACT_DEVIATIONS.filter(
        ({ operation }) => operation === testCase.operation,
      );
      assert.deepEqual(
        normalizedDeviations(contractDeviationsForResult(result)),
        normalizedDeviations(expected),
      );
    });
  }

  it("全部成功响应的状态与字段偏差恰为固定的具体清单", () => {
    const actual = normalizedDeviations(
      [...results.values()].flatMap((result) => contractDeviationsForResult(result)),
    );
    assert.deepEqual(actual, normalizedDeviations(EXPECTED_CONTRACT_DEVIATIONS));
  });

  it("schema 能力与 JSON 自有属性语义均失败关闭", () => {
    const unsupportedType = auditJsonSchema(
      { type: "object", properties: { future: { type: "not-supported" } } },
      openApi,
    );
    assert.ok(unsupportedType.some(({ keyword }) => keyword === "type"));

    const unsupportedFormat = auditJsonSchema(
      { type: "object", properties: { future: { type: "string", format: "not-supported" } } },
      openApi,
    );
    assert.ok(unsupportedFormat.some(({ keyword }) => keyword === "format"));

    const inheritedRef = auditJsonSchema({ $ref: "#/components/schemas/__proto__" }, openApi);
    assert.ok(inheritedRef.some(({ keyword }) => keyword === "$ref"));

    const inheritedRequired = validateJsonSchema(
      {},
      { type: "object", required: ["constructor"] },
      openApi,
    );
    assert.ok(
      inheritedRequired.some(
        ({ path, keyword }) => path === "$.constructor" && keyword === "required",
      ),
    );

    const inheritedProperty = validateJsonSchema(
      JSON.parse('{"toString":"x"}'),
      { type: "object", properties: {}, additionalProperties: false },
      openApi,
    );
    assert.ok(
      inheritedProperty.some(
        ({ path, keyword }) => path === "$.toString" && keyword === "additionalProperties",
      ),
    );
  });

  it("date 与 date-time 使用严格公历边界且支持四位小年份", () => {
    const invalidDateTime = validateJsonSchema(
      "2026-02-30T12:00:00Z",
      { type: "string", format: "date-time" },
      openApi,
    );
    assert.ok(invalidDateTime.some(({ keyword }) => keyword === "format"));

    const smallYearDate = validateJsonSchema(
      "0050-01-01",
      { type: "string", format: "date" },
      openApi,
    );
    assert.deepEqual(smallYearDate, []);
  });

  it("operation 盘点包含全部标准方法并忽略路径级 metadata", () => {
    const syntheticOpenApi = structuredClone(openApi);
    const response = {
      description: "A3 method inventory probe",
      content: { "application/json": { schema: { type: "string" } } },
    };
    syntheticOpenApi.paths["/api/a3-method-probe"] = {
      summary: "path-level metadata is not an operation",
      parameters: [],
      servers: [],
      head: { operationId: "probeHead", responses: { 200: response } },
      options: { operationId: "probeOptions", responses: { 200: response } },
      trace: { operationId: "probeTrace", responses: { 200: response } },
    };
    const methods = listOpenApiOperations(syntheticOpenApi)
      .filter(({ path: operationPath }) => operationPath === "/api/a3-method-probe")
      .map(({ method }) => method);
    assert.deepEqual(
      sortedOperationKeys(methods),
      sortedOperationKeys(["HEAD", "OPTIONS", "TRACE"]),
    );
  });

  it("未知 schema 关键字、断链 ref 与单字段变异均不能通过", () => {
    const unsupported = auditJsonSchema(
      {
        type: "object",
        properties: {
          omitted_future_field: { type: "string", unsupportedKeyword: true },
        },
      },
      openApi,
    );
    assert.ok(unsupported.some(({ keyword }) => keyword === "unsupportedSchemaKeyword"));

    const missingRef = validateJsonSchema(
      {},
      { $ref: "#/components/schemas/NotARealSchema" },
      openApi,
    );
    assert.ok(missingRef.some(({ keyword }) => keyword === "$ref"));

    const ignoredRefConstraint = validateJsonSchema(
      {},
      {
        $ref: "#/components/schemas/CallCapabilitiesResponse",
        required: ["protocol_version"],
      },
      openApi,
    );
    assert.ok(ignoredRefConstraint.some(({ keyword }) => keyword === "$refSiblingKeyword"));

    const capabilitiesResult = results.get("GET /api/call-capabilities");
    const capabilitiesOperation = openApiOperationsByKey.get("GET /api/call-capabilities");
    const schema = capabilitiesOperation.successResponses[0].schema;
    const mutated = { ...capabilitiesResult.body, protocol_version: 2 };
    const mutatedViolations = validateJsonSchema(mutated, schema, openApi);
    assert.ok(
      mutatedViolations.some(
        ({ path, keyword }) => path === "$.protocol_version" && keyword === "const",
      ),
    );
  });
});
