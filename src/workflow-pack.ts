import type { JsonValue } from "./core.js";

export type Schema = {
  type?: "object" | "array" | "string" | "number" | "integer" | "boolean" | "null";
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  oneOf?: Schema[];
  additionalProperties?: boolean;
  enum?: JsonValue[];
  const?: JsonValue;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
  contentEncoding?: string;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  minProperties?: number;
  maxProperties?: number;
};

export type Operation = {
  name: string;
  description: string;
  inputSchema: Schema;
  readOnly: boolean;
  automationReplayMode?: "repeatable-read" | "repeatable-stateless" | "once-create" | "once-update-etag-required" | "once-update-state-required" | "once-delete" | "once-uncertain";
  coverage: "uncovered" | "pack-defined-not-live-verified" | "live-verified";
  livePolicy: "read-only" | "run-owned-resource-cleanup-required" | "one-time-confirmed-target-required" | "gated-outside-authorized-scope" | "unsafe-or-not-started";
  resource?: { kind: string; effect: "create" | "update" | "delete"; parentKind?: string };
};

export type OperationInventory = {
  format: "evalcase.mcp-operation-inventory";
  version: 1;
  id: string;
  source: { repository: string; commit: string; capturedAt: string; note: string };
  actions: Operation[];
  resourceCoverage: { kind: string; operations: string[]; lifecycle: string }[];
};

export type HumanSurfaceInventory = {
  format: "evalcase.human-operation-surface";
  version: 1;
  id: string;
  source: { repository: string; commit: string; scope: string };
  operations: { id: string; endpoint: string; method: string; agentOperation?: string }[];
};

export const compareHumanSurface = (surface: HumanSurfaceInventory, inventory: OperationInventory) => {
  const known = new Set(inventory.actions.map((action) => action.name));
  return surface.operations.map((operation) => ({
    ...operation,
    status: !operation.agentOperation || !known.has(operation.agentOperation) ? "agent-gap" as const : "agent-operation-present" as const,
    ...(operation.agentOperation && !known.has(operation.agentOperation) ? { reason: "mapped MCP operation is absent from the selected catalog version" } : {})
  }));
};

export const parseHumanSurface = (value: unknown): { value?: HumanSurfaceInventory; diagnostics: Diagnostic[] } => {
  if (!isRecord(value) || value.format !== "evalcase.human-operation-surface" || value.version !== 1 || typeof value.id !== "string" || !Array.isArray(value.operations)) {
    return { diagnostics: [{ code: "SURFACE_SHAPE", path: "$", message: "unsupported human operation surface inventory" }] };
  }
  const diagnostics: Diagnostic[] = [];
  const ids = new Set<string>();
  value.operations.forEach((entry, index) => {
    const path = `$.operations[${index}]`;
    if (!isRecord(entry) || typeof entry.id !== "string" || typeof entry.endpoint !== "string" || typeof entry.method !== "string" || (entry.agentOperation !== undefined && typeof entry.agentOperation !== "string")) {
      diagnostics.push({ code: "SURFACE_OPERATION", path, message: "surface operation requires id, endpoint, method, and optional agent operation" });
    } else if (ids.has(entry.id)) diagnostics.push({ code: "SURFACE_DUPLICATE", path: `${path}.id`, message: "surface operation ID must be unique" });
    else ids.add(entry.id);
  });
  return diagnostics.length ? { diagnostics } : { value: value as HumanSurfaceInventory, diagnostics };
};

export type PackValue = JsonValue | { $target: string } | { $run: "id" | "uniqueListName" | "renamedListName" | "testTitle" } | { $capture: string };
export type Assertion =
  | { op: "equals" | "contains" | "not-contains"; path: string; value: PackValue }
  | { op: "exists"; path: string; value: boolean };

export type PackCase = {
  id: string;
  operation: string;
  kind: "positive" | "expected-rejection";
  arguments: Record<string, PackValue>;
  expect: { outcome: "success" | "error"; phase: "tool" | "mcp-schema"; assertions: Assertion[] };
  capture?: Record<string, { path: string; type: "string" | "number" | "boolean" }>;
};

export type CleanupStep = {
  id: string;
  operation: string;
  arguments: Record<string, PackValue>;
  owns: string[];
  when?: { casePassed?: string[]; caseNotPassed?: string[] };
};

