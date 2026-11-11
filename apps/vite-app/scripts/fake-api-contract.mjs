import { isDeepStrictEqual } from "node:util";

const HTTP_METHODS = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"]);
const JSON_MEDIA_TYPE = "application/json";
const ANNOTATION_KEYWORDS = new Set(["title", "description", "default"]);
const SUPPORTED_TYPES = new Set([
  "object",
  "array",
  "integer",
  "number",
  "string",
  "boolean",
  "null",
]);
const SUPPORTED_FORMATS = new Set(["uuid", "date", "date-time"]);
const SUPPORTED_SCHEMA_KEYWORDS = new Set([
  "$ref",
  "additionalProperties",
  "anyOf",
  "const",
  "enum",
  "exclusiveMinimum",
  "format",
  "items",
  "maxItems",
  "maxLength",
  "maximum",
  "minItems",
  "minLength",
  "minimum",
  "pattern",
  "properties",
  "required",
  "type",
  ...ANNOTATION_KEYWORDS,
]);

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(object, key) {
  return Object.hasOwn(object, key);
}

function isSuccessStatus(status) {
  return /^2\d\d$/.test(status);
}

function operationKey(method, operationPath) {
  return `${method.toUpperCase()} ${operationPath}`;
}

export function compareOperationKeys(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function resolveLocalRef(root, ref) {
  if (typeof ref !== "string" || !ref.startsWith("#/")) {
    throw new Error(`仅支持 OpenAPI 文档内以 #/ 开头的 $ref，实际为 ${JSON.stringify(ref)}`);
  }
  const segments = ref
    .slice(2)
    .split("/")
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
  let current = root;
  for (const segment of segments) {
    if (!isObject(current) || !hasOwn(current, segment)) {
      throw new Error(`无法解析 OpenAPI $ref: ${ref}`);
    }
    current = current[segment];
  }
  if (!isObject(current)) {
    throw new Error(`OpenAPI $ref 未指向 schema 对象: ${ref}`);
  }
  return current;
}

function jsonPointerPath(basePath, key) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
    ? `${basePath}.${key}`
    : `${basePath}[${JSON.stringify(key)}]`;
}

function addViolation(violations, path, keyword, message) {
  violations.push({ path, keyword, message });
}

function auditSchemaCapabilities(schema, schemaPath) {
  const issues = [];
  if (hasOwn(schema, "type") && !SUPPORTED_TYPES.has(schema.type)) {
    issues.push({
      path: schemaPath,
      keyword: "type",
      message: `校验器不支持 type=${JSON.stringify(schema.type)}，拒绝按通过处理`,
    });
  }
  if (hasOwn(schema, "format") && !SUPPORTED_FORMATS.has(schema.format)) {
    issues.push({
      path: schemaPath,
      keyword: "format",
      message: `校验器不支持 format=${JSON.stringify(schema.format)}，拒绝按通过处理`,
    });
  }
  return issues;
}

export function auditJsonSchema(schema, root) {
  const issues = [];

  const visit = (candidate, schemaPath) => {
    if (!isObject(candidate)) {
      issues.push({
        path: schemaPath,
        keyword: "schema",
        message: `schema 必须是对象，实际为 ${JSON.stringify(candidate)}`,
      });
      return;
    }
    for (const keyword of Object.keys(candidate)) {
      if (!SUPPORTED_SCHEMA_KEYWORDS.has(keyword)) {
        issues.push({
          path: schemaPath,
          keyword: "unsupportedSchemaKeyword",
          message: `不支持的 schema 关键字 ${JSON.stringify(keyword)}，拒绝按通过处理`,
        });
      }
    }
    issues.push(...auditSchemaCapabilities(candidate, schemaPath));
    if (hasOwn(candidate, "$ref")) {
      for (const keyword of Object.keys(candidate)) {
        if (keyword !== "$ref" && !ANNOTATION_KEYWORDS.has(keyword)) {
          issues.push({
            path: schemaPath,
            keyword: "$refSiblingKeyword",
            message: `$ref sibling 关键字 ${JSON.stringify(keyword)} 不会被静默忽略，拒绝按通过处理`,
          });
        }
      }
      let referencedSchema;
      try {
        referencedSchema = resolveLocalRef(root, candidate.$ref);
      } catch {
        issues.push({
          path: schemaPath,
          keyword: "$ref",
          message: `无法解析 schema 引用 ${JSON.stringify(candidate.$ref)}`,
        });
        return;
      }
      visit(referencedSchema, `${schemaPath} -> ${candidate.$ref}`);
      return;
    }
    if (hasOwn(candidate, "anyOf") && Array.isArray(candidate.anyOf)) {
      candidate.anyOf.forEach((branch, index) => {
        visit(branch, `${schemaPath}/anyOf/${index}`);
      });
    } else if (hasOwn(candidate, "anyOf")) {
      issues.push({
        path: schemaPath,
        keyword: "schema",
        message: "anyOf 必须是数组",
      });
    }
    if (hasOwn(candidate, "properties") && isObject(candidate.properties)) {
      for (const [property, propertySchema] of Object.entries(candidate.properties)) {
        visit(propertySchema, `${schemaPath}/properties/${property}`);
      }
    } else if (hasOwn(candidate, "properties")) {
      issues.push({
        path: schemaPath,
        keyword: "schema",
        message: "properties 必须是对象",
      });
    }
    if (hasOwn(candidate, "items")) {
      visit(candidate.items, `${schemaPath}/items`);
    }
    if (
      hasOwn(candidate, "additionalProperties") &&
      candidate.additionalProperties !== true &&
      candidate.additionalProperties !== false
    ) {
      visit(candidate.additionalProperties, `${schemaPath}/additionalProperties`);
    }
  };

  visit(schema, "#");
  return issues.sort(
    (left, right) =>
      left.path.localeCompare(right.path) ||
      left.keyword.localeCompare(right.keyword) ||
      left.message.localeCompare(right.message),
  );
}

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function isValidCalendarDate(year, month, day) {
  const daysInMonth = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth[month - 1];
}

