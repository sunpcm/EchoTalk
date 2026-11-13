/**
 * lib/api 公共入口：只再导出原 api.ts 的公开名字，不扩大公共 API。
 */

export { ApiError, getBaseUrl, checkHealthReady } from "./client";
export type { ApiRequestOptions, HealthReadyResponse } from "./client";

export {
  parseCallCapabilities,
  getCallCapabilities,
  isValidUuid,
  isPositiveSafeInteger,
  isNonNegativeSafeInteger,
  isValidIsoCalendarTimestamp,
  validateCallLeaseOwner,
  parseCallLeaseResponse,
  parseCallReleaseResponse,
  claimCallLease,
  heartbeatCallLease,
  releaseCallLease,
} from "./callLease";
export type {
  CallCapabilitiesResponse,
  CallLeaseMode,
  CallLeaseOwner,
  CallLeaseResponse,
  CallReleaseResponse,
} from "./callLease";

export {
  createSession,
  getSessionToken,
  endSession,
  dispatchAgent,
  parseSessionListResponse,
  parseDailyProgressResponse,
  listSessions,
  listActiveSessions,
  getDailyProgress,
  parseWeeklyProgressResponse,
  getWeeklyProgress,
  getSessionDetail,
  getAnalysisStatus,
  retryAnalysis,
} from "./sessions";
export type {
  Session,
  Transcript,
  TokenResponse,
  DocContext,
  CreateSessionBody,
  SessionListItem,
  SessionListResponse,
  DailyProgressResponse,
  WeeklyProgressResponse,
  WeeklyProgressDay,
  AnalysisJobStatus,
  AnalysisStatusResponse,
  ListSessionsParams,
  ListActiveSessionsParams,
} from "./sessions";

export {
  getAssessment,
  getGrammarErrors,
  getKnowledgeStates,
  getSkills,
  getRecommendedCurriculum,
  parseWeeklyGrammarSummary,
  getWeeklyGrammar,
} from "./assessments";
export type {
  PhonemeAlignmentItem,
  AssessmentResponse,
  GrammarErrorResponse,
  KnowledgeStateResponse,
  SkillResponse,
  CurriculumRecommendation,
  CurriculumNextResponse,
  WeeklyGrammarSummary,
  WeeklyGrammarItem,
  WeeklyGrammarSkillTag,
} from "./assessments";

export { getUserSettings, updateUserSettings } from "./settings";
export type { UserSettingsResponse, UserSettingsUpdate } from "./settings";
