import test from "node:test";
import assert from "node:assert/strict";
import { createLiveKitMediaAdapter } from "../web/livekit-media.mjs";
import { createMediaController } from "../web/media-controller.mjs";

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const flush = async () => {
  for (let i = 0; i < 35; i++) await Promise.resolve();
};
// Event names are the 2.17.2 declaration snapshot, not imported from the adapter.
const RoomEvent = {
  Reconnecting: "reconnecting",
  SignalReconnecting: "signalReconnecting",
  Disconnected: "disconnected",
  TrackSubscribed: "trackSubscribed",
  TrackUnsubscribed: "trackUnsubscribed",
  AudioPlaybackStatusChanged: "audioPlaybackChanged",
};
const grant = {
  generation: 1,
  session_id: "11111111-1111-4111-8111-111111111111",
  token: "private-room-token",
  ws_url: "wss://media.example.test",
  expires_at: 200,
};
const status = (phase = "stopped") => ({
  phase,
  generation: 1,
  session_id: null,
  error: null,
  end_state: phase === "active" ? "not_needed" : "ended",
});

function fixture(hooks = {}) {
  const calls = [];
  const rooms = [];
  const events = [];
  const elements = new Set();
  const rawHandlers = new Map();
  const local = {
    mediaStreamTrack: {
      readyState: "live",
      stop() {
        calls.push("raw-stop");
        this.readyState = "ended";
        hooks.rawStop?.();
      },
      addEventListener(event, fn) {
        rawHandlers.set(event, fn);
      },
      removeEventListener(event, fn) {
        if (rawHandlers.get(event) === fn) rawHandlers.delete(event);
      },
    },
    stop() {
      calls.push("sdk-stop");
      hooks.trackStop?.();
    },
  };
  const sdk = {
    RoomEvent,
    setLogLevel(level) {
      calls.push(["log-level", level]);
    },
    createLocalAudioTrack(options) {
      calls.push(["capture", options]);
      return hooks.capture?.() ?? Promise.resolve(local);
    },
    Room: class {
      constructor(options) {
        this.options = options;
        this.handlers = new Map();
        this.canPlaybackAudio = true;
        this.localParticipant = {
          publishTrack: (track, config) => {
            calls.push(["publish", track, config]);
            return hooks.publish?.() ?? Promise.resolve();
          },
        };
        rooms.push(this);
      }
      on(event, fn) {
        this.handlers.set(event, fn);
      }
      off(event, fn) {
        if (this.handlers.get(event) === fn) this.handlers.delete(event);
      }
      emit(event, ...args) {
        this.handlers.get(event)?.(...args);
      }
      connect(url, token, options) {
        calls.push(["connect", url, token, options]);
        return hooks.connect?.() ?? Promise.resolve();
      }
      disconnect(stopTracks) {
        calls.push(["disconnect", stopTracks]);
        return hooks.disconnect?.() ?? Promise.resolve();
      }
      startAudio() {
        calls.push("start-audio");
        return hooks.startAudio?.() ?? Promise.resolve();
      }
    },
  };
  const audioRoot = {
    appendChild(element) {
      elements.add(element);
    },
  };
  const adapter = createLiveKitMediaAdapter({ sdk, audioRoot, maxRemoteTracks: 2 });
  function remote({ kind = "audio", play = () => Promise.resolve(), detach } = {}) {
    const element = {
      autoplay: true,
      srcObject: {},
      controls: true,
      setAttribute(...args) {
        calls.push(["attribute", ...args]);
      },
      play() {
        calls.push("play");
        return play();
      },
      pause() {
        calls.push("pause");
      },
      remove() {
        calls.push("remove");
        elements.delete(element);
      },
    };
    const track = {
      kind,
      attach() {
        calls.push("attach");
        return element;
      },
      detach(arg) {
        assert.equal(arg, element);
        calls.push("detach");
        detach?.();
      },
    };
    return { track, element };
  }
  return {
    sdk,
    audioRoot,
    adapter,
    calls,
    rooms,
    local,
    events,
    elements,
    rawHandlers,
    remote,
    create: () => adapter.create({ onEvent: (event) => events.push(event) }),
  };
}