function isValidDate(value) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return (
    Boolean(match) && isValidCalendarDate(Number(match[1]), Number(match[2]), Number(match[3]))
  );
}

function isValidDateTime(value) {
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/,
  );
  if (!match) return false;
  const [, year, month, day, hour, minute, second, , offsetHour, offsetMinute] = match;
  return (
    isValidCalendarDate(Number(year), Number(month), Number(day)) &&
    Number(hour) <= 23 &&
    Number(minute) <= 59 &&
    Number(second) <= 59 &&
    (offsetHour === undefined || (Number(offsetHour) <= 23 && Number(offsetMinute) <= 59))
  );
}

function validateFormat(value, format, violations, instancePath) {
  const isValid =
    format === "uuid"
      ? /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
      : format === "date"
        ? isValidDate(value)
        : format === "date-time"
          ? isValidDateTime(value)
          : null;

  if (isValid === null) {
    addViolation(
      violations,
      instancePath,
      "format",
      `校验器不支持 format=${JSON.stringify(format)}，拒绝按通过处理`,
    );
  } else if (!isValid) {
    addViolation(violations, instancePath, "format", `值不符合 format=${format}`);
  }
}

function validateType(value, expectedType, violations, instancePath) {
  const valid =
    expectedType === "object"
      ? isObject(value)
      : expectedType === "array"
        ? Array.isArray(value)
        : expectedType === "integer"
          ? Number.isInteger(value)
          : expectedType === "number"
            ? typeof value === "number" && Number.isFinite(value)
            : expectedType === "string"
              ? typeof value === "string"
              : expectedType === "boolean"
                ? typeof value === "boolean"
                : expectedType === "null"
                  ? value === null
                  : null;
  if (valid === null) {
    addViolation(
      violations,
      instancePath,
      "type",
      `校验器不支持 type=${JSON.stringify(expectedType)}，拒绝按通过处理`,
    );
  } else if (!valid) {
    addViolation(violations, instancePath, "type", `期望类型为 ${expectedType}`);
  }
}

