import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

const host = "127.0.0.1";
const port = Number(process.env.E2E_API_PORT ?? 18181);
const sessions = new Map();
const analysisJobs = new Map();

function sendJson(response, status, body, extraHeaders = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...extraHeaders,
  });
  response.end(JSON.stringify(body));
}

function userDataExportFixture() {
  const exportedAt = new Date().toISOString();
  const sessionId = "78100000-0000-4000-8000-000000000001";
  const jobId = "78100000-0000-4000-8000-000000000002";
  const pronunciationId = "78100000-0000-4000-8000-000000000003";
  const grammarId = "78100000-0000-4000-8000-000000000004";
  return {
    schema_version: 1,
    exported_at: exportedAt,
    sessions: [
      {
        id: sessionId,
        mode: "pronunciation",
        status: "completed",
        started_at: "2026-11-13T04:00:00Z",
        ended_at: "2026-11-13T04:10:00Z",
      },
    ],
    transcripts: [
      {
        id: 1,
        session_id: sessionId,
        event_id: "78100000-0000-4000-8000-000000000005",
        role: "user",
        content: "I go yesterday, but I said the word three.",
        timestamp_ms: 1,
      },
      {
        id: 2,
        session_id: sessionId,
        event_id: "78100000-0000-4000-8000-000000000006",
        role: "assistant",
        content: "Try the past tense and the TH sound again.",
        timestamp_ms: 2,
      },
    ],
    pronunciation_assessments: [
      {
        id: pronunciationId,
        session_id: sessionId,
        overall_score: 82.5,
        phoneme_alignment: [
          {
            position: 0,
            phoneme: "TH",
            expected: "TH",
            actual: "S",
            type: "substitution",
          },
        ],
        source: "acme_pronunciation",
        provider: "acme",
        model_version: "acme-phoneme-v1",
        is_synthetic: false,
        confidence: 0.91,
        created_at: "2026-11-13T04:10:01Z",
      },
    ],
    grammar_assessments: [
      {
        id: grammarId,
        session_id: sessionId,
        skill_tag: "verb_tense_past",
        original: "I go yesterday.",
        corrected: "I went yesterday.",
        error_type: "tense",
        source: "acme_grammar",
        provider: null,
        model_version: null,
        is_synthetic: true,
        confidence: 0.63,
        created_at: "2026-11-13T04:10:02Z",
      },
    ],
    learning_events: [
      {
        apply_seq: 9001,
        event_type: "analysis_completed",
        session_id: sessionId,
        analysis_job_id: jobId,
        pronunciation_assessment_id: null,
        grammar_error_id: null,
        skill_id: null,
        source_ordinal: null,
        observation_correct: null,
        observation_code: null,
        source: "analysis",
        provider: null,
        model_version: null,
        confidence: null,
        is_synthetic: null,
        algorithm_version: "bkt-v1",
        algorithm_params: {
          p_init: 0.1,
          p_transit: 0.2,
          p_slip: 0.1,
          p_guess: 0.2,
        },
        p_mastery_snapshot: null,
        cutover_revision: null,
        occurred_at: "2026-11-13T04:10:00Z",
        recorded_at: "2026-11-13T04:10:03Z",
        details: {
          schema_version: 1,
          coverage: {
            pronunciation: {
              status: "evaluated",
              source: "acme_pronunciation",
              provider: "acme",
              model_version: "acme-phoneme-v1",
              is_synthetic: false,
            },
            grammar: {
              status: "evaluated",
              source: "acme_grammar",
              provider: null,
              model_version: null,
              is_synthetic: true,
            },
          },
          unmapped: {
            pronunciation: 1,
            grammar: 0,
          },
          legacy_synthetic_impact: null,
        },
      },
      {
        apply_seq: 9002,
        event_type: "pronunciation_observation",
        session_id: sessionId,
        analysis_job_id: jobId,
        pronunciation_assessment_id: pronunciationId,
        grammar_error_id: null,
        skill_id: "th_sounds",
        source_ordinal: 0,
        observation_correct: false,
        observation_code: "th_substitution",
        source: "acme_pronunciation",
        provider: "acme",
        model_version: "acme-phoneme-v1",
        confidence: 0.91,
        is_synthetic: false,
        algorithm_version: null,
        algorithm_params: null,
        p_mastery_snapshot: null,
        cutover_revision: null,
        occurred_at: "2026-11-13T04:10:00Z",
        recorded_at: "2026-11-13T04:10:04Z",
        details: {
          schema_version: 1,
          coverage: null,
          unmapped: null,
          legacy_synthetic_impact: null,
        },
      },
      {
        apply_seq: 9003,
        event_type: "grammar_observation",
        session_id: sessionId,
        analysis_job_id: jobId,
        pronunciation_assessment_id: null,
        grammar_error_id: grammarId,
        skill_id: "verb_tense_past",
        source_ordinal: 0,
        observation_correct: false,
        observation_code: "verb_tense_past",
        source: "acme_grammar",
        provider: null,
        model_version: null,
        confidence: 0.63,
        is_synthetic: true,
        algorithm_version: null,
        algorithm_params: null,
        p_mastery_snapshot: null,
        cutover_revision: null,
        occurred_at: "2026-11-13T04:10:00Z",
        recorded_at: "2026-11-13T04:10:05Z",
        details: {
          schema_version: 1,
          coverage: null,
          unmapped: null,
          legacy_synthetic_impact: null,
        },
      },
      {
        apply_seq: 9004,
        event_type: "baseline_snapshot",
        session_id: null,
        analysis_job_id: null,
        pronunciation_assessment_id: null,
        grammar_error_id: null,
        skill_id: "article_usage",
        source_ordinal: null,
        observation_correct: null,
        observation_code: null,
        source: "legacy_unknown",
        provider: null,
        model_version: null,
        confidence: null,
        is_synthetic: null,
        algorithm_version: null,
        algorithm_params: null,
        p_mastery_snapshot: 0.42,
        cutover_revision: "b1-4-fake-export-v1",
        occurred_at: "2026-11-12T23:59:00Z",
        recorded_at: "2026-11-13T04:10:06Z",
        details: {
          schema_version: 1,
          coverage: null,
          unmapped: null,
          legacy_synthetic_impact: "unknown",
        },
      },
    ],
    knowledge_states: [
      {
        skill_id: "article_usage",
        p_mastery: 0.42,
        updated_at: "2026-11-13T04:10:06Z",
      },
    ],
  };
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function createSession(mode) {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    user_id: "00000000-0000-0000-0000-000000000001",
    mode,
    status: "active",
    started_at: now,
    ended_at: null,
    transcripts: [],
  };
}

