export interface AgentErrorMessage {
  readonly code: string;
  readonly message: string;
}

const decoder = new TextDecoder();

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/** Parses the untrusted agent_error DataChannel payload into its public fields. */
export function parseAgentErrorMessage(payload: Uint8Array): AgentErrorMessage | null {
  try {
    const parsed: unknown = JSON.parse(decoder.decode(payload));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    const candidate = parsed as Record<string, unknown>;
    if (
      !Object.prototype.hasOwnProperty.call(candidate, "type") ||
      candidate.type !== "agent_error" ||
      !Object.prototype.hasOwnProperty.call(candidate, "code") ||
      !isNonEmptyString(candidate.code) ||
      !Object.prototype.hasOwnProperty.call(candidate, "message") ||
      !isNonEmptyString(candidate.message)
    ) {
      return null;
    }

    return { code: candidate.code, message: candidate.message };
  } catch {
    return null;
  }
}