function validateSchema(value, schema, root, instancePath, violations) {
  if (!isObject(schema)) {
    addViolation(
      violations,
      instancePath,
      "schema",
      `schema 必须是对象，实际为 ${JSON.stringify(schema)}`,
    );
    return;
  }

  for (const keyword of Object.keys(schema)) {
    if (!SUPPORTED_SCHEMA_KEYWORDS.has(keyword)) {
      addViolation(
        violations,
        instancePath,
        "unsupportedSchemaKeyword",
        `不支持的 schema 关键字 ${JSON.stringify(keyword)}，拒绝按通过处理`,
      );
    }
  }
  for (const issue of auditSchemaCapabilities(schema, instancePath)) {
    addViolation(violations, issue.path, issue.keyword, issue.message);
  }

  if (hasOwn(schema, "$ref")) {
    for (const keyword of Object.keys(schema)) {
      if (keyword !== "$ref" && !ANNOTATION_KEYWORDS.has(keyword)) {
        addViolation(
          violations,
          instancePath,
          "$refSiblingKeyword",
          `$ref sibling 关键字 ${JSON.stringify(keyword)} 不会被静默忽略，拒绝按通过处理`,
        );
      }
    }
    let referencedSchema;
    try {
      referencedSchema = resolveLocalRef(root, schema.$ref);
    } catch {
      addViolation(
        violations,
        instancePath,
        "$ref",
        `无法解析 schema 引用 ${JSON.stringify(schema.$ref)}`,
      );
      return;
    }
    validateSchema(value, referencedSchema, root, instancePath, violations);
    return;
  }

  if (hasOwn(schema, "anyOf") && Array.isArray(schema.anyOf)) {
    const branches = schema.anyOf.map((candidate) => {
      const candidateViolations = [];
      validateSchema(value, candidate, root, instancePath, candidateViolations);
      return candidateViolations;
    });
    if (!branches.some((candidateViolations) => candidateViolations.length === 0)) {
      addViolation(violations, instancePath, "anyOf", "值不匹配 anyOf 中任一允许的 schema");
    }
  } else if (hasOwn(schema, "anyOf")) {
    addViolation(violations, instancePath, "schema", "anyOf 必须是数组");
  }

  if (hasOwn(schema, "type") && SUPPORTED_TYPES.has(schema.type)) {
    validateType(value, schema.type, violations, instancePath);
  }

  if (hasOwn(schema, "const") && !isDeepStrictEqual(value, schema.const)) {
    addViolation(
      violations,
      instancePath,
      "const",
      `期望固定值 ${JSON.stringify(schema.const)}，实际为 ${JSON.stringify(value)}`,
    );
  }

  if (hasOwn(schema, "enum")) {
    if (!Array.isArray(schema.enum)) {
      addViolation(violations, instancePath, "schema", "enum 必须是数组");
    } else if (!schema.enum.some((candidate) => isDeepStrictEqual(value, candidate))) {
      addViolation(
        violations,
        instancePath,
        "enum",
        `值 ${JSON.stringify(value)} 不在允许枚举 ${JSON.stringify(schema.enum)} 中`,
      );
    }
  }

  if (typeof value === "string") {
    if (hasOwn(schema, "format") && SUPPORTED_FORMATS.has(schema.format)) {
      validateFormat(value, schema.format, violations, instancePath);
    }
    if (hasOwn(schema, "minLength") && value.length < schema.minLength) {
      addViolation(violations, instancePath, "minLength", `字符串长度小于 ${schema.minLength}`);
    }
    if (hasOwn(schema, "maxLength") && value.length > schema.maxLength) {
      addViolation(violations, instancePath, "maxLength", `字符串长度大于 ${schema.maxLength}`);
    }
    if (hasOwn(schema, "pattern")) {
      let pattern;
      try {
        pattern = new RegExp(schema.pattern);
      } catch {
        addViolation(
          violations,
          instancePath,
          "pattern",
          `无效的正则表达式 ${JSON.stringify(schema.pattern)}`,
        );
      }
      if (pattern && !pattern.test(value)) {
        addViolation(
          violations,
          instancePath,
          "pattern",
          `值不匹配 pattern=${JSON.stringify(schema.pattern)}`,
        );
      }
    }
  }

  if (typeof value === "number") {
    if (hasOwn(schema, "minimum") && value < schema.minimum) {
      addViolation(violations, instancePath, "minimum", `数值小于最小值 ${schema.minimum}`);
    }
    if (hasOwn(schema, "maximum") && value > schema.maximum) {
      addViolation(violations, instancePath, "maximum", `数值大于最大值 ${schema.maximum}`);
    }
    if (hasOwn(schema, "exclusiveMinimum") && value <= schema.exclusiveMinimum) {
      addViolation(
        violations,
        instancePath,
        "exclusiveMinimum",
        `数值不大于排他最小值 ${schema.exclusiveMinimum}`,
      );
    }
  }

  if (Array.isArray(value)) {
    if (hasOwn(schema, "minItems") && value.length < schema.minItems) {
      addViolation(violations, instancePath, "minItems", `数组长度小于 ${schema.minItems}`);
    }
    if (hasOwn(schema, "maxItems") && value.length > schema.maxItems) {
      addViolation(violations, instancePath, "maxItems", `数组长度大于 ${schema.maxItems}`);
    }
    if (hasOwn(schema, "items")) {
      value.forEach((item, index) => {
        validateSchema(item, schema.items, root, `${instancePath}[${index}]`, violations);
      });
    }
  }

  if (isObject(value)) {
    const properties =
      hasOwn(schema, "properties") && isObject(schema.properties) ? schema.properties : {};
    if (hasOwn(schema, "required")) {
      if (!Array.isArray(schema.required)) {
        addViolation(violations, instancePath, "schema", "required 必须是字符串数组");
      } else {
        for (const field of schema.required) {
          if (typeof field !== "string") {
            addViolation(violations, instancePath, "schema", "required 必须仅包含字符串");
          } else if (!hasOwn(value, field)) {
            addViolation(
              violations,
              jsonPointerPath(instancePath, field),
              "required",
              `缺少必需字段 ${JSON.stringify(field)}`,
            );
          }
        }
      }
    }

    for (const [key, propertySchema] of Object.entries(properties)) {
      if (hasOwn(value, key)) {
        validateSchema(
          value[key],
          propertySchema,
          root,
          jsonPointerPath(instancePath, key),
          violations,
        );
      }
    }

    if (hasOwn(schema, "additionalProperties") && schema.additionalProperties !== true) {
      for (const key of Object.keys(value)) {
        if (hasOwn(properties, key)) continue;
        const keyPath = jsonPointerPath(instancePath, key);
        if (schema.additionalProperties === false) {
          addViolation(
            violations,
            keyPath,
            "additionalProperties",
            `schema 不允许额外字段 ${JSON.stringify(key)}`,
          );
        } else {
          validateSchema(value[key], schema.additionalProperties, root, keyPath, violations);
        }
      }
    }
  }
}

