import test from "node:test";
import assert from "node:assert/strict";
import { mountMedia } from "../web/media-ui.mjs";

function target() {
  const handlers = new Map();
  return {
    handlers,
    textContent: "",
    disabled: true,
    addEventListener(event, fn) {
      handlers.set(event, fn);
    },
    removeEventListener(event, fn) {
      if (handlers.get(event) === fn) handlers.delete(event);
    },
    emit(event) {
      return handlers.get(event)?.();
    },
  };
}
const state = (phase, error = null) => ({
  phase,
  error,
  end_state: "not_needed",
  can_start: phase === "idle",
  can_stop: phase === "waiting" || phase === "blocked",
  can_retry_playback: phase === "playback_blocked",
});
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
function fixture({ hidden = false, offline = false, retry } = {}) {
  const calls = [];
  const elements = Object.fromEntries(
    ["media-status", "media-detail", "media-start", "media-stop", "media-play"].map((id) => [
      id,
      target(),
    ]),
  );
  const window = { ...target(), navigator: { onLine: !offline } };
  const document = {
    ...target(),
    visibilityState: hidden ? "hidden" : "visible",
    defaultView: window,
    getElementById: (id) => elements[id],
  };
  let render, auth;
  let unsubscribed = false,
    authUnsubscribed = false;
  const controller = {
    subscribe(fn) {
      render = fn;
      fn(state("idle"));
      return () => {
        unsubscribed = true;
      };
    },
    setAuthState(value) {
      calls.push(["auth", value]);
    },
    lifecycle(event) {
      calls.push(["lifecycle", event]);
      return Promise.resolve();
    },
    start() {
      calls.push("start");
      render(state("preparing"));
      return Promise.resolve();
    },
    stop() {
      calls.push("stop");
      render(state("stopped"));
      return Promise.resolve();
    },
    retryPlayback() {
      calls.push("retry");
      return retry?.() ?? Promise.resolve();
    },
    refresh() {
      calls.push("refresh");
      return Promise.resolve();
    },
    dispose() {
      calls.push("dispose");
      return Promise.resolve();
    },
  };
  const dispose = mountMedia({
    document,
    controller,
    onAuthState(fn) {
      auth = fn;
      fn({ authenticated: true, expires_at: 200 });
      return () => {
        authUnsubscribed = true;
      };
    },
  });
  return {
    calls,
    elements,
    window,
    document,
    dispose,
    render: (v) => render(v),
    auth: (v) => auth(v),
    controller,
    unsubscribed: () => unsubscribed && authUnsubscribed,
  };
}

test("explicit controls only, waiting is not audible and no autoplay retry on render", async () => {
  const f = fixture();
  assert.equal(f.elements["media-start"].disabled, false);
  assert.deepEqual(f.calls, [["auth", { authenticated: true, expires_at: 200 }], "refresh"]);
  f.elements["media-start"].emit("click");
  assert.equal(f.calls.at(-1), "start");
  f.elements["media-start"].emit("click");
  assert.equal(f.calls.filter((v) => v === "start").length, 1);
  f.render(state("waiting"));
  assert.match(f.elements["media-status"].textContent, /等待/u);
  assert.match(f.elements["media-detail"].textContent, /不代表双向/u);
  f.elements["media-stop"].emit("click");
  assert.equal(f.calls.at(-1), "stop");
  f.render(state("playback_blocked", "PLAYBACK_BLOCKED"));
  assert.equal(f.calls.includes("retry"), false);
  f.elements["media-play"].emit("click");
  assert.equal(f.calls.at(-1), "retry"); // Called in the same click stack.
  await f.dispose();
});

test("only fixed copy reaches DOM; token/URL/session/error bodies never appear", async () => {
  const f = fixture();
  f.render({
    ...state("blocked", "HTTP token=private"),
    token: "private-room-token",
    session_id: "private-session",
    ws_url: "wss://private.example",
  });
  assert.doesNotMatch(
    JSON.stringify(Object.values(f.elements).map((e) => e.textContent)),
    /private|HTTP|wss:/u,
  );
  assert.match(f.elements["media-status"].textContent, /清理未完成/u);
  f.render(state("<img src=x onerror=evil>"));
  assert.equal(f.elements["media-start"].disabled, true);
  assert.equal(f.elements["media-status"].textContent, "媒体状态不可用");
  f.render(state("audio"));
  assert.match(f.elements["media-status"].textContent, /请确认实际有声/u);
  await f.dispose();
});

test("pending exposes an explicit verification action and missing configuration has dedicated copy", async () => {
  const f = fixture();
  f.render({ ...state("stopping"), end_state: "pending", can_stop: true });
  assert.equal(f.elements["media-stop"].textContent, "核实结束");
  assert.equal(f.elements["media-start"].disabled, true);
  f.elements["media-stop"].emit("click");
  assert.equal(f.calls.at(-1), "stop");
  f.render(state("unconfigured", "CONFIG_MISSING"));
  assert.match(f.elements["media-detail"].textContent, /配置.*禁用/u);
  assert.doesNotMatch(f.elements["media-detail"].textContent, /结束.*未确认/u);
  assert.equal(f.elements["media-start"].disabled, true);
  await f.dispose();
});

test("hidden/offline initial state, pagehide and restored state are forwarded without starting input", async () => {
  const f = fixture({ hidden: true, offline: true });
  assert.ok(f.calls.some((v) => Array.isArray(v) && v[1] === "hidden"));
  assert.ok(f.calls.some((v) => Array.isArray(v) && v[1] === "offline"));
  f.document.visibilityState = "visible";
  f.document.emit("visibilitychange");
  for (const event of ["online", "offline", "pagehide"]) f.window.emit(event);
  assert.deepEqual(f.calls.slice(-5), [
    ["lifecycle", "visible"],
    ["lifecycle", "online"],
    ["lifecycle", "offline"],
    ["lifecycle", "pagehide"],
    "dispose",
  ]);
  assert.equal(f.unsubscribed(), true);
  assert.equal(f.calls.includes("start"), false);
  await f.dispose();
});

test("auth invalidation forwarded, dispose removes every listener and ignores saved old subscriptions", async () => {
  const f = fixture();
  f.auth({ authenticated: false });
  assert.deepEqual(f.calls.at(-1), ["auth", { authenticated: false }]);
  await f.dispose();
  assert.equal(f.unsubscribed(), true);
  assert.equal(f.document.handlers.size, 0);
  assert.equal(f.window.handlers.size, 0);
  for (const e of Object.values(f.elements)) assert.equal(e.handlers.size, 0);
  const before = f.calls.length,
    text = f.elements["media-status"].textContent;
  f.auth({ authenticated: true, expires_at: 999 });
  f.render(state("waiting"));
  await f.dispose();
  assert.equal(f.calls.length, before);
  assert.equal(f.elements["media-status"].textContent, text);
});

test("async playback action failure is sanitized and disposal cannot be overwritten by a late error", async () => {
  let reject;
  const waiting = new Promise((_, no) => {
    reject = no;
  });
  const f = fixture({ retry: () => waiting });
  f.render(state("playback_blocked", "PLAYBACK_BLOCKED"));
  f.elements["media-play"].emit("click");
  await f.dispose();
  const before = f.elements["media-status"].textContent;
  reject(new Error("private room URL"));
  await flush();
  assert.equal(f.elements["media-status"].textContent, before);
});
