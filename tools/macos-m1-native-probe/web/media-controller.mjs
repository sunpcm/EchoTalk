const nativePhases = new Set([
  "unconfigured",
  "idle",
  "preparing",
  "prepared",
  "dispatching",
  "active",
  "stopping",
  "stopped",
  "blocked",
  "failed",
]);
const endStates = new Set(["not_needed", "pending", "ended", "unknown"]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const terminalPhases = new Set(["idle", "stopped", "failed"]);
const safeErrors = new Set([
  "AUTH_REQUIRED",
  "AUTH_EXPIRED",
  "CONFIG_MISSING",
  "MEDIA_UNAVAILABLE",
  "PREPARE_FAILED",
  "GRANT_INVALID",
  "PERMISSION_DENIED",
  "INPUT_FAILED",
  "CONNECT_FAILED",
  "PUBLISH_FAILED",
  "DISPATCH_FAILED",
  "PLAYBACK_BLOCKED",
  "DISCONNECTED",
  "INPUT_ENDED",
  "OFFLINE",
  "HIDDEN",
  "PAGEHIDE",
  "CLEANUP_FAILED",
  "END_UNCONFIRMED",
  "STATUS_INVALID",
]);
const safeError = (code) => (safeErrors.has(code) ? code : "MEDIA_UNAVAILABLE");

// The bridge never accepts URLs, tokens or arbitrary HTTP options from the UI.
export function createMediaBridge(invoke) {
  return Object.freeze({
    prepare: () => invoke("media_prepare", {}),
    dispatch: (generation) => {
      if (!Number.isSafeInteger(generation) || generation <= 0)
        return Promise.reject(new Error("GRANT_INVALID"));
      return invoke("media_dispatch", { generation });
    },
    stop: () => invoke("media_stop", {}),
    status: () => invoke("media_status", {}),
  });
}

export function safeMediaStatus(raw) {
  if (
    !raw ||
    !nativePhases.has(raw.phase) ||
    !Number.isSafeInteger(raw.generation) ||
    raw.generation < 0 ||
    !(
      raw.session_id === null ||
      (typeof raw.session_id === "string" && uuid.test(raw.session_id))
    ) ||
    !(
      raw.error === null ||
      (typeof raw.error === "string" && /^[A-Z][A-Z0-9_]{0,63}$/u.test(raw.error))
    ) ||
    !endStates.has(raw.end_state)
  )
    throw new Error("STATUS_INVALID");
  // Native error codes are deliberately not reflected. They are not UI copy.
  return {
    phase: raw.phase,
    generation: raw.generation,
    end_state: raw.end_state,
    error:
      raw.error === null
        ? null
        : raw.error === "MEDIA_CONFIG_MISSING"
          ? "CONFIG_MISSING"
          : "MEDIA_UNAVAILABLE",
  };
}

function completed(status) {
  return (
    status &&
    ["stopped", "idle", "failed"].includes(status.phase) &&
    ["ended", "not_needed"].includes(status.end_state)
  );
}

function unconfigured(status) {
  return (
    status?.phase === "unconfigured" &&
    status.end_state === "not_needed" &&
    [null, "CONFIG_MISSING"].includes(status.error)
  );
}

function validGrant(grant, now, authExpiry) {
  if (
    !Number.isFinite(now) ||
    !grant ||
    Object.keys(grant).sort().join(",") !== "expires_at,generation,session_id,token,ws_url" ||
    !Number.isSafeInteger(grant.generation) ||
    grant.generation <= 0 ||
    typeof grant.session_id !== "string" ||
    !uuid.test(grant.session_id) ||
    typeof grant.token !== "string" ||
    !grant.token ||
    grant.token.length > 32768 ||
    typeof grant.ws_url !== "string" ||
    grant.ws_url.length > 4096 ||
    !Number.isSafeInteger(grant.expires_at) ||
    grant.expires_at * 1000 <= now ||
    grant.expires_at > authExpiry
  )
    throw new Error("GRANT_INVALID");
  const url = new URL(grant.ws_url);
  if (url.protocol !== "wss:" || url.username || url.password || url.hash)
    throw new Error("GRANT_INVALID");
}

export function createMediaController({
  bridge,
  adapter,
  clock = { now: () => Date.now() },
  timers = globalThis,
  cleanupTimeoutMs = 10000,
}) {
  if (!Number.isFinite(cleanupTimeoutMs) || cleanupTimeoutMs <= 0)
    throw new Error("MEDIA_UNAVAILABLE");
  let state = Object.freeze({ phase: "idle", error: null, end_state: "not_needed" });
  let auth = { authenticated: false, expires_at: 0, revision: null };
  let operation = null;
  let disposed = false;
  let authTimer;
  let revision = 0;
  let visible = true;
  let online = true;
  const listeners = new Set();
  const snapshot = () =>
    Object.freeze({
      ...state,
      can_start:
        !disposed &&
        !operation &&
        terminalPhases.has(state.phase) &&
        authValid() &&
        visible &&
        online,
      can_stop: !disposed && (!!operation || state.phase === "blocked"),
      can_retry_playback:
        !disposed && !!operation && !operation.cancelled && state.phase === "playback_blocked",
    });
  const live = (op) => !disposed && operation === op && !op.cancelled;
  function emit(phase, error = null, end_state = state.end_state) {
    state = Object.freeze({ phase, error: error === null ? null : safeError(error), end_state });
    for (const listener of listeners) {
      try {
        listener(snapshot());
      } catch {
        /* A view cannot interrupt resource cleanup. */
      }
    }
  }
  function scheduleExpiry(expiresAt, callback) {
    return timers.setTimeout(
      callback,
      Math.min(2147483647, Math.max(0, expiresAt * 1000 - clock.now())),
    );
  }
  function authValid() {
    return (
      auth.authenticated && Number.isFinite(clock.now()) && auth.expires_at * 1000 > clock.now()
    );
  }
  function current(op) {
    if (!live(op)) return false;
    if (!authValid() || (op.expiresAt !== undefined && op.expiresAt * 1000 <= clock.now())) {
      void stop("AUTH_EXPIRED");
      return false;
    }
    return true;
  }
  function armAuth() {
    timers.clearTimeout(authTimer);
    if (!auth.authenticated || disposed) return;
    authTimer = scheduleExpiry(auth.expires_at, () => {
      if (!authValid()) setAuthState({ authenticated: false }, "AUTH_EXPIRED");
      else armAuth();
    });
  }
  function setAuthState(value, reason = "AUTH_REQUIRED") {
    if (disposed) return;
    const next = {
      authenticated:
        value?.authenticated === true &&
        Number.isSafeInteger(value.expires_at) &&
        value.expires_at * 1000 > clock.now(),
      expires_at: Number.isSafeInteger(value?.expires_at) ? value.expires_at : 0,
      revision: Number.isSafeInteger(value?.revision) ? value.revision : null,
    };
    const changed = auth.revision !== next.revision;
    auth = next;
    armAuth();
    if (operation && !operation.cancelled && (!authValid() || changed)) void stop(reason);
    else emit(state.phase, state.error, state.end_state);
  }
  function bounded(promise) {
    let timer;
    return Promise.race([
      Promise.resolve(promise),
      new Promise((_, reject) => {
        timer = timers.setTimeout(() => reject(new Error("CLEANUP_FAILED")), cleanupTimeoutMs);
      }),
    ]).finally(() => timers.clearTimeout(timer));
  }
  // Synchronous section: invalidate callbacks, stop tracks and initiate native stop.
  // All network/SDK promises are joined only after these actions have happened.
  function stop(reason = null) {
    if (disposed || operation?.cancelling)
      return operation?.stopping ?? Promise.resolve(snapshot());
    const op = operation ?? { cancelled: true, resource: null, work: Promise.resolve() };
    operation = op;
    revision++;
    if (!Object.hasOwn(op, "reason")) op.reason = reason;
    op.cancelling = true;
    op.cancelled = true;
    op.cleanupFailed = false;
    timers.clearTimeout(op.expiryTimer);
    op.grant = null;
    emit("stopping", reason, "pending");
    let local;
    try {
      local = op.resource?.dispose();
    } catch {
      op.cleanupFailed = true;
    }
    let remote;
    // A pending stop receipt is not a failure. The next explicit stop-button click
    // verifies status, without queueing another end request or polling indefinitely.
    try {
      remote = op.verifyOnly ? bridge.status() : bridge.stop();
    } catch {
      remote = Promise.reject(new Error("END_UNCONFIRMED"));
    }
    op.stopping = (async () => {
      const results = await Promise.allSettled([bounded(local), bounded(op.work), bounded(remote)]);
      if (operation !== op) return snapshot();
      let native;
      try {
        if (results[2].status === "fulfilled") native = safeMediaStatus(results[2].value);
      } catch {
        /* Invalid native receipts cannot authorize another start. */
      }
      const localFailed =
        op.cleanupFailed || results[0].status === "rejected" || results[1].status === "rejected";
      // phase/end_state are authoritative for completion. A sanitized error on an
      // ended receipt may be a historical cancellation reason, not unfinished cleanup.
      const ended = completed(native) || unconfigured(native);
      const pending = native?.phase === "stopping" && native.end_state === "pending";
      op.stopping = null;
      op.cancelling = false;
      op.verifyOnly = pending;
      if (localFailed || (!ended && !pending)) {
        emit(
          "blocked",
          localFailed ? "CLEANUP_FAILED" : "END_UNCONFIRMED",
          native?.end_state ?? "unknown",
        );
      } else if (pending) {
        emit("stopping", null, "pending");
      } else {
        operation = null;
        if (unconfigured(native)) emit("unconfigured", native.error, native.end_state);
        else if (native.phase === "failed")
          emit("failed", op.reason ?? native.error ?? "MEDIA_UNAVAILABLE", native.end_state);
        else emit(op.reason === null ? "stopped" : "failed", op.reason, native.end_state);
      }
      return snapshot();
    })();
    return op.stopping;
  }
  function onEvent(op, event) {
    if (event === "cleanup_failed" && operation === op) {
      op.cleanupFailed = true;
      if (live(op)) void stop("CLEANUP_FAILED");
      return;
    }
    if (!current(op)) return;
    if (["disconnected", "reconnecting", "input_ended"].includes(event)) {
      void stop(event === "input_ended" ? "INPUT_ENDED" : "DISCONNECTED");
    } else if (event === "playback_blocked") {
      op.playback = "blocked";
      if (op.dispatched) emit("playback_blocked", "PLAYBACK_BLOCKED");
    } else if (event === "audio_playing" || event === "audio_removed") {
      op.playback = event === "audio_playing" ? "playing" : "waiting";
      if (op.dispatched) emit(op.playback === "playing" ? "audio" : "waiting");
    }
  }
  async function run(op) {
    let stage = "PREPARE_FAILED";
    try {
      let grant = await bridge.prepare();
      if (!current(op)) return;
      validGrant(grant, clock.now(), auth.expires_at);
      op.grant = grant;
      const generation = grant.generation;
      const expiresAt = grant.expires_at;
      op.expiresAt = expiresAt;
      grant = null;
      const checkExpiry = () => {
        if (!live(op)) return;
        if (expiresAt * 1000 <= clock.now()) void stop("AUTH_EXPIRED");
        else op.expiryTimer = scheduleExpiry(expiresAt, checkExpiry);
      };
      op.expiryTimer = scheduleExpiry(expiresAt, checkExpiry);
      op.resource = adapter.create({ onEvent: (event) => onEvent(op, event) });
      stage = "INPUT_FAILED";
      emit("permission");
      if (!current(op)) return;
      await op.resource.acquire();
      if (!current(op)) return;
      stage = "CONNECT_FAILED";
      emit("connecting");
      if (!current(op)) return;
      const connecting = op.resource.connect(op.grant);
      op.grant = null;
      await connecting;
      if (!current(op)) return;
      stage = "PUBLISH_FAILED";
      emit("publishing");
      if (!current(op)) return;
      await op.resource.publish();
      if (!current(op)) return;
      stage = "DISPATCH_FAILED";
      emit("dispatching");
      if (!current(op)) return;
      const receipt = safeMediaStatus(await bridge.dispatch(generation));
      if (!current(op)) return;
      if (receipt.phase !== "active" || receipt.generation !== generation || receipt.error)
        throw new Error("DISPATCH_FAILED");
      op.dispatched = true;
      emit(
        op.playback === "blocked"
          ? "playback_blocked"
          : op.playback === "playing"
            ? "audio"
            : "waiting",
        op.playback === "blocked" ? "PLAYBACK_BLOCKED" : null,
      );
    } catch (error) {
      if (live(op))
        void stop(
          stage === "INPUT_FAILED" && error?.name === "NotAllowedError"
            ? "PERMISSION_DENIED"
            : stage,
        );
    } finally {
      op.grant = null;
    }
  }
  function start() {
    if (disposed || operation || !terminalPhases.has(state.phase))
      return Promise.resolve(snapshot());
    if (!authValid()) {
      emit("failed", "AUTH_REQUIRED");
      return Promise.resolve(snapshot());
    }
    if (!visible || !online) {
      emit("failed", !visible ? "HIDDEN" : "OFFLINE");
      return Promise.resolve(snapshot());
    }
    const op = {
      cancelled: false,
      resource: null,
      cleanupFailed: false,
      playback: "waiting",
      dispatched: false,
      stopping: null,
      grant: null,
    };
    operation = op;
    revision++;
    emit("preparing", null, "not_needed");
    // Defer so stop() always sees the full work promise, even for synchronous throws.
    op.work = Promise.resolve().then(() => (live(op) ? run(op) : undefined));
    return op.work.then(snapshot);
  }
  async function retryPlayback() {
    const op = operation;
    if (!op || !current(op) || !op.dispatched || state.phase !== "playback_blocked") return;
    try {
      await op.resource.retryPlayback();
    } catch {
      if (live(op)) emit("playback_blocked", "PLAYBACK_BLOCKED");
    }
  }
  async function refresh() {
    if (disposed || operation) return snapshot();
    const current = revision;
    try {
      const value = safeMediaStatus(await bridge.status());
      if (!disposed && !operation && current === revision) {
        if (completed(value) || unconfigured(value))
          emit(
            value.phase,
            unconfigured(value) || value.phase === "failed" ? value.error : null,
            value.end_state,
          );
        else emit("blocked", "END_UNCONFIRMED", value.end_state);
      }
    } catch {
      if (!disposed && !operation && current === revision)
        emit("blocked", "STATUS_INVALID", "unknown");
    }
    return snapshot();
  }
  function lifecycle(event) {
    if (disposed) return Promise.resolve(snapshot());
    if (event === "hidden" || event === "pagehide") visible = false;
    if (event === "visible") visible = true;
    if (event === "offline") online = false;
    if (event === "online") online = true;
    if (operation && !operation.cancelled && ["offline", "hidden", "pagehide"].includes(event))
      return stop(event.toUpperCase());
    emit(state.phase, state.error, state.end_state);
    return Promise.resolve(snapshot());
  }
  function dispose() {
    if (disposed) return operation?.stopping ?? Promise.resolve(snapshot());
    const result = operation ? stop("PAGEHIDE") : Promise.resolve(snapshot());
    disposed = true;
    timers.clearTimeout(authTimer);
    listeners.clear();
    return result;
  }
  return Object.freeze({
    snapshot,
    start,
    stop,
    retryPlayback,
    refresh,
    setAuthState,
    lifecycle,
    dispose,
    subscribe(listener) {
      if (disposed) return () => {};
      listeners.add(listener);
      listener(snapshot());
      return () => listeners.delete(listener);
    },
  });
}