export type WorkflowPack = {
  format: "evalcase.workflow-pack";
  version: 1;
  id: string;
  name: string;
  inventory: { id: string; version: 1 };
  trigger: { type: "manual" };
  target: { type: "connected-integration"; service: string; resourceType: string; bindings: string[] };
  cases: PackCase[];
  cleanup: CleanupStep[];
};

export type Diagnostic = { code: string; path: string; message: string };
export type CoverageRow = {
  operation: string;
  livePolicy: Operation["livePolicy"];
  positiveCase: boolean;
  rejectionCase: boolean;
  status: "unsafe" | "gated-uncovered" | "one-time-confirmation-required" | "uncovered" | "schema-guarded" | "pack-defined-not-live-verified" | "live-verified";
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isJson = (value: unknown): value is JsonValue => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJson);
  return isRecord(value) && Object.values(value).every(isJson);
};
const typeOf = (value: unknown): string => Array.isArray(value) ? "array" : value === null ? "null" : typeof value;
const keys = (value: Record<string, unknown>) => Object.keys(value).sort();
const onlyKeys = (value: Record<string, unknown>, allowed: string[], path: string, out: Diagnostic[]) => {
  for (const key of keys(value)) if (!allowed.includes(key)) out.push({ code: "UNKNOWN_FIELD", path: `${path}.${key}`, message: "field is not supported" });
};
const pointerParts = (pointer: string): string[] | undefined => {
  if (pointer === "") return [];
  if (!pointer.startsWith("/")) return undefined;
  const parts = pointer.slice(1).split("/");
  if (parts.some((part) => /~(?![01])/.test(part))) return undefined;
  return parts.map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"));
};

const schemaIssues = (schema: Schema, value: unknown, path: string): Diagnostic[] => {
  const out: Diagnostic[] = [];
  const add = (code: string, message: string) => out.push({ code, path, message });
  const matchesType = schema.type === "integer"
    ? typeof value === "number" && Number.isSafeInteger(value)
    : schema.type === "number" ? typeof value === "number" : !schema.type || typeOf(value) === schema.type;
  if (!matchesType) {
    add("ARG_TYPE", `expected ${schema.type}`);
    return out;
  }
  if (schema.const !== undefined && JSON.stringify(schema.const) !== JSON.stringify(value)) add("ARG_CONST", "value does not match required constant");
  if (schema.enum && !schema.enum.some((candidate) => JSON.stringify(candidate) === JSON.stringify(value))) add("ARG_ENUM", "value is outside the allowed set");
  if (schema.oneOf && schema.oneOf.filter((candidate) => schemaIssues(candidate, value, path).length === 0).length !== 1) add("ARG_ONE_OF", "value must match exactly one allowed schema");
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) add("ARG_MINIMUM", "number is below the minimum");
    if (schema.maximum !== undefined && value > schema.maximum) add("ARG_MAXIMUM", "number is above the maximum");
  }
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) add("ARG_MIN_LENGTH", "string is too short");
    if (schema.maxLength !== undefined && value.length > schema.maxLength) add("ARG_MAX_LENGTH", "string is too long");
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) add("ARG_PATTERN", "string does not match the required pattern");
    if (schema.format === "uuid" && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) add("ARG_FORMAT", "value is not a UUID");
    if (schema.format === "email" && !/^[^\s@]+@[^\s@]+(?:\.[^\s@]+)+$/.test(value)) add("ARG_FORMAT", "value is not an email address");
    if (schema.format === "uri") {
      try { new URL(value); } catch { add("ARG_FORMAT", "value is not an absolute URI"); }
    }
    if (schema.contentEncoding === "base64" && !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) add("ARG_ENCODING", "value is not valid base64");
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) add("ARG_MIN_ITEMS", "array has too few items");
    if (schema.maxItems !== undefined && value.length > schema.maxItems) add("ARG_MAX_ITEMS", "array has too many items");
    if (schema.items) value.forEach((item, index) => out.push(...schemaIssues(schema.items!, item, `${path}[${index}]`)));
    if (schema.uniqueItems && new Set(value.map((item) => JSON.stringify(item))).size !== value.length) add("ARG_UNIQUE", "array values must be unique");
  }
  if (isRecord(value)) {
    const properties = schema.properties ?? {};
    for (const name of schema.required ?? []) if (!(name in value)) out.push({ code: "ARG_REQUIRED", path: `${path}.${name}`, message: "required argument is missing" });
    if (schema.minProperties !== undefined && Object.keys(value).length < schema.minProperties) add("ARG_MIN_PROPERTIES", "object has too few properties");
    if (schema.maxProperties !== undefined && Object.keys(value).length > schema.maxProperties) add("ARG_MAX_PROPERTIES", "object has too many properties");
    for (const [name, item] of Object.entries(value)) {
      const child = properties[name];
      if (child) out.push(...schemaIssues(child, item, `${path}.${name}`));
      else if (schema.additionalProperties === false) out.push({ code: "ARG_UNKNOWN", path: `${path}.${name}`, message: "argument is not supported" });
    }
  }
  return out;
};

