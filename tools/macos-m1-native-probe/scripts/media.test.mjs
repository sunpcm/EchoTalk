import test from "node:test";
import assert from "node:assert/strict";
import {
  createMediaBridge,
  createMediaController,
  safeMediaStatus,
} from "../web/media-controller.mjs";

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const flush = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
const grant = (generation = 1) => ({
  generation,
  session_id: "11111111-1111-4111-8111-111111111111",
  token: "private-room-token",
  ws_url: "wss://media.example.test",
  expires_at: 200,
});
const status = (phase = "stopped", end_state = "ended", generation = 1) => ({
  phase,
  end_state,
  generation,
  session_id: null,
  error: null,
});
function fixture(hooks = {}) {
  const calls = [];
  const resources = [];
  const tasks = new Map();
  let now = 100000;
  let seq = 0;
  const timers = {
    setTimeout(fn, delay) {
      const id = ++seq;
      tasks.set(id, { fn, due: now + delay });
      return id;
    },
    clearTimeout(id) {
      tasks.delete(id);
    },
  };
  const bridge = {
    prepare() {
      calls.push("prepare");
      return hooks.prepare?.() ?? Promise.resolve(grant());
    },
    dispatch(gen) {
      calls.push(["dispatch", gen]);
      return hooks.dispatch?.(gen) ?? Promise.resolve(status("active", "not_needed", gen));
    },
    stop() {
      calls.push("stop");
      return hooks.stop?.() ?? Promise.resolve(status());
    },
    status() {
      calls.push("status");
      return hooks.status?.() ?? Promise.resolve(status("idle", "not_needed"));
    },
  };
  const adapter = {
    create({ onEvent }) {
      calls.push("create");
      const resource = {
        onEvent,
        stopped: false,
        acquire() {
          calls.push("acquire");
          return hooks.acquire?.() ?? Promise.resolve();
        },
        connect(value) {
          calls.push("connect");
          assert.equal(value.token, "private-room-token");
          return hooks.connect?.() ?? Promise.resolve();
        },
        publish() {
          calls.push("publish");
          return hooks.publish?.() ?? Promise.resolve();
        },
        retryPlayback() {
          calls.push("play");
          return hooks.play?.(onEvent) ?? Promise.resolve();
        },
        dispose() {
          calls.push("dispose");
          resource.stopped = true;
          return hooks.dispose?.() ?? Promise.resolve();
        },
      };
      resources.push(resource);
      return resource;
    },
  };
  const controller = createMediaController({
    bridge,
    adapter,
    timers,
    clock: { now: () => now },
    cleanupTimeoutMs: 1000,
  });
  controller.setAuthState({ authenticated: true, expires_at: 300, revision: 1 });
  return {
    controller,
    calls,
    resources,
    tasks,
    setClock: (value) => {
      now = value;
    },
    async advance(ms) {
      now += ms;
      for (const [id, task] of [...tasks])
        if (task.due <= now && tasks.has(id)) {
          tasks.delete(id);
          task.fn();
        }
      await flush();
    },
  };
}

test("fixed IPC bridge accepts only the positive safe dispatch generation", async () => {
  const calls = [];
  const b = createMediaBridge((...args) => {
    calls.push(args);
    return Promise.resolve();
  });
  await b.prepare();
  await b.dispatch(9);
  await b.stop();
  await b.status();
  for (const value of [0, -1, 1.1, NaN, Infinity, "1", 2 ** 53, {}])
    await assert.rejects(b.dispatch(value));
  assert.deepEqual(calls, [
    ["media_prepare", {}],
    ["media_dispatch", { generation: 9 }],
    ["media_stop", {}],
    ["media_status", {}],
  ]);
});

test("status output is sanitized and malformed native status fails closed", () => {
  assert.deepEqual(safeMediaStatus({ ...status(), token: "secret", ws_url: "private" }), {
    phase: "stopped",
    generation: 1,
    error: null,
    end_state: "ended",
  });
  for (const value of [
    { ...status(), phase: "private" },
    { ...status(), generation: NaN },
    { ...status(), session_id: "private" },
    { ...status(), end_state: "success" },
    { ...status(), error: "HTTP response private" },
  ])
    assert.throws(() => safeMediaStatus(value));
  assert.equal(safeMediaStatus({ ...status(), error: "PRIVATE_TOKEN" }).error, "MEDIA_UNAVAILABLE");
});

