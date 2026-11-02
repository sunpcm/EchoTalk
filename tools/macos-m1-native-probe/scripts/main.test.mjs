import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { mountProbe } from "../web/main.mjs";
import { verifiedSdk } from "../web/sdk.mjs";

const flush = async () => {
  for (let i = 0; i < 80; i++) await Promise.resolve();
};
const authState = (authenticated = true) => ({
  phase: authenticated ? "authenticated" : "cancelled",
  authenticated,
  expires_at: authenticated ? 4102444800 : null,
  error: null,
});
const nativeState = (phase = "idle", end_state = "not_needed", error = null) => ({
  phase,
  end_state,
  error,
  generation: 1,
  session_id: null,
});
const deferred = () => {
  let resolve;
  const promise = new Promise((ok) => (resolve = ok));
  return { promise, resolve };
};
class Target {
  handlers = new Map();
  disabled = true;
  textContent = "";
  addEventListener(name, fn) {
    if (!this.handlers.has(name)) this.handlers.set(name, new Set());
    this.handlers.get(name).add(fn);
  }
  removeEventListener(name, fn) {
    this.handlers.get(name)?.delete(fn);
  }
  fire(name) {
    let result;
    for (const fn of [...(this.handlers.get(name) ?? [])]) result = fn();
    return result;
  }
  click() {
    return this.fire("click");
  }
}
function fixture({ configured = true, sdkVersion = "2.17.2", onInvoke } = {}) {
  const calls = [],
    rooms = [],
    tracks = [],
    timers = new Map();
  let timerId = 0;
  const ids = [
    "auth-status",
    "auth-detail",
    "login",
    "cancel",
    "media-status",
    "media-detail",
    "media-start",
    "media-stop",
    "media-play",
    "media-audio-root",
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, new Target()]));
  elements["media-audio-root"].appendChild = () => {};
  const document = new Target();
  document.visibilityState = "visible";
  document.getElementById = (id) => elements[id];
  class Room {
    events = new Map();
    localParticipant = {
      publishTrack: async () => {
        calls.push("publish");
      },
    };
    constructor(options) {
      this.options = options;
      rooms.push(this);
    }
    on(event, fn) {
      this.events.set(event, fn);
    }
    off(event, fn) {
      if (this.events.get(event) === fn) this.events.delete(event);
    }
    async connect() {
      calls.push("connect");
    }
    async disconnect() {
      calls.push("disconnect");
    }
    startAudio() {
      calls.push("startAudio");
      return Promise.resolve();
    }
  }
  const sdk = {
    version: sdkVersion,
    Room,
    RoomEvent: Object.fromEntries(
      [
        "Disconnected",
        "Reconnecting",
        "SignalReconnecting",
        "TrackSubscribed",
        "TrackUnsubscribed",
        "AudioPlaybackStatusChanged",
      ].map((x) => [x, x]),
    ),
    setLogLevel: () => {},
    createLocalAudioTrack: async () => {
      calls.push("microphone");
      const mediaStreamTrack = new Target();
      mediaStreamTrack.readyState = "live";
      mediaStreamTrack.stop = () => {
        mediaStreamTrack.readyState = "ended";
        calls.push("track-stop");
      };
      const track = { mediaStreamTrack, stop: () => mediaStreamTrack.stop() };
      tracks.push(track);
      return track;
    },
  };
  const window = new Target();
  window.navigator = { onLine: true };
  window.LivekitClient = sdk;
  const invoke = (command, args) => {
    calls.push(command);
    const overridden = onInvoke?.(command, args, { calls, rooms, tracks });
    if (overridden !== undefined) return overridden;
    if (command.startsWith("auth_")) return Promise.resolve(authState(command === "auth_status"));
    if (command === "media_prepare")
      return Promise.resolve({
        generation: 1,
        session_id: "12345678-1234-4234-8234-123456789abc",
        token: "synthetic-room-token",
        ws_url: "wss://media.example.test",
        expires_at: 4102444700,
      });
    if (command === "media_dispatch") return Promise.resolve(nativeState("active", "pending"));
    if (command === "media_stop") return Promise.resolve(nativeState("stopped", "ended"));
    return Promise.resolve(
      configured
        ? nativeState()
        : nativeState("unconfigured", "not_needed", "MEDIA_CONFIG_MISSING"),
    );
  };
  window.__TAURI__ = { core: { invoke } };
  const timerAPI = {
    setTimeout(fn, ms) {
      const id = ++timerId;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  };
  const dispose = mountProbe({ document, window, timers: timerAPI });
  return {
    elements,
    document,
    window,
    calls,
    rooms,
    tracks,
    timers,
    dispose,
    sdk,
    async poll() {
      const poll = [...timers.values()].find((x) => x.ms === 750);
      assert.ok(poll);
      await poll.fn();
      await flush();
    },
  };
}

