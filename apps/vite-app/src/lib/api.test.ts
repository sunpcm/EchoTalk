import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { checkHealthReady, ApiError } from "./api";

describe("API client", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

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