const VALID_STATUSES = new Set(["active", "completed", "cancelled"]);
const FAKE_USER_ID = "00000000-0000-0000-0000-000000000001";
const REQUIRED_CURSOR_KEYS = ["v", "u", "ep", "st", "s", "e", "t", "id"];
const WEEKLY_GRAMMAR_TAGS = new Set([
  "article_usage",
  "verb_tense_past",
  "verb_tense_present",
  "subject_verb_agreement",
  "preposition",
  "other",
]);

// 请求局部合成记录；不会污染浏览器 worker 共享的 sessions，也不进入产品默认数据。
function weeklyFixtures(name) {
  const make = (index, started_at, status = "completed", user_id = FAKE_USER_ID) => ({
    id: `77300000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    user_id,
    mode: "free_talk",
    status,
    started_at,
    ended_at: status === "completed" ? started_at : null,
    transcripts: [],
  });
  if (name === "weekly") {
    return [
      ...Array.from({ length: 55 }, (_, i) =>
        make(i + 1, new Date(Date.parse("2026-11-02T16:00:00Z") + i * 60_000).toISOString()),
      ),
      make(56, "2026-11-01T16:00:00Z"),
      make(57, "2026-11-02T16:00:00Z", "active"),
      make(58, "2026-11-02T16:00:00Z", "completed", "00000000-0000-0000-0000-000000000002"),
    ];
  }
  if (name === "dst") {
    return [
      make(101, "2026-03-08T05:00:00Z"),
      make(102, "2026-03-09T04:00:00Z"),
      make(103, "2026-11-01T04:00:00Z"),
      make(104, "2026-11-02T05:00:00Z"),
      make(105, "2026-11-01T04:00:00Z", "active"),
      make(106, "2026-11-01T04:00:00Z", "completed", "00000000-0000-0000-0000-000000000002"),
    ];
  }
  return [];
}

function weeklyWindows(endDate, timezone) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(endDate ?? "") ||
    !timezone ||
    timezone.length > 128 ||
    /^[+-]/.test(timezone)
  ) {
    throw new Error("Invalid weekly window");
  }
  const last = new Date(`${endDate}T00:00:00Z`);
  if (
    !Number.isFinite(last.getTime()) ||
    last.getUTCFullYear() < 1 ||
    last.toISOString().slice(0, 10) !== endDate
  ) {
    throw new Error("Invalid weekly date");
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
  const wallTime = (instant) => {
    const parts = formatter.formatToParts(new Date(instant));
    const part = (type) => Number(parts.find((p) => p.type === type)?.value);
    const result = new Date(0);
    const year =
      parts.find((p) => p.type === "era")?.value === "BC" ? 1 - part("year") : part("year");
    result.setUTCFullYear(year, part("month") - 1, part("day"));
    result.setUTCHours(part("hour"), part("minute"), part("second"), 0);
    return result.getTime();
  };
  const dates = Array.from({ length: 8 }, (_, i) => {
    const date = new Date(last);
    date.setUTCDate(date.getUTCDate() + i - 6);
    if (date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999) throw new Error("Date overflow");
    return date;
  });
  const boundaries = dates.map((date) => {
    const wall = date.getTime();
    const offsets = new Set(
      [-48, -24, 0, 24, 48].map((hours) => {
        const probe = wall + hours * 3_600_000;
        return wallTime(probe) - probe;
      }),
    );
    const candidates = [...offsets].map((offset) => wall - offset);
    const exact = candidates.filter((candidate) => wallTime(candidate) === wall);
    const boundary = new Date(exact.length ? Math.min(...exact) : Math.max(...candidates));
    if (boundary.getUTCFullYear() < 1 || boundary.getUTCFullYear() > 9999)
      throw new Error("UTC overflow");
    return boundary.toISOString();
  });
  return dates.slice(0, 7).map((date, index) => ({
    date: date.toISOString().slice(0, 10),
    start: boundaries[index],
    end: boundaries[index + 1],
  }));
}

function grammarFixtures(name) {
  if (name !== "weekly") return [];
  const make = (index, skill_tag, source = "provider", is_synthetic = false) => ({
    id: `77400000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    user_id: FAKE_USER_ID,
    session_status: "completed",
    started_at: "2026-11-02T16:30:00Z",
    skill_tag,
    source,
    is_synthetic,
  });
  return [
    ...Array.from({ length: 4 }, (_, i) => make(i + 1, "article_usage")),
    ...Array.from({ length: 3 }, (_, i) => make(i + 11, "verb_tense_past")),
    make(21, "unknown_tag"),
    make(22, "  "),
    make(23, "pronunciation"),
    ...Array.from({ length: 2 }, (_, i) => make(i + 31, "subject_verb_agreement")),
    ...Array.from({ length: 2 }, (_, i) => make(i + 41, "verb_tense_present")),
    make(51, "preposition"),
    make(61, "article_usage", "demo_rule"),
    make(62, "article_usage", "demo_mock"),
    make(63, "article_usage", "provider", true),
    {
      ...make(64, "article_usage"),
      session_status: "active",
    },
    {
      ...make(65, "article_usage"),
      user_id: "00000000-0000-0000-0000-000000000002",
    },
  ];
}