const binding = (value: unknown): { kind: "target" | "run" | "capture"; value: string } | undefined => {
  if (!isRecord(value) || Object.keys(value).length !== 1) return undefined;
  if (typeof value.$target === "string" && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value.$target)) return { kind: "target", value: value.$target };
  if (value.$run === "id" || value.$run === "uniqueListName" || value.$run === "renamedListName" || value.$run === "testTitle") return { kind: "run", value: value.$run };
  if (typeof value.$capture === "string") return { kind: "capture", value: value.$capture };
  return undefined;
};

const isPackValue = (value: unknown): value is PackValue => {
  if (isRecord(value) && Object.keys(value).some((key) => key.startsWith("$"))) return binding(value) !== undefined;
  return isJson(value);
};

export const schemaIssuesWithBindings = (
  schema: Schema,
  value: unknown,
  path: string,
  captures: Map<string, string>
): Diagnostic[] => {
  const out: Diagnostic[] = [];
  const add = (code: string, message: string) => out.push({ code, path, message });
  if (schema.oneOf) {
    const matches = schema.oneOf.filter((candidate) => schemaIssuesWithBindings(candidate, value, path, captures).length === 0).length;
    if (matches !== 1) add("ARG_ONE_OF", "value must match exactly one allowed schema");
  }
  const ref = binding(value);
  if (ref) {
    if (ref.kind === "capture" && !captures.has(ref.value)) return [{ code: "CAPTURE_FORWARD_REF", path, message: "capture must come from an earlier successful case" }];
    const refType = ref.kind === "capture" ? captures.get(ref.value) : "string";
    if (schema.type && refType && schema.type !== refType && !(schema.type === "number" && refType === "number")) {
      return [{ code: "BINDING_TYPE", path, message: `binding type ${refType} does not match ${schema.type}` }];
    }
    if (schema.const !== undefined || schema.enum !== undefined) {
      add("BINDING_CONSTRAINT", "dynamic bindings cannot prove const or enum constraints");
    }
    return out;
  }
  const matchesType = schema.type === "integer"
    ? typeof value === "number" && Number.isSafeInteger(value)
    : schema.type === "number" ? typeof value === "number" : !schema.type || typeOf(value) === schema.type;
  if (!matchesType) return [{ code: "ARG_TYPE", path, message: `expected ${schema.type}` }];
  if (schema.const !== undefined && JSON.stringify(schema.const) !== JSON.stringify(value)) add("ARG_CONST", "value does not match required constant");
  if (schema.enum && !schema.enum.some((candidate) => JSON.stringify(candidate) === JSON.stringify(value))) add("ARG_ENUM", "value is outside the allowed set");
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) add("ARG_MINIMUM", "number is below the minimum");
    if (schema.maximum !== undefined && value > schema.maximum) add("ARG_MAXIMUM", "number is above the maximum");
  }
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) add("ARG_MIN_LENGTH", "string is too short");
    if (schema.maxLength !== undefined && value.length > schema.maxLength) add("ARG_MAX_LENGTH", "string is too long");
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) add("ARG_PATTERN", "string does not match the required pattern");
    if (schema.format === "uuid" && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) add("ARG_FORMAT", "value is not a UUID");
    if (schema.format === "email" && !/^[^\s@]+@[^\s@]+(?:\.[^\s@]+)+$/.test(value)) add("ARG_FORMAT", "value is not an email address");
    if (schema.format === "uri") {
      try { new URL(value); } catch { add("ARG_FORMAT", "value is not an absolute URI"); }
    }
    if (schema.contentEncoding === "base64" && !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) add("ARG_ENCODING", "value is not valid base64");
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) add("ARG_MIN_ITEMS", "array has too few items");
    if (schema.maxItems !== undefined && value.length > schema.maxItems) add("ARG_MAX_ITEMS", "array has too many items");
    if (schema.uniqueItems && new Set(value.map((item) => JSON.stringify(item))).size !== value.length) add("ARG_UNIQUE", "array values must be unique");
    if (schema.items) value.forEach((item, index) => out.push(...schemaIssuesWithBindings(schema.items!, item, `${path}[${index}]`, captures)));
  }
  if (isRecord(value)) {
    const properties = schema.properties ?? {};
    for (const name of schema.required ?? []) if (!(name in value)) out.push({ code: "ARG_REQUIRED", path: `${path}.${name}`, message: "required argument is missing" });
    if (schema.minProperties !== undefined && Object.keys(value).length < schema.minProperties) add("ARG_MIN_PROPERTIES", "object has too few properties");
    if (schema.maxProperties !== undefined && Object.keys(value).length > schema.maxProperties) add("ARG_MAX_PROPERTIES", "object has too many properties");
    for (const [name, item] of Object.entries(value)) {
      const child = properties[name];
      if (child) out.push(...schemaIssuesWithBindings(child, item, `${path}.${name}`, captures));
      else if (schema.additionalProperties === false) out.push({ code: "ARG_UNKNOWN", path: `${path}.${name}`, message: "argument is not supported" });
    }
  }
  return out;
};

