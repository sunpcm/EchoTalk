import type { WeeklyProgressDay } from "@/lib/api";

export type RecordedDurationBucket =
  | {
      kind: "available";
      computableCount: number;
      recordedDurationMs: number;
      unavailableCount: number;
    }
  | {
      kind: "unavailable";
      unavailableCount: number;
    }
  | { kind: "unknown" };

export type WeeklyRecordedDuration =
  | {
      kind: "available";
      knownUnavailableCount: number | null;
      recordedDurationMs: number;
      unavailableCountComplete: boolean;
    }
  | {
      kind: "unavailable";
      knownUnavailableCount: number | null;
      unavailableCountComplete: boolean;
    }
  | {
      kind: "unknown";
      knownUnavailableCount: number | null;
      unavailableCountComplete: boolean;
    };

function isNonNegativeSafeInteger(value: unknown): value is number {
  if (typeof value !== "number") {
    return false;
  }
  return Number.isSafeInteger(value) && value >= 0;
}

function unavailableCountIsKnown(
  day: WeeklyProgressDay,
): day is WeeklyProgressDay & { duration_unavailable_count: number } {
  return (
    isNonNegativeSafeInteger(day.completed_sessions) &&
    isNonNegativeSafeInteger(day.duration_unavailable_count) &&
    day.duration_unavailable_count <= day.completed_sessions
  );
}

export function readRecordedDurationBucket(day: WeeklyProgressDay): RecordedDurationBucket {
  if (
    !isNonNegativeSafeInteger(day.completed_sessions) ||
    !isNonNegativeSafeInteger(day.recorded_duration_ms) ||
    !isNonNegativeSafeInteger(day.duration_unavailable_count) ||
    day.duration_unavailable_count > day.completed_sessions
  ) {
    return { kind: "unknown" };
  }

  const computableCount = day.completed_sessions - day.duration_unavailable_count;
  if (computableCount === 0 && day.recorded_duration_ms > 0) {
    return { kind: "unknown" };
  }
  if (computableCount === 0 && day.completed_sessions > 0) {
    return {
      kind: "unavailable",
      unavailableCount: day.duration_unavailable_count,
    };
  }
  return {
    kind: "available",
    computableCount,
    recordedDurationMs: day.recorded_duration_ms,
    unavailableCount: day.duration_unavailable_count,
  };
}

export function summarizeRecordedDurationWeek(
  days: readonly WeeklyProgressDay[],
): WeeklyRecordedDuration {
  let recordedDurationMs: number = 0;
  let knownUnavailableCount: number | null = null;
  let hasKnownUnavailableCount = false;
  let everyBucketKnown = days.length === 7;
  let durationSumComplete = true;
  let unavailableCountComplete = days.length === 7;
  let hasComputableSessions = false;
  let hasUnavailableSessions = false;

  for (const day of days) {
    const bucket = readRecordedDurationBucket(day);
    if (bucket.kind === "unknown") {
      everyBucketKnown = false;
    } else if (bucket.kind === "unavailable") {
      hasUnavailableSessions = true;
    } else {
      hasComputableSessions ||= bucket.computableCount > 0;
      hasUnavailableSessions ||= bucket.unavailableCount > 0;
      const nextDuration = recordedDurationMs + bucket.recordedDurationMs;
      if (Number.isSafeInteger(nextDuration)) {
        recordedDurationMs = nextDuration;
      } else {
        durationSumComplete = false;
      }
    }

    if (!unavailableCountIsKnown(day)) {
      unavailableCountComplete = false;
      continue;
    }

    if (!hasKnownUnavailableCount) {
      knownUnavailableCount = day.duration_unavailable_count;
      hasKnownUnavailableCount = true;
    } else if (knownUnavailableCount !== null) {
      const nextCount: number = knownUnavailableCount + day.duration_unavailable_count;
      if (Number.isSafeInteger(nextCount)) {
        knownUnavailableCount = nextCount;
      } else {
        knownUnavailableCount = null;
        unavailableCountComplete = false;
      }
    }
  }

  if (everyBucketKnown && durationSumComplete) {
    if (!hasComputableSessions && hasUnavailableSessions) {
      return {
        kind: "unavailable",
        knownUnavailableCount,
        unavailableCountComplete,
      };
    }
    return {
      kind: "available",
      knownUnavailableCount,
      recordedDurationMs,
      unavailableCountComplete,
    };
  }
  return {
    kind: "unknown",
    knownUnavailableCount,
    unavailableCountComplete,
  };
}