function weeklyGrammarSummary(endDate, timezone, fixture) {
  const windows = weeklyWindows(endDate, timezone);
  const firstDay = windows[0];
  const lastDay = windows[windows.length - 1];
  const counts = new Map();
  let total = 0;
  for (const record of grammarFixtures(fixture)) {
    if (
      record.user_id !== FAKE_USER_ID ||
      record.session_status !== "completed" ||
      record.is_synthetic ||
      record.source === "demo_rule" ||
      record.source === "demo_mock"
    ) {
      continue;
    }
    const startedMs = Date.parse(record.started_at);
    if (startedMs < Date.parse(firstDay.start) || startedMs >= Date.parse(lastDay.end)) continue;
    const tag = WEEKLY_GRAMMAR_TAGS.has(record.skill_tag) ? record.skill_tag : "other";
    counts.set(tag, (counts.get(tag) ?? 0) + 1);
    total += 1;
  }
  const items = [...counts.entries()]
    .map(([skill_tag, count]) => ({ skill_tag, count }))
    .sort(
      (a, b) =>
        b.count - a.count || (a.skill_tag < b.skill_tag ? -1 : a.skill_tag > b.skill_tag ? 1 : 0),
    );
  return {
    start: firstDay.start,
    end: lastDay.end,
    total_errors: total,
    items: items.slice(0, 3),
  };
}

