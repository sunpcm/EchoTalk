import { describe, it, expect } from "vitest";
import { getLocalDayWindow } from "./localDayWindow";

describe("localDayWindow utility", () => {
  it("computes local midnight start and next local midnight end for a standard day", () => {
    const ref = new Date("2026-10-25T14:30:00Z");
    const window = getLocalDayWindow(ref);

    expect(window.localStartDate.getHours()).toBe(0);
    expect(window.localStartDate.getMinutes()).toBe(0);
    expect(window.localStartDate.getSeconds()).toBe(0);
    expect(window.localStartDate.getMilliseconds()).toBe(0);

    expect(window.localEndDate.getHours()).toBe(0);
    expect(window.localEndDate.getMinutes()).toBe(0);
    expect(window.localEndDate.getSeconds()).toBe(0);
    expect(window.localEndDate.getMilliseconds()).toBe(0);

    // start < end
    expect(new Date(window.start).getTime()).toBeLessThan(new Date(window.end).getTime());
    // ISO string with timezone indicator (Z)
    expect(window.start.endsWith("Z")).toBe(true);
    expect(window.end.endsWith("Z")).toBe(true);
  });

  it("handles month and year boundaries correctly", () => {
    // 跨年边界：12月31日
    const newYearEve = new Date("2026-12-31T23:59:59");
    const window = getLocalDayWindow(newYearEve);

    expect(window.localStartDate.getMonth()).toBe(11);
    expect(window.localStartDate.getDate()).toBe(31);
    expect(window.localEndDate.getMonth()).toBe(0);
    expect(window.localEndDate.getDate()).toBe(1);
    expect(window.localEndDate.getFullYear()).toBe(newYearEve.getFullYear() + 1);
  });

  it("handles leap year leap day (Feb 29)", () => {
    // 2028 是闰年
    const leapDay = new Date(2028, 1, 29, 12, 0, 0);
    const window = getLocalDayWindow(leapDay);

    expect(window.localStartDate.getMonth()).toBe(1);
    expect(window.localStartDate.getDate()).toBe(29);
    expect(window.localEndDate.getMonth()).toBe(2);
    expect(window.localEndDate.getDate()).toBe(1);
  });

  it("produces valid ISO UTC strings without relying on start + 24h", () => {
    const testDate = new Date(2026, 5, 15, 10, 0, 0);
    const window = getLocalDayWindow(testDate);

    const startTime = new Date(window.start).getTime();
    const endTime = new Date(window.end).getTime();

    // 窗口时长必须在 [23h, 25h] 内以包容夏令时，且小于等于 48 小时
    const durationHours = (endTime - startTime) / (1000 * 60 * 60);
    expect(durationHours).toBeGreaterThanOrEqual(23);
    expect(durationHours).toBeLessThanOrEqual(25);
    expect(durationHours).toBeLessThanOrEqual(48);
  });

  describe("DST & Real Timezone Verification via Independent Subprocess", () => {
    it("verifies America/New_York 2026-03-08 is exactly 23h (spring forward)", async () => {
      const { execFileSync } = (await import("node:child_process" as string)) as {
        execFileSync: (
          file: string,
          args: string[],
          options: { cwd: string; env: Record<string, string | undefined>; encoding: string },
        ) => string;
      };
      const nodeProcess = (
        globalThis as unknown as {
          process: { cwd(): string; env: Record<string, string | undefined> };
        }
      ).process;
      const out = execFileSync(
        "node",
        [
          "--experimental-strip-types",
          "-e",
          `
          import { getLocalDayWindow } from './src/lib/localDayWindow.ts';
          const ref = new Date(2026, 2, 8, 12, 0, 0);
          const win = getLocalDayWindow(ref);
          const diffHours = (new Date(win.end).getTime() - new Date(win.start).getTime()) / 3600000;
          process.stdout.write(diffHours.toString());
          `,
        ],
        {
          cwd: nodeProcess.cwd(),
          env: { ...nodeProcess.env, TZ: "America/New_York" },
          encoding: "utf8",
        },
      );
      expect(Number(out.trim())).toBe(23);
    });

    it("verifies America/New_York 2026-11-01 is exactly 25h (fall back)", async () => {
      const { execFileSync } = (await import("node:child_process" as string)) as {
        execFileSync: (
          file: string,
          args: string[],
          options: { cwd: string; env: Record<string, string | undefined>; encoding: string },
        ) => string;
      };
      const nodeProcess = (
        globalThis as unknown as {
          process: { cwd(): string; env: Record<string, string | undefined> };
        }
      ).process;
      const out = execFileSync(
        "node",
        [
          "--experimental-strip-types",
          "-e",
          `
          import { getLocalDayWindow } from './src/lib/localDayWindow.ts';
          const ref = new Date(2026, 10, 1, 12, 0, 0); // 2026-11-01
          const win = getLocalDayWindow(ref);
          const diffHours = (new Date(win.end).getTime() - new Date(win.start).getTime()) / 3600000;
          process.stdout.write(diffHours.toString());
          `,
        ],
        {
          cwd: nodeProcess.cwd(),
          env: { ...nodeProcess.env, TZ: "America/New_York" },
          encoding: "utf8",
        },
      );
      expect(Number(out.trim())).toBe(25);
    });

    it("verifies Asia/Singapore 2026-03-08 has no DST and is exactly 24h", async () => {
      const { execFileSync } = (await import("node:child_process" as string)) as {
        execFileSync: (
          file: string,
          args: string[],
          options: { cwd: string; env: Record<string, string | undefined>; encoding: string },
        ) => string;
      };
      const nodeProcess = (
        globalThis as unknown as {
          process: { cwd(): string; env: Record<string, string | undefined> };
        }
      ).process;
      const out = execFileSync(
        "node",
        [
          "--experimental-strip-types",
          "-e",
          `
          import { getLocalDayWindow } from './src/lib/localDayWindow.ts';
          const ref = new Date(2026, 2, 8, 12, 0, 0);
          const win = getLocalDayWindow(ref);
          const diffHours = (new Date(win.end).getTime() - new Date(win.start).getTime()) / 3600000;
          process.stdout.write(diffHours.toString());
          `,
        ],
        {
          cwd: nodeProcess.cwd(),
          env: { ...nodeProcess.env, TZ: "Asia/Singapore" },
          encoding: "utf8",
        },
      );
      expect(Number(out.trim())).toBe(24);
    });
  });
});
