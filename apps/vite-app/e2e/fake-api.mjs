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

  if (method === "GET" && pathname === "/api/sessions") {
    sendJson(
      response,
      200,
      [...sessions.values()].map(({ transcripts: _transcripts, ...session }) => session),
    );
    return;
  }

  if (method === "GET" && pathname === "/api/sessions/active") {
    const activeSessions = [...sessions.values()]
      .filter((s) => s.status === "active")
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
    sendJson(response, 200, activeSessions);
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
