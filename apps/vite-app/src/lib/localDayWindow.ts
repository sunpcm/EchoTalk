/**
 * 本地自然日窗口计算工具。
 *
 * 严格使用浏览器本地时区当天 00:00:00.000 与下一个本地自然日 00:00:00.000 分别转换为 UTC ISO 字符串。
 * 绝不使用 start + 24 小时或基于 UTC 日期的 startsWith 前缀截断，以正确包容夏令时 (DST) 切换日
 * （例如 23 小时或 25 小时）的自然日窗口边界。
 */

export interface LocalDayWindow {
  start: string;
  end: string;
  localStartDate: Date;
  localEndDate: Date;
}

/**
 * 计算指定参考时间所在本地自然日的 [start, end) 窗口（默认当前系统时间）
 */
export function getLocalDayWindow(referenceDate: Date = new Date()): LocalDayWindow {
  const year = referenceDate.getFullYear();
  const month = referenceDate.getMonth();
  const day = referenceDate.getDate();

  // 本地当天 0 点
  const localStartDate = new Date(year, month, day, 0, 0, 0, 0);

  // 本地下一个自然日午夜 0 点（利用 Date 构造函数自动进位和本地日历 DST 计算）
  const localEndDate = new Date(year, month, day + 1, 0, 0, 0, 0);

  return {
    start: localStartDate.toISOString(),
    end: localEndDate.toISOString(),
    localStartDate,
    localEndDate,
  };
}
