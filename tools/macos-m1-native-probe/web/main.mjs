import { mountAuth } from "./auth-ui.mjs";

const invoke = window.__TAURI__?.core?.invoke;
if (typeof invoke === "function") {
  const dispose = mountAuth(document, (command, args) => invoke(command, args));
  window.addEventListener("pagehide", dispose, { once: true });
} else {
  document.getElementById("auth-status").textContent = "原生登录桥不可用";
}
