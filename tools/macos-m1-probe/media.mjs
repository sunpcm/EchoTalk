import { ProbeError, requireMethods } from "./ports.mjs";

/**
 * prepare({intent, apiOrigin, signal}) -> {token, wsUrl, dispose()};
 * acquireMicrophone({signal}) -> {dispose()};
 * connect({access, microphone, signal}) -> {dispose()}.
 * Each lease is exclusive to one operation. dispose() must synchronously stop
 * local tracks/automatic reconnect and erase temporary tokens, even if pending
 * work ignores AbortSignal. Backend end/release are separate future contracts.
 */
export function createMediaProbe(config, ports) {
  requireMethods(ports, ["prepare", "acquireMicrophone", "connect"]);
  let current = null;
  let closed = false;
  let blocked = false;
  let cleanupFailed = false;
  let snapshot = Object.freeze({ state: "waiting", reason: "user_action_required" });
  const publish = (state, reason) => {
    snapshot = Object.freeze({ state, reason });
  };
  const live = (op) => current === op && !op.abort.signal.aborted;
  function check(op) {
    if (cleanupFailed) throw new ProbeError("MEDIA_CLEANUP_FAILED");
    if (!live(op)) throw new ProbeError("MEDIA_CANCELLED");
  }

  function dispose(resource) {
    try {
      requireMethods(resource, ["dispose"]);
      resource.dispose();
    } catch {
      // Continue cleaning other resources, but never report a clean stop/restart.
      cleanupFailed = true;
      // If an OLD late lease fails disposal, halt any new session too: safety
      // cannot be established while an old microphone may still be active.
      const active = current;
      current = null;
      if (active) {
        active.abort.abort();
        release(active);
      }
      publish("failed", "cleanup_failed");
    }
  }
  function release(op) {
    // Stop the microphone first, before transport teardown or remote work.
    for (const key of ["microphone", "connection", "access"]) {
      const resource = op[key];
      op[key] = null;
      if (resource) dispose(resource);
    }
  }
  async function acquire(op, key, pending) {
    const resource = await pending;
    if (!live(op)) {
      if (resource) dispose(resource);
      throw new ProbeError("MEDIA_CANCELLED");
    }
    try {
      requireMethods(resource, ["dispose"]);
    } catch {
      dispose(resource);
      throw new ProbeError("PORT_RESOURCE_INVALID");
    }
    op[key] = resource;
    return resource;
  }
  function stop(reason = "user_stop") {
    const op = current;
    current = null;
    publish("stopping", reason);
    const stoppingSnapshot = snapshot;
    if (op) {
      op.abort.abort();
      release(op);
    }
    // A disposer/abort listener can synchronously start another operation.
    if (current === null && snapshot === stoppingSnapshot) {
      publish(
        cleanupFailed ? "failed" : closed ? "closed" : "waiting",
        cleanupFailed ? "cleanup_failed" : reason,
      );
    }
  }

  async function start({ intent, userConfirmed } = {}) {
    if (closed || blocked || cleanupFailed) throw new ProbeError("MEDIA_UNAVAILABLE");
    if (current) throw new ProbeError("MEDIA_BUSY");
    if (userConfirmed !== true || !["start", "resume"].includes(intent)) {
      throw new ProbeError("USER_ACTION_REQUIRED");
    }
    const op = { abort: new AbortController() };
    current = op;
    publish("connecting", "preparing");
    try {
      const access = await acquire(
        op,
        "access",
        ports.prepare({ intent, apiOrigin: config.apiOrigin, signal: op.abort.signal }),
      );
      check(op);
      let url;
      try {
        url = new URL(access.wsUrl);
      } catch {
        throw new ProbeError("MEDIA_ACCESS_INVALID");
      }
      if (
        typeof access.token !== "string" ||
        !access.token ||
        url.protocol !== "wss:" ||
        url.username ||
        url.password ||
        url.hash ||
        !config.mediaOrigins.includes(url.origin)
      )
        throw new ProbeError("MEDIA_ACCESS_INVALID");
      check(op);
      publish("connecting", "microphone");
      const microphone = await acquire(
        op,
        "microphone",
        ports.acquireMicrophone({ signal: op.abort.signal }),
      );
      check(op);
      publish("connecting", "transport");
      await acquire(
        op,
        "connection",
        ports.connect({ access, microphone, signal: op.abort.signal }),
      );
      check(op);
      // The SDK lease owns its internal credentials; clear the temporary API token.
      op.access = null;
      dispose(access);
      check(op);
      publish("connected", "user_started");
      return { status: "connected" };
    } catch (error) {
      if (live(op)) {
        current = null;
        const failingSnapshot = snapshot;
        op.abort.abort();
        release(op);
        if (current === null && snapshot === failingSnapshot) {
          publish("failed", cleanupFailed ? "cleanup_failed" : "connection_failed");
        }
      }
      if (error instanceof ProbeError) throw error;
      throw new ProbeError("MEDIA_PORT_FAILED");
    }
  }

  return Object.freeze({
    start,
    stop: () => stop(),
    getSnapshot: () => snapshot,
    interrupt(reason) {
      if (!["offline", "sleep", "inactive", "device_lost", "auth_invalid"].includes(reason)) {
        throw new ProbeError("INTERRUPT_INVALID");
      }
      blocked = true;
      stop(reason);
    },
    ready() {
      blocked = false;
      // Readiness never calls start/prepare/acquireMicrophone/connect.
    },
    close() {
      closed = true;
      stop("window_closed");
    },
  });
}
