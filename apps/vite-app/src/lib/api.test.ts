import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  checkHealthReady,
  createSession,
  getSessionToken,
  endSession,
  dispatchAgent,
  listSessions,
  getSessionDetail,
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

describe("API client", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

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
      (globalThis.fetch as any).mockResolvedValue(mockResponse);

      try {
        await checkHealthReady();
        expect.fail("Should have thrown");
      } catch (e: any) {
        expect(e).toBeInstanceOf(ApiError);
        expect(e.status).toBe(503);
        expect(e.message).toBe("自定义模式未验证通过。");
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
      (globalThis.fetch as any).mockResolvedValue(mockResponse);

      try {
        await checkHealthReady();
        expect.fail("Should have thrown");
      } catch (e: any) {
        expect(e).toBeInstanceOf(ApiError);
        expect(e.status).toBe(422);
        expect(e.message).toBe("数据验证失败 (body.mode): field required");
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
      (globalThis.fetch as any).mockResolvedValue(mockResponse);

      try {
        await checkHealthReady();
        expect.fail("Should have thrown");
      } catch (e: any) {
        expect(e).toBeInstanceOf(ApiError);
        expect(e.status).toBe(404);
        expect(e.message).toBe("会话不存在");
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
      (globalThis.fetch as any).mockResolvedValue(mockResponse);

      try {
        await checkHealthReady();
        expect.fail("Should have thrown");
      } catch (e: any) {
        expect(e).toBeInstanceOf(ApiError);
        expect(e.status).toBe(500);
        expect(e.message).toBe('{"someField":"someValue"}');
      }
    });
  });

  describe("Health check API", () => {
    it("calls checkHealthReady successfully", async () => {
      const mockResult = { status: "ready" };
      (globalThis.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResult),
      });

      const res = await checkHealthReady();
      expect(res).toEqual(mockResult);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${getBaseUrl()}/health/ready`,
        expect.objectContaining({
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            Authorization: "Bearer mock-token",
          }),
        }),
      );
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
      (globalThis.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockSession),
      });

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
      (globalThis.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockSession),
      });

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
      (globalThis.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockToken),
      });

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
      (globalThis.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockSession),
      });

      const res = await endSession("sess-1");
      expect(res).toEqual(mockSession);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${getBaseUrl()}/sessions/sess-1/end`,
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("dispatches agent", async () => {
      const mockDispatch = { dispatched: true };
      (globalThis.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockDispatch),
      });

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
      (globalThis.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockList),
      });

      const res = await listSessions();
      expect(res).toEqual(mockList);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${getBaseUrl()}/sessions`,
        expect.anything(),
      );
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
      (globalThis.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockDetail),
      });

      const res = await getSessionDetail("sess-1");
      expect(res).toEqual(mockDetail);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${getBaseUrl()}/sessions/sess-1`,
        expect.anything(),
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
        elsa_response: null,
        created_at: "2025-01-01T00:00:00Z",
      };
      (globalThis.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockAssessment),
      });

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
      (globalThis.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockGrammarErrors),
      });

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
      (globalThis.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockKnowledge),
      });

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
      (globalThis.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockSkills),
      });

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
      (globalThis.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockCurriculum),
      });

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
      (globalThis.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockSettings),
      });

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
      (globalThis.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

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
});
