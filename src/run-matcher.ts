export type RunMatcher = {
  format: "evalcase.automation-run-matcher";
  version: 1;
  id: string;
  runId?: string;
  workflowId?: string;
  run: { state: string; stepCount: number };
  steps: { position: number; action: string; state: string; replayMode?: string; messageContains?: string }[];
};

export type MatchResult = { yes: boolean; checks: { path: string; yes: boolean }[] };
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export const parseRunMatcher = (value: unknown): RunMatcher | undefined => {
  if (!record(value) || value.format !== "evalcase.automation-run-matcher" || value.version !== 1 || typeof value.id !== "string" || !record(value.run) || typeof value.run.state !== "string" || !Number.isSafeInteger(value.run.stepCount) || !Array.isArray(value.steps)) return undefined;
  if (Object.keys(value).some((key) => !["format", "version", "id", "runId", "workflowId", "run", "steps"].includes(key))) return undefined;
  if (Object.keys(value.run).some((key) => !["state", "stepCount"].includes(key)) || value.id.length === 0 || value.run.state.length === 0 || Number(value.run.stepCount) < 0 || value.steps.length === 0) return undefined;
  if (value.runId !== undefined && typeof value.runId !== "string") return undefined;
  if (value.workflowId !== undefined && typeof value.workflowId !== "string") return undefined;
  const positions = new Set<number>();
  if (value.steps.some((step) => {
    if (!record(step) || Object.keys(step).some((key) => !["position", "action", "state", "replayMode", "messageContains"].includes(key)) || !Number.isSafeInteger(step.position) || Number(step.position) < 0 || typeof step.action !== "string" || !step.action || typeof step.state !== "string" || !step.state || (step.replayMode !== undefined && typeof step.replayMode !== "string") || (step.messageContains !== undefined && typeof step.messageContains !== "string")) return true;
    if (positions.has(Number(step.position))) return true;
    positions.add(Number(step.position));
    return false;
  })) return undefined;
  return value as RunMatcher;
};

export const matchRunLog = (matcher: RunMatcher, input: unknown): MatchResult => {
  const runs = record(input) && Array.isArray(input.runs) ? input.runs : [input];
  const candidates = runs.filter(record);
  const run = candidates.find((candidate) => (!matcher.runId || candidate.id === matcher.runId) && (!matcher.workflowId || candidate.workflow_id === matcher.workflowId));
  const checks: MatchResult["checks"] = [];
  const check = (path: string, yes: boolean) => checks.push({ path, yes });
  check("run.exists", run !== undefined);
  if (!run) return { yes: false, checks };
  check("run.state", run.state === matcher.run.state);
  const steps = Array.isArray(run.steps) ? run.steps.filter(record) : [];
  check("run.stepCount", steps.length === matcher.run.stepCount);
  for (const expected of matcher.steps) {
    const actual = steps.find((step) => step.position === expected.position);
    const prefix = `steps[${expected.position}]`;
    check(`${prefix}.exists`, actual !== undefined);
    if (!actual) continue;
    check(`${prefix}.action`, actual.action === expected.action);
    check(`${prefix}.state`, actual.state === expected.state);
    if (expected.replayMode !== undefined) check(`${prefix}.replayMode`, actual.replay_mode === expected.replayMode);
    if (expected.messageContains !== undefined) check(`${prefix}.message`, typeof actual.message === "string" && actual.message.includes(expected.messageContains));
  }
  return { yes: checks.every((item) => item.yes), checks };
};
