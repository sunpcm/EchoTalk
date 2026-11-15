import { describe, expect, it } from "vitest";
import contract from "./agent-analysis.contract.generated.json";
import {
  ALLOWED_AGENT_CODES,
  ANALYSIS_UNSUPPORTED,
  AGENT_ERROR_TOPIC,
} from "./agentAnalysisContract";
import { logDiagnostic } from "./diagnostics";

const diagnostic = [
  "ERR_CUSTOM_KEY_INVALID",
  "ERR_SESSION_NOT_FOUND",
  "ERR_CUSTOM_RUNTIME_AUTH",
  "ERR_CUSTOM_RUNTIME",
  "ERR_SYSTEM_RUNTIME",
];

describe("generated Agent/analysis contract consumers", () => {
  it("has the exact independent five-code diagnostic projection and immutable facade", () => {
    expect(ALLOWED_AGENT_CODES).toEqual(diagnostic);
    expect(Object.isFrozen(ALLOWED_AGENT_CODES)).toBe(true);
    expect(AGENT_ERROR_TOPIC).toBe("agent_error");
    expect(ANALYSIS_UNSUPPORTED).toBe("analysis_unsupported");
    expect(contract.paths).toEqual({});
    expect(contract.components.schemas.AnalysisPublicErrorCode).toEqual({
      anyOf: [{ type: "string" }, { type: "null" }],
    });
  });

  it("restricts diagnostic logs for all nine emitted codes and unknown codes", () => {
    const codes = contract.components.schemas.KnownAgentErrorCode.enum;
    expect(codes).toHaveLength(9);
    for (const code of [...codes, "FUTURE_CODE"]) {
      const message = "must-not-enter-diagnostics";
      const options = { agent_code: code, message };
      const result = logDiagnostic("agent_error_received", options);
      expect(result?.agent_code).toBe(diagnostic.includes(code) ? code : "unknown");
      expect(Object.keys(result ?? {}).sort()).toEqual([
        "agent_code",
        "app_version",
        "event",
        "platform",
        "schema_version",
      ]);
      expect(result).not.toHaveProperty("message");
      expect(JSON.stringify(result)).not.toContain(message);
    }
  });
});