test("one explicit start, connect/publish then single dispatch; connected is not audible", async () => {
  const f = fixture();
  const first = f.controller.start();
  await f.controller.start();
  await first;
  assert.deepEqual(f.calls, [
    "prepare",
    "create",
    "acquire",
    "connect",
    "publish",
    ["dispatch", 1],
  ]);
  assert.equal(f.controller.snapshot().phase, "waiting");
  assert.equal(f.controller.snapshot().can_start, false);
  await f.controller.stop();
  assert.equal(f.controller.snapshot().phase, "stopped");
  assert.equal(f.controller.snapshot().can_start, true);
  assert.equal(f.tasks.size, 1); // Only the independent auth expiry timer remains.
  await f.controller.dispose();
  assert.equal(f.tasks.size, 0);
});

for (const stage of ["prepare", "acquire", "connect", "publish", "dispatch"]) {
  test(`cancel during ${stage}: no later effects, drain old operation, explicit start works`, async () => {
    const pending = deferred();
    let first = true;
    const f = fixture({
      [stage]: () => {
        if (!first) return undefined;
        first = false;
        return pending.promise;
      },
    });
    const starting = f.controller.start();
    await flush();
    const before = f.calls.slice();
    const stopping = f.controller.stop();
    assert.equal(f.controller.snapshot().phase, "stopping");
    await f.controller.start();
    assert.equal(f.calls.filter((v) => v === "prepare").length, 1);
    if (stage !== "prepare") assert.equal(f.resources[0].stopped, true);
    pending.resolve(
      stage === "prepare" ? grant() : stage === "dispatch" ? status("active") : undefined,
    );
    await starting;
    await stopping;
    assert.equal(f.controller.snapshot().phase, "stopped");
    assert.deepEqual(
      f.calls.slice(before.length),
      stage === "prepare" ? ["stop"] : ["dispose", "stop"],
    );
    await f.controller.start();
    assert.equal(f.controller.snapshot().phase, "waiting");
    await f.controller.dispose();
  });
}

test("end stops local input synchronously before either native end or disconnect resolves", async () => {
  const end = deferred(),
    disconnect = deferred();
  const f = fixture({ stop: () => end.promise, dispose: () => disconnect.promise });
  await f.controller.start();
  const stopping = f.controller.stop();
  assert.equal(f.resources[0].stopped, true);
  assert.deepEqual(f.calls.slice(-2), ["dispose", "stop"]);
  assert.equal(f.controller.snapshot().phase, "stopping");
  disconnect.resolve();
  await flush();
  assert.equal(f.controller.snapshot().phase, "stopping");
  end.resolve(status());
  await stopping;
  assert.equal(f.controller.snapshot().phase, "stopped");
  await f.controller.dispose();
});

test("permission denial is safe, ends session, never connects or dispatches, permits explicit retry", async () => {
  let deny = true;
  const f = fixture({
    acquire: () => {
      if (!deny) return Promise.resolve();
      return Promise.reject(
        Object.assign(new Error("secret device text"), { name: "NotAllowedError" }),
      );
    },
  });
  await f.controller.start();
  await flush();
  assert.equal(f.controller.snapshot().error, "PERMISSION_DENIED");
  assert.equal(f.controller.snapshot().phase, "failed");
  assert.equal(f.calls.includes("connect"), false);
  assert.equal(f.calls.some(Array.isArray), false);
  deny = false;
  await f.controller.start();
  assert.equal(f.controller.snapshot().phase, "waiting");
  await f.controller.dispose();
});

test("playback rejection before dispatch is preserved; explicit retry never reacquires or redispatches", async () => {
  const dispatch = deferred();
  const f = fixture({
    dispatch: () => dispatch.promise,
    play: (onEvent) => {
      onEvent("audio_playing");
    },
  });
  const start = f.controller.start();
  await flush();
  f.resources[0].onEvent("playback_blocked");
  dispatch.resolve(status("active"));
  await start;
  assert.equal(f.controller.snapshot().phase, "playback_blocked");
  await f.controller.retryPlayback();
  assert.equal(f.controller.snapshot().phase, "audio");
  f.resources[0].onEvent("audio_removed");
  assert.equal(f.controller.snapshot().phase, "waiting");
  assert.equal(f.calls.filter((v) => v === "acquire").length, 1);
  assert.equal(f.calls.filter(Array.isArray).length, 1);
  assert.doesNotMatch(
    JSON.stringify(f.controller.snapshot()),
    /private-room-token|session_id|ws_url/u,
  );
  await f.controller.dispose();
});

