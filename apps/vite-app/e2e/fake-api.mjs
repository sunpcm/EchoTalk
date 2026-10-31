import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

const host = "127.0.0.1";
const port = Number(process.env.E2E_API_PORT ?? 18181);
const sessions = new Map();
const analysisJobs = new Map();

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(body));
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

  if (method === "GET" && pathname === "/api/sessions/daily-progress") {
    const url = new URL(request.url ?? "/", `http://${host}:${port}`);
    const win = validateWindow(url.searchParams.get("start"), url.searchParams.get("end"), {
      required: true,
    });
    if (win.error) {
      sendJson(response, win.error, { detail: win.detail });
      return;
    }

    const completedSessions = [...sessions.values()].filter((s) => {
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

    const allSessions = [...sessions.values()]
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

    const activeSessions = [...sessions.values()]
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
      : sessionId.startsWith("analysis-success")
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
