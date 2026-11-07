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

export interface CalendarDayWindow {
  date: string;
  start: string;
  end: string;
}

/** 用 UTC 仅做日历加减，绝不用它代替当地日界。 */
function calendarDate(date: string, offset = 0): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Invalid calendar date");
  const value = new Date(`${date}T00:00:00.000Z`);
  if (
    !Number.isFinite(value.getTime()) ||
    value.getUTCFullYear() < 1 ||
    value.toISOString().slice(0, 10) !== date
  ) {
    throw new Error("Invalid calendar date");
  }
  value.setUTCDate(value.getUTCDate() + offset);
  if (value.getUTCFullYear() < 1 || value.getUTCFullYear() > 9999) {
    throw new Error("Calendar date overflow");
  }
  return value;
}

/** 每个边界独立求当地午夜。fold 取较早瞬间，gap 采用跳变前 offset，与 ZoneInfo fold=0 一致。 */
export function getZonedWeekWindows(endDate: string, timezone: string): CalendarDayWindow[] {
  if (!timezone || timezone.length > 128 || /^[+-]/.test(timezone)) {
    throw new Error("Invalid timezone");
  }
  const formatter = new Intl.DateTimeFormat("en-US-u-ca-gregory-nu-latn", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    era: "short",
    hourCycle: "h23",
  });
  const wallTime = (instant: number): number => {
    const parts = formatter.formatToParts(new Date(instant));
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((entry) => entry.type === type)?.value);
    const result = new Date(0);
    const year =
      parts.find((entry) => entry.type === "era")?.value === "BC" ? 1 - part("year") : part("year");
    result.setUTCFullYear(year, part("month") - 1, part("day"));
    result.setUTCHours(part("hour"), part("minute"), part("second"), 0);
    return result.getTime();
  };
  const dates = Array.from({ length: 8 }, (_, index) => calendarDate(endDate, index - 6));
  const boundaries = dates.map((date) => {
    const wall = date.getTime();
    const offsets = new Set<number>();
    for (const hours of [-48, -24, 0, 24, 48]) {
      const probe = wall + hours * 3_600_000;
      offsets.add(wallTime(probe) - probe);
    }
    const candidates = [...offsets].map((offset) => wall - offset);
    const exact = candidates.filter((candidate) => wallTime(candidate) === wall);
    const boundary = new Date(exact.length ? Math.min(...exact) : Math.max(...candidates));
    if (boundary.getUTCFullYear() < 1 || boundary.getUTCFullYear() > 9999) {
      throw new Error("UTC boundary overflow");
    }
    return boundary.toISOString();
  });
  return dates.slice(0, 7).map((date, index) => ({
    date: date.toISOString().slice(0, 10),
    start: boundaries[index],
    end: boundaries[index + 1],
  }));
}

/** 每次读取都重新解析时区，支持页面存活期间系统时区改变。 */
export function getLocalWeekContext(referenceDate = new Date()) {
  const timezone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
  const year = String(referenceDate.getFullYear()).padStart(4, "0");
  const month = String(referenceDate.getMonth() + 1).padStart(2, "0");
  const day = String(referenceDate.getDate()).padStart(2, "0");
  return { endDate: `${year}-${month}-${day}`, timezone };
}