for (const event of ["disconnected", "reconnecting", "input_ended"]) {
  test(`${event} stops, old callbacks cannot affect a new explicit operation`, async () => {
    const f = fixture();
    await f.controller.start();
    const old = f.resources[0];
    old.onEvent(event);
    assert.equal(old.stopped, true);
    await flush();
    assert.equal(f.controller.snapshot().phase, "failed");
    const before = f.calls.length;
    await flush();
    assert.equal(f.calls.length, before);
    await f.controller.start();
    for (const saved of [
      "disconnected",
      "reconnecting",
      "audio_playing",
      "playback_blocked",
      "cleanup_failed",
    ])
      old.onEvent(saved);
    assert.equal(f.controller.snapshot().phase, "waiting");
    assert.equal(f.resources[1].stopped, false);
    await f.controller.dispose();
  });
}

for (const event of ["hidden", "offline", "pagehide"]) {
  test(`${event} synchronously stops; foreground/network return never starts input`, async () => {
    const f = fixture();
    await f.controller.start();
    const stopping = f.controller.lifecycle(event);
    assert.equal(f.resources[0].stopped, true);
    await stopping;
    await f.controller.start();
    assert.equal(f.resources.length, 1);
    await f.controller.lifecycle(event === "offline" ? "online" : "visible");
    assert.equal(f.resources.length, 1);
    await f.controller.start();
    assert.equal(f.resources.length, 2);
    await f.controller.dispose();
  });
}

test("auth invalidation and revision change stop input; a new login never resumes it", async () => {
  for (const value of [
    { authenticated: false },
    { authenticated: true, expires_at: 300, revision: 2 },
  ]) {
    const f = fixture();
    await f.controller.start();
    f.controller.setAuthState(value);
    assert.equal(f.resources[0].stopped, true);
    await flush();
    f.controller.setAuthState({ authenticated: true, expires_at: 300, revision: 3 });
    assert.equal(f.resources.length, 1);
    await f.controller.start();
    assert.equal(f.resources.length, 2);
    await f.controller.dispose();
  }
});

test("auth expiry and grant expiry use injected clock and cancel permission waits", async () => {
  for (const expires_at of [200, 300]) {
    const permission = deferred();
    const f = fixture({ acquire: () => permission.promise });
    f.controller.setAuthState({ authenticated: true, expires_at, revision: 1 });
    const starting = f.controller.start();
    await flush();
    await f.advance(100000);
    assert.equal(f.resources[0].stopped, true);
    assert.equal(f.controller.snapshot().phase, "stopping");
    permission.resolve();
    await starting;
    await flush();
    assert.equal(f.controller.snapshot().error, "AUTH_EXPIRED");
    await f.controller.dispose();
  }
});

for (const stage of ["prepare", "acquire", "connect", "publish", "dispatch"]) {
  test(`expired ${stage} return before timer delivery cannot cause later media effects`, async () => {
    const waiting = deferred();
    const f = fixture({ [stage]: () => waiting.promise });
    const starting = f.controller.start();
    await flush();
    const before = f.calls.length;
    f.setClock(301000); // Simulate suspension; no timer callback has been delivered.
    waiting.resolve(
      stage === "prepare" ? grant() : stage === "dispatch" ? status("active") : undefined,
    );
    await starting;
    await flush();
    assert.equal(f.controller.snapshot().phase, "failed");
    assert.equal(f.controller.snapshot().error, "AUTH_EXPIRED");
    assert.deepEqual(f.calls.slice(before), stage === "prepare" ? ["stop"] : ["dispose", "stop"]);
    await f.controller.dispose();
  });
}

