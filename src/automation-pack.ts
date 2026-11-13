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

export const parseAutomationPack = (value: unknown, inventory: OperationInventory, matcherValue: unknown): { value?: AutomationPack; diagnostics: Diagnostic[] } => {
  const diagnostics: Diagnostic[] = [];
  const add = (code: string, path: string, message: string) => diagnostics.push({ code, path, message });
  if (!record(value) || value.format !== "evalcase.automation-pack" || value.version !== 1 || typeof value.id !== "string" || !record(value.automation)) return { diagnostics: [{ code: "AUTOMATION_PACK_SHAPE", path: "$", message: "expected a version 1 automation pack with an automation object" }] };
  const automation = value.automation;
  if (automation.operation !== "workflow" || automation.action !== "steps" || automation.triggerType !== "manual") add("AUTOMATION_TRIGGER", "$.automation", "pack must save one manually triggered backend workflow");
  if (automation.eventType !== undefined || automation.intervalMinutes !== undefined) add("AUTOMATION_TRIGGER", "$.automation", "manual pack cannot define an event or schedule");
  const target = automation.target;
  if (!record(target) || target.type !== "connected-integration" || typeof target.service !== "string" || typeof target.resourceType !== "string" || !Array.isArray(target.bindings) || target.bindings.some((item) => typeof item !== "string")) add("AUTOMATION_TARGET", "$.automation.target", "target must declare one connected service, resource type, and binding list");
  const matcher = parseRunMatcher(matcherValue);
  const declaredBindings = record(target) && Array.isArray(target.bindings) ? target.bindings as unknown[] : [];
  if (!matcher) add("MATCHER_SHAPE", "$.matcher", "separate run matcher is invalid");
  const operations = new Map(inventory.actions.map((action) => [action.name, action]));
  const all = stepsOf(automation.steps);
  const usedBindings = targetRefs(automation.steps);
  if (usedBindings.size !== declaredBindings.length || [...usedBindings].some((name) => !declaredBindings.includes(name))) add("AUTOMATION_BINDINGS", "$.automation.target.bindings", "declared bindings must exactly match the target references used by actions");
  const captures = new Map<string, string>();
  const stepIds = new Set<string>();
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
        if (typeof step.id !== "string" || !step.id || stepIds.has(step.id)) add("AUTOMATION_STEP_ID", `${at}.id`, "action step IDs must be non-empty and unique");
        else stepIds.add(step.id);
        const operation = typeof step.operation === "string" ? operations.get(step.operation) : undefined;
        if (!operation) add("AUTOMATION_OPERATION", `${at}.operation`, "action is absent from the selected operation inventory");
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
            if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name) || typeof pointer !== "string" || (pointer !== "" && !pointer.startsWith("/"))) add("AUTOMATION_CAPTURE", `${at}.capture.${name}`, "capture needs a valid name and JSON pointer");
            else captures.set(`${step.id}.${name}`, "string");
          }
        }
      } else if (step.type === "condition") {
        if (typeof step.path !== "string" || !["==", "!=", ">", ">=", "<", "<=", "contains", "exists", "eq", "ne", "gt", "gte", "lt", "lte"].includes(String(step.operator))) add("AUTOMATION_CONDITION", at, "condition requires a JSON pointer and supported comparison");
        walk(stepsOf(step.then), depth + 1, `${at}.then`); walk(stepsOf(step.else), depth + 1, `${at}.else`);
      } else if (step.type === "repeat" || step.type === "timeout") {
        const limit = step.type === "repeat" ? 10 : 300000;
        const field = step.type === "repeat" ? "count" : "durationMs";
        if (!Number.isSafeInteger(step[field]) || Number(step[field]) < 1 || Number(step[field]) > limit) add("AUTOMATION_BOUND", `${at}.${field}`, "repeat and timeout bounds must be explicit and within backend limits");
        walk(stepsOf(step.steps), depth + 1, `${at}.steps`);
      } else if (step.type === "delay") {
        if (!Number.isSafeInteger(step.durationMs) || Number(step.durationMs) < 1 || Number(step.durationMs) > 300000) add("AUTOMATION_BOUND", `${at}.durationMs`, "delay must be within backend limits");
      } else add("AUTOMATION_STEP_TYPE", `${at}.type`, "unsupported step type for a connected integration pack");
    }
  };
  walk(all, 0, "$.automation.steps");
  if (matcher && matcher.steps.length === 0) add("MATCHER_STEPS", "$.matcher.steps", "matcher must assert at least one ordinary run step");
  return diagnostics.length ? { diagnostics } : { value: value as AutomationPack, diagnostics };
};