test("actual entry displays unconfigured media without Room construction or microphone access", async () => {
  const f = fixture({ configured: false });
  await flush();
  assert.equal(f.elements["media-start"].disabled, true);
  assert.match(f.elements["media-status"].textContent, /尚未配置/u);
  assert.equal(f.rooms.length, 0);
  assert.equal(f.tracks.length, 0);
  assert.ok(!f.calls.includes("media_prepare"));
  f.dispose();
  await flush();
});

for (const command of ["auth_begin", "auth_cancel"])
  test(`actual entry stops local tracks synchronously BEFORE ${command}`, async () => {
    const f = fixture({
      onInvoke(cmd, args, { tracks, calls }) {
        if (cmd === command) {
          assert.equal(tracks[0].mediaStreamTrack.readyState, "ended");
          assert.ok(calls.indexOf("track-stop") < calls.indexOf(command));
        }
      },
    });
    await flush();
    f.elements["media-start"].click();
    await flush();
    assert.equal(f.tracks.length, 1);
    assert.equal(f.tracks[0].mediaStreamTrack.readyState, "live");
    f.elements[command === "auth_begin" ? "login" : "cancel"].click();
    assert.equal(f.tracks[0].mediaStreamTrack.readyState, "ended");
    await flush();
    f.dispose();
    await flush();
  });

test("ordinary repeated verified Auth subscription preserves the same media session", async () => {
  const f = fixture();
  await flush();
  f.elements["media-start"].click();
  await flush();
  await f.poll();
  await f.poll();
  assert.equal(f.tracks[0].mediaStreamTrack.readyState, "live");
  assert.equal(f.rooms.length, 1);
  assert.equal(f.calls.filter((x) => x === "media_dispatch").length, 1);
  f.dispose();
  await flush();
});

test("late authenticated poll after cancel cannot restore media authorization", async () => {
  const old = deferred();
  let polls = 0;
  const f = fixture({
    onInvoke(command) {
      if (command === "auth_status" && ++polls === 2) return old.promise;
    },
  });
  await flush();
  f.elements["media-start"].click();
  await flush();
  const poll = f.poll();
  await f.elements.cancel.click();
  old.resolve(authState());
  await poll;
  await flush();
  assert.equal(f.elements["media-start"].disabled, true);
  assert.equal(f.tracks[0].mediaStreamTrack.readyState, "ended");
  f.dispose();
  await flush();
});

test("late Auth begin success after newer cancel cannot revive media", async () => {
  const old = deferred();
  const f = fixture({
    onInvoke(command) {
      if (command === "auth_begin") return old.promise;
    },
  });
  await flush();
  const beginning = f.elements.login.click();
  await f.elements.cancel.click();
  old.resolve(authState());
  await beginning;
  await flush();
  assert.equal(f.elements["media-start"].disabled, true);
  assert.equal(f.tracks.length, 0);
  f.dispose();
  await flush();
});

test("pagehide releases audio and all Auth/media subscriptions without starting a new Room", async () => {
  const f = fixture();
  await flush();
  f.elements["media-start"].click();
  await flush();
  f.window.fire("pagehide");
  assert.equal(f.tracks[0].mediaStreamTrack.readyState, "ended");
  await flush();
  assert.equal(f.rooms.length, 1);
  assert.equal(f.elements.login.handlers.get("click").size, 0);
  assert.equal(f.elements["media-start"].handlers.get("click").size, 0);
  f.dispose();
});