function validateWindow(startStr, endStr, { required = false } = {}) {
  if (required && (!startStr || !endStr)) {
    return { error: 422, detail: "start and end required" };
  }
  if ((startStr && !endStr) || (!startStr && endStr)) {
    return { error: 422, detail: "start and end must be paired" };
  }
  if (!startStr && !endStr) {
    return { startMs: null, endMs: null, startIso: null, endIso: null };
  }

  // 必须带有明确时区指示 (Z 或 +HH:MM 或 -HH:MM)
  if (!/([zZ]|[+-]\d{2}:\d{2})$/.test(startStr) || !/([zZ]|[+-]\d{2}:\d{2})$/.test(endStr)) {
    return { error: 422, detail: "Time window must contain timezone info" };
  }

  const startDate = new Date(startStr);
  const endDate = new Date(endStr);
  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    return { error: 422, detail: "Invalid datetime format" };
  }

  const startMs = startDate.getTime();
  const endMs = endDate.getTime();

  if (startMs >= endMs) {
    return { error: 422, detail: "start must be earlier than end" };
  }

  if (endMs - startMs > 48 * 3600 * 1000) {
    return { error: 422, detail: "Window span cannot exceed 48 hours" };
  }

  return {
    startMs,
    endMs,
    startIso: startDate.toISOString(),
    endIso: endDate.toISOString(),
  };
}

function paginateItems(allList, url, { endpoint, statusFilter, startIso, endIso }) {
  const rawLimit = url.searchParams.get("limit");
  let limit = 50;
  if (rawLimit !== null) {
    if (!/^\d+$/.test(rawLimit)) {
      return { error: 422, body: { detail: "limit must be a positive integer" } };
    }
    limit = parseInt(rawLimit, 10);
    if (limit < 1 || limit > 100) {
      return { error: 422, body: { detail: "limit must be between 1 and 100" } };
    }
  }

  const cursor = url.searchParams.get("cursor");
  let filtered = allList;

  if (cursor !== null) {
    if (typeof cursor !== "string" || cursor.length === 0 || cursor.length > 1024) {
      return { error: 422, body: { detail: "Invalid pagination cursor" } };
    }
    if (!/^[A-Za-z0-9_-]+={0,2}$/.test(cursor)) {
      return { error: 422, body: { detail: "Invalid pagination cursor" } };
    }

    let decoded;
    try {
      decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    } catch {
      return { error: 422, body: { detail: "Invalid pagination cursor" } };
    }

    if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) {
      return { error: 422, body: { detail: "Invalid pagination cursor" } };
    }

    const keys = Object.keys(decoded);
    if (keys.length !== 8 || !REQUIRED_CURSOR_KEYS.every((k) => k in decoded)) {
      return { error: 422, body: { detail: "Invalid pagination cursor" } };
    }

    if (typeof decoded.v !== "number" || !Number.isInteger(decoded.v) || decoded.v !== 1) {
      return { error: 422, body: { detail: "Invalid pagination cursor" } };
    }

    if (decoded.u !== FAKE_USER_ID) {
      return { error: 422, body: { detail: "Invalid pagination cursor" } };
    }

    if (decoded.ep !== endpoint) {
      return { error: 422, body: { detail: "Invalid pagination cursor" } };
    }

    if (decoded.st !== (statusFilter ?? null)) {
      return { error: 422, body: { detail: "Invalid pagination cursor" } };
    }

    if (decoded.s !== (startIso ?? null) || decoded.e !== (endIso ?? null)) {
      return { error: 422, body: { detail: "Invalid pagination cursor" } };
    }

    if (typeof decoded.t !== "string" || !/([zZ]|[+-]\d{2}:\d{2})$/.test(decoded.t)) {
      return { error: 422, body: { detail: "Invalid pagination cursor" } };
    }

    const cursorTime = new Date(decoded.t).getTime();
    if (isNaN(cursorTime)) {
      return { error: 422, body: { detail: "Invalid pagination cursor" } };
    }

    const cursorId = decoded.id;
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (typeof cursorId !== "string" || !UUID_RE.test(cursorId)) {
      return { error: 422, body: { detail: "Invalid pagination cursor" } };
    }

    filtered = allList.filter((item) => {
      const itemTime = new Date(item.started_at).getTime();
      if (itemTime < cursorTime) return true;
      if (itemTime === cursorTime && item.id < cursorId) return true;
      return false;
    });
  }

  const hasMore = filtered.length > limit;
  const items = filtered.slice(0, limit);
  let nextCursor = null;
  if (hasMore && items.length > 0) {
    const last = items[items.length - 1];
    const payload = {
      v: 1,
      u: FAKE_USER_ID,
      ep: endpoint,
      st: statusFilter ?? null,
      s: startIso ?? null,
      e: endIso ?? null,
      t: new Date(last.started_at).toISOString(),
      id: last.id,
    };
    nextCursor = Buffer.from(JSON.stringify(payload)).toString("base64url");
  }
  return { items, next_cursor: nextCursor };
}

