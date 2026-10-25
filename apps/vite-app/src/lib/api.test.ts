import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  checkHealthReady,
  getCallCapabilities,
  parseCallCapabilities,
  claimCallLease,
  heartbeatCallLease,
  releaseCallLease,
  parseCallLeaseResponse,
  parseCallReleaseResponse,
  isValidUuid,
  isPositiveSafeInteger,
  isValidIsoCalendarTimestamp,
  validateCallLeaseOwner,
  type CallLeaseOwner,
  createSession,
  getSessionToken,
  endSession,
  dispatchAgent,
  listSessions,
  listActiveSessions,
  getDailyProgress,
  parseSessionListResponse,
  parseDailyProgressResponse,
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

  describe("Call capabilities API", () => {
    it("fetches call capabilities successfully with cache: no-store and token", async () => {
      const mockResult = { protocol_version: 1, call_lease_mode: "disabled" };
      fetchMock().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResult),
      } as unknown as Response);

      const res = await getCallCapabilities();
      expect(res).toEqual(mockResult);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${getBaseUrl()}/call-capabilities`,
        expect.objectContaining({
          cache: "no-store",
        }),
      );
      const options = fetchMock().mock.calls[0]?.[1];
      const headers = new Headers(options?.headers);
      expect(headers.get("Authorization")).toBe("Bearer test-access-token");
    });

    it("parses livekit_cloud mode correctly", async () => {
      const mockResult = { protocol_version: 1, call_lease_mode: "livekit_cloud" };
      fetchMock().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResult),
      } as unknown as Response);

      const res = await getCallCapabilities();
      expect(res).toEqual(mockResult);
    });

    it("rejects responses with extra fields", () => {
      expect(() =>
        parseCallCapabilities({
          protocol_version: 1,
          call_lease_mode: "disabled",
          extra_field: "unexpected",
        }),
      ).toThrow(/expected exactly protocol_version and call_lease_mode/);
    });

    it("rejects responses with missing fields", () => {
      expect(() => parseCallCapabilities({ protocol_version: 1 })).toThrow(
        /expected exactly protocol_version and call_lease_mode/,
      );
      expect(() => parseCallCapabilities({ call_lease_mode: "disabled" })).toThrow(
        /expected exactly protocol_version and call_lease_mode/,
      );
    });

    it("rejects responses with unsupported protocol_version", () => {
      expect(() =>
        parseCallCapabilities({ protocol_version: 2, call_lease_mode: "disabled" }),
      ).toThrow(/Unsupported capabilities protocol_version/);
      expect(() =>
        parseCallCapabilities({ protocol_version: 0, call_lease_mode: "disabled" }),
      ).toThrow(/Unsupported capabilities protocol_version/);
    });

    it("rejects responses with unsupported call_lease_mode", () => {
      expect(() =>
        parseCallCapabilities({ protocol_version: 1, call_lease_mode: "standalone" }),
      ).toThrow(/Unsupported call_lease_mode/);
    });

    it("rejects non-object responses", () => {
      expect(() => parseCallCapabilities(null)).toThrow(/expected an object/);
      expect(() => parseCallCapabilities([])).toThrow(/expected an object/);
      expect(() => parseCallCapabilities("string")).toThrow(/expected an object/);
    });

    it("propagates ApiError on 401 and invalidates auth session", async () => {
      const initialRev = getAuthRevision();
      fetchMock().mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ detail: "Unauthorized" }),
      } as unknown as Response);

      await expect(getCallCapabilities()).rejects.toThrow(ApiError);
      expect(getAuthRevision()).toBeGreaterThan(initialRev);
    });
  });

  describe("Call lease API (CP-02 §9)", () => {
    const validSessionId = "550e8400-e29b-41d4-a716-446655440000";
    const validDeviceId = "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d";
    const validExpiresAt = "2026-10-22T10:15:20Z";

    describe("Validation helpers", () => {
      it("validates UUIDs case-insensitively and rejects invalid formats", () => {
        expect(isValidUuid(validSessionId)).toBe(true);
        expect(isValidUuid(validSessionId.toUpperCase())).toBe(true);
        expect(isValidUuid("not-a-uuid")).toBe(false);
        expect(isValidUuid("550e8400e29b41d4a716446655440000")).toBe(false);
        expect(isValidUuid("")).toBe(false);
        expect(isValidUuid(null)).toBe(false);
        expect(isValidUuid(123)).toBe(false);
      });

      it("validates positive safe integers and rejects invalid values", () => {
        expect(isPositiveSafeInteger(1)).toBe(true);
        expect(isPositiveSafeInteger(42)).toBe(true);
        expect(isPositiveSafeInteger(Number.MAX_SAFE_INTEGER)).toBe(true);
        expect(isPositiveSafeInteger(0)).toBe(false);
        expect(isPositiveSafeInteger(-1)).toBe(false);
        expect(isPositiveSafeInteger(1.5)).toBe(false);
        expect(isPositiveSafeInteger(NaN)).toBe(false);
        expect(isPositiveSafeInteger(Infinity)).toBe(false);
        expect(isPositiveSafeInteger(Number.MAX_SAFE_INTEGER + 1)).toBe(false);
        expect(isPositiveSafeInteger("1")).toBe(false);
      });

      it("validates ISO calendar timestamps strictly without normalizing non-existent dates", () => {
        expect(isValidIsoCalendarTimestamp("2026-10-22T10:15:20Z")).toBe(true);
        expect(isValidIsoCalendarTimestamp("2026-10-22T10:15:20.123456Z")).toBe(true);
        expect(isValidIsoCalendarTimestamp("2026-10-22T10:15:20+08:00")).toBe(true);
        expect(isValidIsoCalendarTimestamp("2026-10-22T10:15:20-05:00")).toBe(true);
        expect(isValidIsoCalendarTimestamp("2024-02-29T12:00:00Z")).toBe(true); // 2024 is leap year

        // Non-existent calendar dates that Date.parse would otherwise roll forward
        expect(isValidIsoCalendarTimestamp("2026-02-29T10:00:00Z")).toBe(false); // 2026 is non-leap
        expect(isValidIsoCalendarTimestamp("2026-04-31T10:00:00Z")).toBe(false); // April has 30 days
        expect(isValidIsoCalendarTimestamp("2026-13-01T00:00:00Z")).toBe(false); // Invalid month
        expect(isValidIsoCalendarTimestamp("2026-00-01T00:00:00Z")).toBe(false);
        expect(isValidIsoCalendarTimestamp("2026-01-00T00:00:00Z")).toBe(false);
        expect(isValidIsoCalendarTimestamp("2026-01-01T24:00:00Z")).toBe(false); // Invalid hour

        // Missing or invalid timezone
        expect(isValidIsoCalendarTimestamp("2026-10-22T10:15:20")).toBe(false);
        expect(isValidIsoCalendarTimestamp("2026-10-22T10:15:20+25:00")).toBe(false);
        expect(isValidIsoCalendarTimestamp("invalid-timestamp")).toBe(false);
        expect(isValidIsoCalendarTimestamp(null)).toBe(false);
      });

      it("validates owner objects", () => {
        expect(validateCallLeaseOwner({ device_id: validDeviceId, generation: 2 })).toEqual({
          device_id: validDeviceId,
          generation: 2,
        });
        expect(() => validateCallLeaseOwner(null)).toThrow(/expected an object/);
        expect(() => validateCallLeaseOwner("owner")).toThrow(/expected an object/);
        expect(() => validateCallLeaseOwner({ device_id: "bad", generation: 1 })).toThrow(
          /Invalid owner.device_id/,
        );
        expect(() => validateCallLeaseOwner({ device_id: validDeviceId, generation: 0 })).toThrow(
          /Invalid owner.generation/,
        );
      });
    });

    describe("Input parameter guards (fetch guarding)", () => {
      it("claimCallLease rejects invalid parameters without fetching", async () => {
        await expect(claimCallLease("bad-session", validDeviceId)).rejects.toThrow(
          /Invalid sessionId/,
        );
        await expect(claimCallLease(validSessionId, "bad-device")).rejects.toThrow(
          /Invalid deviceId/,
        );
        await expect(
          claimCallLease(validSessionId, validDeviceId, "true" as unknown as boolean),
        ).rejects.toThrow(/Invalid takeover: expected a boolean/);
        await expect(
          claimCallLease(validSessionId, validDeviceId, 1 as unknown as boolean),
        ).rejects.toThrow(/Invalid takeover: expected a boolean/);
        await expect(
          claimCallLease(validSessionId, validDeviceId, null as unknown as boolean),
        ).rejects.toThrow(/Invalid takeover: expected a boolean/);

        expect(globalThis.fetch).not.toHaveBeenCalled();
      });

      it("heartbeatCallLease rejects invalid parameters without fetching", async () => {
        await expect(
          heartbeatCallLease("bad-session", { device_id: validDeviceId, generation: 1 }),
        ).rejects.toThrow(/Invalid sessionId/);
        await expect(
          heartbeatCallLease(validSessionId, null as unknown as CallLeaseOwner),
        ).rejects.toThrow(/Invalid owner/);
        await expect(
          heartbeatCallLease(validSessionId, { device_id: "bad-device", generation: 1 }),
        ).rejects.toThrow(/Invalid owner.device_id/);
        await expect(
          heartbeatCallLease(validSessionId, { device_id: validDeviceId, generation: -1 }),
        ).rejects.toThrow(/Invalid owner.generation/);

        expect(globalThis.fetch).not.toHaveBeenCalled();
      });

      it("releaseCallLease rejects invalid parameters without fetching", async () => {
        await expect(
          releaseCallLease("bad-session", { device_id: validDeviceId, generation: 1 }),
        ).rejects.toThrow(/Invalid sessionId/);
        await expect(
          releaseCallLease(validSessionId, null as unknown as CallLeaseOwner),
        ).rejects.toThrow(/Invalid owner/);
        await expect(
          releaseCallLease(validSessionId, { device_id: "bad-device", generation: 1 }),
        ).rejects.toThrow(/Invalid owner.device_id/);
        await expect(
          releaseCallLease(validSessionId, { device_id: validDeviceId, generation: 0 }),
        ).rejects.toThrow(/Invalid owner.generation/);

        expect(globalThis.fetch).not.toHaveBeenCalled();
      });

      it("getSessionToken with invalid owner rejects without fetching and does not silently fall back", async () => {
        await expect(
          getSessionToken(validSessionId, null as unknown as CallLeaseOwner),
        ).rejects.toThrow(/Invalid owner/);
        await expect(
          getSessionToken(validSessionId, {} as unknown as CallLeaseOwner),
        ).rejects.toThrow(/Invalid owner.device_id/);
        await expect(
          getSessionToken("bad-session", { device_id: validDeviceId, generation: 1 }),
        ).rejects.toThrow(/Invalid sessionId/);

        expect(globalThis.fetch).not.toHaveBeenCalled();
      });

      it("dispatchAgent with invalid owner rejects without fetching and does not silently fall back", async () => {
        await expect(
          dispatchAgent(validSessionId, null as unknown as CallLeaseOwner),
        ).rejects.toThrow(/Invalid owner/);
        await expect(
          dispatchAgent(validSessionId, {} as unknown as CallLeaseOwner),
        ).rejects.toThrow(/Invalid owner.device_id/);
        await expect(
          dispatchAgent("bad-session", { device_id: validDeviceId, generation: 1 }),
        ).rejects.toThrow(/Invalid sessionId/);

        expect(globalThis.fetch).not.toHaveBeenCalled();
      });
    });

    describe("Request protocols and header isolation", () => {
      it("claimCallLease defaults to takeover=false and only serializes contract fields", async () => {
        const mockResponse = {
          session_id: validSessionId,
          device_id: validDeviceId,
          generation: 1,
          state: "held",
          expires_at: validExpiresAt,
        };
        fetchMock().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockResponse),
        } as unknown as Response);

        const result = await claimCallLease(validSessionId, validDeviceId);
        expect(result).toEqual(mockResponse);
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
        expect(globalThis.fetch).toHaveBeenCalledWith(
          `${getBaseUrl()}/sessions/${validSessionId}/call/claim`,
          expect.objectContaining({
            method: "POST",
            body: JSON.stringify({
              device_id: validDeviceId,
              takeover: false,
            }),
          }),
        );
        const options = fetchMock().mock.calls[0]?.[1];
        const headers = new Headers(options?.headers);
        expect(headers.get("Content-Type")).toBe("application/json");
        expect(headers.get("Authorization")).toBe("Bearer test-access-token");
        expect(headers.has("X-Call-Device-Id")).toBe(false);
      });

      it("claimCallLease sends takeover=true when explicitly requested", async () => {
        const mockResponse = {
          session_id: validSessionId,
          device_id: validDeviceId,
          generation: 2,
          state: "held",
          expires_at: validExpiresAt,
        };
        fetchMock().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockResponse),
        } as unknown as Response);

        const result = await claimCallLease(validSessionId, validDeviceId, true);
        expect(result).toEqual(mockResponse);
        expect(globalThis.fetch).toHaveBeenCalledWith(
          `${getBaseUrl()}/sessions/${validSessionId}/call/claim`,
          expect.objectContaining({
            method: "POST",
            body: JSON.stringify({
              device_id: validDeviceId,
              takeover: true,
            }),
          }),
        );
      });

      it("heartbeatCallLease sends POST with exact contract fields", async () => {
        const mockResponse = {
          session_id: validSessionId,
          device_id: validDeviceId,
          generation: 3,
          state: "held",
          expires_at: validExpiresAt,
        };
        fetchMock().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockResponse),
        } as unknown as Response);

        const owner: CallLeaseOwner = { device_id: validDeviceId, generation: 3 };
        const result = await heartbeatCallLease(validSessionId, owner);
        expect(result).toEqual(mockResponse);
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
        expect(globalThis.fetch).toHaveBeenCalledWith(
          `${getBaseUrl()}/sessions/${validSessionId}/call/heartbeat`,
          expect.objectContaining({
            method: "POST",
            body: JSON.stringify({
              device_id: validDeviceId,
              generation: 3,
            }),
          }),
        );
      });

      it("releaseCallLease sends POST with exact contract fields", async () => {
        const mockResponse = {
          released: true,
          generation: 3,
        };
        fetchMock().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockResponse),
        } as unknown as Response);

        const owner: CallLeaseOwner = { device_id: validDeviceId, generation: 3 };
        const result = await releaseCallLease(validSessionId, owner);
        expect(result).toEqual(mockResponse);
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
        expect(globalThis.fetch).toHaveBeenCalledWith(
          `${getBaseUrl()}/sessions/${validSessionId}/call/release`,
          expect.objectContaining({
            method: "POST",
            body: JSON.stringify({
              device_id: validDeviceId,
              generation: 3,
            }),
          }),
        );
      });

      it("getSessionToken and dispatchAgent support optional owner with header isolation", async () => {
        const mockToken = { token: "token-1", ws_url: "wss://livekit.example.com" };
        const mockDispatch = { dispatched: true };
        fetchMock()
          .mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve(mockToken),
          } as unknown as Response)
          .mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve(mockToken),
          } as unknown as Response)
          .mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve(mockDispatch),
          } as unknown as Response)
          .mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve(mockDispatch),
          } as unknown as Response);

        const owner: CallLeaseOwner = { device_id: validDeviceId, generation: 5 };

        // 1. getSessionToken with owner
        await getSessionToken(validSessionId, owner);
        const tokenWithOptions = fetchMock().mock.calls[0]?.[1];
        const tokenWithHeaders = new Headers(tokenWithOptions?.headers);
        expect(tokenWithHeaders.get("X-Call-Device-Id")).toBe(validDeviceId);
        expect(tokenWithHeaders.get("X-Call-Generation")).toBe("5");
        expect(tokenWithHeaders.get("Authorization")).toBe("Bearer test-access-token");

        // 2. getSessionToken without owner (verifying no header leak)
        await getSessionToken(validSessionId);
        const tokenWithoutOptions = fetchMock().mock.calls[1]?.[1];
        const tokenWithoutHeaders = new Headers(tokenWithoutOptions?.headers);
        expect(tokenWithoutHeaders.has("X-Call-Device-Id")).toBe(false);
        expect(tokenWithoutHeaders.has("X-Call-Generation")).toBe(false);

        // 3. dispatchAgent with owner
        await dispatchAgent(validSessionId, owner);
        const dispatchWithOptions = fetchMock().mock.calls[2]?.[1];
        const dispatchWithHeaders = new Headers(dispatchWithOptions?.headers);
        expect(dispatchWithHeaders.get("X-Call-Device-Id")).toBe(validDeviceId);
        expect(dispatchWithHeaders.get("X-Call-Generation")).toBe("5");

        // 4. dispatchAgent without owner (verifying no header leak)
        await dispatchAgent(validSessionId);
        const dispatchWithoutOptions = fetchMock().mock.calls[3]?.[1];
        const dispatchWithoutHeaders = new Headers(dispatchWithoutOptions?.headers);
        expect(dispatchWithoutHeaders.has("X-Call-Device-Id")).toBe(false);
        expect(dispatchWithoutHeaders.has("X-Call-Generation")).toBe(false);
      });
    });

    describe("Response parsing and failure closure", () => {
      it("accepts valid lease response with case-insensitive UUID matching", () => {
        const uppercaseSession = validSessionId.toUpperCase();
        const raw = {
          session_id: uppercaseSession,
          device_id: validDeviceId,
          generation: 1,
          state: "held",
          expires_at: validExpiresAt,
        };
        const parsed = parseCallLeaseResponse(raw, validSessionId, validDeviceId, 1);
        expect(parsed.session_id).toBe(uppercaseSession);
        expect(parsed.state).toBe("held");
      });

      it("rejects lease response with extra fields", () => {
        expect(() =>
          parseCallLeaseResponse(
            {
              session_id: validSessionId,
              device_id: validDeviceId,
              generation: 1,
              state: "held",
              expires_at: validExpiresAt,
              extra_property: "disallowed",
            },
            validSessionId,
            validDeviceId,
          ),
        ).toThrow(/expected exactly/);
      });

      it("rejects lease response with missing fields", () => {
        expect(() =>
          parseCallLeaseResponse(
            {
              session_id: validSessionId,
              device_id: validDeviceId,
              generation: 1,
              state: "held",
            },
            validSessionId,
            validDeviceId,
          ),
        ).toThrow(/expected exactly/);
      });

      it("rejects lease response with mismatched session_id or device_id", () => {
        expect(() =>
          parseCallLeaseResponse(
            {
              session_id: "00000000-0000-0000-0000-000000000000",
              device_id: validDeviceId,
              generation: 1,
              state: "held",
              expires_at: validExpiresAt,
            },
            validSessionId,
            validDeviceId,
          ),
        ).toThrow(/Mismatched lease response session_id/);

        expect(() =>
          parseCallLeaseResponse(
            {
              session_id: validSessionId,
              device_id: "00000000-0000-0000-0000-000000000000",
              generation: 1,
              state: "held",
              expires_at: validExpiresAt,
            },
            validSessionId,
            validDeviceId,
          ),
        ).toThrow(/Mismatched lease response device_id/);
      });

      it("rejects lease response with non-positive safe integer generation or mismatched generation", () => {
        expect(() =>
          parseCallLeaseResponse(
            {
              session_id: validSessionId,
              device_id: validDeviceId,
              generation: 0,
              state: "held",
              expires_at: validExpiresAt,
            },
            validSessionId,
            validDeviceId,
          ),
        ).toThrow(/generation must be a positive safe integer/);

        expect(() =>
          parseCallLeaseResponse(
            {
              session_id: validSessionId,
              device_id: validDeviceId,
              generation: 2,
              state: "held",
              expires_at: validExpiresAt,
            },
            validSessionId,
            validDeviceId,
            1, // expectedGeneration
          ),
        ).toThrow(/Mismatched lease response generation/);
      });

      it("rejects lease response with non-held state", () => {
        expect(() =>
          parseCallLeaseResponse(
            {
              session_id: validSessionId,
              device_id: validDeviceId,
              generation: 1,
              state: "free",
              expires_at: validExpiresAt,
            },
            validSessionId,
            validDeviceId,
          ),
        ).toThrow(/state must be 'held'/);
      });

      it("rejects lease response with non-existent calendar date", () => {
        expect(() =>
          parseCallLeaseResponse(
            {
              session_id: validSessionId,
              device_id: validDeviceId,
              generation: 1,
              state: "held",
              expires_at: "2026-02-29T10:00:00Z", // Non-leap year
            },
            validSessionId,
            validDeviceId,
          ),
        ).toThrow(/expires_at must be a valid ISO 8601 calendar timestamp/);
      });

      it("rejects non-object lease response", () => {
        expect(() => parseCallLeaseResponse(null, validSessionId, validDeviceId)).toThrow(
          /expected an object/,
        );
        expect(() => parseCallLeaseResponse([], validSessionId, validDeviceId)).toThrow(
          /expected an object/,
        );
      });

      it("parses valid release response and rejects invalid release response", () => {
        const validRelease = { released: true, generation: 4 };
        expect(parseCallReleaseResponse(validRelease, 4)).toEqual(validRelease);

        expect(() => parseCallReleaseResponse({ released: false, generation: 4 }, 4)).toThrow(
          /released must be true/,
        );
        expect(() => parseCallReleaseResponse({ released: true, generation: 5 }, 4)).toThrow(
          /Mismatched release response generation/,
        );
        expect(() =>
          parseCallReleaseResponse({ released: true, generation: 4, extra: 1 }, 4),
        ).toThrow(/expected exactly/);
        expect(() => parseCallReleaseResponse({ released: true }, 4)).toThrow(/expected exactly/);
      });
    });

    describe("HTTP errors and failure closure (no retry, no compensation)", () => {
      it("preserves ApiError with status and structured detail on 409 conflict", async () => {
        const conflictDetail = {
          code: "call_in_use",
          message: "Another device holds the call lease",
          conflict_session_id: "660e8400-e29b-41d4-a716-446655440000",
        };
        fetchMock().mockResolvedValue({
          ok: false,
          status: 409,
          json: () => Promise.resolve({ detail: conflictDetail }),
        } as unknown as Response);

        try {
          await claimCallLease(validSessionId, validDeviceId);
          expect.fail("Should have thrown ApiError");
        } catch (e: unknown) {
          expect(e).toBeInstanceOf(ApiError);
          const apiError = e as ApiError;
          expect(apiError.status).toBe(409);
          expect(apiError.data).toEqual({ detail: conflictDetail });
        }
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      });

      it("preserves ApiError on 502 provider unavailable without automatic compensation", async () => {
        const providerError = {
          code: "call_provider_unavailable",
          message: "LiveKit Cloud revocation failed",
        };
        fetchMock().mockResolvedValue({
          ok: false,
          status: 502,
          json: () => Promise.resolve({ detail: providerError }),
        } as unknown as Response);

        await expect(claimCallLease(validSessionId, validDeviceId, true)).rejects.toThrow(ApiError);
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      });

      it("preserves ApiError on 503 disabled mode", async () => {
        fetchMock().mockResolvedValue({
          ok: false,
          status: 503,
          json: () =>
            Promise.resolve({
              detail: { code: "call_leases_disabled", message: "Call lease disabled" },
            }),
        } as unknown as Response);

        await expect(
          heartbeatCallLease(validSessionId, { device_id: validDeviceId, generation: 1 }),
        ).rejects.toThrow(ApiError);
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      });

      it("invalidates auth session on 401 and does not replay write requests", async () => {
        const initialRev = getAuthRevision();
        fetchMock().mockResolvedValue({
          ok: false,
          status: 401,
          json: () => Promise.resolve({ detail: "Unauthorized" }),
        } as unknown as Response);

        await expect(
          releaseCallLease(validSessionId, { device_id: validDeviceId, generation: 1 }),
        ).rejects.toThrow(ApiError);
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
        expect(getAuthRevision()).toBeGreaterThan(initialRev);
      });

      it("propagates network errors directly without compensation", async () => {
        fetchMock().mockRejectedValue(new Error("Network connection failed"));

        await expect(claimCallLease(validSessionId, validDeviceId)).rejects.toThrow(
          "Network connection failed",
        );
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      });
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

    it("lists sessions with pagination envelope and query params", async () => {
      const mockResponse = {
        items: [
          {
            id: "38752299-15c9-4423-8920-dea740cc4801",
            mode: "free_talk",
            status: "completed",
            started_at: "2025-01-01T00:00:00Z",
            ended_at: "2025-01-01T00:10:00Z",
          },
        ],
        next_cursor: "next-cursor-123",
      };
      fetchMock().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      } as unknown as Response);

      const res = await listSessions({
        status: "completed",
        start: "2025-01-01T00:00:00Z",
        end: "2025-01-01T12:00:00Z",
        limit: 10,
        cursor: "prev-cursor",
      });
      expect(res).toEqual(mockResponse);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${getBaseUrl()}/sessions?status=completed&start=2025-01-01T00%3A00%3A00Z&end=2025-01-01T12%3A00%3A00Z&limit=10&cursor=prev-cursor`,
        expect.anything(),
      );
    });

    it("lists active sessions preserving backend order and passing auth token", async () => {
      const mockActiveResponse = {
        items: [
          {
            id: "8f7e6d5c-4b3a-4210-9876-543210fedcba",
            mode: "doc_chat",
            status: "active",
            started_at: "2025-01-01T01:00:00Z",
            ended_at: null,
          },
          {
            id: "38752299-15c9-4423-8920-dea740cc4801",
            mode: "free_talk",
            status: "active",
            started_at: "2025-01-01T00:00:00Z",
            ended_at: null,
          },
        ],
        next_cursor: null,
      };
      fetchMock().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockActiveResponse),
      } as unknown as Response);

      const res = await listActiveSessions();
      expect(res).toEqual(mockActiveResponse);
      expect(res.items[0].id).toBe("8f7e6d5c-4b3a-4210-9876-543210fedcba");
      expect(res.items[1].id).toBe("38752299-15c9-4423-8920-dea740cc4801");
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

    it("gets daily progress aggregation", async () => {
      const mockDaily = {
        completed_sessions: 3,
        total_turns: 18,
      };
      fetchMock().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockDaily),
      } as unknown as Response);

      const res = await getDailyProgress("2025-01-01T00:00:00Z", "2025-01-01T23:59:59Z");
      expect(res).toEqual(mockDaily);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${getBaseUrl()}/sessions/daily-progress?start=2025-01-01T00%3A00%3A00Z&end=2025-01-01T23%3A59%3A59Z`,
        expect.anything(),
      );
    });

    it("parses valid and rejects invalid session list envelopes fail-closed", () => {
      // 成功用例
      const validEnvelope = {
        items: [
          {
            id: "38752299-15c9-4423-8920-dea740cc4801",
            mode: "free_talk",
            status: "active",
            started_at: "2026-10-25T10:00:00Z",
            ended_at: null,
          },
        ],
        next_cursor: "cur-1",
      };
      expect(parseSessionListResponse(validEnvelope)).toEqual(validEnvelope);

      // 非对象
      expect(() => parseSessionListResponse(null)).toThrow();
      expect(() => parseSessionListResponse([])).toThrow();
      // items 不是数组
      expect(() => parseSessionListResponse({ items: "not-array" })).toThrow();
      // next_cursor 类型错误
      expect(() => parseSessionListResponse({ items: [], next_cursor: 123 })).toThrow();
      // item 中 id 非合法 UUID
      expect(() =>
        parseSessionListResponse({
          items: [
            {
              id: "invalid-uuid",
              mode: "free_talk",
              status: "active",
              started_at: "2026-10-25T10:00:00Z",
            },
          ],
        }),
      ).toThrow();
      // started_at 非时区 ISO 时间戳
      expect(() =>
        parseSessionListResponse({
          items: [
            {
              id: "38752299-15c9-4423-8920-dea740cc4801",
              mode: "free_talk",
              status: "active",
              started_at: "2026-10-25 10:00:00",
            },
          ],
        }),
      ).toThrow();
    });

    it("parses valid and rejects invalid daily progress envelopes fail-closed", () => {
      // 成功用例
      const valid = { completed_sessions: 5, total_turns: 20 };
      expect(parseDailyProgressResponse(valid)).toEqual(valid);

      // 负数
      expect(() =>
        parseDailyProgressResponse({ completed_sessions: -1, total_turns: 0 }),
      ).toThrow();
      expect(() =>
        parseDailyProgressResponse({ completed_sessions: 0, total_turns: -5 }),
      ).toThrow();
      // 浮点数
      expect(() =>
        parseDailyProgressResponse({ completed_sessions: 1.5, total_turns: 0 }),
      ).toThrow();
      // 缺少字段
      expect(() => parseDailyProgressResponse({ completed_sessions: 1 })).toThrow();
      // 非对象
      expect(() => parseDailyProgressResponse("not-object")).toThrow();
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

  describe("Safe Local Diagnostics Instrumentation (CP-06)", () => {
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
    let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
    let consoleLogSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    });

    it("emits zero diagnostic logs on successful API request", async () => {
      fetchMock().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ status: "ready" }),
      } as unknown as Response);

      const res = await checkHealthReady();
      expect(res).toEqual({ status: "ready" });
      expect(consoleErrorSpy).not.toHaveBeenCalled();
      expect(consoleWarnSpy).not.toHaveBeenCalled();
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it("emits sanitized api_http_failed on HTTP 503 and preserves original ApiError & data", async () => {
      const sensitiveCanaryBody = {
        detail: "Database connection failed",
        secret_jwt: "canary-super-secret-jwt-token",
        internal_doc: "confidential student analysis transcript",
      };

      fetchMock().mockResolvedValue({
        ok: false,
        status: 503,
        json: () => Promise.resolve(sensitiveCanaryBody),
      } as unknown as Response);

      await expect(checkHealthReady()).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(ApiError);
        const apiErr = err as ApiError;
        expect(apiErr.status).toBe(503);
        expect(apiErr.message).toBe("Database connection failed");
        expect(apiErr.data).toEqual(sensitiveCanaryBody);
        return true;
      });

      // 验证控制台日志仅有前缀与纯净白名单 record
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      const [prefix, record] = consoleErrorSpy.mock.calls[0];
      expect(prefix).toBe("[diagnostic]");
      expect(record).toEqual({
        schema_version: 1,
        app_version: expect.any(String),
        platform: expect.any(String),
        event: "api_http_failed",
        status: 503,
      });

      // 序列化后断言绝无敏感 canary 泄漏
      const serialized = JSON.stringify(record);
      expect(serialized).not.toContain("canary-super-secret-jwt-token");
      expect(serialized).not.toContain("confidential student analysis transcript");
      expect(serialized).not.toContain("Database connection failed");
      expect(serialized).not.toContain("Authorization");
      expect(serialized).not.toContain("/health/ready");
    });

    it("emits sanitized api_http_failed on 401 and preserves auth invalidation semantics", async () => {
      const initialRev = getAuthRevision();
      fetchMock().mockResolvedValue({
        ok: false,
        status: 401,
        json: () =>
          Promise.resolve({
            detail: "Token expired",
            canary_leak: "secret-bearer-token-12345",
          }),
      } as unknown as Response);

      await expect(listSessions()).rejects.toThrow(ApiError);

      // 原认证失效逻辑与代际递增保持不变
      expect(getAuthRevision()).toBeGreaterThan(initialRev);

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      const [prefix, record] = consoleErrorSpy.mock.calls[0];
      expect(prefix).toBe("[diagnostic]");
      expect(record).toEqual({
        schema_version: 1,
        app_version: expect.any(String),
        platform: expect.any(String),
        event: "api_http_failed",
        status: 401,
      });

      const serialized = JSON.stringify(record);
      expect(serialized).not.toContain("secret-bearer-token-12345");
      expect(serialized).not.toContain("Token expired");
      expect(serialized).not.toContain("/sessions");
    });

    it("rethrows exact network error on fetch reject and emits api_network_failed once", async () => {
      const networkError = new TypeError("Failed to fetch: net::ERR_CONNECTION_REFUSED");
      fetchMock().mockRejectedValue(networkError);

      let thrownError: unknown = null;
      try {
        await checkHealthReady();
      } catch (err) {
        thrownError = err;
      }

      // 严格全等：原对象原样 rethrow
      expect(thrownError).toBe(networkError);
      expect(fetchMock()).toHaveBeenCalledTimes(1);

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      const [prefix, record] = consoleErrorSpy.mock.calls[0];
      expect(prefix).toBe("[diagnostic]");
      expect(record).toEqual({
        schema_version: 1,
        app_version: expect.any(String),
        platform: expect.any(String),
        event: "api_network_failed",
      });

      const serialized = JSON.stringify(record);
      expect(serialized).not.toContain("ERR_CONNECTION_REFUSED");
      expect(serialized).not.toContain("/health/ready");
    });

    it("does not classify auth provider error as api_network_failed", async () => {
      setAccessTokenProvider(() => {
        throw new Error("Local auth storage corrupted");
      });

      await expect(checkHealthReady()).rejects.toThrow("Local auth storage corrupted");
      expect(fetchMock()).not.toHaveBeenCalled();
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it("preserves response.json parsing error without emitting inaccurate events", async () => {
      const jsonParseError = new SyntaxError("Unexpected token < in JSON at position 0");
      fetchMock().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.reject(jsonParseError),
      } as unknown as Response);

      await expect(checkHealthReady()).rejects.toBe(jsonParseError);
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it("does not disrupt API request or response if console.error throws", async () => {
      consoleErrorSpy.mockImplementation(() => {
        throw new Error("Console pipe broken");
      });

      fetchMock().mockResolvedValue({
        ok: false,
        status: 503,
        json: () => Promise.resolve({ detail: "Unavailable" }),
      } as unknown as Response);

      // 控制台 sink 失败绝不影响原有的 ApiError 抛出和处理
      await expect(checkHealthReady()).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).status).toBe(503);
        return true;
      });
    });
  });

  describe("parseSessionListResponse strict schema validation", () => {
    const validItem = {
      id: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
      mode: "free_talk",
      status: "completed",
      started_at: "2026-10-25T10:00:00Z",
      ended_at: "2026-10-25T10:10:00Z",
    };

    it("accepts valid list response with null or valid next_cursor", () => {
      const res1 = parseSessionListResponse({
        items: [validItem],
        next_cursor: null,
      });
      expect(res1.items).toHaveLength(1);
      expect(res1.next_cursor).toBeNull();

      const res2 = parseSessionListResponse({
        items: [{ ...validItem, ended_at: null }],
        next_cursor: "valid-cursor-token",
      });
      expect(res2.items[0].ended_at).toBeNull();
      expect(res2.next_cursor).toBe("valid-cursor-token");
    });

    it("rejects empty string next_cursor", () => {
      expect(() =>
        parseSessionListResponse({
          items: [validItem],
          next_cursor: "",
        }),
      ).toThrow("next_cursor cannot be an empty string");
    });

    it("rejects next_cursor exceeding 1024 chars", () => {
      expect(() =>
        parseSessionListResponse({
          items: [validItem],
          next_cursor: "a".repeat(1025),
        }),
      ).toThrow("next_cursor length exceeds 1024");
    });

    it("rejects items exceeding maximum limit of 100", () => {
      const items = Array.from({ length: 101 }, (_, i) => ({
        ...validItem,
        id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      }));
      expect(() =>
        parseSessionListResponse({
          items,
          next_cursor: null,
        }),
      ).toThrow("items length exceeds maximum limit of 100");
    });

    it("rejects session item missing ended_at property", () => {
      const itemWithoutEndedAt = {
        id: validItem.id,
        mode: validItem.mode,
        status: validItem.status,
        started_at: validItem.started_at,
      };
      expect(() =>
        parseSessionListResponse({
          items: [itemWithoutEndedAt],
          next_cursor: null,
        }),
      ).toThrow("ended_at is required");
    });

    it("rejects invalid ended_at format", () => {
      expect(() =>
        parseSessionListResponse({
          items: [{ ...validItem, ended_at: "not-a-timestamp" }],
          next_cursor: null,
        }),
      ).toThrow("ended_at must be null or an ISO calendar timestamp with timezone");
    });
  });
});
