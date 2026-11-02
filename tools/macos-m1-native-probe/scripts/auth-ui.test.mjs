import test from "node:test";
import assert from "node:assert/strict";
import { createPublicKey, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { mountAuth, safeStatus } from "../web/auth-ui.mjs";

const state = (phase, error = null) => ({
  phase,
  authenticated: phase === "authenticated",
  expires_at: phase === "authenticated" ? 4102444800 : null,
  error,
});
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((ok, no) => {
    resolve = ok;
    reject = no;
  });
  return { promise, resolve, reject };
};
function fixture(invoke) {
  const elements = Object.fromEntries(
    ["auth-status", "auth-detail", "login", "cancel"].map((id) => [
      id,
      {
        textContent: "",
        disabled: true,
        handlers: new Map(),
        addEventListener(event, fn) {
          this.handlers.set(event, fn);
        },
        removeEventListener(event, fn) {
          if (this.handlers.get(event) === fn) this.handlers.delete(event);
        },
        click() {
          return this.handlers.get("click")?.();
        },
      },
    ]),
  );
  let next;
  let cleared = false;
  const timers = {
    setTimeout(fn) {
      next = fn;
      return 1;
    },
    clearTimeout() {
      cleared = true;
    },
  };
  const dispose = mountAuth({ getElementById: (id) => elements[id] }, invoke, timers);
  return { elements, dispose, poll: () => next(), cleared: () => cleared };
}

test("UI forwards only three fixed empty-argument commands and renders native status", async () => {
  const calls = [];
  const f = fixture(async (command, args) => {
    calls.push([command, args]);
    return state(command === "auth_begin" ? "waiting" : "idle");
  });
  await flush();
  assert.equal(f.elements.login.disabled, false);
  await f.elements.login.click();
  assert.equal(f.elements.login.disabled, true);
  assert.match(f.elements["auth-status"].textContent, /浏览器/u);
  await f.elements.cancel.click();
  assert.equal(f.elements.login.disabled, false);
  assert.deepEqual(calls, [
    ["auth_status", {}],
    ["auth_begin", {}],
    ["auth_cancel", {}],
  ]);
  f.dispose();
  assert.equal(f.cleared(), true);
  assert.equal(f.elements.login.handlers.size, 0);
});

test("unknown errors/status/identity bodies never appear as text or HTML", async () => {
  const f = fixture(async () => {
    throw "code=private-state token=private-payload";
  });
  await flush();
  assert.equal(f.elements["auth-detail"].textContent, "AUTH_UNAVAILABLE");
  for (const value of [
    { ...state("idle"), phase: "<img onerror=evil>" },
    { ...state("idle"), error: "private-token" },
    { ...state("authenticated"), expires_at: null },
  ])
    assert.throws(() => safeStatus(value));
  assert.deepEqual(
    safeStatus({ ...state("idle"), identity: "private-subject", access_token: "private-token" }),
    state("idle"),
  );
  f.dispose();
});

test("late initial poll and old begin success/failure cannot overwrite cancellation or newer login", async () => {
  for (const fail of [false, true]) {
    const initial = deferred(),
      begin = deferred();
    let count = 0;
    const f = fixture((command) => {
      if (command === "auth_status")
        return count++ === 0 ? initial.promise : Promise.resolve(state("idle"));
      if (command === "auth_begin") return begin.promise;
      return Promise.resolve(state("cancelled"));
    });
    const starting = f.elements.login.click();
    initial.resolve(state("authenticated"));
    await flush();
    await f.elements.cancel.click();
    assert.match(f.elements["auth-status"].textContent, /取消/u);
    if (fail) begin.reject("OIDC_EXCHANGE_FAILED");
    else begin.resolve(state("waiting"));
    await starting;
    assert.match(f.elements["auth-status"].textContent, /取消/u);
    await f.poll();
    assert.equal(f.elements.login.disabled, false);
    f.dispose();
  }
});

test("unconfigured UI is inert and disposed pending operations cannot render or rearm timers", async () => {
  const wait = deferred();
  let calls = 0;
  const f = fixture(async () => {
    calls++;
    return wait.promise;
  });
  f.dispose();
  wait.resolve(state("unconfigured"));
  await flush();
  assert.equal(calls, 1);
  assert.equal(f.elements["auth-status"].textContent, "");
  assert.equal(f.elements.login.handlers.size, 0);
  const u = fixture(async () => state("unconfigured", "CONFIG_MISSING"));
  await flush();
  assert.equal(u.elements.login.disabled, true);
  assert.equal(u.elements.cancel.disabled, true);
  u.dispose();
});

test("synthetic RSA fixture has valid signatures for semantic-negative cases and deliberately wrong signature control", () => {
  const fixture = JSON.parse(
    readFileSync(new URL("../src-tauri/src/oidc-fixture.json", import.meta.url)),
  );
  const key = createPublicKey({ key: fixture.jwks.keys[0], format: "jwk" });
  for (const [name, jwt] of Object.entries(fixture.tokens)) {
    const [header, body, signature] = jwt.split(".");
    assert.equal(
      verify(
        "RSA-SHA256",
        Buffer.from(header + "." + body),
        key,
        Buffer.from(signature, "base64url"),
      ),
      name !== "bad_signature",
      name,
    );
  }
  assert.equal(
    JSON.parse(Buffer.from(fixture.tokens.valid.split(".")[1], "base64url")).aud,
    "m1-native",
  );
});
