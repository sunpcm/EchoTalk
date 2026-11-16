/**
 * CP02I 本地组合补验：真实 controller + 实际 api.ts 封装 + stdio 传输桥 + 真实 ASGI + 真实 PG。
 * 仅外部模拟 Cloud 撤销；不连真实网络、不持久化设备 ID/Token、不自动重试。
 * 运行前提：主控注入合成 DATABASE_URL（127.0.0.1:55433/echotalk_b1_test）。
 */

import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  _resetAuthForTesting,
  getAuthRevision,
  invalidateAuthSession,
  setAccessTokenProvider,
} from "@/lib/auth";
import {
  ApiError,
  claimCallLease,
  dispatchAgent,
  getSessionToken,
  heartbeatCallLease,
  releaseCallLease,
} from "@/lib/api";
import { createCallLeaseController } from "@/lib/callLeaseController";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "../..");
const backendDir = path.resolve(appRoot, "../../backend");
const bridgePath = path.join(here, "bridge.py");
const pythonBin = path.join(backendDir, ".venv/bin/python");

type BridgeMessage =
  | { type: "ctl"; id: number; ok: boolean; [key: string]: unknown }
  | { type: "http"; id: number; status: number; headers: Record<string, string>; body: string }
  | { type: "held"; id: number }
  | { type: "bridge_error"; id: number; message: string }
  | { type: "fatal"; message: string }
  | { type: "error"; message: string };

interface PendingEntry {
  resolve: (msg: BridgeMessage) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout | null;
}

interface LeaseInfo {
  session_id: string | null;
  device_id: string | null;
  generation: number;
  state: string;
  expires_at: string | null;
}

let bridge: ChildProcess | null = null;
let nextId = 1;
let exited = false;
let exitCode: number | null = null;
let exitResolve: (() => void) | null = null;
const pending = new Map<number, PendingEntry>();
const heldWaiters: Array<(msg: { id: number }) => void> = [];
let inflightHttp = 0;
let httpTotal = 0;
let fatalMessage: string | null = null;
let stderrTail = "";
const restoreAccessTokenProvider = { call: () => {} };

function rejectEntry(id: number, error: Error): void {
  const entry = pending.get(id);
  if (entry) {
    pending.delete(id);
    if (entry.timer) clearTimeout(entry.timer);
    entry.reject(error);
  }
}

function failAllPending(message: string): void {
  for (const id of [...pending.keys()]) {
    rejectEntry(id, new Error(message));
  }
  heldWaiters.length = 0;
}

function send(msg: Record<string, unknown>): void {
  bridge?.stdin?.write(`${JSON.stringify(msg)}\n`);
}

function registerPending(id: number, label: string, timeoutMs: number): void {
  const entry = pending.get(id);
  if (!entry) return;
  entry.timer = setTimeout(() => {
    rejectEntry(id, new Error(`${label} 超时`));
  }, timeoutMs);
}

function dispatchLine(line: string): void {
  let msg: BridgeMessage;
  try {
    msg = JSON.parse(line) as BridgeMessage;
  } catch {
    failAllPending("bridge_invalid_json_line");
    return;
  }
  switch (msg.type) {
    case "ctl": {
      const entry = pending.get(msg.id);
      if (entry) {
        pending.delete(msg.id);
        if (entry.timer) clearTimeout(entry.timer);
        entry.resolve(msg);
      }
      break;
    }
    case "http": {
      inflightHttp = Math.max(0, inflightHttp - 1);
      const entry = pending.get(msg.id);
      if (entry) {
        pending.delete(msg.id);
        if (entry.timer) clearTimeout(entry.timer);
        entry.resolve(msg);
      }
      break;
    }
    case "held": {
      const waiters = heldWaiters.splice(0);
      for (const waiter of waiters) waiter({ id: msg.id });
      break;
    }
    case "bridge_error": {
      inflightHttp = Math.max(0, inflightHttp - 1);
      rejectEntry(msg.id, new Error(`bridge_error:${msg.message}`));
      break;
    }
    case "fatal": {
      fatalMessage = msg.message;
      failAllPending(`bridge_fatal:${msg.message}`);
      break;
    }
    case "error": {
      failAllPending(`bridge_protocol_error:${msg.message}`);
      break;
    }
    default:
      failAllPending("bridge_unknown_message");
  }
}

