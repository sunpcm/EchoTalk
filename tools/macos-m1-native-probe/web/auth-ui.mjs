const phases = Object.freeze({
  idle: "可以登录",
  unconfigured: "尚未配置隔离登录服务",
  unavailable: "登录不可用",
  preparing: "正在准备登录",
  waiting: "等待系统浏览器完成登录",
  exchanging: "正在验证登录结果",
  authenticated: "已登录",
  cancelled: "已取消或退出登录",
  failed: "登录失败，请重新登录",
  blocked: "安全存储不可用，请先取消并重试",
});
const errors = new Set([
  "CONFIG_MISSING",
  "CONFIG_INVALID",
  "AUTH_UNAVAILABLE",
  "AUTH_BUSY",
  "AUTH_CANCELLED",
  "AUTH_STORAGE_FAILED",
  "AUTHORIZATION_INVALID",
  "BROWSER_FAILED",
  "CALLBACK_REJECTED",
  "CALLBACK_INVALID",
  "AUTH_DENIED",
  "AUTH_EXPIRED",
  "IDENTITY_INVALID",
  "CLOCK_INVALID",
  "OIDC_UNAVAILABLE",
  "OIDC_DISCOVERY_FAILED",
  "OIDC_METADATA_REJECTED",
  "OIDC_EXCHANGE_FAILED",
  "OIDC_REFRESH_FORBIDDEN",
  "IPC_FORBIDDEN",
  "IPC_ARGUMENTS_FORBIDDEN",
]);

export function safeStatus(value) {
  if (
    !value ||
    !Object.hasOwn(phases, value.phase) ||
    typeof value.authenticated !== "boolean" ||
    value.authenticated !== (value.phase === "authenticated") ||
    !(
      value.expires_at === null ||
      (Number.isSafeInteger(value.expires_at) && value.expires_at > 0)
    ) ||
    (value.authenticated && value.expires_at === null) ||
    !(value.error === null || errors.has(value.error))
  )
    throw new Error("STATUS_INVALID");
  return {
    phase: value.phase,
    authenticated: value.authenticated,
    expires_at: value.expires_at,
    error: value.error,
  };
}

export function mountAuth(document, invoke, timers = globalThis) {
  const status = document.getElementById("auth-status");
  const detail = document.getElementById("auth-detail");
  const login = document.getElementById("login");
  const cancel = document.getElementById("cancel");
  let disposed = false;
  let mutation = false;
  let revision = 0;
  let timer;

  function render(raw) {
    const state = safeStatus(raw);
    status.textContent = phases[state.phase];
    detail.textContent =
      state.error ??
      (state.authenticated
        ? `有效期至 ${new Date(state.expires_at * 1000).toLocaleTimeString("zh-CN")}`
        : "");
    login.disabled =
      mutation ||
      [
        "preparing",
        "waiting",
        "exchanging",
        "blocked",
        "unconfigured",
        "unavailable",
        "authenticated",
      ].includes(state.phase);
    cancel.disabled = ["unconfigured", "unavailable"].includes(state.phase);
  }
  function failure(error) {
    status.textContent = "登录操作未完成";
    detail.textContent = errors.has(error) ? error : "AUTH_UNAVAILABLE";
  }
  async function refresh() {
    const current = revision;
    try {
      const state = await invoke("auth_status", {});
      if (!disposed && current === revision && !mutation) render(state);
    } catch (error) {
      if (!disposed && current === revision && !mutation) failure(error);
    } finally {
      if (!disposed) timer = timers.setTimeout(refresh, 750);
    }
  }
  async function action(command) {
    if (disposed || (mutation && command === "auth_begin")) return;
    const current = ++revision;
    mutation = true;
    login.disabled = true;
    try {
      const state = await invoke(command, {});
      if (!disposed && current === revision) {
        mutation = false;
        render(state);
      }
    } catch (error) {
      if (!disposed && current === revision) {
        mutation = false;
        failure(error);
      }
    }
  }
  const begin = () => action("auth_begin");
  const stop = () => action("auth_cancel");
  login.addEventListener("click", begin);
  cancel.addEventListener("click", stop);
  void refresh();
  return () => {
    disposed = true;
    revision++;
    timers.clearTimeout(timer);
    login.removeEventListener("click", begin);
    cancel.removeEventListener("click", stop);
  };
}
