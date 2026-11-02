import test from "node:test";
import assert from "node:assert/strict";
import { createMediaProbe } from "../media.mjs";
import { config, mediaFixture, deferred, until, code } from "./support.mjs";

const action = { intent: "start", userConfirmed: true };
const make = (f) => createMediaProbe(config(), f.ports);

test("explicit start/resume is required; ready and invalid intent have no media side effects", async () => {
  const f = mediaFixture();
  const media = make(f);
  media.ready();
  for (const input of [
    undefined,
    {},
    { intent: "start" },
    { ...action, userConfirmed: false },
    { ...action, intent: "takeover" },
  ]) {
    await assert.rejects(media.start(input), code("USER_ACTION_REQUIRED"));
  }
  assert.deepEqual(f.calls, { prepared: [], microphone: [], connected: [] });
  await media.start({ intent: "resume", userConfirmed: true });
  assert.equal(f.calls.prepared[0].intent, "resume");
  assert.equal(f.calls.prepared[0].apiOrigin, config().apiOrigin);
  media.stop();
});

test("connected path clears temporary token, stop releases mic and connection exactly once", async () => {
  const f = mediaFixture();
  const media = make(f);
  assert.equal(media.getSnapshot().state, "waiting");
  assert.deepEqual(await media.start(action), { status: "connected" });
  const [access, microphone, connection] = f.resources;
  assert.equal(access.token, null);
  assert.equal(access.disposals, 1);
  assert.equal(microphone.disposals, 0);
  assert.equal(connection.disposals, 0);
  assert.equal(f.calls.connected[0].microphone, microphone);
  assert.equal(media.getSnapshot().state, "connected");
  assert.equal(JSON.stringify(media.getSnapshot()).includes("offline-media-token"), false);
  const order = [];
  for (const resource of [microphone, connection]) {
    const dispose = resource.dispose.bind(resource);
    resource.dispose = () => {
      order.push(resource.kind);
      dispose();
    };
  }
  media.stop();
  assert.deepEqual(order, ["microphone", "connection"]);
  assert.deepEqual(
    f.resources.map((r) => r.disposals),
    [1, 1, 1],
  );
  assert.equal(f.calls.connected[0].signal.aborted, true);
  assert.equal(media.getSnapshot().state, "waiting");
  media.stop();
  assert.deepEqual(
    f.resources.map((r) => r.disposals),
    [1, 1, 1],
  );
});

for (const reason of ["offline", "sleep", "inactive", "device_lost", "auth_invalid"]) {
  test(`${reason}: immediately stop local resources; readiness does not reconnect`, async () => {
    const f = mediaFixture();
    const media = make(f);
    await media.start(action);
    media.interrupt(reason);
    assert.equal(f.resources.find((r) => r.kind === "microphone").disposals, 1);
    assert.equal(f.resources.find((r) => r.kind === "connection").disposals, 1);
    assert.deepEqual(media.getSnapshot(), { state: "waiting", reason });
    await assert.rejects(media.start(action), code("MEDIA_UNAVAILABLE"));
    media.ready();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(f.calls.prepared.length, 1);
    assert.equal(f.calls.microphone.length, 1);
    await media.start({ intent: "resume", userConfirmed: true });
    assert.equal(f.calls.microphone.length, 2);
    media.close();
  });
}

test("close immediately releases media and permanently rejects new work", async () => {
  const f = mediaFixture();
  const media = make(f);
  await media.start(action);
  media.close();
  media.ready();
  assert.equal(media.getSnapshot().state, "closed");
  assert.ok(f.resources.every((r) => r.disposals === 1));
  await assert.rejects(media.start(action), code("MEDIA_UNAVAILABLE"));
  assert.equal(f.calls.prepared.length, 1);
});

for (const stage of ["prepare", "acquireMicrophone", "connect"]) {
  test(`cancel while ${stage} pending: late observable resource disposed without stopping new session`, async () => {
    const f = mediaFixture();
    const gate = deferred();
    const original = f.ports[stage];
    let entered = false;
    f.ports[stage] = async () => {
      entered = true;
      return gate.promise;
    };
    const media = make(f);
    const old = assert.rejects(media.start(action), code("MEDIA_CANCELLED"));
    await until(() => entered);
    await assert.rejects(media.start(action), code("MEDIA_BUSY"));
    media.stop();
    for (const resource of f.resources) assert.equal(resource.disposals, 1, resource.kind);
    f.ports[stage] = original;
    await media.start({ intent: "resume", userConfirmed: true });
    const newMic = f.resources.filter((r) => r.kind === "microphone").at(-1);
    const newConnection = f.resources.filter((r) => r.kind === "connection").at(-1);
    const late = f.lease(
      `late-${stage}`,
      stage === "prepare" ? { token: "late-token", wsUrl: "wss://media.example.test" } : {},
    );
    gate.resolve(late);
    await old;
    assert.equal(late.disposals, 1);
    if (stage === "prepare") assert.equal(late.token, null);
    assert.equal(newMic.disposals, 0);
    assert.equal(newConnection.disposals, 0);
    assert.equal(media.getSnapshot().state, "connected");
    assert.equal(f.calls.microphone.length, stage === "connect" ? 2 : 1);
    assert.equal(f.calls.connected.length, 1);
    media.stop();
    assert.equal(newMic.disposals, 1);
    assert.equal(newConnection.disposals, 1);
  });
}

