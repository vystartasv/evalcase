export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export type Diagnostic = {
  code: string;
  path: string;
  message: string;
};

export type CaseStep = {
  id: string;
  tool: string;
  required_args: string[];
  result_status: "success" | "error";
  exact_result?: JsonValue;
  max_duration_ms?: number;
  allow_failure: boolean;
};

export type EvalCase = {
  id: string;
  name: string;
  input: { [key: string]: JsonValue };
  steps: CaseStep[];
};

type RunStart = {
  type: "run_start";
  id: string;
  case_id: string;
  duration_ms: number;
};

type ToolCall = {
  type: "tool_call";
  id: string;
  step_id: string;
  tool: string;
  arguments: { [key: string]: JsonValue };
  duration_ms: number;
};

type ToolResult = {
  type: "tool_result";
  id: string;
  call_id: string;
  status: "success" | "error";
  result: JsonValue;
  duration_ms: number;
};

type RunEnd = {
  type: "run_end";
  id: string;
  status: "success" | "error";
  duration_ms: number;
};

type Event = RunStart | ToolCall | ToolResult | RunEnd;

export type Evaluation = {
  status: "passed" | "failed" | "invalid";
  exitCode: 0 | 1 | 3;
  case?: EvalCase;
  diagnostics: Diagnostic[];
  steps: StepResult[];
  duration_ms: number;
};

export type StepResult = {
  id: string;
  name: string;
  status: "passed" | "failed" | "invalid";
  duration_ms: number;
  diagnostics: Diagnostic[];
};

const MAX_DIAGNOSTICS = 50;
const CASE_KEYS = ["id", "name", "input", "steps"];
const STEP_KEYS = ["id", "tool", "required_args", "result_status", "exact_result", "max_duration_ms", "allow_failure"];
const EVENT_KEYS: Record<string, string[]> = {
  run_start: ["type", "id", "case_id", "duration_ms"],
  tool_call: ["type", "id", "step_id", "tool", "arguments", "duration_ms"],
  tool_result: ["type", "id", "call_id", "status", "result", "duration_ms"],
  run_end: ["type", "id", "status", "duration_ms"]
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isJsonValue = (value: unknown): value is JsonValue => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isRecord(value) && Object.values(value).every(isJsonValue);
};

const pathKey = (path: string, key: string) => `${path}.${key}`;
const pathIndex = (path: string, index: number) => `${path}[${index}]`;

const add = (diagnostics: Diagnostic[], code: string, path: string, message: string) => {
  diagnostics.push({ code, path, message });
};

const keys = (value: Record<string, unknown>) => Object.keys(value).sort();

const checkKeys = (value: Record<string, unknown>, allowed: string[], path: string, diagnostics: Diagnostic[]) => {
  const allowedSet = new Set(allowed);
  for (const key of keys(value)) {
    if (!allowedSet.has(key)) add(diagnostics, "UNKNOWN_FIELD", pathKey(path, key), "field is not supported");
  }
};

const requiredString = (value: Record<string, unknown>, key: string, path: string, diagnostics: Diagnostic[]) => {
  const item = value[key];
  if (typeof item !== "string" || item.length === 0) {
    add(diagnostics, "FIELD_TYPE", pathKey(path, key), "expected a non-empty string");
    return undefined;
  }
  return item;
};

const requiredInteger = (value: Record<string, unknown>, key: string, path: string, diagnostics: Diagnostic[]) => {
  const item = value[key];
  if (typeof item !== "number" || !Number.isSafeInteger(item) || item < 0) {
    add(diagnostics, "FIELD_TYPE", pathKey(path, key), "expected a non-negative safe integer");
    return undefined;
  }
  return item;
};

const optionalInteger = (value: Record<string, unknown>, key: string, path: string, diagnostics: Diagnostic[]) => {
  if (!(key in value)) return undefined;
  return requiredInteger(value, key, path, diagnostics);
};

const canonical = (value: JsonValue): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key] as JsonValue)}`).join(",")}}`;
  }
  return JSON.stringify(value);
};

const finishDiagnostics = (diagnostics: Diagnostic[]) => {
  const sorted = [...diagnostics].sort((a, b) => a.code.localeCompare(b.code) || a.path.localeCompare(b.path) || a.message.localeCompare(b.message));
  return sorted.slice(0, MAX_DIAGNOSTICS);
};

