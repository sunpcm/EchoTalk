import { createHash, randomBytes } from "node:crypto";
import { ProbeError, requireMethods } from "./ports.mjs";

function parseCallback(raw, config) {
  try {
    if (typeof raw !== "string" || raw.length > 8192) throw new Error();
    const url = new URL(raw);
    if (raw.split("?")[0] !== config.redirectUri || url.hash) throw new Error();
    const allowed = new Set(["state", "code", "error", "error_description", "error_uri", "iss"]);
    for (const key of url.searchParams.keys()) {
      if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1) throw new Error();
    }
    const state = url.searchParams.get("state");
    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");
    if (
      !/^[A-Za-z0-9_-]{43}$/u.test(state ?? "") ||
      (url.searchParams.has("iss") && url.searchParams.get("iss") !== config.issuer) ||
      url.searchParams.has("code") === url.searchParams.has("error") ||
      (code !== null && (!code || code.length > 2048)) ||
      (error !== null && !error)
    ) {
      throw new Error();
    }
    return { state, code, denied: error !== null };
  } catch {
    throw new ProbeError("CALLBACK_INVALID");
  }
}

/**
 * Native auth port contracts (NO implementation/default here):
 * transactions.save(record): unique durable insert before opening browser.
 * transactions.consume(state): atomic destructive take shared by cold/warm entrypoints.
 * transactions.revoke(state): durable, idempotent cancellation; prune expired records.
 * openAuthorization(url, {signal}): only this pinned authorization endpoint.
 * exchangeCode({code, verifier, ...pinned bindings, signal}): native PKCE exchange.
 * validateIdentity({tokens, nonce, issuer, clientId, signal}): authentic signature,
 * issuer/audience/azp, expiry and nonce validation; return {issuer, subject}.
 * discardTokens(tokens): synchronous disposal, including late exchange results.
 * All failures are translated to static errors; never include port error/callback text.
 */
