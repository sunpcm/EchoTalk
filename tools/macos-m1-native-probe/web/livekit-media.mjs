// Production callers must inject the self-hosted, integrity-checked LiveKit 2.17.2 SDK.
// This module has no simulator, network loader or synthetic audio fallback.
export function createLiveKitMediaAdapter({ sdk, audioRoot, maxRemoteTracks = 8 }) {
  if (
    typeof sdk?.Room !== "function" ||
    typeof sdk.createLocalAudioTrack !== "function" ||
    typeof sdk.setLogLevel !== "function" ||
    !sdk.RoomEvent ||
    !audioRoot ||
    typeof audioRoot.appendChild !== "function" ||
    !Number.isSafeInteger(maxRemoteTracks) ||
    maxRemoteTracks < 1 ||
    maxRemoteTracks > 16
  )
    throw new Error("MEDIA_UNAVAILABLE");
  const events = sdk.RoomEvent;
  for (const key of [
    "Disconnected",
    "Reconnecting",
    "SignalReconnecting",
    "TrackSubscribed",
    "TrackUnsubscribed",
    "AudioPlaybackStatusChanged",
  ])
    if (typeof events[key] !== "string") throw new Error("MEDIA_UNAVAILABLE");
  sdk.setLogLevel("silent");

  return Object.freeze({
    create({ onEvent }) {
      const room = new sdk.Room({
        reconnectPolicy: { nextRetryDelayInMs: () => null },
        disconnectOnPageLeave: false,
        adaptiveStream: false,
        dynacast: false,
      });
      let closed = false;
      let local = null;
      let localEnded = null;
      let acquired = false;
      let connected = false;
      let published = false;
      let retrying = false;
      let stoppedCleanly = true;
      const attached = new Map();
      const bindings = [];
      const pending = new Set();
      const notify = (event) => {
        if (!closed) onEvent(event);
      };
      const cleanupFailed = () => {
        stoppedCleanly = false;
        onEvent("cleanup_failed");
      };
      function trackPromise(promise) {
        const tracked = Promise.resolve(promise);
        pending.add(tracked);
        tracked.then(
          () => pending.delete(tracked),
          () => pending.delete(tracked),
        );
        return tracked;
      }
      function bind(event, callback) {
        bindings.push([event, callback]);
        room.on(event, callback);
      }
      function stopTrack(track) {
        // Stop the underlying browser track even if the SDK stop path throws.
        let failed = false;
        try {
          track.mediaStreamTrack?.stop();
        } catch {
          failed = true;
        }
        try {
          track.stop();
        } catch {
          failed = true;
        }
        if (track.mediaStreamTrack?.readyState !== "ended") failed = true;
        if (failed) {
          cleanupFailed();
          throw new Error("CLEANUP_FAILED");
        }
      }
      function stopLocal() {
        if (!local) return;
        let listenerFailed = false;
        if (localEnded) {
          try {
            local.mediaStreamTrack?.removeEventListener("ended", localEnded);
          } catch {
            cleanupFailed();
            listenerFailed = true;
          }
          if (!listenerFailed) localEnded = null;
        }
        stopTrack(local);
        if (!listenerFailed) local = null;
      }
      function removeAudio(track) {
        const entry = attached.get(track);
        if (!entry) return;
        entry.live = false;
        let failed = false;
        try {
          entry.element.pause();
        } catch {
          failed = true;
        }
        try {
          track.detach(entry.element);
        } catch {
          failed = true;
        }
        try {
          entry.element.srcObject = null;
        } catch {
          failed = true;
        }
        try {
          entry.element.remove();
        } catch {
          failed = true;
        }
        if (failed) {
          cleanupFailed();
          throw new Error("CLEANUP_FAILED");
        }
        attached.delete(track);
      }
      function publishPlayback() {
        if (closed) return;
        const entries = [...attached.values()];
        if (entries.some((entry) => entry.blocked)) notify("playback_blocked");
        else notify(entries.some((entry) => entry.playing) ? "audio_playing" : "audio_removed");
      }
      async function play(entry) {
        if (closed || !entry.live) return;
        const attempt = ++entry.attempt;
        try {
          await entry.element.play();
          if (closed || !entry.live || entry.attempt !== attempt) return;
          entry.playing = true;
          entry.blocked = false;
        } catch {
          if (closed || !entry.live || entry.attempt !== attempt) return;
          entry.playing = false;
          entry.blocked = true;
        }
        publishPlayback();
      }
      bind(events.TrackSubscribed, (track) => {
        if (closed || track.kind !== "audio" || attached.has(track)) return;
        if (attached.size >= maxRemoteTracks) {
          notify("disconnected");
          return;
        }
        let element;
        try {
          element = track.attach();
          const entry = { element, live: true, attempt: 0, playing: false, blocked: false };
          attached.set(track, entry);
          // Explicit play() is the only source of playback-success receipts.
          element.autoplay = false;
          element.controls = false;
          element.setAttribute("aria-hidden", "true");
          audioRoot.appendChild(element);
          void play(entry);
        } catch {
          if (attached.has(track)) {
            try {
              removeAudio(track);
            } catch {
              /* Failure already reported. */
            }
          } else if (element) {
            try {
              track.detach(element);
              element.remove();
            } catch {
              cleanupFailed();
            }
          }
          notify("playback_blocked");
        }
      });
      bind(events.TrackUnsubscribed, (track) => {
        if (closed || !attached.has(track)) return;
        try {
          removeAudio(track);
        } catch {
          return;
        }
        publishPlayback();
      });
      bind(events.AudioPlaybackStatusChanged, () => {
        if (!closed && room.canPlaybackAudio === false) notify("playback_blocked");
      });
      for (const event of [events.Disconnected, events.Reconnecting, events.SignalReconnecting])
        bind(event, () => {
          if (closed) return;
          // The controller invalidates ownership and calls dispose synchronously.
          notify(event === events.Disconnected ? "disconnected" : "reconnecting");
        });

      function disconnect() {
        try {
          return Promise.resolve(room.disconnect(true)).catch(() => {
            cleanupFailed();
            throw new Error("CLEANUP_FAILED");
          });
        } catch {
          cleanupFailed();
          return Promise.reject(new Error("CLEANUP_FAILED"));
        }
      }
      return Object.freeze({
        acquire() {
          if (closed || acquired) return Promise.reject(new Error("INPUT_FAILED"));
          acquired = true;
          return trackPromise(
            (async () => {
              const track = await sdk.createLocalAudioTrack({
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
              });
              local = track;
              if (closed) {
                stopLocal();
                return;
              }
              localEnded = () => notify("input_ended");
              track.mediaStreamTrack.addEventListener("ended", localEnded);
              if (track.mediaStreamTrack.readyState === "ended") notify("input_ended");
            })(),
          );
        },
        connect(grant) {
          if (closed || !local || connected) return Promise.reject(new Error("CONNECT_FAILED"));
          return trackPromise(
            (async () => {
              try {
                await room.connect(grant.ws_url, grant.token, {
                  autoSubscribe: true,
                  maxRetries: 0,
                });
              } finally {
                grant = null;
                // A cancelled connect may resolve or reject after the first disconnect.
                if (closed) await disconnect();
              }
              if (!closed) connected = true;
            })(),
          );
        },
        publish() {
          if (closed || !local || !connected || published)
            return Promise.reject(new Error("PUBLISH_FAILED"));
          published = true;
          return trackPromise(
            (async () => {
              try {
                await room.localParticipant.publishTrack(local, { source: "microphone" });
              } finally {
                if (closed) {
                  stopLocal();
                  await disconnect();
                }
              }
            })(),
          );
        },
        async retryPlayback() {
          if (closed || retrying) return;
          retrying = true;
          try {
            // Invoke before the first await to retain the explicit user gesture.
            await room.startAudio();
            if (closed) return;
            await Promise.all([...attached.values()].map(play));
          } catch {
            notify("playback_blocked");
          } finally {
            retrying = false;
          }
        },
        dispose() {
          closed = true;
          stoppedCleanly = true;
          // Do not await disconnect before attempting every synchronous cleanup.
          for (let index = bindings.length - 1; index >= 0; index--) {
            const [event, callback] = bindings[index];
            try {
              room.off(event, callback);
              bindings.splice(index, 1);
            } catch {
              cleanupFailed();
            }
          }
          try {
            stopLocal();
          } catch {
            /* Try remote DOM cleanup as well. */
          }
          for (const track of attached.keys()) {
            try {
              removeAudio(track);
            } catch {
              /* Attempt every owned element. */
            }
          }
          const leaving = disconnect();
          return Promise.allSettled([leaving, ...pending]).then((results) => {
            if (!stoppedCleanly || results[0].status === "rejected")
              throw new Error("CLEANUP_FAILED");
          });
        },
      });
    },
  });
}
