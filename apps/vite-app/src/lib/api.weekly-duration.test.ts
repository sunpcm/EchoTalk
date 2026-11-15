import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getBaseUrl, getWeeklyProgress, parseWeeklyProgressResponse } from "./api";
import { _resetAuthForTesting, setAccessTokenProvider } from "./auth";
import { getZonedWeekWindows } from "./localDayWindow";

const END_DATE = "2026-11-03";
const TIMEZONE = "Asia/Singapore";

type RawWeeklyDay = Record<string, unknown>;

function legacyResponse() {
  return {
    days: getZonedWeekWindows(END_DATE, TIMEZONE).map((day) => ({
      ...day,
      completed_sessions: 0,
    })),
  };
}

function rawDay(body: ReturnType<typeof legacyResponse>, index = 0): RawWeeklyDay {
  return body.days[index] as RawWeeklyDay;
}

describe("weekly recorded duration parser compatibility", () => {
  it("keeps a legacy four-field response byte-for-byte in the parsed object shape", () => {
    const body = legacyResponse();
    expect(parseWeeklyProgressResponse(body, END_DATE, TIMEZONE)).toStrictEqual(body);
    for (const day of parseWeeklyProgressResponse(body, END_DATE, TIMEZONE).days) {
      expect(Object.keys(day)).toHaveLength(4);
    }
  });

  it("preserves both trusted extension integers, including legal zero", () => {
    const body = legacyResponse();
    const first = rawDay(body);
    first.completed_sessions = 2;
    first.recorded_duration_ms = 2500;
    first.duration_unavailable_count = 1;
    const second = rawDay(body, 1);
    second.completed_sessions = 2;
    second.recorded_duration_ms = 0;
    second.duration_unavailable_count = 1;

    expect(parseWeeklyProgressResponse(body, END_DATE, TIMEZONE)).toStrictEqual(body);
  });

  it.each([
    ["missing", undefined],
    ["null", null],
    ["string", "2500"],
    ["negative", -1],
    ["decimal", 1.5],
    ["unsafe integer", Number.MAX_SAFE_INTEGER + 1],
  ])(
    "downgrades an invalid recorded_duration_ms (%s) without erasing the count",
    (_label, value) => {
      const body = legacyResponse();
      const day = rawDay(body);
      day.completed_sessions = 2;
      day.duration_unavailable_count = 1;
      if (value === undefined) {
        delete day.recorded_duration_ms;
      } else {
        day.recorded_duration_ms = value;
      }

      const parsedDay = parseWeeklyProgressResponse(body, END_DATE, TIMEZONE).days[0];
      expect(parsedDay.completed_sessions).toBe(2);
      expect(parsedDay).not.toHaveProperty("recorded_duration_ms");
      expect(parsedDay).toHaveProperty("duration_unavailable_count", 1);
    },
  );

  it.each([
    ["missing", undefined],
    ["null", null],
    ["string", "1"],
    ["negative", -1],
    ["decimal", 0.5],
    ["unsafe integer", Number.MAX_SAFE_INTEGER + 1],
  ])(
    "downgrades an invalid duration_unavailable_count (%s) without erasing the count",
    (_label, value) => {
      const body = legacyResponse();
      const day = rawDay(body);
      day.completed_sessions = 2;
      day.recorded_duration_ms = 2500;
      if (value === undefined) {
        delete day.duration_unavailable_count;
      } else {
        day.duration_unavailable_count = value;
      }

      const parsedDay = parseWeeklyProgressResponse(body, END_DATE, TIMEZONE).days[0];
      expect(parsedDay.completed_sessions).toBe(2);
      expect(parsedDay).toHaveProperty("recorded_duration_ms", 2500);
      expect(parsedDay).not.toHaveProperty("duration_unavailable_count");
    },
  );

  it.each([
    ["unavailable exceeds completed", 1, 10, 2],
    ["no computable session but duration exists", 1, 1, 1],
  ])(
    "downgrades an inconsistent extension pair to unknown: %s",
    (_label, completed, duration, unavailable) => {
      const body = legacyResponse();
      const day = rawDay(body);
      day.completed_sessions = completed;
      day.recorded_duration_ms = duration;
      day.duration_unavailable_count = unavailable;

      const parsedDay = parseWeeklyProgressResponse(body, END_DATE, TIMEZONE).days[0];
      expect(parsedDay.completed_sessions).toBe(completed);
      expect(parsedDay).not.toHaveProperty("recorded_duration_ms");
      expect(parsedDay).not.toHaveProperty("duration_unavailable_count");
    },
  );

  it.each([
    [
      "unknown day extension",
      (body: ReturnType<typeof legacyResponse>) => {
        rawDay(body).private_duration = 1;
      },
    ],
    [
      "extra root key",
      (body: ReturnType<typeof legacyResponse>) => {
        Object.assign(body, { raw: true });
      },
    ],
    [
      "bad date",
      (body: ReturnType<typeof legacyResponse>) => {
        rawDay(body).date = "2026-11-02";
      },
    ],
    [
      "bad window",
      (body: ReturnType<typeof legacyResponse>) => {
        rawDay(body).start = "2026-10-27T00:00:00Z";
      },
    ],
    [
      "bad completed count",
      (body: ReturnType<typeof legacyResponse>) => {
        rawDay(body).completed_sessions = -1;
      },
    ],
  ])("still rejects invalid base or unknown shape: %s", (_label, mutate) => {
    const body = legacyResponse();
    mutate(body);
    expect(() => parseWeeklyProgressResponse(body, END_DATE, TIMEZONE)).toThrow();
  });
});

describe("weekly recorded duration request ownership", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    _resetAuthForTesting();
    globalThis.fetch = vi.fn();
    setAccessTokenProvider(() => "test-access-token");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("sends the fixed opt-in flag through one authenticated GET without changing ownership", async () => {
    const body = legacyResponse();
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: async () => body,
    } as Response);
    const controller = new AbortController();

    await getWeeklyProgress(END_DATE, TIMEZONE, { signal: controller.signal });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(url).toBe(
      `${getBaseUrl()}/sessions/weekly-progress?end_date=${END_DATE}&timezone=Asia%2FSingapore&include_recorded_duration=true`,
    );
    expect(
      new URL(String(url), "https://weekly-contract.test").searchParams.get(
        "include_recorded_duration",
      ),
    ).toBe("true");
    expect(options?.method ?? "GET").toBe("GET");
    expect(options?.cache).toBe("no-store");
    expect(options?.signal).toBeInstanceOf(AbortSignal);
  });
});