for (const phase of ["preparing", "permission", "connecting", "publishing", "dispatching"]) {
  test(`synchronous cancellation from ${phase} subscriber prevents the next side effect`, async () => {
    const f = fixture();
    const unsubscribe = f.controller.subscribe((value) => {
      if (value.phase === phase) void f.controller.stop();
    });
    await f.controller.start();
    await flush();
    const forbidden = {
      preparing: "prepare",
      permission: "acquire",
      connecting: "connect",
      publishing: "publish",
      dispatching: "dispatch",
    }[phase];
    assert.equal(
      f.calls.some((value) => (Array.isArray(value) ? value[0] : value) === forbidden),
      false,
    );
    assert.equal(f.controller.snapshot().phase, "stopped");
    unsubscribe();
    await f.controller.start();
    assert.equal(f.controller.snapshot().phase, "waiting");
    await f.controller.dispose();
  });
}

test("native end unknown/error and local cleanup failure block new starts; explicit end can recover", async () => {
  for (const receipt of [
    status("blocked", "unknown"),
    { ...status("failed", "unknown"), error: "END_FAILED" },
    null,
  ]) {
    let bad = true;
    const f = fixture({ stop: () => Promise.resolve(bad ? receipt : status()) });
    await f.controller.start();
    await f.controller.stop();
    assert.equal(f.controller.snapshot().phase, "blocked");
    await f.controller.start();
    assert.equal(f.resources.length, 1);
    bad = false;
    await f.controller.stop();
    assert.equal(f.controller.snapshot().phase, "stopped");
    await f.controller.start();
    assert.equal(f.resources.length, 2);
    await f.controller.dispose();
  }
  let fail = true;
  const f = fixture({
    dispose: () => {
      if (fail) throw new Error("private cleanup error");
    },
  });
  await f.controller.start();
  await f.controller.stop();
  assert.equal(f.controller.snapshot().error, "CLEANUP_FAILED");
  await f.controller.start();
  assert.equal(f.resources.length, 1);
  fail = false;
  await f.controller.stop();
  assert.equal(f.controller.snapshot().phase, "stopped");
  await f.controller.dispose();
});

test("pending stop then explicit bounded status verification confirms ended and permits another start", async () => {
  const preparing = deferred(),
    verifying = deferred();
  let first = true,
    checks = 0;
  const f = fixture({
    prepare: () => {
      if (first) {
        first = false;
        return preparing.promise;
      }
    },
    stop: () => Promise.resolve(status("stopping", "pending")),
    status: () => {
      checks++;
      return checks === 1
        ? verifying.promise
        : Promise.resolve({ ...status(), error: "MEDIA_CANCELLED" });
    },
  });
  const start = f.controller.start();
  await flush();
  const stopped = f.controller.stop("HIDDEN");
  preparing.resolve(grant());
  await start;
  await stopped;
  assert.equal(f.controller.snapshot().phase, "stopping");
  assert.equal(f.controller.snapshot().end_state, "pending");
  assert.equal(f.controller.snapshot().error, null);
  await f.controller.start();
  assert.equal(f.resources.length, 0);
  const check1 = f.controller.stop(),
    duplicate = f.controller.stop();
  assert.equal(check1, duplicate);
  assert.equal(checks, 1);
  verifying.resolve(status("stopping", "pending"));
  await check1;
  assert.equal(f.controller.snapshot().phase, "stopping");
  assert.equal(checks, 1); // No timer/automatic background polling.
  await f.controller.stop();
  assert.equal(checks, 2);
  assert.equal(f.controller.snapshot().end_state, "ended");
  assert.equal(f.controller.snapshot().error, "HIDDEN"); // Local interruption, not end failure.
  assert.equal(f.controller.snapshot().can_start, true);
  assert.equal(f.calls.filter((v) => v === "stop").length, 1);
  await f.controller.start();
  assert.equal(f.controller.snapshot().phase, "waiting");
  // Complete disposal with one more explicit status receipt.
  await f.controller.stop();
  await f.controller.stop();
  await f.controller.dispose();
});

test("ended receipt with historical cancellation cause is complete; unconfigured is configuration, not end failure", async () => {
  const f = fixture({ stop: () => Promise.resolve({ ...status(), error: "MEDIA_CANCELLED" }) });
  await f.controller.start();
  await f.controller.stop();
  assert.equal(f.controller.snapshot().phase, "stopped");
  assert.equal(f.controller.snapshot().error, null);
  assert.equal(f.controller.snapshot().can_start, true);
  await f.controller.dispose();
  const config = { ...status("unconfigured", "not_needed", 0), error: "MEDIA_CONFIG_MISSING" };
  const disabled = fixture({
    status: () => Promise.resolve(config),
    stop: () => Promise.resolve(config),
  });
  await disabled.controller.refresh();
  assert.equal(disabled.controller.snapshot().phase, "unconfigured");
  assert.equal(disabled.controller.snapshot().error, "CONFIG_MISSING");
  assert.equal(disabled.controller.snapshot().can_start, false);
  await disabled.controller.start();
  assert.equal(disabled.calls.includes("prepare"), false);
  await disabled.controller.stop();
  assert.equal(disabled.controller.snapshot().phase, "unconfigured");
  assert.equal(disabled.controller.snapshot().end_state, "not_needed");
  await disabled.controller.dispose();
});

