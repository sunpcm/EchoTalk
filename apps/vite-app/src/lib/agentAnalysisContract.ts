import contract from "./agent-analysis.contract.generated.json";
import type { components } from "./agentAnalysis.generated";

type Schemas = components["schemas"];
const metadata = contract["x-echotalk-contract"];

export type AgentErrorMessage = Readonly<Pick<Schemas["AgentErrorReceived"], "code" | "message">>;
export type AllowedAgentCode = Schemas["DiagnosticAgentErrorCode"];
export const AGENT_ERROR_TOPIC = metadata.topic;
export const ALLOWED_AGENT_CODES: readonly AllowedAgentCode[] = Object.freeze([
  ...(metadata.diagnostic_agent_codes as AllowedAgentCode[]),
]);
export const DIAGNOSTIC_UNKNOWN_AGENT_CODE = metadata.diagnostic_unknown_agent_code;
export const ANALYSIS_UNSUPPORTED = metadata.analysis_codes.ANALYSIS_UNSUPPORTED.code;