for (const stage of ["prepare", "acquireMicrophone", "connect"]) {
  test(`${stage} failure sanitizes errors and releases acquired resources`, async () => {
    const f = mediaFixture();
    f.ports[stage] = async () => {
      throw new Error("private-token callback-code private-payload");
    };
    const media = make(f);
    await assert.rejects(media.start(action), code("MEDIA_PORT_FAILED"));
    assert.equal(media.getSnapshot().state, "failed");
    assert.ok(f.resources.every((r) => r.disposals === 1));
    assert.equal(f.calls.connected.length, 0);
  });
}

test("reject invalid or unpinned access before microphone; temporary token is erased", async () => {
  for (const patch of [
    { token: "" },
    { wsUrl: "ws://media.example.test/room" },
    { wsUrl: "wss://evil.example.test/room" },
    { wsUrl: "wss://user:offline-password@media.example.test/room" },
    { wsUrl: "wss://media.example.test/room#fragment" },
    { wsUrl: "not a url" },
  ]) {
    const f = mediaFixture();
    const access = f.lease("access", {
      token: "private-temp",
      wsUrl: "wss://media.example.test",
      ...patch,
    });
    f.ports.prepare = async () => access;
    const media = make(f);
    await assert.rejects(media.start(action), code("MEDIA_ACCESS_INVALID"));
    assert.equal(access.token, null);
    assert.equal(access.disposals, 1);
    assert.equal(f.calls.microphone.length, 0);
    assert.equal(f.calls.connected.length, 0);
  }
});

test("late rejection from old connect does not overwrite new connected state", async () => {
  const f = mediaFixture();
  const gate = deferred();
  const connect = f.ports.connect;
  let entered = false;
  f.ports.connect = async () => {
    entered = true;
    return gate.promise;
  };
  const media = make(f);
  const old = assert.rejects(media.start(action), code("MEDIA_PORT_FAILED"));
  await until(() => entered);
  media.interrupt("sleep");
  f.ports.connect = connect;
  media.ready();
  await media.start(action);
  gate.reject(new Error("late private-token"));
  await old;
  assert.equal(media.getSnapshot().state, "connected");
  assert.equal(f.resources.filter((r) => r.kind === "microphone").at(-1).disposals, 0);
  media.close();
});

test("close during pending microphone releases returned track and never connects", async () => {
  const f = mediaFixture();
  const gate = deferred();
  let entered = false;
  f.ports.acquireMicrophone = async () => {
    entered = true;
    return gate.promise;
  };
  const media = make(f);
  const pending = assert.rejects(media.start(action), code("MEDIA_CANCELLED"));
  await until(() => entered);
  media.close();
  const late = f.lease("late-microphone");
  gate.resolve(late);
  await pending;
  assert.equal(late.disposals, 1);
  assert.equal(f.calls.connected.length, 0);
  assert.equal(media.getSnapshot().state, "closed");
});

test("cleanup failure attempts all releases and forbids falsely clean restarts", async () => {
  const f = mediaFixture();
  const media = make(f);
  await media.start(action);
  const mic = f.resources.find((r) => r.kind === "microphone");
  mic.dispose = () => {
    throw new Error("device cleanup failed private-payload");
  };
  media.stop();
  assert.equal(f.resources.find((r) => r.kind === "connection").disposals, 1);
  assert.deepEqual(media.getSnapshot(), { state: "failed", reason: "cleanup_failed" });
  media.ready();
  await assert.rejects(media.start(action), code("MEDIA_UNAVAILABLE"));
});

test("invalid lifecycle event does not unexpectedly stop a healthy session", async () => {
  const f = mediaFixture();
  const media = make(f);
  await media.start(action);
  assert.throws(() => media.interrupt("normal_window_blur"), code("INTERRUPT_INVALID"));
  assert.equal(media.getSnapshot().state, "connected");
  media.stop();
});