function withTimeout<T>(promise: Promise<T>, label: string, ms = 30000): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} 超时`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

function ctl(
  op: string,
  extra: Record<string, unknown> = {},
): Promise<BridgeMessage & { ok: boolean }> {
  const id = nextId++;
  return withTimeout(
    new Promise<BridgeMessage & { ok: boolean }>((resolve, reject) => {
      if (exited || !bridge) {
        reject(new Error("bridge_not_running"));
        return;
      }
      pending.set(id, {
        resolve: (msg) => resolve(msg as BridgeMessage & { ok: boolean }),
        reject,
        timer: null,
      });
      registerPending(id, `ctl ${op}`, 30000);
      send({ type: "ctl", id, op, ...extra });
    }),
    `ctl ${op}`,
  );
}

async function ctlOk(
  op: string,
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const res = await ctl(op, extra);
  if (!res.ok) {
    throw new Error(`ctl ${op} failed: ${JSON.stringify(res)}`);
  }
  return res;
}

function bridgeHttp(
  method: string,
  pathName: string,
  headers: Record<string, string>,
  body: string,
): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  const id = nextId++;
  inflightHttp += 1;
  httpTotal += 1;
  return withTimeout(
    new Promise<{ status: number; headers: Record<string, string>; body: string }>(
      (resolve, reject) => {
        if (exited || !bridge) {
          reject(new Error("bridge_not_running"));
          return;
        }
        pending.set(id, {
          resolve: (msg) => {
            if (msg.type !== "http") {
              reject(new Error(`unexpected_bridge_message:${msg.type}`));
              return;
            }
            resolve({ status: msg.status, headers: msg.headers, body: msg.body });
          },
          reject,
          timer: null,
        });
        registerPending(id, `http ${method} ${pathName}`, 30000);
        send({ type: "http", id, method, path: pathName, headers, body });
      },
    ),
    `http ${method} ${pathName}`,
  );
}

function waitForHeld(): Promise<{ id: number }> {
  return withTimeout(
    new Promise<{ id: number }>((resolve) => {
      heldWaiters.push(resolve);
    }),
    "等待 held 响应门",
  );
}

async function bridgeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!url.startsWith("/api/")) {
    throw new Error(`bridge_fetch_rejects_non_local_path:${url.slice(0, 24)}`);
  }
  const headers = Object.fromEntries(new Headers(init?.headers).entries());
  const body = typeof init?.body === "string" ? init.body : "";
  const res = await bridgeHttp(init?.method ?? "GET", url, headers, body);
  return new Response(res.body, { status: res.status, headers: res.headers });
}

async function bridgeIdle(maxMs = 30000): Promise<void> {
  const deadline = Date.now() + maxMs;
  while (inflightHttp > 0) {
    if (Date.now() > deadline) {
      throw new Error("bridgeIdle 超时：仍有在途桥请求");
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

class VirtualClock {
  nowMs = Date.now();
  private nextHandle = 1;
  private timers = new Map<number, { due: number; handler: () => void }>();

  setTimeout(handler: () => void, timeout?: number): unknown {
    const handle = this.nextHandle++;
    this.timers.set(handle, { due: this.nowMs + Math.max(0, timeout ?? 0), handler });
    return handle;
  }

  clearTimeout(handle: unknown): void {
    this.timers.delete(handle as number);
  }

  pendingTimerCount(): number {
    return this.timers.size;
  }

  async advance(ms: number): Promise<void> {
    const target = this.nowMs + ms;
    for (;;) {
      const dueEntries = [...this.timers.entries()].filter(([, t]) => t.due <= target);
      if (dueEntries.length === 0) break;
      dueEntries.sort((a, b) => a[1].due - b[1].due);
      const [handle, entry] = dueEntries[0];
      this.timers.delete(handle);
      this.nowMs = Math.max(this.nowMs, entry.due);
      entry.handler();
      await bridgeIdle();
      await flushAsync();
    }
    this.nowMs = target;
  }
}

async function flushAsync(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

async function expectApiError(
  promise: Promise<unknown>,
  expectedStatus: number,
  expectedCode: string | null,
): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== expectedStatus) {
      throw error;
    }
    if (expectedCode !== null) {
      const code = (error.data as { detail?: { code?: string } } | undefined)?.detail?.code;
      expect(code).toBe(expectedCode);
    }
    return error;
  }
  throw new Error(`expected ApiError ${expectedStatus}`);
}

let clock: VirtualClock;
let controller: ReturnType<typeof createCallLeaseController> | null = null;
let boundRevision = 0;
let currentToken = "";
const originalFetch = globalThis.fetch;

async function createOwnedUser(): Promise<void> {
  const res = await ctlOk("create_user");
  currentToken = String(res.user_id);
}

async function createSession(): Promise<string> {
  const res = await ctlOk("create_session");
  return String(res.session_id);
}

async function makeController(): Promise<ReturnType<typeof createCallLeaseController>> {
  boundRevision = getAuthRevision();
  controller = createCallLeaseController({
    claim: (sessionId, deviceId, takeover) =>
      claimCallLease(sessionId, deviceId, takeover ?? false),
    heartbeat: (sessionId, owner) => heartbeatCallLease(sessionId, owner),
    release: (sessionId, owner) => releaseCallLease(sessionId, owner),
    isCurrent: () => getAuthRevision() === boundRevision,
    now: () => clock.nowMs,
    setTimeout: (handler, timeout) => clock.setTimeout(handler, timeout),
    clearTimeout: (handle) => clock.clearTimeout(handle),
  });
  return controller;
}

async function claimDirect(sessionId: string, deviceId: string, takeover = false): Promise<void> {
  await claimCallLease(sessionId, deviceId, takeover);
}

async function readLease(): Promise<LeaseInfo | null> {
  const res = await ctlOk("read_lease");
  return (res.lease as LeaseInfo | null) ?? null;
}

beforeAll(async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL 未注入；CP02I 组合测试必须失败，不允许 skip");
  }
  _resetAuthForTesting();
  restoreAccessTokenProvider.call = setAccessTokenProvider(async () => currentToken);
  globalThis.fetch = bridgeFetch;
  clock = new VirtualClock();
  bridge = spawn(pythonBin, [bridgePath], {
    cwd: backendDir,
    env: { ...process.env, ECHOTALK_CALL_LEASE_LOCAL_PG: "1" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let lineBuffer = "";
  bridge.stdout?.on("data", (chunk: Buffer) => {
    lineBuffer += chunk.toString();
    for (;;) {
      const index = lineBuffer.indexOf("\n");
      if (index < 0) break;
      const line = lineBuffer.slice(0, index).trim();
      lineBuffer = lineBuffer.slice(index + 1);
      if (line) dispatchLine(line);
    }
  });
  bridge.on("exit", (code) => {
    exited = true;
    exitCode = code;
    if (exitResolve) {
      exitResolve();
    }
    failAllPending(`bridge_exited_${code}`);
  });
  bridge.on("error", (err) => {
    const errnoCode = (err as { code?: unknown }).code;
    failAllPending(`bridge_spawn_error:${typeof errnoCode === "string" ? errnoCode : "unknown"}`);
  });
  bridge.stderr?.on("data", (chunk: Buffer) => {
    stderrTail = (stderrTail + chunk.toString()).slice(-2000);
  });
  await ctlOk("ping");
});

afterEach(async () => {
  controller?.dispose();
  controller = null;
  try {
    await ctlOk("release");
  } catch {
    // 桥已退出时由后续断言报告失败
  }
  await bridgeIdle();
  await ctlOk("cleanup");
});

afterAll(async () => {
  globalThis.fetch = originalFetch;
  restoreAccessTokenProvider.call();
  if (bridge && !exited) {
    try {
      await ctl("shutdown");
    } catch {
      // shutdown 失败时走限时等待，仍未退出则 SIGKILL
    }
    bridge.stdin?.end();
  }
  if (bridge && !exited) {
    await withTimeout(
      new Promise<void>((resolve) => {
        exitResolve = resolve;
      }),
      "等待 bridge 正常退出",
      10000,
    ).catch(async () => {
      if (bridge && !exited) {
        bridge.kill("SIGKILL");
        await withTimeout(
          new Promise<void>((resolve) => {
            exitResolve = resolve;
          }),
          "等待 bridge SIGKILL",
          5000,
        );
      }
    });
  }
  if (exitCode !== 0) {
    throw new Error(`bridge 清理未正常收束：exit=${exitCode}`);
  }
  if (stderrTail.includes("DATABASE_URL")) {
    throw new Error("bridge stderr 泄漏数据库 URL");
  }
  if (fatalMessage !== null) {
    throw new Error(`bridge fatal: ${fatalMessage}`);
  }
});

describe("CP02I call-lease 本地组合", () => {
  it("场景1：首次/重复 claim 保持 gen1；默认非接管 409 call_in_use", async () => {
    await createOwnedUser();
    const s1 = await createSession();
    const deviceA = crypto.randomUUID();
    const c = await makeController();
    await c.claim(s1, deviceA);
    expect(c.getSnapshot()).toMatchObject({ status: "held", reason: null });
    expect(c.getSnapshot().lease?.generation).toBe(1);

    const duplicate = await claimCallLease(s1, deviceA);
    expect(duplicate.generation).toBe(1);

    const s2 = await createSession();
    const deviceB = crypto.randomUUID();
    await expectApiError(claimCallLease(s2, deviceB), 409, "call_in_use");
  });

  it("场景2：显式接管 gen2；旧 owner heartbeat/token/dispatch/release 全 409 call_lease_lost", async () => {
    await createOwnedUser();
    const sessionId = await createSession();
    const deviceOld = crypto.randomUUID();
    await claimDirect(sessionId, deviceOld, true);
    const deviceNew = crypto.randomUUID();
    await claimDirect(sessionId, deviceNew, true);
    const oldOwner = { device_id: deviceOld, generation: 1 };
    await expectApiError(heartbeatCallLease(sessionId, oldOwner), 409, "call_lease_lost");
    await expectApiError(getSessionToken(sessionId, oldOwner), 409, "call_lease_lost");
    await expectApiError(dispatchAgent(sessionId, oldOwner), 409, "call_lease_lost");
    await expectApiError(releaseCallLease(sessionId, oldOwner), 409, "call_lease_lost");
    const lease = await readLease();
    expect(lease?.generation).toBe(2);
    expect(lease?.device_id).toBe(deviceNew);
  });

  it("场景3：Cloud 撤销失败 claim 502 回滚；release_failed 精确保留 tuple 且仅显式重试", async () => {
    await createOwnedUser();
    const sessionId = await createSession();
    const deviceOld = crypto.randomUUID();
    await claimDirect(sessionId, deviceOld, true);
    const c = await makeController();
    const deviceNew = crypto.randomUUID();
    await c.claim(sessionId, deviceNew, true);
    expect(c.getSnapshot().lease?.generation).toBe(2);

    await ctlOk("set_revoke", { mode: "fail" });
    const deviceNext = crypto.randomUUID();
    await expectApiError(claimDirect(sessionId, deviceNext, true), 502, null);
    const rolledBack = await readLease();
    expect(rolledBack?.generation).toBe(2);
    expect(rolledBack?.device_id).toBe(deviceNew);

    await c.release();
    expect(c.getSnapshot()).toMatchObject({
      status: "release_failed",
      reason: "release_failed",
      lease: { device_id: deviceNew, generation: 2 },
    });
    const retained = await readLease();
    expect(retained?.device_id).toBe(deviceNew);
    expect(retained?.generation).toBe(2);
    expect(retained?.state).toBe("held");

    const httpBeforeIdle = httpTotal;
    await clock.advance(30_000);
    await bridgeIdle();
    expect(httpTotal).toBe(httpBeforeIdle);
    expect(c.getSnapshot()).toMatchObject({ status: "release_failed" });
    expect(await readLease()).toMatchObject({ device_id: deviceNew, generation: 2 });

    await ctlOk("set_revoke", { mode: "ok" });
    await c.release();
    expect(c.getSnapshot()).toMatchObject({
      status: "idle",
      reason: null,
      lease: null,
    });
    const freed = await readLease();
    expect(freed).toMatchObject({
      session_id: sessionId,
      device_id: deviceNew,
      generation: 2,
      state: "free",
      expires_at: null,
    });
  });

  it("场景4：真实 DB 过期心跳 409，lost/heartbeat_failed、清 owner 停 timer、无自动 claim", async () => {
    await createOwnedUser();
    const sessionId = await createSession();
    const deviceId = crypto.randomUUID();
    await claimDirect(sessionId, deviceId);
    boundRevision = getAuthRevision();
    let capturedHeartbeatError: unknown = null;
    controller = createCallLeaseController({
      claim: (claimSessionId, claimDeviceId, takeover) =>
        claimCallLease(claimSessionId, claimDeviceId, takeover ?? false),
      heartbeat: async (heartbeatSessionId, owner) => {
        try {
          return await heartbeatCallLease(heartbeatSessionId, owner);
        } catch (error) {
          capturedHeartbeatError = error;
          throw error;
        }
      },
      release: (releaseSessionId, owner) => releaseCallLease(releaseSessionId, owner),
      isCurrent: () => getAuthRevision() === boundRevision,
      now: () => clock.nowMs,
      setTimeout: (handler, timeout) => clock.setTimeout(handler, timeout),
      clearTimeout: (handle) => clock.clearTimeout(handle),
    });
    const c = controller;
    await c.claim(sessionId, deviceId);
    expect(c.getSnapshot()).toMatchObject({ status: "held" });

    await ctlOk("force_expire");
    await clock.advance(20_000);
    await bridgeIdle();
    expect(capturedHeartbeatError).toBeInstanceOf(ApiError);
    const heartbeatError = capturedHeartbeatError as ApiError;
    expect(heartbeatError.status).toBe(409);
    const heartbeatCode = (heartbeatError.data as { detail?: { code?: string } } | undefined)
      ?.detail?.code;
    expect(heartbeatCode).toBe("call_lease_expired");
    expect(c.getSnapshot()).toMatchObject({ status: "lost", reason: "heartbeat_failed" });
    expect(c.getSnapshot().lease).toBeNull();
    expect(clock.pendingTimerCount()).toBe(0);

    const httpBeforeIdle = httpTotal;
    await clock.advance(30_000);
    await bridgeIdle();
    expect(httpTotal).toBe(httpBeforeIdle);
    expect(c.getSnapshot()).toMatchObject({ status: "lost", reason: "heartbeat_failed" });
    expect(await readLease()).not.toBeNull();
  });

  it("场景5：claim 已 commit 响应被 hold，invalidate 后迟到成功不覆盖也不自动回写", async () => {
    await createOwnedUser();
    const sessionId = await createSession();
    const deviceId = crypto.randomUUID();
    const c = await makeController();
    await ctlOk("hold");
    const claimPromise = c.claim(sessionId, deviceId);
    await waitForHeld();
    const committed = await readLease();
    expect(committed?.generation).toBe(1);
    expect(committed?.device_id).toBe(deviceId);

    c.invalidate();
    expect(c.getSnapshot()).toMatchObject({ status: "lost", reason: "invalidated" });
    await ctlOk("release");
    await claimPromise;
    await bridgeIdle();
    expect(c.getSnapshot()).toMatchObject({ status: "lost", reason: "invalidated" });
    const after = await readLease();
    expect(after?.generation).toBe(1);
    expect(after?.state).toBe("held");
  });

  it("场景6：authRevision 变化后迟到成功不覆盖，服务端真实 held 保留", async () => {
    await createOwnedUser();
    const sessionId = await createSession();
    const deviceId = crypto.randomUUID();
    const c = await makeController();
    await ctlOk("hold");
    const claimPromise = c.claim(sessionId, deviceId);
    await waitForHeld();
    const committed = await readLease();
    expect(committed?.generation).toBe(1);

    invalidateAuthSession();
    expect(getAuthRevision()).not.toBe(boundRevision);
    await ctlOk("release");
    await claimPromise;
    await bridgeIdle();
    expect(c.getSnapshot()).toMatchObject({ status: "lost", reason: null });
    const after = await readLease();
    expect(after?.generation).toBe(1);
  });
});
