/**
 * i18n 中文字符串映射。
 * TODO: i18n — 后续接入 react-i18next 或 next-intl，将此对象替换为语言包文件。
 */
export const zhCN = {
  conversation: {
    title: "AI 英语口语练习",
    subtitle: "与 AI 教练进行实时语音对话，提升你的英语口语能力",
    startButton: "开始练习",
    endButton: "结束对话",
    retryButton: "再来一次",
    connecting: "正在连接...",
    listening: "正在聆听...",
    speaking: "AI 正在说话...",
    idle: "等待你开讲...",
    ended: "对话已结束",
    endedHint: "你可以开始新一轮练习",
    errorTitle: "连接出错",
    errorRetry: "重试",
    micPermission: "请允许浏览器使用麦克风",
  },
} as const;