export const parseCase = (value: unknown): { value?: EvalCase; diagnostics: Diagnostic[] } => {
  const diagnostics: Diagnostic[] = [];
  if (!isRecord(value)) {
    add(diagnostics, "ROOT_TYPE", "$", "case must be a JSON object");
    return { diagnostics: finishDiagnostics(diagnostics) };
  }
  checkKeys(value, CASE_KEYS, "$", diagnostics);
  const id = requiredString(value, "id", "$", diagnostics);
  const name = requiredString(value, "name", "$", diagnostics);
  const input = value.input;
  if (!isRecord(input) || !Object.values(input).every(isJsonValue)) add(diagnostics, "FIELD_TYPE", "$.input", "expected a JSON object of metadata");
  const stepsValue = value.steps;
  if (!Array.isArray(stepsValue)) add(diagnostics, "FIELD_TYPE", "$.steps", "expected an array");
  const steps: CaseStep[] = [];
  const ids = new Set<string>();
  if (Array.isArray(stepsValue)) {
    stepsValue.forEach((item, index) => {
      const path = pathIndex("$.steps", index);
      if (!isRecord(item)) {
        add(diagnostics, "STEP_TYPE", path, "step must be a JSON object");
        return;
      }
      checkKeys(item, STEP_KEYS, path, diagnostics);
      const stepId = requiredString(item, "id", path, diagnostics);
      const tool = requiredString(item, "tool", path, diagnostics);
      const requiredArgsValue = item.required_args;
      let requiredArgs: string[] = [];
      if (!Array.isArray(requiredArgsValue) || !requiredArgsValue.every((arg) => typeof arg === "string" && arg.length > 0)) {
        add(diagnostics, "FIELD_TYPE", pathKey(path, "required_args"), "expected an array of non-empty strings");
      } else {
        requiredArgs = requiredArgsValue;
        if (new Set(requiredArgs).size !== requiredArgs.length) add(diagnostics, "DUPLICATE_VALUE", pathKey(path, "required_args"), "required argument keys must be unique");
      }
      const resultStatus = item.result_status;
      if (resultStatus !== "success" && resultStatus !== "error") add(diagnostics, "FIELD_TYPE", pathKey(path, "result_status"), "expected success or error");
      if ("exact_result" in item && !isJsonValue(item.exact_result)) add(diagnostics, "FIELD_TYPE", pathKey(path, "exact_result"), "expected a JSON value");
      const maxDuration = optionalInteger(item, "max_duration_ms", path, diagnostics);
      if (typeof item.allow_failure !== "boolean") add(diagnostics, "FIELD_TYPE", pathKey(path, "allow_failure"), "expected a boolean");
      if (stepId && ids.has(stepId)) add(diagnostics, "DUPLICATE_ID", pathKey(path, "id"), "step id must be unique");
      if (stepId) ids.add(stepId);
      if (stepId && tool && (resultStatus === "success" || resultStatus === "error") && typeof item.allow_failure === "boolean") {
        steps.push({ id: stepId, tool, required_args: requiredArgs, result_status: resultStatus, ...( "exact_result" in item ? { exact_result: item.exact_result as JsonValue } : {}), ...(maxDuration === undefined ? {} : { max_duration_ms: maxDuration }), allow_failure: item.allow_failure });
      }
    });
  }
  if (diagnostics.length > 0 || !id || !name || !isRecord(input) || !Object.values(input).every(isJsonValue) || !Array.isArray(stepsValue)) return { diagnostics: finishDiagnostics(diagnostics) };
  return { value: { id, name, input: input as { [key: string]: JsonValue }, steps }, diagnostics: [] };
};

const parseEvent = (value: unknown, index: number, diagnostics: Diagnostic[]): Event | undefined => {
  const path = pathIndex("$", index);
  if (!isRecord(value)) {
    add(diagnostics, "EVENT_TYPE", path, "event must be a JSON object");
    return undefined;
  }
  const type = value.type;
  if (typeof type !== "string" || !(type in EVENT_KEYS)) {
    add(diagnostics, "EVENT_TYPE", pathKey(path, "type"), "unsupported event type");
    return undefined;
  }
  checkKeys(value, EVENT_KEYS[type], path, diagnostics);
  const id = requiredString(value, "id", path, diagnostics);
  const duration = requiredInteger(value, "duration_ms", path, diagnostics);
  if (!id || duration === undefined) return undefined;
  if (type === "run_start") {
    const caseId = requiredString(value, "case_id", path, diagnostics);
    return caseId ? { type: "run_start", id, case_id: caseId, duration_ms: duration } : undefined;
  }
  if (type === "tool_call") {
    const stepId = requiredString(value, "step_id", path, diagnostics);
    const tool = requiredString(value, "tool", path, diagnostics);
    if (!isRecord(value.arguments) || !Object.values(value.arguments).every(isJsonValue)) add(diagnostics, "FIELD_TYPE", pathKey(path, "arguments"), "expected a JSON object");
    if (!stepId || !tool || !isRecord(value.arguments) || !Object.values(value.arguments).every(isJsonValue)) return undefined;
    return { type: "tool_call", id, step_id: stepId, tool, arguments: value.arguments as { [key: string]: JsonValue }, duration_ms: duration };
  }
  if (type === "tool_result") {
    const callId = requiredString(value, "call_id", path, diagnostics);
    if (!isJsonValue(value.result)) add(diagnostics, "FIELD_TYPE", pathKey(path, "result"), "expected a JSON value");
    if (value.status !== "success" && value.status !== "error") add(diagnostics, "FIELD_TYPE", pathKey(path, "status"), "expected success or error");
    if (!callId || !isJsonValue(value.result) || (value.status !== "success" && value.status !== "error")) return undefined;
    return { type: "tool_result", id, call_id: callId, status: value.status, result: value.result, duration_ms: duration };
  }
  if (value.status !== "success" && value.status !== "error") add(diagnostics, "FIELD_TYPE", pathKey(path, "status"), "expected success or error");
  return value.status === "success" || value.status === "error" ? { type: "run_end", id, status: value.status, duration_ms: duration } : undefined;
};