test("late old microphone with failed cleanup halts new session and blocks restarts", async () => {
  const f = mediaFixture();
  const gate = deferred();
  const acquire = f.ports.acquireMicrophone;
  let entered = false;
  f.ports.acquireMicrophone = async () => {
    entered = true;
    return gate.promise;
  };
  const media = make(f);
  const old = assert.rejects(media.start(action), code("MEDIA_CANCELLED"));
  await until(() => entered);
  media.stop();
  f.ports.acquireMicrophone = acquire;
  await media.start(action);
  const newMic = f.resources.find((r) => r.kind === "microphone");
  const newConnection = f.resources.find((r) => r.kind === "connection");
  gate.resolve({
    dispose() {
      throw new Error("old mic cannot stop");
    },
  });
  await old;
  assert.equal(newMic.disposals, 1);
  assert.equal(newConnection.disposals, 1);
  assert.deepEqual(media.getSnapshot(), { state: "failed", reason: "cleanup_failed" });
  await assert.rejects(media.start(action), code("MEDIA_UNAVAILABLE"));
});

test("a malformed resource without disposal fails closed and clears earlier access", async () => {
  const f = mediaFixture();
  f.ports.acquireMicrophone = async () => ({ invalidHandle: true });
  const media = make(f);
  await assert.rejects(media.start(action), code("PORT_RESOURCE_INVALID"));
  assert.equal(f.resources[0].token, null);
  assert.equal(f.calls.connected.length, 0);
  assert.deepEqual(media.getSnapshot(), { state: "failed", reason: "cleanup_failed" });
  await assert.rejects(media.start(action), code("MEDIA_UNAVAILABLE"));
});

test("r1 synchronous sleep during access disposal cannot publish or return connected", async () => {
  const f = mediaFixture();
  const access = f.lease("access", {
    token: "offline-temp",
    wsUrl: "wss://media.example.test/room",
  });
  const media = make(f);
  const clear = access.dispose.bind(access);
  access.dispose = () => {
    clear();
    media.interrupt("sleep");
  };
  f.ports.prepare = async () => access;
  await assert.rejects(media.start(action), code("MEDIA_CANCELLED"));
  assert.equal(access.token, null);
  assert.deepEqual(
    f.resources.map((r) => r.disposals),
    [1, 1, 1],
  );
  assert.equal(f.calls.connected[0].signal.aborted, true);
  assert.deepEqual(media.getSnapshot(), { state: "waiting", reason: "sleep" });
  media.close();
});

for (const reason of ["stop", "close"]) {
  test(`r1 synchronous ${reason} during access disposal preserves stopped state`, async () => {
    const f = mediaFixture();
    const media = make(f);
    const access = f.lease("access", {
      token: "offline-temp",
      wsUrl: "wss://media.example.test/room",
    });
    const clear = access.dispose.bind(access);
    access.dispose = () => {
      clear();
      media[reason]();
    };
    f.ports.prepare = async () => access;
    await assert.rejects(media.start(action), code("MEDIA_CANCELLED"));
    assert.equal(access.token, null);
    assert.ok(f.resources.every((r) => r.disposals === 1));
    assert.deepEqual(
      media.getSnapshot(),
      reason === "close"
        ? { state: "closed", reason: "window_closed" }
        : { state: "waiting", reason: "user_stop" },
    );
  });
}

test("r1 replacement started synchronously by access disposer owns its state and resources", async () => {
  const f = mediaFixture();
  const media = make(f);
  const prepare = f.ports.prepare;
  const access = f.lease("access", {
    token: "offline-temp",
    wsUrl: "wss://media.example.test/room",
  });
  const clear = access.dispose.bind(access);
  let replacement;
  f.ports.prepare = async () => {
    f.ports.prepare = prepare;
    return access;
  };
  access.dispose = () => {
    clear();
    media.stop();
    replacement = media.start({ intent: "resume", userConfirmed: true });
  };
  await assert.rejects(media.start(action), code("MEDIA_CANCELLED"));
  await replacement;
  assert.equal(access.disposals, 1);
  assert.equal(media.getSnapshot().state, "connected");
  const microphones = f.resources.filter((r) => r.kind === "microphone");
  const connections = f.resources.filter((r) => r.kind === "connection");
  assert.deepEqual(
    microphones.map((r) => r.disposals),
    [1, 0],
  );
  assert.deepEqual(
    connections.map((r) => r.disposals),
    [1, 0],
  );
  media.stop();
  assert.deepEqual(
    microphones.map((r) => r.disposals),
    [1, 1],
  );
  assert.deepEqual(
    connections.map((r) => r.disposals),
    [1, 1],
  );
});