const contains = (actual: unknown, expected: unknown): boolean => {
  if (isRecord(expected)) return isRecord(actual) && Object.entries(expected).every(([key, value]) => contains(actual[key], value));
  if (Array.isArray(expected)) return Array.isArray(actual) && expected.every((value) => actual.some((candidate) => contains(candidate, value)));
  return JSON.stringify(actual) === JSON.stringify(expected);
};

export const parseOperationInventory = (value: unknown): { value?: OperationInventory; diagnostics: Diagnostic[] } => {
  const diagnostics: Diagnostic[] = [];
  if (!isRecord(value) || value.format !== "evalcase.mcp-operation-inventory" || value.version !== 1 || typeof value.id !== "string" || !Array.isArray(value.actions)) {
    return { diagnostics: [{ code: "INVENTORY_SHAPE", path: "$", message: "unsupported MCP operation inventory" }] };
  }
  const names = new Set<string>();
  value.actions.forEach((action, index) => {
    const path = `$.actions[${index}]`;
    if (!isRecord(action) || typeof action.name !== "string" || !isRecord(action.inputSchema) || typeof action.readOnly !== "boolean") {
      diagnostics.push({ code: "INVENTORY_ACTION", path, message: "action requires a name, input schema, and read-only flag" });
      return;
    }
    if (action.automationReplayMode !== undefined && !["repeatable-read", "repeatable-stateless", "once-create", "once-update-etag-required", "once-update-state-required", "once-delete", "once-uncertain"].includes(String(action.automationReplayMode))) diagnostics.push({ code: "INVENTORY_REPLAY_MODE", path: `${path}.automationReplayMode`, message: "unsupported automation replay mode" });
    if (!["uncovered", "pack-defined-not-live-verified", "live-verified"].includes(String(action.coverage))) diagnostics.push({ code: "INVENTORY_COVERAGE", path: `${path}.coverage`, message: "action requires an explicit coverage status" });
    if (!["read-only", "run-owned-resource-cleanup-required", "one-time-confirmed-target-required", "gated-outside-authorized-scope", "unsafe-or-not-started"].includes(String(action.livePolicy))) diagnostics.push({ code: "INVENTORY_POLICY", path: `${path}.livePolicy`, message: "action requires an explicit live-test policy" });
    if (names.has(action.name)) diagnostics.push({ code: "INVENTORY_DUPLICATE", path: `${path}.name`, message: "operation name must be unique" });
    names.add(action.name);
  });
  return diagnostics.length ? { diagnostics } : { value: value as OperationInventory, diagnostics };
};