const server = createServer(async (request, response) => {
  const method = request.method ?? "GET";
  const pathname = new URL(request.url ?? "/", `http://${host}:${port}`).pathname;

  if (pathname !== "/api/health" && request.headers.authorization !== "Bearer e2e-dev-token") {
    sendJson(response, 401, { detail: "Authentication required." });
    return;
  }

  // Per-request fixtures avoid global mutable state across browser workers.
  if (method === "GET" && pathname === "/api/health/ready") {
    const fixture = request.headers["x-e2e-readiness"];
    const codes = new Set([
      "database_unavailable",
      "user_unavailable",
      "settings_required",
      "custom_unverified",
      "custom_incomplete",
      "permission_denied",
      "livekit_unconfigured",
      "provider_unconfigured",
    ]);
    if (fixture === "html") {
      response.writeHead(503, { "Content-Type": "text/html; charset=utf-8" });
      response.end("<html>synthetic-readiness-canary</html>");
      return;
    }
    if (codes.has(fixture) || fixture === "unknown" || fixture === "legacy") {
      sendJson(response, 503, {
        detail: {
          status: "not_ready",
          ...(fixture === "legacy" ? {} : { code: fixture }),
          errors: { config: "synthetic-readiness-canary" },
        },
      });
      return;
    }
    if (fixture === "ready") {
      sendJson(response, 200, { status: "ready" });
      return;
    }
  }

  if (method === "GET" && (pathname === "/api/health" || pathname === "/api/health/ready")) {
    sendJson(response, 200, { status: "ok", service: "echotalk-e2e-fake" });
    return;
  }

  if (method === "GET" && pathname === "/api/call-capabilities") {
    sendJson(response, 200, {
      protocol_version: 1,
      call_lease_mode: "disabled",
    });
    return;
  }

  if (method === "GET" && pathname === "/api/user/settings") {
    sendJson(response, 200, {
      is_custom_mode: false,
      is_custom_verified: false,
      subscription_tier: "free",
      theme: "warm",
      stt_provider: null,
      llm_provider: null,
      llm_model: null,
      tts_provider: null,
      has_stt_key: false,
      has_llm_key: false,
      has_tts_key: false,
      stt_status: "unconfigured",
      llm_status: "unconfigured",
      tts_status: "unconfigured",
    });
    return;
  }

  if (method === "GET" && pathname === "/api/user/data-export") {
    sendJson(response, 200, userDataExportFixture(), {
      "Content-Disposition": 'attachment; filename="echotalk-user-data-export.json"',
      "X-Content-Type-Options": "nosniff",
    });
    return;
  }

  if (method === "GET" && pathname === "/api/curriculum/next") {
    sendJson(response, 200, {
      weakest_skill: "grammar_past_tense",
      weakest_skill_mastery: 0.4,
      target_level: "B1",
      recommendations: [
        {
          scenario_name: "travel_planning",
          difficulty_cefr: "B1",
          category: "conversation",
          focus_skills: ["grammar_past_tense"],
          system_prompt_template: "Practice planning a trip.",
        },
      ],
    });
    return;
  }

  if (method === "GET" && pathname === "/api/assessments/knowledge/states") {
    sendJson(response, 200, []);
    return;
  }

  if (method === "GET" && pathname === "/api/assessments/knowledge/skills") {
    sendJson(response, 200, []);
    return;
  }

  if (method === "POST" && pathname === "/api/sessions") {
    const body = await readJson(request);
    const session = createSession(typeof body.mode === "string" ? body.mode : "scenario");
    sessions.set(session.id, session);
    sendJson(response, 201, session);
    return;
  }

  const userSessions = [
    ...sessions.values(),
    ...weeklyFixtures(request.headers["x-e2e-weekly-fixture"]),
  ].filter((session) => session.user_id === FAKE_USER_ID);

  if (method === "GET" && pathname === "/api/sessions/weekly-progress") {
    const url = new URL(request.url ?? "/", `http://${host}:${port}`);
    try {
      const days = weeklyWindows(
        url.searchParams.get("end_date"),
        url.searchParams.get("timezone"),
      ).map((day) => ({
        ...day,
        completed_sessions: userSessions.filter(
          (session) =>
            session.status === "completed" &&
            Date.parse(session.started_at) >= Date.parse(day.start) &&
            Date.parse(session.started_at) < Date.parse(day.end),
        ).length,
      }));
      sendJson(response, 200, { days });
    } catch {
      sendJson(response, 422, { detail: "Invalid weekly window" });
    }
    return;
  }

  if (method === "GET" && pathname === "/api/assessments/weekly-grammar") {
    const url = new URL(request.url ?? "/", `http://${host}:${port}`);
    if (request.headers["x-e2e-weekly-grammar-status"] === "503") {
      sendJson(response, 503, { detail: "Controlled weekly grammar failure." });
      return;
    }
    try {
      sendJson(
        response,
        200,
        weeklyGrammarSummary(
          url.searchParams.getAll("end_date").at(-1),
          url.searchParams.getAll("timezone").at(-1),
          request.headers["x-e2e-weekly-grammar-fixture"],
        ),
      );
    } catch {
      sendJson(response, 422, { detail: "Invalid weekly grammar window" });
    }
    return;
  }

  if (method === "GET" && pathname === "/api/sessions/daily-progress") {
    const url = new URL(request.url ?? "/", `http://${host}:${port}`);
    const win = validateWindow(url.searchParams.get("start"), url.searchParams.get("end"), {
      required: true,
    });
    if (win.error) {
      sendJson(response, win.error, { detail: win.detail });
      return;
    }

    const completedSessions = userSessions.filter((s) => {
      if (s.status !== "completed") return false;
      const t = new Date(s.started_at).getTime();
      return t >= win.startMs && t < win.endMs;
    });

    const totalTurns = completedSessions.reduce(
      (sum, s) => sum + (s.transcripts ? s.transcripts.length : 0),
      0,
    );
    sendJson(response, 200, {
      completed_sessions: completedSessions.length,
      total_turns: totalTurns,
    });
    return;
  }

  if (method === "GET" && pathname === "/api/sessions") {
    const url = new URL(request.url ?? "/", `http://${host}:${port}`);
    const statusFilter = url.searchParams.get("status");
    if (statusFilter !== null && !VALID_STATUSES.has(statusFilter)) {
      sendJson(response, 422, { detail: `无效的 status 值: '${statusFilter}'` });
      return;
    }

    const win = validateWindow(url.searchParams.get("start"), url.searchParams.get("end"), {
      required: false,
    });
    if (win.error) {
      sendJson(response, win.error, { detail: win.detail });
      return;
    }

    const allSessions = userSessions
      .filter((s) => {
        if (statusFilter && s.status !== statusFilter) return false;
        if (win.startMs !== null && win.endMs !== null) {
          const t = new Date(s.started_at).getTime();
          if (t < win.startMs || t >= win.endMs) return false;
        }
        return true;
      })
      .map(({ id, mode, status, started_at, ended_at }) => ({
        id,
        mode,
        status,
        started_at,
        ended_at,
      }))
      .sort((a, b) => {
        const timeDiff = new Date(b.started_at).getTime() - new Date(a.started_at).getTime();
        if (timeDiff !== 0) return timeDiff;
        return b.id.localeCompare(a.id);
      });

    const res = paginateItems(allSessions, url, {
      endpoint: "history",
      statusFilter,
      startIso: win.startIso,
      endIso: win.endIso,
    });
    if (res.error) {
      sendJson(response, res.error, res.body);
      return;
    }
    sendJson(response, 200, res);
    return;
  }

  if (method === "GET" && pathname === "/api/sessions/active") {
    const url = new URL(request.url ?? "/", `http://${host}:${port}`);
    const win = validateWindow(url.searchParams.get("start"), url.searchParams.get("end"), {
      required: false,
    });
    if (win.error) {
      sendJson(response, win.error, { detail: win.detail });
      return;
    }

    const activeSessions = userSessions
      .filter((s) => {
        if (s.status !== "active") return false;
        if (win.startMs !== null && win.endMs !== null) {
          const t = new Date(s.started_at).getTime();
          if (t < win.startMs || t >= win.endMs) return false;
        }
        return true;
      })
      .map(({ id, mode, status, started_at, ended_at }) => ({
        id,
        mode,
        status,
        started_at,
        ended_at,
      }))
      .sort((a, b) => {
        const timeDiff = new Date(b.started_at).getTime() - new Date(a.started_at).getTime();
        if (timeDiff !== 0) return timeDiff;
        return b.id.localeCompare(a.id);
      });

    const res = paginateItems(activeSessions, url, {
      endpoint: "active",
      statusFilter: "active",
      startIso: win.startIso,
      endIso: win.endIso,
    });
    if (res.error) {
      sendJson(response, res.error, res.body);
      return;
    }
    sendJson(response, 200, res);
    return;
  }

  const sessionDetailMatch = pathname.match(/^\/api\/sessions\/([^/]+)$/);
  if (method === "GET" && sessionDetailMatch) {
    const session = sessions.get(sessionDetailMatch[1]);
    sendJson(response, session ? 200 : 404, session ?? { detail: "Session not found" });
    return;
  }

  // 主路径夹具：只签发明确标注的假 Token 与不可达信令地址，不连接任何真实 LiveKit。
  const tokenMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/token$/);
  if (method === "GET" && tokenMatch) {
    const session = sessions.get(tokenMatch[1]);
    if (!session) {
      sendJson(response, 404, { detail: "Session not found" });
      return;
    }
    if (session.status !== "active") {
      sendJson(response, 409, { detail: "Session is not active" });
      return;
    }
    sendJson(response, 200, { token: "e2e-fake-livekit-token", ws_url: "wss://127.0.0.1:9" });
    return;
  }

  const dispatchMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/dispatch$/);
  if (method === "POST" && dispatchMatch) {
    const session = sessions.get(dispatchMatch[1]);
    if (!session) {
      sendJson(response, 404, { detail: "Session not found" });
      return;
    }
    sendJson(response, 200, { dispatched: true });
    return;
  }

  const endSessionMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/end$/);
  if (method === "POST" && endSessionMatch) {
    const session = sessions.get(endSessionMatch[1]);
    if (!session) {
      sendJson(response, 404, { detail: "Session not found" });
      return;
    }
    session.status = "completed";
    session.ended_at = new Date().toISOString();
    analysisJobs.set(session.id, "pending");
    sendJson(response, 200, session);
    return;
  }

  const analysisStatusMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/analysis-status$/);
  if (method === "GET" && analysisStatusMatch) {
    const sessionId = analysisStatusMatch[1];
    const queuedStatus = analysisJobs.get(sessionId);
    const status = queuedStatus
      ? queuedStatus
      : sessionId.startsWith("analysis-success") || sessionId.startsWith("grammar-only")
        ? "succeeded"
        : sessionId.startsWith("analysis-failure")
          ? "failed"
          : sessionId.startsWith("analysis-unsupported")
            ? "failed"
            : sessionId.startsWith("analysis-pending")
              ? "pending"
              : sessionId.startsWith("analysis-running")
                ? "running"
                : undefined;
    if (!status) {
      sendJson(response, 404, { detail: "Analysis job not found" });
      return;
    }
    sendJson(response, 200, {
      session_id: sessionId,
      status,
      attempt_count: status === "failed" ? 3 : status === "pending" ? 0 : 1,
      error_code:
        status === "failed"
          ? sessionId.startsWith("analysis-unsupported")
            ? "analysis_unsupported"
            : "analysis_failed"
          : null,
      retryable: status === "failed" && !sessionId.startsWith("analysis-unsupported"),
      started_at: status === "pending" ? null : new Date().toISOString(),
      finished_at: status === "succeeded" || status === "failed" ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    });
    if (sessionId.startsWith("analysis-failure") && status === "pending") {
      analysisJobs.set(sessionId, "succeeded");
    }
    return;
  }

  const analysisRetryMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/analysis-retry$/);
  if (method === "POST" && analysisRetryMatch) {
    const sessionId = analysisRetryMatch[1];
    analysisJobs.set(sessionId, "pending");
    sendJson(response, 200, {
      session_id: sessionId,
      status: "pending",
      attempt_count: 3,
      error_code: null,
      retryable: false,
      started_at: null,
      finished_at: null,
      updated_at: new Date().toISOString(),
    });
    return;
  }

  const grammarOnlyMatch = pathname.match(
    /^\/api\/assessments\/(grammar-only(?:-[a-z0-9]+(?:-[a-z0-9]+)*)?)\/grammar$/,
  );
  if (method === "GET" && grammarOnlyMatch) {
    const sessionId = grammarOnlyMatch[1];
    if (sessionId.startsWith("grammar-only-empty")) {
      sendJson(response, 200, []);
      return;
    }
    sendJson(response, 200, [
      {
        id: "77500000-0000-4000-8000-000000000001",
        session_id: sessionId,
        skill_tag: "verb_tense_past",
        original: "I go",
        corrected: "I went",
        error_type: "wrong_tense",
        source: "demo_rule",
        provider: null,
        model_version: "demo-grammar-rules-v1",
        is_synthetic: true,
        confidence: 0.5,
        created_at: new Date().toISOString(),
      },
    ]);
    return;
  }

  const assessmentGrammarMatch = pathname.match(
    /^\/api\/assessments\/((?:analysis-success|analysis-failure)(?:-[a-z0-9]+(?:-[a-z0-9]+)*)?)\/grammar$/,
  );
  if (method === "GET" && assessmentGrammarMatch) {
    sendJson(response, 200, []);
    return;
  }

  const assessmentDetailMatch = pathname.match(
    /^\/api\/assessments\/((?:analysis-success|analysis-failure)(?:-[a-z0-9]+(?:-[a-z0-9]+)*)?)$/,
  );
  if (method === "GET" && assessmentDetailMatch) {
    const sessionId = assessmentDetailMatch[1];
    sendJson(response, 200, {
      id: randomUUID(),
      session_id: sessionId,
      overall_score: 88,
      phoneme_alignment: [
        {
          position: 0,
          phoneme: "HH",
          expected: "HH",
          actual: "HH",
          type: "correct",
        },
      ],
      source: "demo_mock",
      provider: null,
      model_version: "demo-phoneme-rules-v1",
      is_synthetic: true,
      confidence: 0,
      provider_response_ref: null,
      created_at: new Date().toISOString(),
    });
    return;
  }

  sendJson(response, 404, { detail: `No fake route for ${method} ${pathname}` });
});

server.listen(port, host, () => {
  const address = server.address();
  const actualPort = typeof address === "object" && address !== null ? address.port : port;
  console.log(`[fake-api] ready on http://${host}:${actualPort}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