for (const stage of ["prepare", "acquireMicrophone", "connect"]) {
  test(`r1 interrupt between ${stage} lease adoption and start continuation prevents next effect`, async () => {
    const f = mediaFixture();
    const media = make(f);
    f.ports[stage] = async () => {
      const resource =
        stage === "prepare"
          ? f.lease("access", { token: "offline-temp", wsUrl: "wss://media.example.test/room" })
          : f.lease(stage);
      // First microtask precedes acquire's continuation; second runs after
      // adoption and before start resumes from its await of acquire.
      queueMicrotask(() => queueMicrotask(() => media.interrupt("sleep")));
      return resource;
    };
    await assert.rejects(media.start(action), code("MEDIA_CANCELLED"));
    assert.deepEqual(media.getSnapshot(), { state: "waiting", reason: "sleep" });
    assert.ok(f.resources.every((r) => r.disposals === 1));
    if (stage === "prepare") assert.equal(f.calls.microphone.length, 0);
    assert.equal(f.calls.connected.length, 0, "no downstream connect or false connected");
  });
}

for (const failure of [false, true]) {
  test(`r1 ${failure ? "failed start" : "stop"} release cannot overwrite a synchronously started replacement`, async () => {
    const f = mediaFixture();
    const media = make(f);
    const connect = f.ports.connect;
    const prepare = f.ports.prepare;
    const gate = deferred();
    let replacement;
    let microphone;
    const acquire = f.ports.acquireMicrophone;
    f.ports.acquireMicrophone = async (request) => {
      f.ports.acquireMicrophone = acquire;
      microphone = await acquire(request);
      const dispose = microphone.dispose.bind(microphone);
      microphone.dispose = () => {
        dispose();
        f.ports.connect = connect;
        f.ports.prepare = async (request) => {
          const access = await prepare(request);
          await gate.promise;
          return access;
        };
        replacement = media.start({ intent: "resume", userConfirmed: true });
      };
      return microphone;
    };
    if (failure) {
      f.ports.connect = async () => {
        throw new Error("offline connect failed");
      };
      await assert.rejects(media.start(action), code("MEDIA_PORT_FAILED"));
    } else {
      await media.start(action);
      media.stop();
    }
    try {
      assert.equal(microphone.disposals, 1);
      assert.equal(
        media.getSnapshot().state,
        "connecting",
        "old teardown does not publish over replacement",
      );
    } finally {
      gate.resolve();
    }
    await replacement;
    assert.equal(media.getSnapshot().state, "connected");
    assert.equal(f.resources.filter((r) => r.kind === "microphone").at(-1).disposals, 0);
    media.close();
  });
}

test("r1 throwing final access disposal clears other leases and blocks further starts", async () => {
  const f = mediaFixture();
  const media = make(f);
  const access = f.lease("access", {
    token: "offline-temp",
    wsUrl: "wss://media.example.test/room",
  });
  const clear = access.dispose.bind(access);
  access.dispose = () => {
    clear();
    throw new Error("disposal failed private-token");
  };
  f.ports.prepare = async () => access;
  await assert.rejects(media.start(action), code("MEDIA_CLEANUP_FAILED"));
  assert.ok(f.resources.every((r) => r.disposals === 1));
  assert.deepEqual(media.getSnapshot(), { state: "failed", reason: "cleanup_failed" });
  media.ready();
  await assert.rejects(media.start(action), code("MEDIA_UNAVAILABLE"));
});

for (const failure of [false, true]) {
  test(`r1 ${failure ? "failed start" : "stop"} release preserves a synchronously reported sleep`, async () => {
    const f = mediaFixture();
    const media = make(f);
    const acquire = f.ports.acquireMicrophone;
    f.ports.acquireMicrophone = async (request) => {
      const microphone = await acquire(request);
      const stop = microphone.dispose.bind(microphone);
      microphone.dispose = () => {
        stop();
        media.interrupt("sleep");
      };
      return microphone;
    };
    if (failure) {
      f.ports.connect = async () => {
        throw new Error("offline failure");
      };
      await assert.rejects(media.start(action), code("MEDIA_PORT_FAILED"));
    } else {
      await media.start(action);
      media.stop();
    }
    assert.deepEqual(media.getSnapshot(), { state: "waiting", reason: "sleep" });
    assert.ok(f.resources.every((r) => r.disposals === 1));
    await assert.rejects(media.start(action), code("MEDIA_UNAVAILABLE"));
    media.close();
  });
}
