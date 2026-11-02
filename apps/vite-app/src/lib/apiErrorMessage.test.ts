import { describe, expect, it } from "vitest";
import { getApiErrorMessage } from "./apiErrorMessage";

describe("getApiErrorMessage", () => {
  describe("default message fallback", () => {
    it("returns default message for primitive or null bodies", () => {
      expect(getApiErrorMessage(500, null)).toBe("请求失败: 500");
      expect(getApiErrorMessage(404, undefined)).toBe("请求失败: 404");
      expect(getApiErrorMessage(400, 12345)).toBe("请求失败: 400");
      expect(getApiErrorMessage(403, "some string")).toBe("请求失败: 403");
      expect(getApiErrorMessage(502, true)).toBe("请求失败: 502");
      expect(getApiErrorMessage(500, [1, 2, 3])).toBe("请求失败: 500");
    });
  });

  describe("detail string branch", () => {
    it("returns detail when it is a non-empty string", () => {
      expect(getApiErrorMessage(404, { detail: "会话不存在" })).toBe("会话不存在");
    });

    it("returns empty string when detail is an empty string, taking precedence over fallback", () => {
      expect(getApiErrorMessage(400, { detail: "", message: "fallback" })).toBe("");
    });
  });

  describe("detail array validation errors branch", () => {
    it("formats validation error with valid string loc and msg", () => {
      const body = {
        detail: [
          {
            loc: ["body", "mode"],
            msg: "field required",
          },
        ],
      };
      expect(getApiErrorMessage(422, body)).toBe("数据验证失败 (body.mode): field required");
    });

    it("formats validation error with numeric loc parts", () => {
      const body = {
        detail: [
          {
            loc: ["items", 0, "name"],
            msg: "must be string",
          },
        ],
      };
      expect(getApiErrorMessage(422, body)).toBe("数据验证失败 (items.0.name): must be string");
    });

    it("formats validation error with empty loc array as empty string inside parens", () => {
      const body = {
        detail: [
          {
            loc: [],
            msg: "root error",
          },
        ],
      };
      expect(getApiErrorMessage(422, body)).toBe("数据验证失败 (): root error");
    });

    it("allows empty string msg in validation error", () => {
      const body = {
        detail: [
          {
            loc: ["body"],
            msg: "",
          },
        ],
      };
      expect(getApiErrorMessage(422, body)).toBe("数据验证失败 (body): ");
    });

    it("falls back to Unknown when loc is missing", () => {
      const body = {
        detail: [
          {
            msg: "missing loc field",
          },
        ],
      };
      expect(getApiErrorMessage(422, body)).toBe("数据验证失败 (Unknown): missing loc field");
    });

    it("falls back to Unknown when loc is a non-array primitive", () => {
      const body = {
        detail: [
          {
            loc: "body.mode",
            msg: "field error",
          },
        ],
      };
      expect(getApiErrorMessage(422, body)).toBe("数据验证失败 (Unknown): field error");
    });

    it("falls back to Unknown when loc contains invalid elements", () => {
      const body = {
        detail: [
          {
            loc: ["body", null],
            msg: "field error",
          },
        ],
      };
      expect(getApiErrorMessage(422, body)).toBe("数据验证失败 (Unknown): field error");
    });

    it("falls back to default when detail array is empty", () => {
      expect(getApiErrorMessage(422, { detail: [] })).toBe("请求失败: 422");
    });

    it("only inspects first error and does not scan subsequent items when first item is invalid", () => {
      const body = {
        detail: [null, { loc: ["body"], msg: "valid second error" }],
      };
      expect(getApiErrorMessage(422, body)).toBe("请求失败: 422");
    });

    it("falls back to default when first error has non-string msg", () => {
      expect(getApiErrorMessage(422, { detail: [{ loc: ["body"], msg: 123 }] })).toBe(
        "请求失败: 422",
      );
      expect(getApiErrorMessage(422, { detail: [{ loc: ["body"], msg: null }] })).toBe(
        "请求失败: 422",
      );
      expect(getApiErrorMessage(422, { detail: [{ loc: ["body"] }] })).toBe("请求失败: 422");
    });
  });

  describe("detail object branch", () => {
    it("extracts first truthy string from detail.errors", () => {
      const body = {
        detail: {
          errors: {
            service: "服务不可用",
          },
        },
      };
      expect(getApiErrorMessage(503, body)).toBe("服务不可用");
    });

    it("only checks first value of detail.errors and does not scan second truthy value", () => {
      const body = {
        detail: {
          errors: {
            first: "",
            second: "valid message",
          },
        },
      };
      expect(getApiErrorMessage(503, body)).toBe("请求失败: 503");
    });

    it("falls back when detail.errors first value is not a string", () => {
      const body = {
        detail: {
          errors: {
            code: 500,
          },
        },
      };
      expect(getApiErrorMessage(503, body)).toBe("请求失败: 503");
    });

    it("uses detail.message if non-empty string when detail.errors is absent", () => {
      const body = {
        detail: {
          message: "操作被拒绝",
        },
      };
      expect(getApiErrorMessage(403, body)).toBe("操作被拒绝");
    });

    it("falls back to JSON.stringify when detail has empty message", () => {
      const body = {
        detail: {
          message: "",
        },
      };
      expect(getApiErrorMessage(500, body)).toBe('{"message":""}');
    });

    it("falls back to JSON.stringify with empty message and extra fields", () => {
      const body = {
        detail: {
          message: "",
          code: "ERR_CUSTOM",
          retryable: false,
        },
      };
      expect(getApiErrorMessage(500, body)).toBe(
        '{"message":"","code":"ERR_CUSTOM","retryable":false}',
      );
    });

    it("falls back to JSON.stringify for empty detail object", () => {
      expect(getApiErrorMessage(500, { detail: {} })).toBe("{}");
    });

    it("falls back to default message if JSON.stringify throws on circular reference", () => {
      const circular: Record<string, unknown> = {};
      circular.self = circular;
      const body = { detail: circular };
      expect(getApiErrorMessage(500, body)).toBe("请求失败: 500");
    });
  });

  describe("top-level errors branch", () => {
    it("extracts first truthy string from top-level errors record", () => {
      const body = {
        errors: {
          field: "参数错误",
        },
      };
      expect(getApiErrorMessage(400, body)).toBe("参数错误");
    });

    it("only checks first value of top-level errors and does not scan second value", () => {
      const body = {
        errors: {
          first: "",
          second: "valid message",
        },
      };
      expect(getApiErrorMessage(400, body)).toBe("请求失败: 400");
    });

    it("ignores non-record errors property", () => {
      expect(getApiErrorMessage(400, { errors: "not_a_record" })).toBe("请求失败: 400");
      expect(getApiErrorMessage(400, { errors: null })).toBe("请求失败: 400");
    });
  });

  describe("top-level message branch", () => {
    it("returns top-level message string", () => {
      expect(getApiErrorMessage(500, { message: "服务器内部异常" })).toBe("服务器内部异常");
    });

    it("returns empty string when top-level message is empty string", () => {
      expect(getApiErrorMessage(500, { message: "" })).toBe("");
    });

    it("ignores non-string top-level message", () => {
      expect(getApiErrorMessage(500, { message: { text: "err" } })).toBe("请求失败: 500");
      expect(getApiErrorMessage(500, { message: 12345 })).toBe("请求失败: 500");
    });
  });

  describe("priority and immutability", () => {
    it("prioritizes detail string over detail.message, errors, and message", () => {
      const body = {
        detail: "最高优先级 detail",
        errors: { err: "errors" },
        message: "message",
      };
      expect(getApiErrorMessage(400, body)).toBe("最高优先级 detail");
    });

    it("prioritizes detail.errors over detail.message", () => {
      const body = {
        detail: {
          errors: { key: "detail.errors 优先" },
          message: "detail.message",
        },
      };
      expect(getApiErrorMessage(400, body)).toBe("detail.errors 优先");
    });

    it("prioritizes errors over top-level message", () => {
      const body = {
        errors: { field: "errors 优先" },
        message: "message 次优",
      };
      expect(getApiErrorMessage(400, body)).toBe("errors 优先");
    });

    it("does not mutate frozen input body or nested properties", () => {
      const frozenBody = Object.freeze({
        detail: Object.freeze({
          errors: Object.freeze({
            item: "frozen error",
          }),
        }),
      });
      const result = getApiErrorMessage(500, frozenBody);
      expect(result).toBe("frozen error");
      expect(Object.isFrozen(frozenBody)).toBe(true);
      expect(Object.isFrozen(frozenBody.detail)).toBe(true);
    });
  });
});
