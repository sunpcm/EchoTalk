import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createAuthProbe } from "../auth.mjs";
import { authFixture, config, deferred, until, code } from "./support.mjs";

const make = (f, now) => createAuthProbe(config().auth, f.ports, now);

test("PKCE binds state/nonce/verifier, saves before browser, validates before publishing principal", async () => {
  const f = authFixture();
  const auth = make(f);
  assert.deepEqual(await auth.begin(), { status: "waiting" });
  const tx = f.calls.saved[0];
  const url = new URL(f.calls.opened[0].url);
  assert.equal(url.origin + url.pathname, config().auth.authorizationEndpoint);
  assert.equal(
    url.searchParams.get("code_challenge"),
    createHash("sha256").update(tx.verifier).digest("base64url"),
  );
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("nonce"), tx.nonce);
  assert.equal(url.searchParams.get("state"), tx.state);
  assert.equal(url.searchParams.get("redirect_uri"), tx.redirectUri);
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("scope"), "openid");
  assert.equal(url.searchParams.has("code_verifier"), false);
  assert.notEqual(tx.state, tx.nonce);
  assert.notEqual(tx.state, tx.verifier);
  assert.notEqual(tx.nonce, tx.verifier);
  const result = await auth.handleCallback(f.callback());
  assert.deepEqual(result, {
    status: "authenticated",
    principal: { issuer: tx.issuer, subject: "offline-subject" },
  });
  assert.equal(f.calls.exchanged.length, 1);
  assert.equal(f.calls.exchanged[0].verifier, tx.verifier);
  assert.equal(f.calls.exchanged[0].code, "offline-code");
  assert.equal(f.calls.exchanged[0].tokenEndpoint, config().auth.tokenEndpoint);
  assert.equal(f.calls.verified[0].nonce, tx.nonce);
  assert.equal(f.calls.verified[0].clientId, tx.clientId);
  assert.equal(f.calls.verified[0].issuer, tx.issuer);
  assert.equal(f.records.size, 0);
  assert.deepEqual(f.calls.discarded, [{}]);
  assert.equal(JSON.stringify(result).includes(tx.verifier), false);
  await assert.rejects(auth.handleCallback(f.callback()), code("CALLBACK_REJECTED"));
  assert.equal(f.calls.exchanged.length, 1);
  await auth.begin();
  assert.notEqual(f.calls.saved[1].state, tx.state);
  await auth.cancel();
});

test("forged redirect/state/issuer, duplicates and ambiguous code/error never exchange or consume valid login", async () => {
  const f = authFixture();
  const auth = make(f);
  await auth.begin();
  const valid = f.callback();
  for (const raw of [
    valid.replace("/callback?", "/callback/evil?"),
    valid.replace("org.example.echotalk:", "org.example.other:"),
    valid.replace("/callback?", "/%63allback?"),
    valid + "#fragment",
    valid + "&state=other",
    valid + "&code=another",
    valid + "&iss=https%3A%2F%2Fevil.example.test%2F",
    valid + "&error=denied",
    valid + "&redirect_uri=https%3A%2F%2Fevil.example.test",
    f.callback().replace("code=offline-code", "code="),
  ])
    await assert.rejects(auth.handleCallback(raw), code("CALLBACK_INVALID"));
  await assert.rejects(auth.handleCallback(f.callback("A".repeat(43))), code("CALLBACK_REJECTED"));
  assert.equal(f.calls.exchanged.length, 0);
  assert.equal(f.records.size, 1);
  await auth.handleCallback(valid);
  assert.equal(f.calls.exchanged.length, 1);
});