export const parseOutcome = (values: unknown[]): { events?: Event[]; diagnostics: Diagnostic[] } => {
  const diagnostics: Diagnostic[] = [];
  const events = values.map((value, index) => parseEvent(value, index, diagnostics)).filter((event): event is Event => event !== undefined);
  const ids = new Set<string>();
  events.forEach((event, index) => {
    if (ids.has(event.id)) add(diagnostics, "DUPLICATE_ID", pathKey(pathIndex("$", index), "id"), "event id must be unique");
    ids.add(event.id);
  });
  if (events.length === 0) add(diagnostics, "EVENT_ORDER", "$", "outcome must contain events");
  return diagnostics.length > 0 ? { diagnostics: finishDiagnostics(diagnostics) } : { events, diagnostics: [] };
};

const diagnosticStep = (step: CaseStep, index: number, diagnostics: Diagnostic[]): StepResult => ({
  id: step.id,
  name: `step ${index + 1}: ${step.tool}`,
  status: diagnostics.length ? "failed" : "passed",
  duration_ms: 0,
  diagnostics: finishDiagnostics(diagnostics)
});

export const evaluate = (caseValue: EvalCase, events: Event[]): Evaluation => {
  const contract: Diagnostic[] = [];
  if (events[0]?.type !== "run_start") add(contract, "EVENT_ORDER", "$[0]", "first event must be run_start");
  if (events.at(-1)?.type !== "run_end") add(contract, "EVENT_ORDER", `$[${Math.max(events.length - 1, 0)}]`, "last event must be run_end");
  const runStart = events[0]?.type === "run_start" ? events[0] : undefined;
  const runEnd = events.at(-1)?.type === "run_end" ? events.at(-1) as RunEnd : undefined;
  if (runStart && runStart.case_id !== caseValue.id) add(contract, "CASE_MISMATCH", "$.case_id", `expected ${caseValue.id}`);
  const expectedLength = 2 + caseValue.steps.length * 2;
  if (events.length < expectedLength) add(contract, "MISSING_EVENT", "$", `expected ${expectedLength} events`);
  if (events.length > expectedLength) add(contract, "EVENT_ORDER", "$", `expected ${expectedLength} events`);
  const steps: StepResult[] = [];
  const seenCalls = new Set<string>();
  caseValue.steps.forEach((step, index) => {
    const callIndex = 1 + index * 2;
    const resultIndex = callIndex + 1;
    const call = events[callIndex];
    const result = events[resultIndex];
    const stepDiagnostics: Diagnostic[] = [];
    if (!call || call.type !== "tool_call") {
      add(contract, "MISSING_TOOL_CALL", `$[${callIndex}]`, `expected tool_call for step ${step.id}`);
    }
    if (!result || result.type !== "tool_result") {
      add(contract, "MISSING_RESULT", `$[${resultIndex}]`, `expected tool_result for step ${step.id}`);
    }
    if (call?.type === "tool_call") {
      if (seenCalls.has(call.id)) add(contract, "DUPLICATE_ID", `$[${callIndex}].id`, "tool call id must be unique");
      seenCalls.add(call.id);
      if (call.step_id !== step.id) add(contract, "STEP_MISMATCH", `$[${callIndex}].step_id`, `expected ${step.id}`);
      if (call.tool !== step.tool) add(stepDiagnostics, "TOOL_NAME", `$[${callIndex}].tool`, `expected ${step.tool}`);
      for (const key of step.required_args) if (!(key in call.arguments)) add(stepDiagnostics, "ARGUMENT_KEY", `$[${callIndex}].arguments.${key}`, "required argument key is missing");
    }
    if (result?.type === "tool_result") {
      if (call?.type === "tool_call" && result.call_id !== call.id) add(contract, "CALL_MISMATCH", `$[${resultIndex}].call_id`, `expected ${call.id}`);
      if (result.status !== step.result_status && !(result.status === "error" && step.allow_failure)) add(stepDiagnostics, "RESULT_STATUS", `$[${resultIndex}].status`, `expected ${step.result_status}`);
      if ("exact_result" in step && !(result.status === "error" && step.allow_failure) && canonical(result.result) !== canonical(step.exact_result as JsonValue)) add(stepDiagnostics, "EXACT_RESULT", `$[${resultIndex}].result`, "JSON fragment does not match");
      if (step.max_duration_ms !== undefined && result.duration_ms > step.max_duration_ms) add(stepDiagnostics, "MAX_DURATION", `$[${resultIndex}].duration_ms`, `must be <= ${step.max_duration_ms}`);
      steps.push({ ...diagnosticStep(step, index, stepDiagnostics), duration_ms: result.duration_ms });
    } else {
      steps.push(diagnosticStep(step, index, stepDiagnostics));
    }
  });
  if (runEnd && runEnd.status !== "success" && steps.every((step) => step.status === "passed")) add(contract, "RUN_STATUS", "$[last].status", "run_end status must be success when all steps pass");
  if (contract.length) return { status: "invalid", exitCode: 3, case: caseValue, diagnostics: finishDiagnostics(contract), steps, duration_ms: runEnd?.duration_ms ?? 0 };
  const failed = steps.some((step) => step.status === "failed");
  return { status: failed ? "failed" : "passed", exitCode: failed ? 1 : 0, case: caseValue, diagnostics: finishDiagnostics(steps.flatMap((step) => step.diagnostics)), steps, duration_ms: runEnd?.duration_ms ?? 0 };
};

