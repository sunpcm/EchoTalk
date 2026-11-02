import { mountAuth } from "./auth-ui.mjs";
import { createMediaBridge, createMediaController } from "./media-controller.mjs";
import { createLiveKitMediaAdapter } from "./livekit-media.mjs";
import { mountMedia } from "./media-ui.mjs";
import { verifiedSdk } from "./sdk.mjs";

// The same assembly function is used by the bundled entry and offline integration tests.
export function mountProbe({ document, window, timers = window }) {
  const invoke = window.__TAURI__?.core?.invoke;
  if (typeof invoke !== "function") {
    document.getElementById("auth-status").textContent = "原生登录桥不可用";
    document.getElementById("media-status").textContent = "原生媒体桥不可用";
    return () => {};
  }
  const call = (command, args) => invoke(command, args);
  const disposeAuth = mountAuth(document, call, timers);
  let disposeMedia = () => {};
  try {
    const controller = createMediaController({
      bridge: createMediaBridge(call),
      adapter: createLiveKitMediaAdapter({
        sdk: verifiedSdk(window.LivekitClient),
        audioRoot: document.getElementById("media-audio-root"),
      }),
      timers,
    });
    disposeMedia = mountMedia({ document, window, controller, onAuthState: disposeAuth.subscribe });
  } catch {
    document.getElementById("media-status").textContent = "本地媒体组件不可用";
    document.getElementById("media-detail").textContent = "请检查构建资源后重试。";
  }
  let disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    // Local tracks/resources are released synchronously before Auth disposal.
    void disposeMedia();
    disposeAuth();
    window.removeEventListener("pagehide", dispose);
  }
  window.addEventListener("pagehide", dispose, { once: true });
  return dispose;
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  // DOMContentLoaded follows the local deferred UMD script, even on a cold load.
  const start = () => mountProbe({ document, window });
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
}