test("no SDK means unavailable, never a production simulator", () => {
  for (const sdk of [undefined, {}, { Room() {}, RoomEvent }])
    assert.throws(() => createLiveKitMediaAdapter({ sdk, audioRoot: { appendChild() {} } }));
});

test("real API shape: silent logs, no reconnect, initial retries zero, explicit capture/publish", async () => {
  const f = fixture(),
    resource = f.create();
  assert.equal(
    f.calls.some((call) => Array.isArray(call) && call[0] === "capture"),
    false,
  );
  assert.deepEqual(f.calls[0], ["log-level", "silent"]);
  assert.equal(f.rooms[0].options.reconnectPolicy.nextRetryDelayInMs({ retryCount: 0 }), null);
  assert.equal(f.rooms[0].options.disconnectOnPageLeave, false);
  await resource.acquire();
  await resource.connect(grant);
  await resource.publish();
  assert.deepEqual(
    f.calls.find((call) => Array.isArray(call) && call[0] === "connect"),
    ["connect", grant.ws_url, grant.token, { autoSubscribe: true, maxRetries: 0 }],
  );
  assert.deepEqual(
    f.calls.find((call) => Array.isArray(call) && call[0] === "publish"),
    ["publish", f.local, { source: "microphone" }],
  );
  assert.deepEqual(f.events, []); // A connected/published microphone is not remote audio.
  const ending = resource.dispose();
  assert.equal(f.local.mediaStreamTrack.readyState, "ended");
  assert.equal(f.rawHandlers.size, 0);
  assert.equal(f.rooms[0].handlers.size, 0);
  await ending;
  await assert.rejects(resource.acquire());
  await assert.rejects(resource.connect(grant));
  await assert.rejects(resource.publish());
});

test("late permission track is stopped even after dispose and never reaches the room", async () => {
  const capture = deferred();
  const f = fixture({ capture: () => capture.promise });
  const resource = f.create(),
    acquiring = resource.acquire();
  const ending = resource.dispose();
  capture.resolve(f.local);
  await acquiring;
  await ending;
  assert.equal(f.local.mediaStreamTrack.readyState, "ended");
  assert.ok(f.calls.includes("raw-stop"));
  assert.ok(f.calls.includes("sdk-stop"));
  assert.equal(
    f.calls.some((v) => Array.isArray(v) && ["connect", "publish"].includes(v[0])),
    false,
  );
});

for (const rejects of [false, true]) {
  test(`late connect ${rejects ? "rejects" : "resolves"}: disconnect again, never publish`, async () => {
    const connect = deferred();
    const f = fixture({ connect: () => connect.promise });
    const resource = f.create();
    await resource.acquire();
    const connecting = resource.connect(grant);
    const outcome = connecting.catch(() => {});
    const ending = resource.dispose();
    assert.equal(f.local.mediaStreamTrack.readyState, "ended");
    if (rejects) connect.reject(new Error("private URL response"));
    else connect.resolve();
    await outcome;
    await ending;
    assert.equal(f.calls.filter((v) => Array.isArray(v) && v[0] === "disconnect").length, 2);
    assert.equal(
      f.calls.some((v) => Array.isArray(v) && v[0] === "publish"),
      false,
    );
    assert.equal(f.rooms[0].handlers.size, 0);
  });
}

test("late publication resolution is disconnected again without restarting the track", async () => {
  const publish = deferred();
  const f = fixture({ publish: () => publish.promise });
  const resource = f.create();
  await resource.acquire();
  await resource.connect(grant);
  const publishing = resource.publish();
  const ending = resource.dispose();
  assert.equal(f.local.mediaStreamTrack.readyState, "ended");
  publish.resolve();
  await publishing;
  await ending;
  assert.equal(f.calls.filter((v) => Array.isArray(v) && v[0] === "disconnect").length, 2);
  assert.equal(f.calls.filter((v) => Array.isArray(v) && v[0] === "capture").length, 1);
});