export const parseWorkflowPack = (value: unknown, inventory: OperationInventory): { value?: WorkflowPack; diagnostics: Diagnostic[] } => {
  const diagnostics: Diagnostic[] = [];
  if (!isRecord(value)) return { diagnostics: [{ code: "PACK_ROOT", path: "$", message: "pack must be an object" }] };
  if (/https?:\/\//i.test(JSON.stringify(value))) diagnostics.push({ code: "RAW_URL", path: "$", message: "packs cannot contain URLs; bind the site through the explicit run target" });
  onlyKeys(value, ["format", "version", "id", "name", "inventory", "trigger", "target", "cases", "cleanup"], "$", diagnostics);
  if (value.format !== "evalcase.workflow-pack" || value.version !== 1) diagnostics.push({ code: "PACK_VERSION", path: "$", message: "unsupported pack format or version" });
  for (const key of ["id", "name"] as const) if (typeof value[key] !== "string" || value[key].length === 0) diagnostics.push({ code: "PACK_FIELD", path: `$.${key}`, message: "expected a non-empty string" });
  if (!isRecord(value.inventory) || value.inventory.id !== inventory.id || value.inventory.version !== inventory.version) diagnostics.push({ code: "INVENTORY_MISMATCH", path: "$.inventory", message: "pack inventory must match the selected versioned operation catalog" });
  if (!isRecord(value.trigger) || value.trigger.type !== "manual" || Object.keys(value.trigger).some((key) => key !== "type")) diagnostics.push({ code: "TRIGGER", path: "$.trigger", message: "only the manual trigger is supported" });
  if (!isRecord(value.target) || value.target.type !== "connected-integration" || typeof value.target.service !== "string" || !value.target.service || typeof value.target.resourceType !== "string" || !value.target.resourceType || !Array.isArray(value.target.bindings) || value.target.bindings.length < 1 || value.target.bindings.length > 10 || !value.target.bindings.every((name) => typeof name === "string" && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name)) || new Set(value.target.bindings).size !== value.target.bindings.length || Object.keys(value.target).some((key) => !["type", "service", "resourceType", "bindings"].includes(key))) diagnostics.push({ code: "TARGET", path: "$.target", message: "pack target must identify one connected integration, resource type, and unique target bindings" });
  if (!Array.isArray(value.cases) || value.cases.length === 0) diagnostics.push({ code: "CASES", path: "$.cases", message: "pack requires at least one case" });
  if (!Array.isArray(value.cleanup)) diagnostics.push({ code: "CLEANUP", path: "$.cleanup", message: "cleanup must be an array" });
  if (diagnostics.length) return { diagnostics };

  const actionByName = new Map(inventory.actions.map((action) => [action.name, action]));
  const ids = new Set<string>();
  const captures = new Map<string, string>();
  const created = new Map<string, string>();
  const targetRefs = new Set<string>();
  const declaredTargetBindings = isRecord(value.target) && Array.isArray(value.target.bindings) ? value.target.bindings : [];
  const collectTargets = (node: unknown): void => {
    const ref = binding(node);
    if (ref?.kind === "target") targetRefs.add(ref.value);
    else if (Array.isArray(node)) node.forEach(collectTargets);
    else if (isRecord(node)) Object.values(node).forEach(collectTargets);
  };
  collectTargets(value.cases);
  collectTargets(value.cleanup);
  if (declaredTargetBindings.length > 0 && (targetRefs.size !== declaredTargetBindings.length || declaredTargetBindings.some((name) => !targetRefs.has(name as string)))) {
    diagnostics.push({ code: "TARGET_BINDINGS", path: "$.target.bindings", message: "target bindings must exactly match the fields used by cases and cleanup" });
  }
  const cases = value.cases as unknown[];
  cases.forEach((item, index) => {
    const path = `$.cases[${index}]`;
    if (!isRecord(item)) {
      diagnostics.push({ code: "CASE_TYPE", path, message: "case must be an object" });
      return;
    }
    onlyKeys(item, ["id", "operation", "kind", "arguments", "expect", "capture"], path, diagnostics);
    if (typeof item.id !== "string" || !item.id || ids.has(item.id)) diagnostics.push({ code: "CASE_ID", path: `${path}.id`, message: "case ID must be unique and non-empty" });
    else ids.add(item.id);
    const operation = typeof item.operation === "string" ? actionByName.get(item.operation) : undefined;
    if (!operation) diagnostics.push({ code: "OPERATION_UNKNOWN", path: `${path}.operation`, message: "operation is not in the selected MCP inventory" });
    if (item.kind !== "positive" && item.kind !== "expected-rejection") diagnostics.push({ code: "CASE_KIND", path: `${path}.kind`, message: "expected positive or expected-rejection" });
    if (!isRecord(item.arguments)) diagnostics.push({ code: "CASE_ARGUMENTS", path: `${path}.arguments`, message: "arguments must be an object" });
    if (!isRecord(item.expect) || (item.expect.outcome !== "success" && item.expect.outcome !== "error") || (item.expect.phase !== "tool" && item.expect.phase !== "mcp-schema") || !Array.isArray(item.expect.assertions)) {
      diagnostics.push({ code: "CASE_EXPECT", path: `${path}.expect`, message: "expectation requires outcome, phase, and data-only assertions" });
    }
    if (item.kind === "positive" && (!isRecord(item.expect) || item.expect.outcome !== "success")) diagnostics.push({ code: "CASE_EXPECT", path: `${path}.expect.outcome`, message: "positive cases must expect success" });
    if (item.kind === "expected-rejection" && (!isRecord(item.expect) || (item.expect.outcome !== "error" && item.expect.outcome !== "success"))) diagnostics.push({ code: "CASE_EXPECT", path: `${path}.expect.outcome`, message: "expected-rejection cases must assert an error result or an operation-level rejection in result data" });
    if (!operation || !isRecord(item.arguments) || !isRecord(item.expect)) return;

    const schemaOnly = item.kind === "expected-rejection" && item.expect.outcome === "error" && item.expect.phase === "mcp-schema";
    if (!["read-only", "run-owned-resource-cleanup-required"].includes(operation.livePolicy) && !schemaOnly) {
      diagnostics.push({ code: "OPERATION_POLICY", path: `${path}.operation`, message: "operations outside the live run scope may only have MCP-schema rejection cases" });
    }

    const argumentIssues = schemaIssuesWithBindings(operation.inputSchema, item.arguments, `${path}.arguments`, captures);
    const phase = item.expect.phase;
    const assertions = Array.isArray(item.expect.assertions) ? item.expect.assertions as unknown[] : [];
    if (phase === "mcp-schema" && argumentIssues.length === 0) diagnostics.push({ code: "REJECTION_PHASE", path: `${path}.expect.phase`, message: "mcp-schema rejection case must contain an input that violates the tool schema" });
    if (phase === "tool" && argumentIssues.length > 0) diagnostics.push(...argumentIssues);
    if (item.kind === "positive" && phase !== "tool") diagnostics.push({ code: "POSITIVE_PHASE", path: `${path}.expect.phase`, message: "positive cases must reach the MCP tool" });
    if (assertions.length === 0) diagnostics.push({ code: "ASSERTION_REQUIRED", path: `${path}.expect.assertions`, message: "each case requires at least one data-only outcome assertion" });
    if (assertions.some((assertion) => !isRecord(assertion) || !(assertion.op === "equals" || assertion.op === "contains" || assertion.op === "not-contains" || assertion.op === "exists") || typeof assertion.path !== "string" || pointerParts(assertion.path) === undefined)) {
      diagnostics.push({ code: "ASSERTION", path: `${path}.expect.assertions`, message: "assertions must use supported data-only JSON pointers" });
    }
    if (assertions.length) {
      assertions.forEach((assertion, assertionIndex) => {
        const assertionPath = `${path}.expect.assertions[${assertionIndex}]`;
        if (!isRecord(assertion)) return;
        const allowed = assertion.op === "exists" ? ["op", "path", "value"] : ["op", "path", "value"];
        onlyKeys(assertion, allowed, assertionPath, diagnostics);
        if (assertion.op === "exists" && typeof assertion.value !== "boolean") diagnostics.push({ code: "ASSERTION_VALUE", path: `${assertionPath}.value`, message: "exists assertion requires a boolean" });
        if ((assertion.op === "equals" || assertion.op === "contains" || assertion.op === "not-contains") && !isPackValue(assertion.value)) diagnostics.push({ code: "ASSERTION_VALUE", path: `${assertionPath}.value`, message: "assertion value must be JSON data or a supported capture binding" });
        if (isRecord(assertion.value) && typeof assertion.value.$capture === "string" && !captures.has(assertion.value.$capture)) diagnostics.push({ code: "CAPTURE_FORWARD_REF", path: `${assertionPath}.value`, message: "assertion capture must come from an earlier case" });
      });
    }
    const serialized = JSON.stringify(item.arguments);
    if (/https?:\/\//i.test(serialized)) diagnostics.push({ code: "RAW_URL", path: `${path}.arguments`, message: "packs cannot contain URLs; bind siteUrl to the confirmed run target" });
    const checkSiteBinding = (value: unknown, currentPath: string): void => {
      if (isRecord(value)) {
        for (const [key, nested] of Object.entries(value)) {
          if (key === "siteUrl" && binding(nested)?.kind !== "target") diagnostics.push({ code: "SITE_BINDING", path: `${currentPath}.${key}`, message: "siteUrl must bind to the exact run-confirmed target" });
          checkSiteBinding(nested, `${currentPath}.${key}`);
        }
      } else if (Array.isArray(value)) value.forEach((nested, i) => checkSiteBinding(nested, `${currentPath}[${i}]`));
    };
    checkSiteBinding(item.arguments, `${path}.arguments`);

    if (item.capture !== undefined) {
      if (!isRecord(item.capture)) diagnostics.push({ code: "CAPTURE", path: `${path}.capture`, message: "capture must be a map of JSON pointers and primitive types" });
      else for (const [name, spec] of Object.entries(item.capture)) {
        if (!name || !isRecord(spec) || typeof spec.path !== "string" || pointerParts(spec.path) === undefined || !(spec.type === "string" || spec.type === "number" || spec.type === "boolean")) {
          diagnostics.push({ code: "CAPTURE", path: `${path}.capture.${name}`, message: "capture requires a JSON pointer and primitive type" });
          continue;
        }
        const key = `${item.id}.${name}`;
        captures.set(key, spec.type);
        if ((operation.name === "deployment_site_list_create" || operation.name === "deployment_list_item_create") && spec.path === "/id") created.set(key, operation.resource?.kind ?? "");
      }
    }
  });

  const cleanupIds = new Set<string>();
  (value.cleanup as unknown[]).forEach((item, index) => {
    const path = `$.cleanup[${index}]`;
    if (!isRecord(item)) {
      diagnostics.push({ code: "CLEANUP_TYPE", path, message: "cleanup step must be an object" });
      return;
    }
    onlyKeys(item, ["id", "operation", "arguments", "owns", "when"], path, diagnostics);
    if (typeof item.id !== "string" || !item.id || ids.has(item.id) || cleanupIds.has(item.id)) diagnostics.push({ code: "CLEANUP_ID", path: `${path}.id`, message: "step ID must be unique and non-empty" });
    else cleanupIds.add(item.id);
    const operation = typeof item.operation === "string" ? actionByName.get(item.operation) : undefined;
    if (!operation || operation.resource?.effect !== "delete") diagnostics.push({ code: "CLEANUP_OPERATION", path: `${path}.operation`, message: "cleanup must use an inventory operation classified as a delete" });
    if (!isRecord(item.arguments)) diagnostics.push({ code: "CLEANUP_ARGUMENTS", path: `${path}.arguments`, message: "cleanup arguments must be an object" });
    if (!Array.isArray(item.owns) || item.owns.length === 0 || !item.owns.every((ref) => typeof ref === "string" && created.has(ref))) diagnostics.push({ code: "CLEANUP_OWNERSHIP", path: `${path}.owns`, message: "cleanup must be bound to resource IDs captured from creates in this run" });
    if (item.when !== undefined) {
      if (!isRecord(item.when)) diagnostics.push({ code: "CLEANUP_CONDITION", path: `${path}.when`, message: "cleanup conditions must be an object" });
      else {
        onlyKeys(item.when, ["casePassed", "caseNotPassed"], `${path}.when`, diagnostics);
        for (const key of ["casePassed", "caseNotPassed"] as const) {
          const refs = item.when[key];
          if (refs !== undefined && (!Array.isArray(refs) || !refs.every((ref) => typeof ref === "string" && cases.some((candidate) => isRecord(candidate) && candidate.id === ref)))) {
            diagnostics.push({ code: "CLEANUP_CONDITION", path: `${path}.when.${key}`, message: "conditions must reference cases in this pack" });
          }
        }
      }
    }
    if (operation && isRecord(item.arguments)) {
      const issues = schemaIssuesWithBindings(operation.inputSchema, item.arguments, `${path}.arguments`, captures);
      diagnostics.push(...issues);
      const owns = Array.isArray(item.owns) ? item.owns as string[] : [];
      const ownedKinds = owns.map((ref) => created.get(ref)).filter(Boolean);
      if (operation.resource?.kind && ownedKinds.length && !ownedKinds.includes(operation.resource.kind)) diagnostics.push({ code: "CLEANUP_RESOURCE_KIND", path: `${path}.operation`, message: "cleanup operation does not delete a resource created by this run" });
      const ownedIdField = operation.resource?.kind === "sharepoint-list" ? "listId"
        : operation.resource?.kind === "sharepoint-list-item" ? "itemId" : undefined;
      if (ownedIdField) {
        const reference = binding(item.arguments[ownedIdField]);
        const capture = reference?.kind === "capture" ? reference.value : "";
        if (!reference || reference.kind !== "capture" || !owns.includes(capture) || created.get(capture) !== operation.resource?.kind) {
          diagnostics.push({ code: "CLEANUP_OWNERSHIP", path: `${path}.arguments.${ownedIdField}`, message: "cleanup resource ID must reference the matching run-owned create capture" });
        }
      }
      const serialized = JSON.stringify(item.arguments);
      if (/https?:\/\//i.test(serialized)) diagnostics.push({ code: "RAW_URL", path: `${path}.arguments`, message: "packs cannot contain URLs; bind siteUrl to the confirmed run target" });
      const checkSiteBinding = (value: unknown, currentPath: string): void => {
        if (isRecord(value)) {
          for (const [key, nested] of Object.entries(value)) {
            if (key === "siteUrl" && binding(nested)?.kind !== "target") diagnostics.push({ code: "SITE_BINDING", path: `${currentPath}.${key}`, message: "siteUrl must bind to the exact run-confirmed target" });
            checkSiteBinding(nested, `${currentPath}.${key}`);
          }
        } else if (Array.isArray(value)) value.forEach((nested, i) => checkSiteBinding(nested, `${currentPath}[${i}]`));
      };
      checkSiteBinding(item.arguments, `${path}.arguments`);
    }
  });

  return diagnostics.length ? { diagnostics: finish(diagnostics) } : { value: value as WorkflowPack, diagnostics: [] };
};

export const coverageReport = (pack: WorkflowPack, inventory: OperationInventory): CoverageRow[] => {
  const operations = new Map(inventory.actions.map((action) => [action.name, action]));
  return inventory.actions.map((operation) => {
    const cases = pack.cases.filter((item) => item.operation === operation.name);
    const positiveCase = cases.some((item) => item.kind === "positive") || operation.coverage === "pack-defined-not-live-verified" || operation.coverage === "live-verified";
    const rejectionCase = cases.some((item) => item.kind === "expected-rejection");
    const status = operation.livePolicy === "unsafe-or-not-started" ? "unsafe"
      : operation.livePolicy === "gated-outside-authorized-scope" ? "gated-uncovered"
      : operation.livePolicy === "one-time-confirmed-target-required" ? "one-time-confirmation-required"
      : operation.coverage === "live-verified" ? "live-verified"
      : positiveCase ? "pack-defined-not-live-verified"
      : rejectionCase ? "schema-guarded" : "uncovered";
    return { operation: operation.name, livePolicy: operations.get(operation.name)!.livePolicy, positiveCase, rejectionCase, status };
  });
};

export const finish = (diagnostics: Diagnostic[]): Diagnostic[] =>
  [...diagnostics].sort((a, b) => a.code.localeCompare(b.code) || a.path.localeCompare(b.path) || a.message.localeCompare(b.message)).slice(0, 100);

export const readPointer = (value: unknown, pointer: string): { found: boolean; value?: unknown } => {
  const parts = pointerParts(pointer);
  if (!parts) return { found: false };
  let current: unknown = value;
  for (const part of parts) {
    if (Array.isArray(current)) {
      if (!/^(0|[1-9][0-9]*)$/.test(part) || Number(part) >= current.length) return { found: false };
      current = current[Number(part)];
    } else if (isRecord(current) && part in current) current = current[part];
    else return { found: false };
  }
  return { found: true, value: current };
};

export const assertionHolds = (assertion: Assertion, result: unknown): boolean => {
  const actual = readPointer(result, assertion.path);
  if (assertion.op === "exists") return actual.found === assertion.value;
  if (!actual.found) return false;
  if (assertion.op === "equals") return JSON.stringify(actual.value) === JSON.stringify(assertion.value);
  const match = contains(actual.value, assertion.value);
  return assertion.op === "contains" ? match : !match;
};
