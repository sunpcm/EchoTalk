const labels = Object.freeze({
  idle: "待开始（仅隔离开发）",
  unconfigured: "尚未配置隔离媒体服务",
  preparing: "正在准备会话",
  permission: "正在请求麦克风权限",
  connecting: "正在连接媒体房间",
  publishing: "正在发布麦克风音轨",
  dispatching: "正在请求 Agent 加入",
  waiting: "等待 Agent 远端音频",
  audio: "远端音频已接入，请确认实际有声",
  playback_blocked: "播放未获允许，请点击重试播放",
  stopping: "已请求停止，清理待确认；可点击核实结束",
  stopped: "已停止",
  blocked: "清理未完成，请重试结束并核实",
  failed: "媒体操作已中断，请明确重新开始",
});
const errorCopy = Object.freeze({
  CONFIG_MISSING: "缺少编译期隔离媒体配置，当前功能已禁用。",
  AUTH_REQUIRED: "请先登录，切换身份后需要重新开始。",
  AUTH_EXPIRED: "授权已过期，请重新登录。",
  PERMISSION_DENIED: "麦克风权限被拒绝，请检查系统设置后重新开始。",
  PLAYBACK_BLOCKED: "请使用重试播放按钮允许声音播放。",
  CLEANUP_FAILED: "本地资源释放尚未确认，不可开始新会话。",
  END_UNCONFIRMED: "远端会话结束尚未确认，不可开始新会话。",
  DISCONNECTED: "连接中断，不会自动重连或恢复采音。",
  INPUT_ENDED: "麦克风音轨已结束，请检查设备后重新开始。",
  OFFLINE: "网络已断开，不会自动恢复采音。",
  HIDDEN: "窗口进入后台，已停止采音。",
  PAGEHIDE: "窗口正在关闭，已停止采音。",
});

// onAuthState is a subscription function: listener => unsubscribe.
// The integration owner must publish false BEFORE auth begin/cancel/logout/account change.
export function mountMedia({ document, controller, onAuthState, window = document.defaultView }) {
  const ids = ["media-status", "media-detail", "media-start", "media-stop", "media-play"];
  const [status, detail, start, stop, play] = ids.map((id) => document.getElementById(id));
  if (
    [status, detail, start, stop, play].some((element) => !element) ||
    !window ||
    typeof onAuthState !== "function"
  )
    throw new Error("MEDIA_UNAVAILABLE");
  let disposed = false;
  let last;
  const bindings = [];
  const bind = (target, event, callback) => {
    target.addEventListener(event, callback);
    bindings.push([target, event, callback]);
  };
  function render(value) {
    if (disposed) return;
    last = value;
    const known = value && Object.hasOwn(labels, value.phase);
    status.textContent = known ? labels[value.phase] : "媒体状态不可用";
    detail.textContent = !known
      ? "请结束并核实会话。"
      : value.error === null
        ? "连接成功不代表双向实际有声。"
        : Object.hasOwn(errorCopy, value.error)
          ? errorCopy[value.error]
          : "操作未完成，请检查后重试。";
    start.disabled = !known || value.can_start !== true;
    stop.disabled = !known || value.can_stop !== true;
    play.disabled = !known || value.can_retry_playback !== true;
    stop.textContent =
      known && value.phase === "stopping" && value.end_state === "pending"
        ? "核实结束"
        : known && value.phase === "blocked"
          ? "重试结束 / 核实"
          : "结束";
  }
  const action = (name, permitted) => () => {
    if (disposed || !last || last[permitted] !== true) return;
    // Do not defer the method call: startAudio must retain the click's user gesture.
    try {
      Promise.resolve(controller[name]()).catch(() => {
        if (!disposed) render(null);
      });
    } catch {
      render(null);
    }
  };
  bind(start, "click", action("start", "can_start"));
  bind(stop, "click", action("stop", "can_stop"));
  bind(play, "click", action("retryPlayback", "can_retry_playback"));
  const lifecycle = (event) => {
    void controller.lifecycle(event);
  };
  bind(document, "visibilitychange", () =>
    lifecycle(document.visibilityState === "visible" ? "visible" : "hidden"),
  );
  bind(window, "offline", () => lifecycle("offline"));
  bind(window, "online", () => lifecycle("online"));
  bind(window, "pagehide", () => {
    lifecycle("pagehide");
    void dispose();
  });
  const unsubscribe = controller.subscribe(render);
  let unsubscribeAuth;
  try {
    unsubscribeAuth = onAuthState((state) => {
      if (!disposed) controller.setAuthState(state);
    });
  } catch {
    controller.setAuthState({ authenticated: false });
  }
  if (document.visibilityState !== "visible") lifecycle("hidden");
  if (window.navigator?.onLine === false) lifecycle("offline");
  void controller.refresh();
  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const [target, event, callback] of bindings) target.removeEventListener(event, callback);
    unsubscribe();
    try {
      unsubscribeAuth?.();
    } catch {
      /* Still dispose the media resources. */
    }
    return controller.dispose();
  }
  return dispose;
}