test("playback retry reaches actual Room.startAudio synchronously from the entry click", async () => {
  const f = fixture();
  await flush();
  f.elements["media-start"].click();
  await flush();
  let blocked = true;
  const audio = {
    pause() {},
    remove() {},
    play() {
      return blocked ? Promise.reject(new Error("synthetic")) : Promise.resolve();
    },
  };
  const remote = { kind: "audio", attach: () => audio, detach() {} };
  f.rooms[0].events.get("TrackSubscribed")(remote);
  await flush();
  assert.equal(f.elements["media-play"].disabled, false);
  blocked = false;
  f.elements["media-play"].click();
  assert.ok(f.calls.includes("startAudio"));
  await flush();
  f.dispose();
  await flush();
});

test("entry refuses a mismatched SDK version without fake fallback or microphone calls", async () => {
  const f = fixture({ sdkVersion: "2.17.3" });
  await flush();
  assert.match(f.elements["media-status"].textContent, /组件不可用/u);
  assert.equal(f.tracks.length, 0);
  assert.throws(() => verifiedSdk({ version: "2.17.2" }));
  f.dispose();
  await flush();
});

test("the exact installed UMD really exports the locked API/version without creating a Room", () => {
  const bytes = readFileSync(
    new URL("../node_modules/livekit-client/dist/livekit-client.umd.js", import.meta.url),
    "utf8",
  );
  const context = {
    TextEncoder,
    TextDecoder,
    URL,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    console,
  };
  runInNewContext(bytes, context, { timeout: 3000 });
  assert.equal(verifiedSdk(context.LivekitClient).version, "2.17.2");
});

test("a failed/ended native receipt preserves failure copy and permits another explicit start", async () => {
  const f = fixture({
    onInvoke(command) {
      if (command === "media_stop")
        return Promise.resolve(nativeState("failed", "ended", "MEDIA_HTTP_FAILED"));
    },
  });
  await flush();
  f.elements["media-start"].click();
  await flush();
  f.elements["media-stop"].click();
  await flush();
  assert.match(f.elements["media-status"].textContent, /中断/u);
  assert.equal(f.elements["media-start"].disabled, false);
  assert.ok(!f.elements["media-detail"].textContent.includes("MEDIA_HTTP_FAILED"));
  f.elements["media-start"].click();
  await flush();
  assert.equal(f.rooms.length, 2);
  f.dispose();
  await flush();
});

test("refresh of historical failed/ended state is retryable rather than unknown cleanup", async () => {
  const f = fixture({
    onInvoke(command) {
      if (command === "media_status")
        return Promise.resolve(nativeState("failed", "ended", "MEDIA_TOKEN_INVALID"));
    },
  });
  await flush();
  assert.equal(f.elements["media-start"].disabled, false);
  assert.match(f.elements["media-status"].textContent, /中断/u);
  assert.equal(f.tracks.length, 0);
  f.dispose();
  await flush();
});

test("repeated unauthenticated broadcasts and lifecycle events never retry unknown end automatically", async () => {
  let cancelled = false;
  const f = fixture({
    onInvoke(command) {
      if (command === "auth_cancel") {
        cancelled = true;
        return Promise.resolve(authState(false));
      }
      if (command === "auth_status" && cancelled) return Promise.resolve(authState(false));
      if (command === "media_stop")
        return Promise.resolve(nativeState("blocked", "unknown", "MEDIA_END_UNKNOWN"));
    },
  });
  await flush();
  f.elements["media-start"].click();
  await flush();
  await f.elements.cancel.click();
  await flush();
  assert.equal(f.calls.filter((x) => x === "media_stop").length, 1);
  for (let i = 0; i < 3; i++) {
    await f.poll();
    f.window.fire("offline");
    f.document.visibilityState = "hidden";
    f.document.fire("visibilitychange");
    await flush();
  }
  assert.equal(f.calls.filter((x) => x === "media_stop").length, 1);
  assert.equal(f.elements["media-start"].disabled, true);
  assert.equal(f.tracks[0].mediaStreamTrack.readyState, "ended");
  f.elements["media-stop"].click();
  await flush();
  assert.equal(f.calls.filter((x) => x === "media_stop").length, 2);
  f.dispose();
  await flush();
});
