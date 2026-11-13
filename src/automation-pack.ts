import { schemaIssuesWithBindings, type OperationInventory, type Diagnostic } from "./workflow-pack.js";
import { parseRunMatcher } from "./run-matcher.js";

export type AutomationPack = {
  format: "evalcase.automation-pack";
  version: 1;
  id: string;
  automation: Record<string, unknown>;
};

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const stepsOf = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.filter(record) : [];
const targetRefs = (value: unknown, refs = new Set<string>()): Set<string> => {
  if (record(value)) {
    if (Object.keys(value).length === 1 && typeof value.$target === "string") refs.add(value.$target);
    else Object.values(value).forEach((child) => targetRefs(child, refs));
  } else if (Array.isArray(value)) value.forEach((child) => targetRefs(child, refs));
  return refs;
};
const replayMode = (operation: OperationInventory["actions"][number]): string => operation.automationReplayMode ?? (operation.readOnly ? "repeatable-read" : "once-uncertain");
export const parseAutomationPack = (value: unknown, inventory: OperationInventory, matcherValue: unknown): { value?: AutomationPack; diagnostics: Diagnostic[] } => {
  const diagnostics: Diagnostic[] = [];
  const add = (code: string, path: string, message: string) => diagnostics.push({ code, path, message });
  if (!record(value) || value.format !== "evalcase.automation-pack" || value.version !== 1 || typeof value.id !== "string" || !record(value.automation)) return { diagnostics: [{ code: "AUTOMATION_PACK_SHAPE", path: "$", message: "expected a version 1 automation pack with an automation object" }] };
  if (Object.keys(value).some((key) => !["format", "version", "id", "automation"].includes(key))) add("AUTOMATION_PACK_FIELD", "$", "automation pack contains unsupported fields");
  const automation = value.automation;
  if (Object.keys(automation).some((key) => !["operation", "name", "action", "triggerType", "enabled", "target", "steps", "intervalMinutes", "eventType"].includes(key))) add("AUTOMATION_FIELD", "$.automation", "automation contains unsupported fields");
  if (typeof automation.name !== "string" || !automation.name || typeof automation.enabled !== "boolean") add("AUTOMATION_FIELD", "$.automation", "automation requires a name and explicit enabled flag");
  if (automation.operation !== "workflow" || automation.action !== "steps" || automation.triggerType !== "manual") add("AUTOMATION_TRIGGER", "$.automation", "pack must save one manually triggered backend workflow");
  if (automation.eventType !== undefined || automation.intervalMinutes !== undefined) add("AUTOMATION_TRIGGER", "$.automation", "manual pack cannot define an event or schedule");
  const target = automation.target;
  if (!record(target) || target.type !== "connected-integration" || typeof target.service !== "string" || typeof target.resourceType !== "string" || !Array.isArray(target.bindings) || target.bindings.some((item) => typeof item !== "string") || Object.keys(target).some((key) => !["type", "service", "resourceType", "bindings"].includes(key))) add("AUTOMATION_TARGET", "$.automation.target", "target must declare one connected service, resource type, and binding list");
  const matcher = parseRunMatcher(matcherValue);
  const declaredBindings = record(target) && Array.isArray(target.bindings) ? target.bindings as unknown[] : [];
  if (!matcher) add("MATCHER_SHAPE", "$.matcher", "separate run matcher is invalid");
  const operations = new Map(inventory.actions.map((action) => [action.name, action]));
  const all = stepsOf(automation.steps);
  const usedBindings = targetRefs(automation.steps);
  if (usedBindings.size !== declaredBindings.length || [...usedBindings].some((name) => !declaredBindings.includes(name))) add("AUTOMATION_BINDINGS", "$.automation.target.bindings", "declared bindings must exactly match the target references used by actions");
  const captures = new Map<string, string>();
  const stepIds = new Set<string>();
  const loggedActions = new Map<string, string>();
  if (!Array.isArray(automation.steps) || all.length === 0 || all.length > 100) add("AUTOMATION_STEPS", "$.automation.steps", "workflow must contain 1–100 ordered steps");
  let budget = 0;
  const walk = (steps: Record<string, unknown>[], depth: number, path: string): void => {
    if (depth > 4) add("AUTOMATION_DEPTH", path, "control-flow nesting exceeds four levels");
    for (let i = 0; i < steps.length; i += 1) {
      budget += 1;
      const step = steps[i]!;
      const at = `${path}[${i}]`;
      if (budget > 100) { add("AUTOMATION_BUDGET", at, "workflow exceeds 100 declared steps"); return; }
      if (step.type === "integration-action") {
        if (Object.keys(step).some((key) => !["type", "id", "operation", "arguments", "capture"].includes(key))) add("AUTOMATION_STEP_FIELD", at, "connected action contains unsupported fields");
        if (typeof step.id !== "string" || !step.id || stepIds.has(step.id)) add("AUTOMATION_STEP_ID", `${at}.id`, "action step IDs must be non-empty and unique");
        else stepIds.add(step.id);
        const operation = typeof step.operation === "string" ? operations.get(step.operation) : undefined;
        if (!operation) add("AUTOMATION_OPERATION", `${at}.operation`, "action is absent from the selected operation inventory");
        else loggedActions.set(operation.name, replayMode(operation));
        if (!record(step.arguments)) add("AUTOMATION_ARGUMENTS", `${at}.arguments`, "connected action arguments must be an object");
        const refs = targetRefs(step.arguments);
        if (!refs.size) add("AUTOMATION_BINDING", `${at}.arguments`, "connected action must use an explicit target binding");
        if ([...refs].some((ref) => !declaredBindings.includes(ref))) add("AUTOMATION_BINDING", `${at}.arguments`, "target reference is absent from the declared bindings");
        if (operation && record(step.arguments)) {
          for (const issue of schemaIssuesWithBindings(operation.inputSchema, step.arguments, `${at}.arguments`, captures)) add(issue.code, issue.path, issue.message);
        }
        if (step.capture !== undefined) {
          if (!record(step.capture) || Object.keys(step.capture).length > 20) add("AUTOMATION_CAPTURE", `${at}.capture`, "captures must be an object with at most 20 named JSON pointers");
          else for (const [name, pointer] of Object.entries(step.capture)) {
            if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name) || typeof pointer !== "string" || (pointer !== "" && pointer !== "$status" && !pointer.startsWith("/"))) add("AUTOMATION_CAPTURE", `${at}.capture.${name}`, "capture needs a valid name and JSON pointer");
            else captures.set(`${step.id}.${name}`, pointer === "$status" ? "number" : "string");
          }
        }
      } else if (step.type === "finalize") {
        loggedActions.set("Finalize workflow", "repeatable-control");
        if (Object.keys(step).some((key) => !["type", "steps", "cleanup"].includes(key))) add("AUTOMATION_STEP_FIELD", at, "finalizer contains unsupported fields");
        if (stepsOf(step.steps).length === 0 || stepsOf(step.cleanup).length === 0) add("AUTOMATION_STEP_FIELD", at, "finalizer requires non-empty body and cleanup steps");
        walk(stepsOf(step.steps), depth + 1, `${at}.steps`);
        walk(stepsOf(step.cleanup), depth + 1, `${at}.cleanup`);
      } else if (step.type === "condition") {
        loggedActions.set("Select condition branch", "repeatable-control");
        if (Object.keys(step).some((key) => !["type", "path", "operator", "value", "then", "else"].includes(key))) add("AUTOMATION_STEP_FIELD", at, "condition contains unsupported fields");
        if (typeof step.path !== "string" || !step.path.startsWith("/") || /~(?![01])/.test(step.path) || !["==", "!=", ">", ">=", "<", "<=", "contains", "exists", "eq", "ne", "gt", "gte", "lt", "lte"].includes(String(step.operator))) add("AUTOMATION_CONDITION", at, "condition requires a JSON pointer and supported comparison");
        if (step.operator === "exists" && step.value !== undefined && typeof step.value !== "boolean") add("AUTOMATION_CONDITION", `${at}.value`, "exists condition value must be boolean");
        if (step.operator !== "exists" && step.value === undefined) add("AUTOMATION_CONDITION", `${at}.value`, "condition requires an expected value");
        const capturePath = typeof step.path === "string" && step.path.startsWith("/captures/") ? step.path.slice("/captures/".length).split("/") : [];
        if (capturePath.length >= 2) {
          const ref = `${capturePath[0]!.replace(/~1/g, "/").replace(/~0/g, "~")}.${capturePath[1]!.replace(/~1/g, "/").replace(/~0/g, "~")}`;
          if (!captures.has(ref)) add("CAPTURE_FORWARD_REF", `${at}.path`, "condition capture must come from an earlier action");
        }
        const before = new Map(captures);
        walk(stepsOf(step.then), depth + 1, `${at}.then`);
        for (const key of [...captures.keys()]) if (!before.has(key)) captures.delete(key);
        walk(stepsOf(step.else), depth + 1, `${at}.else`);
        for (const key of [...captures.keys()]) if (!before.has(key)) captures.delete(key);
      } else if (step.type === "repeat" || step.type === "timeout" || step.type === "loop") {
        loggedActions.set(step.type === "repeat" ? "Repeat steps" : step.type === "loop" ? "Loop steps" : "Run steps with timeout", "repeatable-control");
        const fields = step.type === "repeat" ? ["type", "count", "steps"] : step.type === "loop" ? ["type", "maxIterations", "condition", "steps"] : ["type", "durationMs", "steps"];
        if (Object.keys(step).some((key) => !fields.includes(key))) add("AUTOMATION_STEP_FIELD", at, "control step contains unsupported fields");
        const field = step.type === "repeat" ? "count" : step.type === "loop" ? "maxIterations" : "durationMs";
        const limit = step.type === "timeout" ? 300000 : 10;
        if (!Number.isSafeInteger(step[field]) || Number(step[field]) < 1 || Number(step[field]) > limit) add("AUTOMATION_BOUND", `${at}.${field}`, "repeat and loop bounds must be at most 10; timeout must be at most 300000 milliseconds");
        if (stepsOf(step.steps).length === 0) add("AUTOMATION_STEPS", `${at}.steps`, "control step requires at least one child step");
        if (step.type === "loop") {
          const condition = record(step.condition) ? step.condition : {};
          if (Object.keys(condition).some((key) => !["path", "operator", "value"].includes(key)) || typeof condition.path !== "string" || !condition.path.startsWith("/") || /~(?![01])/.test(condition.path) || !["==", "!=", ">", ">=", "<", "<=", "contains", "exists", "eq", "ne", "gt", "gte", "lt", "lte"].includes(String(condition.operator))) add("AUTOMATION_CONDITION", `${at}.condition`, "loop requires a JSON pointer condition with a supported comparison");
          if (condition.operator === "exists" && condition.value !== undefined && typeof condition.value !== "boolean") add("AUTOMATION_CONDITION", `${at}.condition.value`, "exists condition value must be boolean");
          if (condition.operator !== "exists" && condition.value === undefined) add("AUTOMATION_CONDITION", `${at}.condition.value`, "condition requires an expected value");
          const capturePath = typeof condition.path === "string" && condition.path.startsWith("/captures/") ? condition.path.slice("/captures/".length).split("/") : [];
          if (capturePath.length >= 2) {
            const ref = `${capturePath[0]!.replace(/~1/g, "/").replace(/~0/g, "~")}.${capturePath[1]!.replace(/~1/g, "/").replace(/~0/g, "~")}`;
            if (!captures.has(ref)) add("CAPTURE_FORWARD_REF", `${at}.condition.path`, "loop condition capture must come from an earlier action");
          }
        }
        const before = step.type === "loop" ? new Map(captures) : undefined;
        walk(stepsOf(step.steps), depth + 1, `${at}.steps`);
        if (before) for (const key of [...captures.keys()]) if (!before.has(key)) captures.delete(key);
      } else if (step.type === "delay") {
        loggedActions.set("Wait", "repeatable-control");
        if (Object.keys(step).some((key) => !["type", "durationMs"].includes(key))) add("AUTOMATION_STEP_FIELD", at, "delay contains unsupported fields");
        if (!Number.isSafeInteger(step.durationMs) || Number(step.durationMs) < 1 || Number(step.durationMs) > 300000) add("AUTOMATION_BOUND", `${at}.durationMs`, "delay must be within backend limits");
      } else add("AUTOMATION_STEP_TYPE", `${at}.type`, "unsupported step type for a connected integration pack");
    }
  };
  walk(all, 0, "$.automation.steps");
  if (matcher && matcher.steps.length === 0) add("MATCHER_STEPS", "$.matcher.steps", "matcher must assert at least one ordinary run step");
  if (matcher) for (const [index, step] of matcher.steps.entries()) {
    const expectedMode = loggedActions.get(step.action);
    if (!expectedMode) add("MATCHER_ACTION", `$.matcher.steps[${index}].action`, "matcher action must be declared by the backend automation");
    else if (step.replayMode !== expectedMode) add("MATCHER_REPLAY_MODE", `$.matcher.steps[${index}].replayMode`, `matcher replay mode must be ${expectedMode}`);
  }
  return diagnostics.length ? { diagnostics } : { value: value as AutomationPack, diagnostics };
};
