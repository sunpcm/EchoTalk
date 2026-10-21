import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  checkHealthReady,
  createSession,
  getSessionToken,
  endSession,
  dispatchAgent,
  listSessions,
  listActiveSessions,
  getSessionDetail,
  getAnalysisStatus,
  retryAnalysis,
  getAssessment,
  getGrammarErrors,
  getKnowledgeStates,
  getSkills,
  getRecommendedCurriculum,
  getUserSettings,
  updateUserSettings,
  ApiError,
  getBaseUrl,
} from "./api";
import {
  setAccessTokenProvider,
  getAuthRevision,
  invalidateAuthSession,
  _resetAuthForTesting,
} from "./auth";
import { zhCN } from "@/i18n/zh-CN";

describe("API client", () => {
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

  const fetchMock = () => vi.mocked(globalThis.fetch);

  describe("Error handling", () => {
    it("parses health check errors correctly", async () => {
      const mockResponse = {
        ok: false,
        status: 503,
        json: () =>
          Promise.resolve({
            detail: {
              status: "not_ready",
              errors: {
                config: "自定义模式未验证通过。",
              },
            },
          }),
      };
      fetchMock().mockResolvedValue(mockResponse as unknown as Response);

      try {
        await checkHealthReady();
        expect.fail("Should have thrown");
      } catch (e: unknown) {
        expect(e).toBeInstanceOf(ApiError);
        if (e instanceof ApiError) {
          expect(e.status).toBe(503);
          expect(e.message).toBe("自定义模式未验证通过。");
        }
      }
    });

    it("parses validation errors correctly", async () => {
      const mockResponse = {
        ok: false,
        status: 422,
        json: () =>
          Promise.resolve({
            detail: [
              {
                loc: ["body", "mode"],
                msg: "field required",
                type: "value_error.missing",
              },
            ],
          }),
      };
      fetchMock().mockResolvedValue(mockResponse as unknown as Response);

      try {
        await checkHealthReady();
        expect.fail("Should have thrown");
      } catch (e: unknown) {
        expect(e).toBeInstanceOf(ApiError);
        if (e instanceof ApiError) {
          expect(e.status).toBe(422);
          expect(e.message).toBe("数据验证失败 (body.mode): field required");
        }
      }
    });

    it("parses string detail correctly", async () => {
      const mockResponse = {
        ok: false,
        status: 404,
        json: () =>
          Promise.resolve({
            detail: "会话不存在",
          }),
      };
      fetchMock().mockResolvedValue(mockResponse as unknown as Response);

      try {
        await checkHealthReady();
        expect.fail("Should have thrown");
      } catch (e: unknown) {
        expect(e).toBeInstanceOf(ApiError);
        if (e instanceof ApiError) {
          expect(e.status).toBe(404);
          expect(e.message).toBe("会话不存在");
        }
      }
    });

    it("parses object detail without message or errors correctly", async () => {
      const mockResponse = {
        ok: false,
        status: 500,
        json: () =>
          Promise.resolve({
            detail: {
              someField: "someValue",
            },
          }),
      };
      fetchMock().mockResolvedValue(mockResponse as unknown as Response);

      try {
        await checkHealthReady();
        expect.fail("Should have thrown");
      } catch (e: unknown) {
        expect(e).toBeInstanceOf(ApiError);
        if (e instanceof ApiError) {
          expect(e.status).toBe(500);
          expect(e.message).toBe('{"someField":"someValue"}');
        }
      }
    });
  });

  describe("Health check API", () => {
    it("calls checkHealthReady successfully", async () => {
      const mockResult = { status: "ready" };
      fetchMock().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResult),
      } as unknown as Response);

      const res = await checkHealthReady();
      expect(res).toEqual(mockResult);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${getBaseUrl()}/health/ready`,
        expect.any(Object),
      );
      const options = fetchMock().mock.calls[0]?.[1];
      const headers = new Headers(options?.headers);
      expect(headers.get("Content-Type")).toBe("application/json");
      expect(headers.get("Authorization")).toBe("Bearer test-access-token");
    });

    it("stops sending authorization immediately after logout", async () => {
      setAccessTokenProvider(() => null);
      fetchMock().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: "ready" }),
      } as unknown as Response);

      await checkHealthReady();
      const options = fetchMock().mock.calls[0]?.[1];
      expect(new Headers(options?.headers).has("Authorization")).toBe(false);
    });
  });

  describe("Session API", () => {
    it("creates a session without docContext", async () => {
      const mockSession = {
        id: "sess-1",
        user_id: "u-1",
        mode: "free_talk",
        status: "active",
        started_at: "2025-01-01T00:00:00Z",
        ended_at: null,
        transcripts: [],
      };
      fetchMock().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockSession),
      } as unknown as Response);

      const res = await createSession("free_talk");
      expect(res).toEqual(mockSession);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${getBaseUrl()}/sessions`,
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ mode: "free_talk" }),
        }),
      );
    });

    it("creates a session with docContext", async () => {
      const docContext = {
        content_type: "article",
        raw_text: "Sample text",
        prompt: "Discuss this article",
      };
      const mockSession = {
        id: "sess-2",
        user_id: "u-1",
        mode: "doc_chat",
        status: "active",
        started_at: "2025-01-01T00:00:00Z",
        ended_at: null,
        transcripts: [],
      };
      fetchMock().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockSession),
      } as unknown as Response);

      const res = await createSession("doc_chat", docContext);
      expect(res).toEqual(mockSession);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${getBaseUrl()}/sessions`,
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ mode: "doc_chat", doc_context: docContext }),
        }),
      );
    });

    it("fetches session token", async () => {
      const mockToken = { token: "token-123", ws_url: "wss://livekit.example.com" };
      fetchMock().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockToken),
      } as unknown as Response);

      const res = await getSessionToken("sess-1");
      expect(res).toEqual(mockToken);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${getBaseUrl()}/sessions/sess-1/token`,
        expect.anything(),
      );
    });

    it("ends a session", async () => {
      const mockSession = {
        id: "sess-1",
        user_id: "u-1",
        mode: "free_talk",
        status: "ended",
        started_at: "2025-01-01T00:00:00Z",
        ended_at: "2025-01-01T00:10:00Z",
        transcripts: [],
      };
      fetchMock().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockSession),
      } as unknown as Response);

      const res = await endSession("sess-1");
      expect(res).toEqual(mockSession);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${getBaseUrl()}/sessions/sess-1/end`,
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("dispatches agent", async () => {
      const mockDispatch = { dispatched: true };
      fetchMock().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockDispatch),
      } as unknown as Response);

      const res = await dispatchAgent("sess-1");
      expect(res).toEqual(mockDispatch);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${getBaseUrl()}/sessions/sess-1/dispatch`,
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("lists sessions", async () => {
      const mockList = [
        {
          id: "sess-1",
          mode: "free_talk",
          status: "ended",
          started_at: "2025-01-01T00:00:00Z",
          ended_at: "2025-01-01T00:10:00Z",
        },
      ];
      fetchMock().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockList),
      } as unknown as Response);

      const res = await listSessions();
      expect(res).toEqual(mockList);
      expect(globalThis.fetch).toHaveBeenCalledWith(`${getBaseUrl()}/sessions`, expect.anything());
    });

    it("lists active sessions preserving backend order and passing auth token", async () => {
      const mockActiveSessions = [
        {
          id: "sess-2",
          mode: "doc_chat",
          status: "active",
          started_at: "2025-01-01T01:00:00Z",
          ended_at: null,
        },
        {
          id: "sess-1",
          mode: "free_talk",
          status: "active",
          started_at: "2025-01-01T00:00:00Z",
          ended_at: null,
        },
      ];
      fetchMock().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockActiveSessions),
      } as unknown as Response);

      const res = await listActiveSessions();
      expect(res).toEqual(mockActiveSessions);
      expect(res[0].id).toBe("sess-2");
      expect(res[1].id).toBe("sess-1");
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${getBaseUrl()}/sessions/active`,
        expect.objectContaining({
          headers: expect.any(Headers),
        }),
      );
      const options = fetchMock().mock.calls[0]?.[1];
      const headers = new Headers(options?.headers);
      expect(headers.get("Authorization")).toBe("Bearer test-access-token");
    });

    it("gets session detail", async () => {
      const mockDetail = {
        id: "sess-1",
        user_id: "u-1",
        mode: "free_talk",
        status: "ended",
        started_at: "2025-01-01T00:00:00Z",
        ended_at: "2025-01-01T00:10:00Z",
        transcripts: [
          {
            id: 1,
            session_id: "sess-1",
            role: "user",
            content: "Hello",
            audio_url: null,
            timestamp_ms: 1000,
          },
        ],
      };
      fetchMock().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockDetail),
      } as unknown as Response);

      const res = await getSessionDetail("sess-1");
      expect(res).toEqual(mockDetail);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${getBaseUrl()}/sessions/sess-1`,
        expect.anything(),
      );
    });

    it("gets explicit analysis status", async () => {
      const status = {
        session_id: "sess-1",
        status: "running",
        attempt_count: 1,
        error_code: null,
        retryable: false,
        started_at: "2025-01-01T00:00:01Z",
        finished_at: null,
        updated_at: "2025-01-01T00:00:01Z",
      };
      fetchMock().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(status),
      } as unknown as Response);

      await expect(getAnalysisStatus("sess-1")).resolves.toEqual(status);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${getBaseUrl()}/sessions/sess-1/analysis-status`,
        expect.anything(),
      );
    });

    it("retries a failed analysis", async () => {
      const status = {
        session_id: "sess-1",
        status: "pending",
        attempt_count: 3,
        error_code: null,
        retryable: false,
        started_at: "2025-01-01T00:00:01Z",
        finished_at: null,
        updated_at: "2025-01-01T00:01:00Z",
      };
      fetchMock().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(status),
      } as unknown as Response);

      await expect(retryAnalysis("sess-1")).resolves.toEqual(status);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${getBaseUrl()}/sessions/sess-1/analysis-retry`,
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  describe("Assessment API", () => {
    it("gets assessment", async () => {
      const mockAssessment = {
        id: "asm-1",
        session_id: "sess-1",
        overall_score: 85,
        phoneme_alignment: [],
        source: "demo_mock",
        provider: null,
        model_version: "demo-phoneme-rules-v1",
        is_synthetic: true,
        confidence: 0,
        provider_response_ref: null,
        created_at: "2025-01-01T00:00:00Z",
      };
      fetchMock().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockAssessment),
      } as unknown as Response);

      const res = await getAssessment("sess-1");
      expect(res).toEqual(mockAssessment);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${getBaseUrl()}/assessments/sess-1`,
        expect.anything(),
      );
    });

    it("gets grammar errors", async () => {
      const mockGrammarErrors = [
        {
          id: "ge-1",
          session_id: "sess-1",
          skill_tag: "past_tense",
          original: "I go yesterday",
          corrected: "I went yesterday",
          error_type: "tense",
          created_at: "2025-01-01T00:00:00Z",
        },
      ];
      fetchMock().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockGrammarErrors),
      } as unknown as Response);

      const res = await getGrammarErrors("sess-1");
      expect(res).toEqual(mockGrammarErrors);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${getBaseUrl()}/assessments/sess-1/grammar`,
        expect.anything(),
      );
    });

    it("gets knowledge states", async () => {
      const mockKnowledge = [
        {
          id: "ks-1",
          user_id: "u-1",
          skill_id: "sk-1",
          skill_name: "Past Tense",
          skill_category: "grammar",
          p_mastery: 0.75,
          updated_at: "2025-01-01T00:00:00Z",
        },
      ];
      fetchMock().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockKnowledge),
      } as unknown as Response);

      const res = await getKnowledgeStates();
      expect(res).toEqual(mockKnowledge);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${getBaseUrl()}/assessments/knowledge/states`,
        expect.anything(),
      );
    });

    it("gets skills", async () => {
      const mockSkills = [
        {
          id: "sk-1",
          name: "Past Tense",
          category: "grammar",
          description: "Use of past tense verbs",
        },
      ];
      fetchMock().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockSkills),
      } as unknown as Response);

      const res = await getSkills();
      expect(res).toEqual(mockSkills);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${getBaseUrl()}/assessments/knowledge/skills`,
        expect.anything(),
      );
    });
  });

  describe("Curriculum API", () => {
    it("gets recommended curriculum", async () => {
      const mockCurriculum = {
        weakest_skill: "Past Tense",
        weakest_skill_mastery: 0.4,
        target_level: "B1",
        recommendations: [
          {
            scenario_name: "Job Interview",
            difficulty_cefr: "B1",
            category: "business",
            focus_skills: ["past_tense"],
            system_prompt_template: "Act as an interviewer",
          },
        ],
      };
      fetchMock().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockCurriculum),
      } as unknown as Response);

      const res = await getRecommendedCurriculum();
      expect(res).toEqual(mockCurriculum);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${getBaseUrl()}/curriculum/next`,
        expect.anything(),
      );
    });
  });

  describe("User Settings API", () => {
    it("gets user settings", async () => {
      const mockSettings = {
        is_custom_mode: false,
        stt_provider: "deepgram",
        llm_provider: "openrouter",
        llm_model: "gpt-4o",
        tts_provider: "cartesia",
        has_stt_key: true,
        has_llm_key: true,
        has_tts_key: true,
        stt_status: "verified",
        llm_status: "verified",
        tts_status: "verified",
      };
      fetchMock().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockSettings),
      } as unknown as Response);

      const res = await getUserSettings();
      expect(res).toEqual(mockSettings);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${getBaseUrl()}/user/settings`,
        expect.anything(),
      );
    });

    it("updates user settings", async () => {
      const updateData = {
        is_custom_mode: true,
        llm_provider: "siliconflow" as const,
        llm_key: "sk-secret-key",
      };
      const mockResponse = {
        is_custom_mode: true,
        stt_provider: "deepgram",
        llm_provider: "siliconflow",
        llm_model: "deepseek-v3",
        tts_provider: "cartesia",
        has_stt_key: true,
        has_llm_key: true,
        has_tts_key: true,
        stt_status: "verified",
        llm_status: "verified",
        tts_status: "verified",
      };
      fetchMock().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      } as unknown as Response);

      const res = await updateUserSettings(updateData);
      expect(res).toEqual(mockResponse);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${getBaseUrl()}/user/settings`,
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify(updateData),
        }),
      );
    });
  });

  describe("Auth revision and 401 handling", () => {
    it("aborts before fetch if auth revision changes during token acquisition", async () => {
      fetchMock().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: "ready" }),
      } as unknown as Response);

      let triggerRevisionChangeDuringToken: () => void = () => undefined;
      setAccessTokenProvider(async () => {
        triggerRevisionChangeDuringToken();
        return "token-1";
      });

      triggerRevisionChangeDuringToken = () => {
        invalidateAuthSession();
      };

      await expect(checkHealthReady()).rejects.toThrow(zhCN.auth.sessionChanged);
      // 绝不能用新账号凭据发送旧意图请求
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("triggers invalidateAuthSession on 401 and propagates ApiError(401) without retrying", async () => {
      const initialRev = getAuthRevision();
      fetchMock().mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ detail: "Token invalid" }),
      } as unknown as Response);

      await expect(checkHealthReady()).rejects.toThrow(ApiError);
      // revision 应被递增
      expect(getAuthRevision()).toBeGreaterThan(initialRev);
      // 绝不重放写请求或重试
      expect(fetchMock()).toHaveBeenCalledTimes(1);
    });

    it("handles 401 on listActiveSessions by invalidating session", async () => {
      const initialRev = getAuthRevision();
      fetchMock().mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ detail: "Unauthorized" }),
      } as unknown as Response);

      await expect(listActiveSessions()).rejects.toThrow(ApiError);
      expect(getAuthRevision()).toBeGreaterThan(initialRev);
      expect(fetchMock()).toHaveBeenCalledTimes(1);
    });

    it("does not invalidate newer session if 401 is from a stale request with an older revision", async () => {
      let resolveFetch!: (res: Response) => void;
      fetchMock().mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveFetch = resolve;
          }),
      );

      const requestPromise = checkHealthReady();
      // 等待微任务让 fetch 被发起调用
      await Promise.resolve();

      // 在请求在途期间，发生登出或新登录，revision 递增
      invalidateAuthSession();
      const currentRev = getAuthRevision();

      // 旧请求迟到返回 401
      resolveFetch({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ detail: "Stale 401" }),
      } as unknown as Response);

      await expect(requestPromise).rejects.toThrow(ApiError);
      // 当前较新的 revision 绝不应被旧 401 冲掉！
      expect(getAuthRevision()).toBe(currentRev);
    });
  });
});