export function createAuthProbe(config, ports, now = Date.now) {
  requireMethods(ports?.transactions, ["save", "consume", "revoke"]);
  requireMethods(ports, ["openAuthorization", "exchangeCode", "validateIdentity", "discardTokens"]);
  let current = null;
  let closed = false;
  let faulted = false;
  const live = (op) => current === op && !op.abort.signal.aborted;
  function check(op) {
    if (!live(op) || closed || faulted) throw new ProbeError("AUTH_CANCELLED");
  }
  function discard(op) {
    if (op.tokens === undefined) return;
    const tokens = op.tokens;
    op.tokens = undefined;
    try {
      ports.discardTokens(tokens);
    } catch {
      faulted = true;
      throw new ProbeError("AUTH_CLEANUP_FAILED");
    }
  }
  function abandon(op) {
    if (current === op) current = null;
    op.abort.abort();
    discard(op);
  }

  async function begin() {
    if (closed) throw new ProbeError("AUTH_CLOSED");
    if (faulted) throw new ProbeError("AUTH_UNAVAILABLE");
    if (current) throw new ProbeError("AUTH_BUSY");
    const createdAt = now();
    const transaction = {
      state: randomBytes(32).toString("base64url"),
      nonce: randomBytes(32).toString("base64url"),
      verifier: randomBytes(32).toString("base64url"),
      issuer: config.issuer,
      clientId: config.clientId,
      redirectUri: config.redirectUri,
      createdAt,
      expiresAt: createdAt + config.transactionTtlMs,
    };
    const op = { state: transaction.state, abort: new AbortController(), completed: false };
    current = op;
    try {
      op.saved = Promise.resolve().then(() => ports.transactions.save(transaction));
      await op.saved;
      check(op);
      const url = new URL(config.authorizationEndpoint);
      url.search = new URLSearchParams({
        response_type: "code",
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        scope: "openid",
        state: transaction.state,
        nonce: transaction.nonce,
        code_challenge: createHash("sha256").update(transaction.verifier).digest("base64url"),
        code_challenge_method: "S256",
      }).toString();
      await ports.openAuthorization(url.href, { signal: op.abort.signal });
      if (!op.completed) check(op);
      return { status: op.completed ? "callback_completed" : "waiting" };
    } catch (error) {
      let failure = error;
      try {
        abandon(op);
      } catch (cleanupError) {
        failure = cleanupError;
      }
      // A failed/aborted browser launch must not leave a usable persisted transaction.
      try {
        await ports.transactions.revoke(op.state);
      } catch {
        faulted = true;
        throw new ProbeError("AUTH_STORAGE_FAILED");
      }
      if (
        failure instanceof ProbeError &&
        ["AUTH_CANCELLED", "AUTH_CLEANUP_FAILED"].includes(failure.code)
      ) {
        throw failure;
      }
      throw new ProbeError("AUTH_PORT_FAILED");
    }
  }

  async function handleCallback(raw) {
    if (closed) throw new ProbeError("AUTH_CLOSED");
    if (faulted) throw new ProbeError("AUTH_UNAVAILABLE");
    const callback = parseCallback(raw, config);
    if (current && (current.state !== callback.state || current.handling)) {
      throw new ProbeError("CALLBACK_REJECTED");
    }
    const op = current ?? { state: callback.state, abort: new AbortController() };
    current = op;
    op.handling = true;
    try {
      // A warm callback may arrive while the durable save is still completing.
      if (op.saved) await op.saved;
      check(op);
      const tx = await ports.transactions.consume(callback.state);
      check(op);
      const time = now();
      if (
        !tx ||
        tx.state !== callback.state ||
        tx.issuer !== config.issuer ||
        tx.clientId !== config.clientId ||
        tx.redirectUri !== config.redirectUri ||
        !Number.isSafeInteger(tx.createdAt) ||
        !Number.isSafeInteger(tx.expiresAt) ||
        time < tx.createdAt ||
        time >= tx.expiresAt ||
        tx.expiresAt - tx.createdAt !== config.transactionTtlMs ||
        !/^[A-Za-z0-9_-]{43}$/u.test(tx.nonce ?? "") ||
        !/^[A-Za-z0-9_-]{43}$/u.test(tx.verifier ?? "")
      ) {
        throw new ProbeError("CALLBACK_REJECTED");
      }
      if (callback.denied) throw new ProbeError("AUTH_DENIED");
      const tokens = await ports.exchangeCode({
        code: callback.code,
        verifier: tx.verifier,
        redirectUri: tx.redirectUri,
        issuer: tx.issuer,
        clientId: tx.clientId,
        tokenEndpoint: config.tokenEndpoint,
        signal: op.abort.signal,
      });
      op.tokens = tokens;
      check(op);
      if (now() >= tx.expiresAt || now() < tx.createdAt) {
        throw new ProbeError("CALLBACK_REJECTED");
      }
      if (!tokens) throw new ProbeError("AUTH_PORT_FAILED");
      const identity = await ports.validateIdentity({
        tokens,
        nonce: tx.nonce,
        issuer: tx.issuer,
        clientId: tx.clientId,
        signal: op.abort.signal,
      });
      check(op);
      if (now() >= tx.expiresAt || now() < tx.createdAt) {
        throw new ProbeError("CALLBACK_REJECTED");
      }
      if (
        identity?.issuer !== config.issuer ||
        typeof identity?.subject !== "string" ||
        !identity.subject.trim()
      ) {
        throw new ProbeError("IDENTITY_INVALID");
      }
      // Disposal may synchronously cancel/close or start a different operation.
      discard(op);
      check(op);
      op.completed = true;
      return {
        status: "authenticated",
        principal: { issuer: identity.issuer, subject: identity.subject },
      };
    } catch (error) {
      // Do not keep credentials alive while durable revocation is slow/pending.
      let failure = error;
      try {
        abandon(op);
      } catch (cleanupError) {
        failure = cleanupError;
      }
      try {
        await ports.transactions.revoke(op.state);
      } catch {
        faulted = true;
        throw new ProbeError("AUTH_STORAGE_FAILED");
      }
      if (failure instanceof ProbeError) throw failure;
      throw new ProbeError("AUTH_PORT_FAILED");
    } finally {
      if (current === op) current = null;
      discard(op);
    }
  }

  async function cancel() {
    const op = current;
    if (!op) return;
    let cleanupError;
    try {
      abandon(op);
    } catch (error) {
      cleanupError = error;
    }
    try {
      if (op.saved) await op.saved.catch(() => {});
      await ports.transactions.revoke(op.state);
    } catch {
      faulted = true;
      throw new ProbeError("AUTH_STORAGE_FAILED");
    }
    if (cleanupError) throw cleanupError;
  }

  return Object.freeze({
    begin,
    handleCallback,
    cancel,
    async close() {
      closed = true;
      await cancel();
    },
  });
}
