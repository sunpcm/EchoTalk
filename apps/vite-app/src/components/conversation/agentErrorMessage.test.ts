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
});