test("pending verification is bounded and a rejection remains explicitly recoverable", async () => {
  const pending = deferred();
  let hung = true;
  const f = fixture({
    stop: () => Promise.resolve(status("stopping", "pending")),
    status: () => (hung ? pending.promise : Promise.resolve(status())),
  });
  await f.controller.start();
  await f.controller.stop();
  const checking = f.controller.stop();
  await f.advance(1000);
  await checking;
  assert.equal(f.controller.snapshot().phase, "blocked");
  assert.equal(f.controller.snapshot().error, "END_UNCONFIRMED");
  pending.reject(new Error("private HTTP body"));
  await flush();
  hung = false;
  await f.controller.stop(); // After an unknown status, retry end explicitly first.
  await f.controller.stop();
  assert.equal(f.controller.snapshot().phase, "stopped");
  await f.controller.dispose();
});

test("unresolved old permission causes bounded blocked cleanup, late disposal failure is not hidden", async () => {
  const permission = deferred();
  const f = fixture({ acquire: () => permission.promise });
  const starting = f.controller.start();
  await flush();
  const stopping = f.controller.stop();
  await f.advance(1000);
  await stopping;
  assert.equal(f.controller.snapshot().phase, "blocked");
  await f.controller.start();
  assert.equal(f.resources.length, 1);
  f.resources[0].onEvent("cleanup_failed");
  permission.resolve();
  await starting;
  assert.equal(f.controller.snapshot().phase, "blocked");
  await f.controller.stop(); // An explicit successful cleanup receipt is required.
  assert.equal(f.controller.snapshot().phase, "stopped");
  await f.controller.dispose();
});

test("stale refresh success/failure cannot override an operation or cancellation", async () => {
  for (const reject of [false, true]) {
    const pending = deferred();
    const f = fixture({ status: () => pending.promise });
    const refresh = f.controller.refresh();
    await f.controller.start();
    await f.controller.stop();
    if (reject) pending.reject(new Error("private HTTP body"));
    else pending.resolve(status("idle", "not_needed"));
    await refresh;
    assert.equal(f.controller.snapshot().phase, "stopped");
    await f.controller.dispose();
  }
});

test("invalid/expired grants never acquire input and failed dispatch never looks active", async () => {
  for (const raw of [
    { ...grant(), generation: 0 },
    { ...grant(), expires_at: 100 },
    { ...grant(), expires_at: 301 },
    { ...grant(), token: "" },
    { ...grant(), ws_url: "https://media.example.test" },
    { ...grant(), extra: true },
  ]) {
    const f = fixture({ prepare: () => Promise.resolve(raw) });
    await f.controller.start();
    await flush();
    assert.equal(f.resources.length, 0);
    assert.equal(f.controller.snapshot().phase, "failed");
    await f.controller.dispose();
  }
  const f = fixture({ dispatch: () => Promise.resolve(status("active", "not_needed", 2)) });
  await f.controller.start();
  await flush();
  assert.equal(f.controller.snapshot().error, "DISPATCH_FAILED");
  assert.equal(f.resources[0].stopped, true);
  await f.controller.dispose();
});

test("dispose is idempotent, removes subscribers and blocks any future start/stop IPC", async () => {
  const f = fixture();
  let renders = 0;
  f.controller.subscribe(() => {
    renders++;
  });
  await f.controller.start();
  await f.controller.dispose();
  const calls = f.calls.length,
    before = renders;
  await f.controller.start();
  await f.controller.stop();
  await f.controller.refresh();
  await f.controller.dispose();
  f.controller.setAuthState({ authenticated: true, expires_at: 300 });
  assert.equal(f.calls.length, calls);
  assert.equal(renders, before);
  assert.equal(f.tasks.size, 0);
});