export const makeReport = (evaluation: Evaluation) => {
  const passed = evaluation.steps.filter((step) => step.status === "passed").length;
  const failed = evaluation.steps.filter((step) => step.status === "failed").length;
  return {
    schema: "evalcase/report/v1",
    status: evaluation.status,
    exit_code: evaluation.exitCode,
    case: evaluation.case ? { id: evaluation.case.id, name: evaluation.case.name } : null,
    tests: evaluation.steps.length,
    failures: failed,
    errors: evaluation.status === "invalid" ? 1 : 0,
    time_ms: evaluation.duration_ms,
    summary: { steps: evaluation.steps.length, passed, failed, diagnostics: evaluation.diagnostics.length },
    testcases: evaluation.steps.map((step) => ({ id: step.id, name: step.name, status: step.status, duration_ms: step.duration_ms, diagnostics: step.diagnostics })),
    diagnostics: evaluation.diagnostics
  };
};

export const formatText = (evaluation: Evaluation) => {
  const title = evaluation.case ? `${evaluation.case.id} — ${evaluation.case.name}` : "evalcase";
  const lines = [`${evaluation.status.toUpperCase()} ${title}`, `steps: ${evaluation.steps.filter((step) => step.status === "passed").length} passed, ${evaluation.steps.filter((step) => step.status === "failed").length} failed`, `duration_ms: ${evaluation.duration_ms}`];
  for (const diagnostic of evaluation.diagnostics) lines.push(`${diagnostic.code} ${diagnostic.path} ${diagnostic.message}`);
  return `${lines.join("\n")}\n`;
};

export const demoData = (): { caseValue: EvalCase; events: Event[] } => ({
  caseValue: { id: "demo-weather", name: "Deterministic weather lookup", input: { city: "London", locale: "en-GB" }, steps: [
    { id: "lookup", tool: "weather.lookup", required_args: ["city"], result_status: "success", exact_result: { city: "London", temperature_c: 18 }, max_duration_ms: 100, allow_failure: false }
  ] },
  events: [
    { type: "run_start", id: "run-1", case_id: "demo-weather", duration_ms: 0 },
    { type: "tool_call", id: "call-1", step_id: "lookup", tool: "weather.lookup", arguments: { city: "London" }, duration_ms: 0 },
    { type: "tool_result", id: "result-1", call_id: "call-1", status: "success", result: { temperature_c: 18, city: "London" }, duration_ms: 42 },
    { type: "run_end", id: "run-end-1", status: "success", duration_ms: 42 }
  ]
});