export function validateJsonSchema(value, schema, root) {
  const violations = [];
  validateSchema(value, schema, root, "$", violations);
  return violations.sort(
    (left, right) =>
      left.path.localeCompare(right.path) ||
      left.keyword.localeCompare(right.keyword) ||
      left.message.localeCompare(right.message),
  );
}

export function listOpenApiOperations(openApi) {
  if (!isObject(openApi) || !hasOwn(openApi, "paths") || !isObject(openApi.paths)) {
    throw new Error("OpenAPI 文档缺少 paths 对象");
  }

  const operations = [];
  for (const [operationPath, pathItem] of Object.entries(openApi.paths)) {
    if (!isObject(pathItem)) {
      throw new Error(`OpenAPI pathItem 不是对象: ${operationPath}`);
    }
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method)) continue;
      if (
        !isObject(operation) ||
        !hasOwn(operation, "responses") ||
        !isObject(operation.responses)
      ) {
        throw new Error(`OpenAPI operation 缺少 responses: ${method} ${operationPath}`);
      }
      const successResponses = [];
      for (const [status, response] of Object.entries(operation.responses)) {
        if (!isSuccessStatus(status)) continue;
        if (!isObject(response) || !isObject(response.content)) {
          throw new Error(`成功响应缺少 content: ${method} ${operationPath} ${status}`);
        }
        const jsonResponse = response.content[JSON_MEDIA_TYPE];
        if (!isObject(jsonResponse) || !hasOwn(jsonResponse, "schema")) {
          throw new Error(
            `成功响应缺少 application/json.schema: ${method} ${operationPath} ${status}`,
          );
        }
        if (!isObject(jsonResponse.schema)) {
          throw new Error(`成功响应 schema 不是对象: ${method} ${operationPath} ${status}`);
        }
        successResponses.push({
          status,
          response,
          schema: jsonResponse.schema,
        });
      }
      if (successResponses.length === 0) {
        throw new Error(`OpenAPI operation 没有 2xx 响应: ${method} ${operationPath}`);
      }
      for (const { status, schema } of successResponses) {
        const schemaIssues = auditJsonSchema(schema, openApi);
        if (schemaIssues.length > 0) {
          throw new Error(
            `OpenAPI 成功响应 schema 失败关闭: ${method} ${operationPath} ${status}: ` +
              JSON.stringify(schemaIssues),
          );
        }
      }
      operations.push({
        key: operationKey(method, operationPath),
        method: method.toUpperCase(),
        path: operationPath,
        operationId: operation.operationId ?? null,
        successResponses,
      });
    }
  }
  return operations.sort((left, right) => compareOperationKeys(left.key, right.key));
}

export function classifyOpenApiSuccessCoverage(openApi, fakeOperationKeys) {
  const operations = listOpenApiOperations(openApi);
  const fakeKeys = new Set(fakeOperationKeys);
  const missingOperations = operations
    .filter((operation) => !fakeKeys.has(operation.key))
    .map((operation) => operation.key);
  const unmodeledResponses = operations.flatMap((operation) =>
    operation.successResponses
      .filter((successResponse) => Object.keys(successResponse.schema).length === 0)
      .map((successResponse) => ({
        operation: operation.key,
        status: successResponse.status,
      })),
  );

  return { operations, missingOperations, unmodeledResponses };
}
