/**
 * 会话目标定义、执行进度与终态视图 API。
 */

import type { ApiRequestOptions, ApiSchemas } from "./client";
import { request } from "./client";
import {
  isNonNegativeSafeInteger,
  isPositiveSafeInteger,
  isValidUuid,
  validateUuid,
} from "./callLease";

/** 客户端提交的最小目标目录引用。 */
export type SessionGoalBindingInput = Readonly<ApiSchemas["GoalBindingRef"]>;

/** 目标终态；进度状态不进入该枚举。 */
export type SessionGoalResultStatus = "achieved" | "not_achieved" | "unknown" | "not_assessed";

/** 单次目标评估执行状态。 */
export type SessionGoalExecutionStatus = "pending" | "running" | "succeeded" | "failed";

/** 冻结目标定义及该会话当前可见结果。 */
export type SessionGoalViewEntry = Readonly<
  Omit<ApiSchemas["GoalViewEntry"], "criteria" | "evidence_types" | "result"> & {
    readonly criteria: ReadonlyArray<string>;
    readonly evidence_types: ReadonlyArray<string>;
    readonly result: SessionGoalResultStatus | null;
  }
>;

/** 当前唯一目标评估 revision 的执行进度。 */
export type SessionGoalExecution = Readonly<
  Omit<ApiSchemas["GoalExecution"], "status"> & {
    readonly status: SessionGoalExecutionStatus;
  }
>;

/** 终态目标计数；客户端会再次校验行数守恒。 */
export type SessionGoalSummary = Readonly<ApiSchemas["GoalSummary"]>;

/** GET /sessions/{id}/goals 的严格领域响应。 */
export type SessionGoalsResponse = Readonly<
  Omit<ApiSchemas["GoalViewResponse"], "execution" | "goals" | "summary"> & {
    readonly goals: ReadonlyArray<SessionGoalViewEntry>;
    readonly execution: SessionGoalExecution | null;
    readonly summary: SessionGoalSummary | null;
  }
>;

const GOAL_MATERIAL_ID_PATTERN = /^mat_[a-z0-9_-]+$/;
const GOAL_ID_PATTERN = /^mat_[a-z0-9_-]+:[a-z][a-z0-9_-]*$/;
const SESSION_GOAL_RESULT_STATUSES = new Set<string>([
  "achieved",
  "not_achieved",
  "unknown",
  "not_assessed",
]);
const SESSION_GOAL_EXECUTION_STATUSES = new Set<string>([
  "pending",
  "running",
  "succeeded",
  "failed",
]);

function requireGoalRecord(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Invalid ${name}: expected an object`);
  }
  return value as Record<string, unknown>;
}

function requireGoalKeys(
  value: Record<string, unknown>,
  expectedKeys: ReadonlyArray<string>,
  name: string,
): void {
  const actualKeys = Object.keys(value);
  if (
    actualKeys.length !== expectedKeys.length ||
    expectedKeys.some((key) => !Object.prototype.hasOwnProperty.call(value, key))
  ) {
    throw new Error(
      `Invalid ${name}: expected exactly [${expectedKeys.join(", ")}], got [${actualKeys.join(", ")}]`,
    );
  }
}

function requireGoalString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Invalid ${name}: expected a non-empty string`);
  }
  return value;
}

function requireGoalStringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Invalid ${name}: expected a non-empty string array`);
  }
  const items: string[] = [];
  for (const item of value as unknown[]) {
    if (typeof item !== "string" || item.trim().length === 0) {
      throw new Error(`Invalid ${name}: every item must be a non-empty string`);
    }
    items.push(item);
  }
  return items;
}

function isSessionGoalResultStatus(value: unknown): value is SessionGoalResultStatus {
  return typeof value === "string" && SESSION_GOAL_RESULT_STATUSES.has(value);
}

function isSessionGoalExecutionStatus(value: unknown): value is SessionGoalExecutionStatus {
  return typeof value === "string" && SESSION_GOAL_EXECUTION_STATUSES.has(value);
}

function parseSessionGoalViewEntry(
  raw: unknown,
  materialId: string,
  index: number,
): SessionGoalViewEntry {
  const name = `goal view entry ${index}`;
  const entry = requireGoalRecord(raw, name);
  requireGoalKeys(
    entry,
    [
      "goal_id",
      "goal_version",
      "description_en",
      "description_zh",
      "criteria",
      "evidence_types",
      "result",
    ],
    name,
  );

  const goalId = requireGoalString(entry.goal_id, `${name}.goal_id`);
  if (
    !GOAL_ID_PATTERN.test(goalId) ||
    !goalId.startsWith(`${materialId}:`) ||
    goalId.length === materialId.length + 1
  ) {
    throw new Error(`Invalid ${name}.goal_id: must be prefixed by material_id`);
  }
  const goalVersion = entry.goal_version;
  if (!isPositiveSafeInteger(goalVersion)) {
    throw new Error(`Invalid ${name}.goal_version: expected a positive safe integer`);
  }

  let result: SessionGoalResultStatus | null;
  if (entry.result === null) {
    result = null;
  } else if (isSessionGoalResultStatus(entry.result)) {
    result = entry.result;
  } else {
    throw new Error(`Invalid ${name}.result: unknown goal result status`);
  }

  return {
    goal_id: goalId,
    goal_version: goalVersion,
    description_en: requireGoalString(entry.description_en, `${name}.description_en`),
    description_zh: requireGoalString(entry.description_zh, `${name}.description_zh`),
    criteria: requireGoalStringArray(entry.criteria, `${name}.criteria`),
    evidence_types: requireGoalStringArray(entry.evidence_types, `${name}.evidence_types`),
    result,
  };
}

function parseSessionGoalExecution(raw: unknown): SessionGoalExecution {
  const name = "goal execution";
  const execution = requireGoalRecord(raw, name);
  requireGoalKeys(execution, ["status", "revision", "evaluator_version"], name);
  const status = execution.status;
  const revision = execution.revision;
  if (!isSessionGoalExecutionStatus(status)) {
    throw new Error(`Invalid ${name}.status: unknown goal execution status`);
  }
  if (!isPositiveSafeInteger(revision)) {
    throw new Error(`Invalid ${name}.revision: expected a positive safe integer`);
  }
  return {
    status,
    revision,
    evaluator_version: requireGoalString(execution.evaluator_version, `${name}.evaluator_version`),
  };
}

function parseSessionGoalSummary(raw: unknown): SessionGoalSummary {
  const name = "goal summary";
  const summary = requireGoalRecord(raw, name);
  requireGoalKeys(
    summary,
    ["total", "achieved", "not_achieved", "assessed", "unknown", "not_assessed"],
    name,
  );
  const total = summary.total;
  const achieved = summary.achieved;
  const notAchieved = summary.not_achieved;
  const assessed = summary.assessed;
  const unknown = summary.unknown;
  const notAssessed = summary.not_assessed;
  if (
    !isNonNegativeSafeInteger(total) ||
    !isNonNegativeSafeInteger(achieved) ||
    !isNonNegativeSafeInteger(notAchieved) ||
    !isNonNegativeSafeInteger(assessed) ||
    !isNonNegativeSafeInteger(unknown) ||
    !isNonNegativeSafeInteger(notAssessed)
  ) {
    throw new Error(`Invalid ${name}: counts must be non-negative safe integers`);
  }
  return {
    total,
    achieved,
    not_achieved: notAchieved,
    assessed,
    unknown,
    not_assessed: notAssessed,
  };
}

/** 严格解析当前用户单个会话的目标定义、执行进度与终态汇总。 */
export function parseSessionGoalsResponse(
  data: unknown,
  expectedSessionId: string,
): SessionGoalsResponse {
  validateUuid(expectedSessionId, "expectedSessionId");
  const root = requireGoalRecord(data, "session goals response");
  requireGoalKeys(
    root,
    [
      "session_id",
      "configured",
      "material_id",
      "material_version",
      "goals",
      "execution",
      "summary",
    ],
    "session goals response",
  );

  const responseSessionId = root.session_id;
  if (!isValidUuid(responseSessionId)) {
    throw new Error("Invalid session goals response.session_id: expected a valid UUID string");
  }
  if (responseSessionId.toLowerCase() !== expectedSessionId.toLowerCase()) {
    throw new Error("Mismatched session goals response.session_id");
  }
  if (typeof root.configured !== "boolean") {
    throw new Error("Invalid session goals response.configured: expected a boolean");
  }

  if (!root.configured) {
    if (!Array.isArray(root.goals) || root.goals.length !== 0) {
      throw new Error("Invalid unconfigured session goals response: goals must be empty");
    }
    if (
      root.material_id !== null ||
      root.material_version !== null ||
      root.execution !== null ||
      root.summary !== null
    ) {
      throw new Error(
        "Invalid unconfigured session goals response: material, execution, and summary must be null",
      );
    }
    return {
      session_id: responseSessionId,
      configured: false,
      material_id: null,
      material_version: null,
      goals: [],
      execution: null,
      summary: null,
    };
  }

  const materialId = requireGoalString(root.material_id, "session goals response.material_id");
  if (!GOAL_MATERIAL_ID_PATTERN.test(materialId)) {
    throw new Error("Invalid session goals response.material_id: invalid material id");
  }
  const materialVersion = root.material_version;
  if (!isPositiveSafeInteger(materialVersion)) {
    throw new Error(
      "Invalid session goals response.material_version: expected a positive safe integer",
    );
  }
  if (!Array.isArray(root.goals) || root.goals.length === 0) {
    throw new Error("Invalid configured session goals response: goals must be a non-empty array");
  }

  const rawGoals = root.goals as unknown[];
  const goals = rawGoals.map((goal, index) => parseSessionGoalViewEntry(goal, materialId, index));
  const goalIds = new Set<string>();
  for (const goal of goals) {
    if (goalIds.has(goal.goal_id)) {
      throw new Error(`Invalid session goals response: duplicate goal_id ${goal.goal_id}`);
    }
    goalIds.add(goal.goal_id);
  }

  const execution = root.execution === null ? null : parseSessionGoalExecution(root.execution);
  const summary = root.summary === null ? null : parseSessionGoalSummary(root.summary);

  if (execution === null) {
    if (summary === null || goals.some((goal) => goal.result !== "not_assessed")) {
      throw new Error(
        "Invalid snapshot without run: every goal and summary must be terminal not_assessed",
      );
    }
  } else if (execution.status === "pending" || execution.status === "running") {
    if (summary !== null || goals.some((goal) => goal.result !== null)) {
      throw new Error("Invalid in-progress goals response: results and summary must be null");
    }
  } else if (summary === null || goals.some((goal) => goal.result === null)) {
    throw new Error("Invalid terminal goals response: results and summary are required");
  }

  if (summary !== null) {
    const achieved = goals.filter((goal) => goal.result === "achieved").length;
    const notAchieved = goals.filter((goal) => goal.result === "not_achieved").length;
    const unknown = goals.filter((goal) => goal.result === "unknown").length;
    const notAssessed = goals.filter((goal) => goal.result === "not_assessed").length;
    const assessed = achieved + notAchieved;
    if (
      summary.total !== goals.length ||
      summary.achieved !== achieved ||
      summary.not_achieved !== notAchieved ||
      summary.assessed !== assessed ||
      summary.unknown !== unknown ||
      summary.not_assessed !== notAssessed ||
      achieved + notAchieved + unknown + notAssessed !== summary.total
    ) {
      throw new Error("Invalid goal summary: counts do not match goal rows");
    }
  }

  return {
    session_id: responseSessionId,
    configured: true,
    material_id: materialId,
    material_version: materialVersion,
    goals,
    execution,
    summary,
  };
}

/** 读取单个会话的目标定义、执行进度与终态汇总。 */
export async function getSessionGoals(
  sessionId: string,
  options?: ApiRequestOptions,
): Promise<SessionGoalsResponse> {
  validateUuid(sessionId, "sessionId");
  const raw = await request<unknown>(`/sessions/${sessionId}/goals`, {
    cache: "no-store",
    signal: options?.signal,
  });
  return parseSessionGoalsResponse(raw, sessionId);
}