test("audio attach/play failure, explicit startAudio retry, unsubscribe and DOM release", async () => {
  let blocked = true;
  const f = fixture(),
    resource = f.create();
  const { track, element } = f.remote({
    play: () => (blocked ? Promise.reject(new Error("private")) : Promise.resolve()),
  });
  f.rooms[0].emit("trackSubscribed", track);
  await flush();
  assert.equal(element.autoplay, false);
  assert.equal(element.controls, false);
  assert.equal(f.elements.size, 1);
  assert.deepEqual(f.events, ["playback_blocked"]);
  assert.equal(f.calls.includes("start-audio"), false);
  blocked = false;
  const retrying = resource.retryPlayback();
  assert.equal(f.calls.includes("start-audio"), true); // Synchronous user gesture path.
  await retrying;
  assert.equal(f.events.at(-1), "audio_playing");
  f.rooms[0].emit("trackUnsubscribed", track);
  assert.equal(f.events.at(-1), "audio_removed");
  assert.equal(f.elements.size, 0);
  assert.equal(element.srcObject, null);
  await resource.dispose();
});

test("late play result and saved subscribe/unsubscribe callbacks cannot attach or report audio", async () => {
  for (const reject of [false, true]) {
    const playing = deferred();
    const f = fixture(),
      resource = f.create();
    const oldSubscribe = f.rooms[0].handlers.get("trackSubscribed");
    const oldUnsubscribe = f.rooms[0].handlers.get("trackUnsubscribed");
    const { track } = f.remote({ play: () => playing.promise });
    oldSubscribe(track);
    await resource.dispose();
    if (reject) playing.reject(new Error("private"));
    else playing.resolve();
    oldSubscribe(f.remote().track);
    oldUnsubscribe(track);
    await flush();
    assert.deepEqual(f.events, []);
    assert.equal(f.elements.size, 0);
    assert.equal(f.calls.filter((v) => v === "attach").length, 1);
  }
});

test("video ignored, duplicate tracks bounded, excess audio requests safe termination", async () => {
  const f = fixture(),
    resource = f.create(),
    first = f.remote().track;
  f.rooms[0].emit("trackSubscribed", f.remote({ kind: "video" }).track);
  assert.equal(f.elements.size, 0);
  f.rooms[0].emit("trackSubscribed", first);
  f.rooms[0].emit("trackSubscribed", first);
  f.rooms[0].emit("trackSubscribed", f.remote().track);
  f.rooms[0].emit("trackSubscribed", f.remote().track);
  assert.equal(f.elements.size, 2);
  assert.equal(f.events.at(-1), "disconnected");
  await resource.dispose();
  assert.equal(f.elements.size, 0);
});

test("track cleanup tries browser and SDK paths, and still disconnects/detaches when either fails", async () => {
  let fail = true;
  const f = fixture({
    rawStop: () => {
      if (fail) throw new Error("private");
    },
  });
  const resource = f.create();
  await resource.acquire();
  const { track } = f.remote();
  f.rooms[0].emit("trackSubscribed", track);
  await flush();
  const ending = resource.dispose();
  assert.ok(f.calls.includes("sdk-stop"));
  assert.equal(f.elements.size, 0);
  assert.ok(f.calls.some((v) => Array.isArray(v) && v[0] === "disconnect"));
  await assert.rejects(ending, /CLEANUP_FAILED/u);
  assert.ok(f.events.includes("cleanup_failed"));
  fail = false;
  await resource.dispose();
});

test("late permission cleanup failure and disconnect rejection are observable", async () => {
  const capture = deferred();
  const f = fixture({
    capture: () => capture.promise,
    trackStop: () => {
      throw new Error("private");
    },
  });
  const resource = f.create(),
    acquiring = resource.acquire();
  const acquiringResult = acquiring.catch(() => {});
  const ending = resource.dispose();
  capture.resolve(f.local);
  await acquiringResult;
  await assert.rejects(ending, /CLEANUP_FAILED/u);
  assert.ok(f.events.includes("cleanup_failed"));
  const bad = fixture({ disconnect: () => Promise.reject(new Error("private room URL")) });
  await assert.rejects(bad.create().dispose(), /CLEANUP_FAILED/u);
  assert.deepEqual(bad.events, ["cleanup_failed"]);
});

