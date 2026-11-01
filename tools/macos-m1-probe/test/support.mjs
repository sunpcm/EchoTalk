import assert from "node:assert/strict";
import { validateConfig } from "../bootstrap.mjs";

// TEST ONLY: reserved example.test addresses; never connect or read configuration.
export function config() {
  return validateConfig({
    apiOrigin: "https://api.example.test",
    mediaOrigins: ["wss://media.example.test"],
    auth: {
      issuer: "https://id.example.test/",
      authorizationEndpoint: "https://id.example.test/authorize",
      tokenEndpoint: "https://id.example.test/token",
      clientId: "offline-public-client",
      redirectUri: "org.example.echotalk://oauth/callback",
      transactionTtlMs: 60000,
    },
  });
}

export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

export async function until(predicate) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail("Expected observable port call did not occur");
}

export function code(expected) {
  return (error) => {
    assert.equal(error.name, "ProbeError");
    assert.equal(error.code, expected);
    assert.equal(error.message, expected);
    assert.equal(error.cause, undefined);
    return true;
  };
}

export function authFixture() {
  const records = new Map();
  const calls = { saved: [], opened: [], exchanged: [], verified: [], discarded: [], revoked: [] };
  const ports = {
    transactions: {
      async save(record) {
        assert.equal(records.has(record.state), false);
        records.set(record.state, structuredClone(record));
        calls.saved.push(structuredClone(record));
      },
      async consume(state) {
        // Atomic synchronous destructive take before promise resolution (test substitute).
        const record = records.get(state);
        records.delete(state);
        return record;
      },
      async revoke(state) {
        records.delete(state);
        calls.revoked.push(state);
      },
    },
    async openAuthorization(url, options) {
      assert.ok(records.has(new URL(url).searchParams.get("state")), "save precedes opener");
      calls.opened.push({ url, ...options });
    },
    async exchangeCode(request) {
      calls.exchanged.push(request);
      return { accessToken: "offline-access", idToken: "offline-id" };
    },
    async validateIdentity(request) {
      calls.verified.push(request);
      return { issuer: request.issuer, subject: "offline-subject" };
    },
    discardTokens(tokens) {
      calls.discarded.push(tokens);
      for (const key of Object.keys(tokens)) delete tokens[key];
    },
  };
  const callback = (state = calls.saved.at(-1)?.state, extra = {}) => {
    const query = new URLSearchParams({ state, code: "offline-code", ...extra });
    return `${config().auth.redirectUri}?${query}`;
  };
  return { ports, calls, records, callback };
}

export function mediaFixture() {
  const calls = { prepared: [], microphone: [], connected: [] };
  const resources = [];
  function lease(kind, fields = {}) {
    const resource = {
      kind,
      disposals: 0,
      ...fields,
      dispose() {
        this.disposals++;
        if ("token" in this) this.token = null;
      },
    };
    resources.push(resource);
    return resource;
  }
  const ports = {
    async prepare(request) {
      calls.prepared.push(request);
      return lease("access", {
        token: "offline-media-token",
        wsUrl: "wss://media.example.test/room",
      });
    },
    async acquireMicrophone(request) {
      calls.microphone.push(request);
      return lease("microphone");
    },
    async connect(request) {
      calls.connected.push(request);
      return lease("connection");
    },
  };
  return { ports, calls, resources, lease };
}