test("cold and warm entrypoints racing share atomic take; exactly one exchange", async () => {
  const f = authFixture();
  const warm = make(f);
  await warm.begin();
  const cold = make(f);
  const results = await Promise.allSettled([
    warm.handleCallback(f.callback()),
    cold.handleCallback(f.callback()),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.filter((r) => r.status === "rejected")[0].reason.code, "CALLBACK_REJECTED");
  assert.equal(f.calls.exchanged.length, 1);
  assert.equal(f.calls.verified.length, 1);
  assert.equal(f.records.size, 0);
});

test("cold callback succeeds using persisted transaction rather than local state", async () => {
  const f = authFixture();
  await make(f).begin();
  assert.equal((await make(f).handleCallback(f.callback())).status, "authenticated");
});

for (const mutate of [
  (tx) => {
    tx.expiresAt = tx.createdAt;
  },
  (tx) => {
    tx.issuer = "https://evil.example.test/";
  },
  (tx) => {
    tx.clientId = "other-client";
  },
  (tx) => {
    tx.redirectUri += "/other";
  },
  (tx) => {
    tx.nonce = "";
  },
  (tx) => {
    tx.verifier = "";
  },
]) {
  test(`stored transaction rejects invalid binding ${mutate.toString().split("tx.")[1].split(" ")[0]}`, async () => {
    const f = authFixture();
    const auth = make(f);
    await auth.begin();
    mutate(f.records.values().next().value);
    await assert.rejects(auth.handleCallback(f.callback()), code("CALLBACK_REJECTED"));
    assert.equal(f.calls.exchanged.length, 0);
    assert.equal(f.records.size, 0);
  });
}

test("expiry at deadline, future clock and cancelled transactions are refused across cold entry", async () => {
  for (const time of [61000, 999]) {
    const f = authFixture();
    const auth = make(f, () => 1000);
    await auth.begin();
    await assert.rejects(
      make(f, () => time).handleCallback(f.callback()),
      code("CALLBACK_REJECTED"),
    );
    assert.equal(f.calls.exchanged.length, 0);
  }
  const f = authFixture();
  const auth = make(f);
  await auth.begin();
  await auth.cancel();
  await assert.rejects(make(f).handleCallback(f.callback()), code("CALLBACK_REJECTED"));
  assert.equal(f.calls.exchanged.length, 0);
});

test("provider denial consumes transaction without exchange and never exposes error_description", async () => {
  const f = authFixture();
  const auth = make(f);
  await auth.begin();
  const raw = f
    .callback()
    .replace("code=offline-code", "error=access_denied&error_description=private-payload");
  await assert.rejects(auth.handleCallback(raw), code("AUTH_DENIED"));
  await assert.rejects(auth.handleCallback(f.callback()), code("CALLBACK_REJECTED"));
  assert.equal(f.calls.exchanged.length, 0);
});

test("reentrant begin and duplicate in-flight callback cause no second browser/exchange", async () => {
  const f = authFixture();
  const exchange = deferred();
  f.ports.exchangeCode = async (request) => {
    f.calls.exchanged.push(request);
    return exchange.promise;
  };
  const auth = make(f);
  await auth.begin();
  await assert.rejects(auth.begin(), code("AUTH_BUSY"));
  const pending = auth.handleCallback(f.callback());
  await until(() => f.calls.exchanged.length === 1);
  await assert.rejects(auth.handleCallback(f.callback()), code("CALLBACK_REJECTED"));
  exchange.resolve({ accessToken: "late-offline" });
  await pending;
  assert.equal(f.calls.opened.length, 1);
  assert.equal(f.calls.exchanged.length, 1);
});

test("cancel during delayed save revokes after save, opens no browser; new transaction survives", async () => {
  const f = authFixture();
  const save = f.ports.transactions.save;
  const gate = deferred();
  let entered = false;
  f.ports.transactions.save = async (tx) => {
    entered = true;
    await gate.promise;
    await save(tx);
  };
  const auth = make(f);
  const begin = assert.rejects(auth.begin(), code("AUTH_CANCELLED"));
  await until(() => entered);
  const cancelled = auth.cancel();
  f.ports.transactions.save = save;
  await auth.begin();
  const newState = f.calls.saved.at(-1).state;
  gate.resolve();
  await Promise.all([begin, cancelled]);
  assert.equal(f.calls.opened.length, 1);
  assert.deepEqual([...f.records.keys()], [newState]);
  await auth.handleCallback(f.callback(newState));
});

test("callback while save pending waits for persistence, then consumes once", async () => {
  const f = authFixture();
  const gate = deferred();
  const save = f.ports.transactions.save;
  let tx;
  f.ports.transactions.save = async (record) => {
    tx = record;
    await gate.promise;
    await save(record);
  };
  const auth = make(f);
  const beginning = auth.begin();
  await until(() => tx);
  const callback = auth.handleCallback(f.callback(tx.state));
  assert.equal(f.calls.exchanged.length, 0);
  gate.resolve();
  await beginning;
  await callback;
  assert.equal(f.calls.exchanged.length, 1);
  assert.equal(f.records.size, 0);
});

for (const stage of ["exchange", "verify"]) {
  test(`cancel during ${stage}: late tokens discarded; old callback cannot publish identity or cancel new login`, async () => {
    const f = authFixture();
    const gate = deferred();
    let entered = false;
    const method = stage === "exchange" ? "exchangeCode" : "validateIdentity";
    const original = f.ports[method];
    f.ports[method] = async () => {
      entered = true;
      return gate.promise;
    };
    const auth = make(f);
    await auth.begin();
    const pending = assert.rejects(auth.handleCallback(f.callback()), code("AUTH_CANCELLED"));
    await until(() => entered);
    await auth.cancel();
    f.ports[method] = original;
    await auth.begin();
    const next = f.calls.saved.at(-1).state;
    const late =
      stage === "exchange"
        ? { accessToken: "late-private-token" }
        : { issuer: config().auth.issuer, subject: "late" };
    gate.resolve(late);
    await pending;
    assert.equal(f.calls.discarded.length, 1);
    if (stage === "exchange") {
      assert.deepEqual(late, {});
      assert.equal(f.calls.verified.length, 0);
    }
    assert.ok(f.records.has(next));
    assert.equal(
      (await auth.handleCallback(f.callback(next))).principal.subject,
      "offline-subject",
    );
  });
}

for (const stage of ["save", "open", "exchange", "verify"]) {
  test(`${stage} port failure is sanitized and fails closed`, async () => {
    const f = authFixture();
    const fail = async () => {
      throw new Error("secret code/verifier/token private-payload");
    };
    if (stage === "save") f.ports.transactions.save = fail;
    else
      f.ports[
        { open: "openAuthorization", exchange: "exchangeCode", verify: "validateIdentity" }[stage]
      ] = fail;
    const auth = make(f);
    if (["save", "open"].includes(stage)) {
      await assert.rejects(auth.begin(), code("AUTH_PORT_FAILED"));
      assert.equal(f.records.size, 0);
      assert.equal(f.calls.exchanged.length, 0);
    } else {
      await auth.begin();
      await assert.rejects(auth.handleCallback(f.callback()), code("AUTH_PORT_FAILED"));
      assert.equal(f.calls.discarded.length, stage === "verify" ? 1 : 0);
    }
  });
}

test("untrusted identity is rejected, tokens disposed, close permanently refuses begin and callback", async () => {
  const f = authFixture();
  f.ports.validateIdentity = async () => ({
    issuer: "https://evil.example.test/",
    subject: "injected",
  });
  const auth = make(f);
  await auth.begin();
  await assert.rejects(auth.handleCallback(f.callback()), code("IDENTITY_INVALID"));
  assert.equal(f.calls.discarded.length, 1);
  await auth.close();
  await assert.rejects(auth.begin(), code("AUTH_CLOSED"));
  await assert.rejects(auth.handleCallback(f.callback()), code("AUTH_CLOSED"));
});

test("cancel pending browser launch aborts it; a late completion cannot revive transaction", async () => {
  const f = authFixture();
  const gate = deferred();
  const open = f.ports.openAuthorization;
  f.ports.openAuthorization = async (...args) => {
    await open(...args);
    await gate.promise;
  };
  const auth = make(f);
  const pending = assert.rejects(auth.begin(), code("AUTH_CANCELLED"));
  await until(() => f.calls.opened.length === 1);
  const callback = f.callback();
  await auth.cancel();
  assert.equal(f.calls.opened[0].signal.aborted, true);
  gate.resolve();
  await pending;
  await assert.rejects(make(f).handleCallback(callback), code("CALLBACK_REJECTED"));
  assert.equal(f.calls.exchanged.length, 0);
});

test("callback may complete before browser port resolves without treating success as cancellation", async () => {
  const f = authFixture();
  const gate = deferred();
  const open = f.ports.openAuthorization;
  f.ports.openAuthorization = async (...args) => {
    await open(...args);
    await gate.promise;
  };
  const auth = make(f);
  const beginning = auth.begin();
  await until(() => f.calls.opened.length === 1);
  await auth.handleCallback(f.callback());
  gate.resolve();
  assert.deepEqual(await beginning, { status: "callback_completed" });
  assert.equal(f.calls.exchanged.length, 1);
});

for (const stage of ["consume", "revoke", "discardTokens"]) {
  test(`${stage} failure is explicit; revoke/cleanup failures lock the controller`, async () => {
    const f = authFixture();
    const auth = make(f);
    await auth.begin();
    const fail = () => {
      throw new Error("private-credential storage error");
    };
    if (stage === "discardTokens") {
      f.ports.discardTokens = fail;
      await assert.rejects(auth.handleCallback(f.callback()), code("AUTH_CLEANUP_FAILED"));
    } else {
      f.ports.transactions[stage] = fail;
      if (stage === "consume") {
        await assert.rejects(auth.handleCallback(f.callback()), code("AUTH_PORT_FAILED"));
        assert.equal(f.calls.exchanged.length, 0);
        return;
      }
      await assert.rejects(auth.cancel(), code("AUTH_STORAGE_FAILED"));
    }
    await assert.rejects(auth.begin(), code("AUTH_UNAVAILABLE"));
    await assert.rejects(auth.handleCallback(f.callback()), code("AUTH_UNAVAILABLE"));
  });
}

test("verification port rejection of nonce/signature is never reported as authentication", async () => {
  const f = authFixture();
  f.ports.validateIdentity = async (request) => {
    assert.equal(request.nonce, f.calls.saved[0].nonce);
    assert.equal(request.tokens.idToken, "offline-id");
    throw new Error("nonce/signature rejected by TEST port (no real JWT validation)");
  };
  const auth = make(f);
  await auth.begin();
  await assert.rejects(auth.handleCallback(f.callback()), code("AUTH_PORT_FAILED"));
  assert.deepEqual(f.calls.discarded, [{}]);
});

test("transaction expiring during exchange refuses late identity and disposes tokens", async () => {
  const f = authFixture();
  const gate = deferred();
  let time = 1000;
  let entered = false;
  f.ports.exchangeCode = async () => {
    entered = true;
    return gate.promise;
  };
  const auth = make(f, () => time);
  await auth.begin();
  const pending = assert.rejects(auth.handleCallback(f.callback()), code("CALLBACK_REJECTED"));
  await until(() => entered);
  time = 61000;
  const late = { accessToken: "expired-late-token" };
  gate.resolve(late);
  await pending;
  assert.deepEqual(late, {});
  assert.equal(f.calls.verified.length, 0);
});

test("cancel during verification erases token immediately even while verification remains pending", async () => {
  const f = authFixture();
  const verify = deferred();
  let tokens;
  f.ports.validateIdentity = async (request) => {
    tokens = request.tokens;
    return verify.promise;
  };
  const auth = make(f);
  await auth.begin();
  const pending = assert.rejects(auth.handleCallback(f.callback()), code("AUTH_CANCELLED"));
  await until(() => tokens);
  const cancelling = auth.cancel();
  assert.deepEqual(tokens, {});
  assert.equal(f.calls.discarded.length, 1);
  await cancelling;
  verify.resolve({ issuer: config().auth.issuer, subject: "late-subject" });
  await pending;
  assert.equal(f.calls.discarded.length, 1);
});

test("failure erases token before waiting for a slow durable revoke", async () => {
  const f = authFixture();
  const revoke = deferred();
  let revokeEntered = false;
  f.ports.validateIdentity = async () => {
    throw new Error("invalid identity private-token");
  };
  f.ports.transactions.revoke = async () => {
    revokeEntered = true;
    await revoke.promise;
  };
  const auth = make(f);
  await auth.begin();
  const pending = assert.rejects(auth.handleCallback(f.callback()), code("AUTH_PORT_FAILED"));
  await until(() => revokeEntered);
  assert.deepEqual(f.calls.discarded, [{}]);
  revoke.resolve();
  await pending;
});

test("r1 opener rejection immediately clears in-flight verification tokens before slow revoke", async () => {
  const f = authFixture();
  const opener = deferred();
  const verify = deferred();
  const revoke = deferred();
  const open = f.ports.openAuthorization;
  const validate = f.ports.validateIdentity;
  const revokeTransaction = f.ports.transactions.revoke;
  let tokens;
  let revokeEntered = false;
  f.ports.openAuthorization = async (...args) => {
    await open(...args);
    return opener.promise;
  };
  f.ports.validateIdentity = async (request) => {
    tokens = request.tokens;
    return verify.promise;
  };
  f.ports.transactions.revoke = async (state) => {
    revokeEntered = true;
    await revoke.promise;
    await revokeTransaction(state);
  };
  const auth = make(f);
  const beginning = assert.rejects(auth.begin(), code("AUTH_PORT_FAILED"));
  await until(() => f.calls.opened.length === 1);
  const callback = assert.rejects(auth.handleCallback(f.callback()), code("AUTH_CANCELLED"));
  try {
    await until(() => tokens);
    opener.reject(new Error("opener failed private-token"));
    await until(() => revokeEntered);
    assert.deepEqual(tokens, {}, "browser failure clears token while verify/revoke still pending");
    assert.equal(f.calls.discarded.length, 1);
    assert.equal(f.calls.opened[0].signal.aborted, true);
    f.ports.openAuthorization = open;
    f.ports.validateIdentity = validate;
    f.ports.transactions.revoke = revokeTransaction;
    await auth.begin();
    assert.equal((await auth.handleCallback(f.callback())).principal.subject, "offline-subject");
    assert.equal(f.calls.discarded.length, 2);
  } finally {
    verify.resolve({ issuer: config().auth.issuer, subject: "stale-subject" });
    revoke.resolve();
    await Promise.all([beginning, callback]);
  }
  assert.equal(f.calls.discarded.length, 2, "old token is never destroyed twice");
});

test("r1 opener rejection before exchange returns clears late token once without verifying it", async () => {
  const f = authFixture();
  const opener = deferred();
  const exchange = deferred();
  const open = f.ports.openAuthorization;
  const exchangeCode = f.ports.exchangeCode;
  let entered = false;
  f.ports.openAuthorization = async (...args) => {
    await open(...args);
    return opener.promise;
  };
  f.ports.exchangeCode = async () => {
    entered = true;
    return exchange.promise;
  };
  const auth = make(f);
  const beginning = assert.rejects(auth.begin(), code("AUTH_PORT_FAILED"));
  await until(() => f.calls.opened.length === 1);
  const old = assert.rejects(auth.handleCallback(f.callback()), code("AUTH_CANCELLED"));
  await until(() => entered);
  opener.reject(new Error("opener failed"));
  await beginning;
  assert.equal(f.calls.discarded.length, 0);
  f.ports.openAuthorization = open;
  f.ports.exchangeCode = exchangeCode;
  await auth.begin();
  const nextState = f.calls.saved.at(-1).state;
  const late = { accessToken: "late-offline-token" };
  exchange.resolve(late);
  await old;
  assert.deepEqual(late, {});
  assert.equal(f.calls.discarded.length, 1);
  assert.equal(f.calls.verified.length, 0);
  assert.ok(f.records.has(nextState));
  await auth.handleCallback(f.callback(nextState));
  assert.equal(f.calls.discarded.length, 2);
});

test("r1 opener failure with throwing token disposal locks auth and never retries disposal", async () => {
  const f = authFixture();
  const opener = deferred();
  const verify = deferred();
  const open = f.ports.openAuthorization;
  let entered = false;
  let attempts = 0;
  f.ports.openAuthorization = async (...args) => {
    await open(...args);
    return opener.promise;
  };
  f.ports.validateIdentity = async () => {
    entered = true;
    return verify.promise;
  };
  f.ports.discardTokens = () => {
    attempts++;
    throw new Error("cannot erase private-token");
  };
  const auth = make(f);
  const beginning = assert.rejects(auth.begin(), code("AUTH_CLEANUP_FAILED"));
  await until(() => f.calls.opened.length === 1);
  const old = assert.rejects(auth.handleCallback(f.callback()), code("AUTH_CANCELLED"));
  try {
    await until(() => entered);
    opener.reject(new Error("opener failed"));
    await beginning;
    assert.equal(attempts, 1, "cleanup attempted before slow verifier settles");
    await assert.rejects(auth.begin(), code("AUTH_UNAVAILABLE"));
    await assert.rejects(auth.handleCallback(f.callback()), code("AUTH_UNAVAILABLE"));
  } finally {
    verify.resolve({ issuer: config().auth.issuer, subject: "stale" });
    await old;
  }
  assert.equal(attempts, 1);
});

test("r1 synchronous close from token disposal refuses the otherwise verified identity", async () => {
  const f = authFixture();
  const auth = make(f);
  const discard = f.ports.discardTokens;
  let closing;
  f.ports.discardTokens = (tokens) => {
    discard(tokens);
    closing = auth.close();
  };
  await auth.begin();
  await assert.rejects(auth.handleCallback(f.callback()), code("AUTH_CANCELLED"));
  await closing;
  assert.deepEqual(f.calls.discarded, [{}]);
  await assert.rejects(auth.begin(), code("AUTH_CLOSED"));
});