test("SDK startAudio rejection is safe and never manufactures playback success", async () => {
  const f = fixture({ startAudio: () => Promise.reject(new Error("private")) });
  const resource = f.create();
  await resource.retryPlayback();
  assert.deepEqual(f.events, ["playback_blocked"]);
  await resource.dispose();
});

test("a stop method returning without ending the browser track is cleanup failure", async () => {
  const f = fixture(),
    resource = f.create();
  await resource.acquire();
  f.local.mediaStreamTrack.stop = () => {}; // A broken platform path must not look ready.
  await assert.rejects(resource.dispose(), /CLEANUP_FAILED/u);
  assert.ok(f.events.includes("cleanup_failed"));
  f.local.mediaStreamTrack.stop = function () {
    this.readyState = "ended";
  };
  await resource.dispose();
});

test("detach failure still clears DOM and must be explicitly retried before clean disposal", async () => {
  let fail = true;
  const f = fixture(),
    resource = f.create();
  const { track, element } = f.remote({
    detach: () => {
      if (fail) throw new Error("private");
    },
  });
  f.rooms[0].emit("trackSubscribed", track);
  await flush();
  await assert.rejects(resource.dispose(), /CLEANUP_FAILED/u);
  assert.equal(element.srcObject, null);
  assert.equal(f.elements.size, 0);
  fail = false;
  await resource.dispose();
});

test("cancel during explicit playback retry cannot play detached audio or affect a newer Room", async () => {
  const startAudio = deferred();
  const f = fixture({ startAudio: () => startAudio.promise }),
    resource = f.create();
  const { track } = f.remote({ play: () => Promise.reject(new Error("denied")) });
  f.rooms[0].emit("trackSubscribed", track);
  await flush();
  const retry = resource.retryPlayback();
  await resource.dispose();
  const before = f.calls.filter((value) => value === "play").length;
  const next = f.create();
  startAudio.resolve();
  await retry;
  await flush();
  assert.equal(f.calls.filter((value) => value === "play").length, before);
  assert.equal(f.elements.size, 0);
  assert.equal(f.rooms.length, 2);
  await next.dispose();
});

for (const event of ["signalReconnecting", "reconnecting", "disconnected"]) {
  test(`controller + SDK ${event}: synchronous stop, no recapture, old Room cannot stop new Room`, async () => {
    const f = fixture();
    const timers = { setTimeout: () => 1, clearTimeout() {} };
    let generation = 0;
    const bridge = {
      prepare: () => Promise.resolve({ ...grant, generation: ++generation }),
      dispatch: (gen) => Promise.resolve({ ...status("active"), generation: gen }),
      stop: () => Promise.resolve(status()),
      status: () => Promise.resolve(status("idle")),
    };
    const controller = createMediaController({
      bridge,
      adapter: f.adapter,
      timers,
      clock: { now: () => 100000 },
    });
    controller.setAuthState({ authenticated: true, expires_at: 300 });
    await controller.start();
    const old = f.rooms[0].handlers.get(event);
    old();
    assert.equal(f.local.mediaStreamTrack.readyState, "ended");
    assert.equal(controller.snapshot().phase, "stopping");
    await flush();
    assert.equal(controller.snapshot().phase, "failed");
    assert.equal(f.rooms.length, 1);
    // A new user gesture creates a different track and Room. No SDK auto restart is used.
    f.local.mediaStreamTrack.readyState = "live";
    await controller.start();
    assert.equal(f.rooms.length, 2);
    old();
    assert.equal(controller.snapshot().phase, "waiting");
    assert.equal(f.local.mediaStreamTrack.readyState, "live");
    await controller.dispose();
  });
}

test("microphone ended and SDK audio playback state are relayed without exception bodies", async () => {
  const f = fixture(),
    resource = f.create();
  await resource.acquire();
  f.rawHandlers.get("ended")();
  f.rooms[0].canPlaybackAudio = false;
  f.rooms[0].emit("audioPlaybackChanged", "secret");
  assert.deepEqual(f.events, ["input_ended", "playback_blocked"]);
  await resource.dispose();
});
