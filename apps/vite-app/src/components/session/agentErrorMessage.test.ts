import contract from "@/lib/agent-analysis.contract.generated.json";
import { AGENT_ERROR_TOPIC } from "@/lib/agentAnalysisContract";
import { describe, expect, it } from "vitest";
import { parseAgentErrorMessage } from "./agentErrorMessage";

function encode(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

describe("parseAgentErrorMessage", () => {
  it("accepts an exact error envelope and drops unknown extra fields", () => {
    expect(
      parseAgentErrorMessage(
        encode({
          type: "agent_error",
          code: "ERR_CUSTOM_RUNTIME",
          message: "运行失败",
          payload_from_runtime: "must-not-escape",
          canary_secret: "{{SECRET_0e6d94a1}}",
        }),
      ),
    ).toEqual({
      code: "ERR_CUSTOM_RUNTIME",
      message: "运行失败",
    });
  });

  it("retains a non-empty unknown string code for existing UI compatibility", () => {
    expect(
      parseAgentErrorMessage(
        encode({
          type: "agent_error",
          code: "UNKNOWN_PROVIDER_CODE",
          message: "未知错误",
        }),
      ),
    ).toEqual({
      code: "UNKNOWN_PROVIDER_CODE",
      message: "未知错误",
    });
  });

  it.each(["type", "code", "message"] as const)(
    "rejects an inherited %s field while accepting own fields",
    (field) => {
      const own = { type: "agent_error", code: "FUTURE_CODE", message: "own message" };
      const missing: Record<string, string> = { ...own };
      delete missing[field];
      const missingPayload = encode(missing);
      const ownPayload = encode(own);
      const previous = Object.getOwnPropertyDescriptor(Object.prototype, field);
      let inheritedResult;
      let ownResult;
      try {
        Object.defineProperty(Object.prototype, field, {
          configurable: true,
          writable: true,
          value: field === "type" ? "agent_error" : "inherited non-empty value",
        });
        // Real JSON.parse inherits this value; do not mock the parser/decoder.
        inheritedResult = parseAgentErrorMessage(missingPayload);
        ownResult = parseAgentErrorMessage(ownPayload);
      } finally {
        if (previous) {
          Object.defineProperty(Object.prototype, field, previous);
        } else {
          Reflect.deleteProperty(Object.prototype, field);
        }
      }
      // Run assertions only after restoring the global prototype.
      expect(Object.getOwnPropertyDescriptor(Object.prototype, field)).toEqual(previous);
      expect(inheritedResult).toBeNull();
      expect(ownResult).toEqual({ code: own.code, message: own.message });
      expect(parseAgentErrorMessage(missingPayload)).toBeNull();
      expect(parseAgentErrorMessage(ownPayload)).toEqual(ownResult);
    },
  );

  it.each([null, [], "agent_error", 1, true])("rejects non-object JSON value %j", (value) => {
    expect(parseAgentErrorMessage(encode(value))).toBeNull();
  });

  it.each([
    { type: "other", code: "CODE", message: "message" },
    { type: "Agent_Error", code: "CODE", message: "message" },
    { code: "CODE", message: "message" },
    { type: "agent_error", code: "", message: "message" },
    { type: "agent_error", code: "   ", message: "message" },
    { type: "agent_error", code: null, message: "message" },
    { type: "agent_error", code: 42, message: "message" },
    { type: "agent_error", code: true, message: "message" },
    { type: "agent_error", code: {}, message: "message" },
    { type: "agent_error", code: "CODE", message: "" },
    { type: "agent_error", code: "CODE", message: "\n\t" },
    { type: "agent_error", code: "CODE", message: null },
    { type: "agent_error", code: "CODE", message: false },
    { type: "agent_error", code: "CODE", message: [] },
    { type: "agent_error", message: "message" },
    { type: "agent_error", code: "CODE" },
  ])("rejects an invalid envelope %#", (value) => {
    expect(parseAgentErrorMessage(encode(value))).toBeNull();
  });

  it("rejects malformed JSON and invalid bytes without throwing", () => {
    expect(parseAgentErrorMessage(new TextEncoder().encode("{"))).toBeNull();
    expect(parseAgentErrorMessage(new Uint8Array([0xff, 0x00, 0x7b]))).toBeNull();
  });

  it("preserves ECMAScript whitespace, BOM and replacement decoding compatibility", () => {
    for (const blank of ["\uFEFF", "\u00a0\u2003\u2028", "\n\t"]) {
      expect(
        parseAgentErrorMessage(encode({ type: "agent_error", code: blank, message: "ok" })),
      ).toBeNull();
      expect(
        parseAgentErrorMessage(encode({ type: "agent_error", code: "future", message: blank })),
      ).toBeNull();
    }
    const value = { type: "agent_error", code: "\u0085", message: " \u200b " };
    expect(parseAgentErrorMessage(encode(value))).toEqual({
      code: value.code,
      message: value.message,
    });
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...encode(value)]);
    expect(parseAgentErrorMessage(bom)).toEqual({ code: value.code, message: value.message });
    const prefix = new TextEncoder().encode('{"type":"agent_error","code":"future","message":"');
    const suffix = new TextEncoder().encode('"}');
    const replacement = new Uint8Array([...prefix, 0xff, ...suffix]);
    expect(parseAgentErrorMessage(replacement)).toEqual({ code: "future", message: "\uFFFD" });
  });
  it("compares schema-required properties against the actual receiver", () => {
    const schema = contract.components.schemas.AgentErrorReceived;
    const codes = contract.components.schemas.KnownAgentErrorCode.enum;
    expect(codes).toHaveLength(9);
    for (const code of [...codes, "FUTURE_CODE"]) {
      expect(
        parseAgentErrorMessage(encode({ type: "agent_error", code, message: "safe" })),
      ).toEqual({ code, message: "safe" });
    }
    const valid: Record<string, unknown> = {
      type: "agent_error",
      code: " FUTURE ",
      message: " message ",
    };
    expect(Object.keys(schema.properties).sort()).toEqual(["code", "message", "type"]);
    expect([...schema.required].sort()).toEqual(["code", "message", "type"]);
    expect(schema.additionalProperties).toBe(true);
    expect(parseAgentErrorMessage(encode({ ...valid, future: "discard" }))).toEqual({
      code: " FUTURE ",
      message: " message ",
    });
    for (const key of schema.required) {
      const missing = { ...valid };
      delete missing[key];
      expect(parseAgentErrorMessage(encode(missing))).toBeNull();
      for (const invalid of [null, false, 0, {}, []]) {
        expect(parseAgentErrorMessage(encode({ ...valid, [key]: invalid }))).toBeNull();
      }
    }
    for (const [key, property] of Object.entries(schema.properties)) {
      expect(property.type).toBe("string");
      if ("minLength" in property) {
        expect(property.minLength).toBe(1);
        expect(parseAgentErrorMessage(encode({ ...valid, [key]: "" }))).toBeNull();
      }
      if ("const" in property) {
        expect(property.const).toBe(AGENT_ERROR_TOPIC);
        expect(parseAgentErrorMessage(encode({ ...valid, [key]: "other" }))).toBeNull();
      }
    }
  });
});
