import { describe, expect, test } from "bun:test";
import { coverageReport, parseOperationInventory, parseWorkflowPack, schemaIssuesWithBindings } from "../src/workflow-pack.js";
import { parseAutomationPack } from "../src/automation-pack.js";
import { matchRunLog, parseRunMatcher } from "../src/run-matcher.js";
import { readFile } from "node:fs/promises";

describe("portable connected-integration packs", () => {
  test("validates catalog numeric, format, encoding, and oneOf constraints", () => {
    const emptyCaptures = new Map<string, string>();
    expect(schemaIssuesWithBindings({ type: "integer", minimum: 1, maximum: 3 }, 0, "$.count", emptyCaptures).map((issue) => issue.code)).toContain("ARG_MINIMUM");
    expect(schemaIssuesWithBindings({ type: "integer", minimum: 1, maximum: 3 }, 4, "$.count", emptyCaptures).map((issue) => issue.code)).toContain("ARG_MAXIMUM");
    expect(schemaIssuesWithBindings({ type: "string", format: "email" }, "not-an-email", "$.email", emptyCaptures).map((issue) => issue.code)).toContain("ARG_FORMAT");
    expect(schemaIssuesWithBindings({ type: "string", format: "uri" }, "/relative", "$.url", emptyCaptures).map((issue) => issue.code)).toContain("ARG_FORMAT");
    expect(schemaIssuesWithBindings({ type: "string", contentEncoding: "base64" }, "%%%", "$.body", emptyCaptures).map((issue) => issue.code)).toContain("ARG_ENCODING");
    expect(schemaIssuesWithBindings({ oneOf: [{ type: "string" }, { type: "integer" }] }, true, "$.value", emptyCaptures).map((issue) => issue.code)).toContain("ARG_ONE_OF");
    expect(schemaIssuesWithBindings({ type: "array", minItems: 2, items: { type: "string", minLength: 2 } }, ["x"], "$.items", emptyCaptures).map((issue) => issue.code)).toEqual(expect.arrayContaining(["ARG_MIN_ITEMS", "ARG_MIN_LENGTH"]));
    expect(schemaIssuesWithBindings({ type: "object", minProperties: 2, properties: { id: { type: "string" } }, additionalProperties: false }, { id: "x" }, "$.target", emptyCaptures).map((issue) => issue.code)).toContain("ARG_MIN_PROPERTIES");
    expect(schemaIssuesWithBindings({ type: "string", enum: ["allowed"] }, { $target: "name" }, "$.name", emptyCaptures).map((issue) => issue.code)).toContain("BINDING_CONSTRAINT");
  });

  test("rejects an invalid extra argument for all 95 catalog actions", async () => {
    const root = new URL("../", import.meta.url);
    const inventory = parseOperationInventory(JSON.parse(await readFile(new URL("catalog/control-plane-mcp-v1.json", root), "utf8")));
    expect(inventory.value).toBeDefined();
    expect(inventory.value!.actions).toHaveLength(95);
    for (const action of inventory.value!.actions) {
      expect(action.livePolicy).toBeTruthy();
      expect(schemaIssuesWithBindings(action.inputSchema, { __evalcase_invalid_field: true }, `$.${action.name}`, new Map()).some((issue) => issue.code === "ARG_UNKNOWN")).toBe(true);
    }
  });

  test("validates a normal manual backend automation against a separate run matcher", async () => {
    const root = new URL("../", import.meta.url);
    const [inventoryRaw, packRaw, matcherRaw] = await Promise.all([
      readFile(new URL("catalog/control-plane-mcp-v1.json", root), "utf8"),
      readFile(new URL("examples/sharepoint-site-read.automation-pack.json", root), "utf8"),
      readFile(new URL("examples/sharepoint-site-read.matcher.json", root), "utf8")
    ]);
    const inventory = parseOperationInventory(JSON.parse(inventoryRaw));
    expect(inventory.value).toBeDefined();
    expect(inventory.value!.actions).toHaveLength(95);
    expect(inventory.value!.actions.filter((action) => action.coverage === "pack-defined-not-live-verified")).toHaveLength(27);
    for (const name of ["automation_recovery_decision", "deployment_site_uninstall"]) {
      expect(inventory.value!.actions.find((action) => action.name === name)?.livePolicy).toBe("gated-outside-authorized-scope");
    }
    const pack = parseAutomationPack(JSON.parse(packRaw), inventory.value!, JSON.parse(matcherRaw));
    expect(pack.diagnostics).toEqual([]);
    expect(pack.value?.automation.triggerType).toBe("manual");
  });

  test("validates the Control Plane read-only API pack on a service-scope target", async () => {
    const root = new URL("../", import.meta.url);
    const [inventoryRaw, packRaw, matcherRaw] = await Promise.all([
      readFile(new URL("catalog/control-plane-mcp-v1.json", root), "utf8"),
      readFile(new URL("examples/control-plane-readonly.automation-pack.json", root), "utf8"),
      readFile(new URL("examples/control-plane-readonly.matcher.json", root), "utf8")
    ]);
    const inventory = parseOperationInventory(JSON.parse(inventoryRaw));
    expect(inventory.value).toBeDefined();
    const value = JSON.parse(packRaw);
    const result = parseAutomationPack(value, inventory.value!, JSON.parse(matcherRaw));
    expect(result.diagnostics).toEqual([]);
    const operations = value.automation.steps.map((step: { operation: string }) => step.operation);
    expect(operations).toEqual(["work_list", "automation_list", "automation_templates", "automation_inbox", "settings_read", "diagnostics_status", "diagnostics_export", "integrations_list", "agents_list"]);
    expect(operations.every((operation: string) => inventory.value!.actions.find((action) => action.name === operation)?.readOnly)).toBe(true);
    const matcher = parseRunMatcher(JSON.parse(matcherRaw));
    expect(matcher).toBeDefined();
    const log = { state: "succeeded", steps: matcher!.steps.map((step) => ({ position: step.position, action: step.action, state: step.state, replay_mode: step.replayMode, message: step.messageContains })) };
    expect(matchRunLog(matcher!, log).yes).toBe(true);
    expect(matchRunLog(matcher!, { ...log, steps: log.steps.slice(1) }).yes).toBe(false);
  });

  test("validates typed-target read packs and ordinary matchers", async () => {
    const root = new URL("../", import.meta.url);
    const inventory = parseOperationInventory(JSON.parse(await readFile(new URL("catalog/control-plane-mcp-v1.json", root), "utf8")));
    expect(inventory.value).toBeDefined();
    for (const [packName, matcherName] of [
      ["work-results-read.automation-pack.json", "work-results-read.matcher.json"],
      ["feed-read.automation-pack.json", "feed-read.matcher.json"],
      ["sharepoint-site-read.automation-pack.json", "sharepoint-site-read.matcher.json"]
    ]) {
      const [pack, matcher] = await Promise.all([
        readFile(new URL(`examples/${packName}`, root), "utf8"),
        readFile(new URL(`examples/${matcherName}`, root), "utf8")
      ]);
      expect(parseAutomationPack(JSON.parse(pack), inventory.value!, JSON.parse(matcher)).diagnostics).toEqual([]);
    }
  });

  test("defines a schema-only rejection case for every current MCP operation", async () => {
    const root = new URL("../", import.meta.url);
    const [inventoryRaw, packRaw] = await Promise.all([
      readFile(new URL("catalog/control-plane-mcp-v1.json", root), "utf8"),
      readFile(new URL("examples/control-plane-mcp-schema-guards.workflow-pack.json", root), "utf8")
    ]);
    const inventory = parseOperationInventory(JSON.parse(inventoryRaw));
    expect(inventory.value?.actions).toHaveLength(95);
    const pack = parseWorkflowPack(JSON.parse(packRaw), inventory.value!);
    expect(pack.diagnostics).toEqual([]);
    expect(pack.value?.cases).toHaveLength(95);
    expect(new Set(pack.value?.cases.map((item) => item.operation)).size).toBe(95);
    expect(pack.value?.cases.every((item) => item.kind === "expected-rejection" && item.expect.phase === "mcp-schema")).toBe(true);
    const coverage = coverageReport(pack.value!, inventory.value!);
    expect(coverage.filter((item) => item.status === "pack-defined-not-live-verified")).toHaveLength(27);
    expect(coverage.filter((item) => item.status === "schema-guarded")).toHaveLength(2);
    expect(coverage.filter((item) => item.status === "gated-uncovered")).toHaveLength(37);
    expect(coverage.filter((item) => item.status === "unsafe")).toHaveLength(27);
    expect(coverage.filter((item) => item.status === "one-time-confirmation-required")).toHaveLength(2);
  });

  test("keeps batch item write schema guards runnable without external writes", async () => {
    const root = new URL("../", import.meta.url);
    const [inventoryRaw, packRaw] = await Promise.all([
      readFile(new URL("catalog/sharepoint-mcp-v1.json", root), "utf8"),
      readFile(new URL("examples/sharepoint-batch-item-guards.workflow-pack.json", root), "utf8")
    ]);
    const inventory = parseOperationInventory(JSON.parse(inventoryRaw));
    expect(inventory.value).toBeDefined();
    const pack = parseWorkflowPack(JSON.parse(packRaw), inventory.value!);
    expect(pack.diagnostics).toEqual([]);
    expect(pack.value?.cases.map((item) => [item.operation, item.kind, item.expect.phase])).toEqual([
      ["deployment_list_items_batch_create", "expected-rejection", "mcp-schema"],
      ["deployment_list_items_batch_update", "expected-rejection", "mcp-schema"]
    ]);
  });

  test("validates one manual CRUD automation and keeps checks in the separate matcher", async () => {
    const root = new URL("../", import.meta.url);
    const [inventoryRaw, packRaw, matcherRaw] = await Promise.all([
      readFile(new URL("catalog/control-plane-mcp-v1.json", root), "utf8"),
      readFile(new URL("examples/sharepoint-list-crud.pack.json", root), "utf8"),
      readFile(new URL("examples/sharepoint-list-crud.matcher.json", root), "utf8")
    ]);
    const inventory = parseOperationInventory(JSON.parse(inventoryRaw));
    expect(inventory.value).toBeDefined();
    const packValue = JSON.parse(packRaw);
    const matcher = JSON.parse(matcherRaw);
    expect(parseAutomationPack(packValue, inventory.value!, matcher).diagnostics).toEqual([]);
    const unrelatedCleanupID = structuredClone(packValue);
    unrelatedCleanupID.automation.steps[0].cleanup[1].then[0].then[0].arguments.listId = { $target: "siteUrl" };
    expect(parseAutomationPack(unrelatedCleanupID, inventory.value!, matcher).diagnostics.some((issue) => issue.code === "AUTOMATION_CLEANUP_OWNERSHIP")).toBe(true);
    const wrongReplay = structuredClone(matcher);
    wrongReplay.steps[1].replayMode = "repeatable-stateless";
    expect(parseAutomationPack(packValue, inventory.value!, wrongReplay).diagnostics.some((issue) => issue.code === "MATCHER_REPLAY_MODE")).toBe(true);
    const unrelatedMatcher = structuredClone(matcher);
    unrelatedMatcher.steps[0].action = "unrelated_operation";
    expect(parseAutomationPack(packValue, inventory.value!, unrelatedMatcher).diagnostics.some((issue) => issue.code === "MATCHER_ACTION")).toBe(true);
    const operations: string[] = [];
    type PackStep = { type: string; operation?: string; steps?: PackStep[]; cleanup?: PackStep[]; then?: PackStep[]; else?: PackStep[] };
    const collect = (steps: PackStep[]) => {
      for (const step of steps) {
        if (step.type === "integration-action" && step.operation) operations.push(step.operation);
        for (const key of ["steps", "cleanup", "then", "else"] as const) {
          if (step[key]) collect(step[key]);
        }
      }
    };
    collect(packValue.automation.steps as PackStep[]);
    expect(operations).toContain("deployment_site_list_create");
    expect(operations).toContain("deployment_list_column_create");
    expect(operations).toContain("deployment_site_lists");
    expect(operations).toContain("deployment_list_columns");
    expect(operations).toContain("deployment_list_changes");
    expect(operations).toContain("deployment_list_items");
    expect(operations).toContain("deployment_site_list_rename");
    expect(operations).toContain("deployment_list_item_create");
    expect(operations).toContain("deployment_list_items_batch_create");
    expect(operations).toContain("deployment_list_items_batch_update");
    expect(operations).toContain("deployment_list_items_batch");
    expect(operations).toContain("deployment_list_item_read");
    expect(operations).toContain("deployment_list_item_update");
    expect(operations).toContain("deployment_list_item_delete");
    expect(operations.at(-1)).toBe("deployment_site_list_delete");
    const runMatcher = parseRunMatcher(matcher);
    expect(runMatcher).toBeDefined();
    const expectedLog = { state: "succeeded", steps: runMatcher!.steps.map((step) => ({ position: step.position, action: step.action, state: step.state, replay_mode: step.replayMode, message: step.messageContains })) };
    expect(matchRunLog(runMatcher!, expectedLog).yes).toBe(true);
    expect(matchRunLog(runMatcher!, { ...expectedLog, steps: expectedLog.steps.slice(0, -1) }).yes).toBe(false);
    const expectedStatus = structuredClone(packValue);
    expectedStatus.automation.steps[0].expectStatus = 409;
    expect(parseAutomationPack(expectedStatus, inventory.value!, matcher).diagnostics.some((issue) => issue.code === "AUTOMATION_STEP_FIELD")).toBe(true);
    const embeddedAssertion = structuredClone(packValue);
    embeddedAssertion.automation.steps.unshift({ type: "assert", sourceStep: "list.create", assertions: [{ path: "/id", operator: "exists", value: true }] });
    expect(parseAutomationPack(embeddedAssertion, inventory.value!, matcher).diagnostics.some((issue) => issue.code === "AUTOMATION_STEP_TYPE")).toBe(true);
    const boundedLoop = structuredClone(packValue);
    boundedLoop.automation.steps[0].steps.unshift({ type: "loop", maxIterations: 2, condition: { path: "/ready", operator: "eq", value: true }, steps: [{ type: "delay", durationMs: 1 }] });
    expect(parseAutomationPack(boundedLoop, inventory.value!, matcher).diagnostics).toEqual([]);
    const unboundedLoop = structuredClone(boundedLoop);
    unboundedLoop.automation.steps[0].steps[0].maxIterations = 11;
    expect(parseAutomationPack(unboundedLoop, inventory.value!, matcher).diagnostics.some((issue) => issue.code === "AUTOMATION_BOUND")).toBe(true);
  });

  test("matches failed runs only when ordinary action failure and cleanup are both logged", async () => {
    const root = new URL("../", import.meta.url);
    const matcherValue = JSON.parse(await readFile(new URL("examples/sharepoint-list-crud-cleanup-failure.matcher.json", root), "utf8"));
    const matcher = parseRunMatcher(matcherValue);
    expect(matcher).toBeDefined();
    const result = matchRunLog(matcher!, { id: "run-1", workflow_id: "workflow-1", state: "failed", steps: [
      { position: 0, action: "Finalize workflow", state: "failed", replay_mode: "repeatable-control", message: "The primary workflow failed; bounded final cleanup completed." },
      { position: 1, action: "deployment_site_lists", state: "succeeded", replay_mode: "repeatable-read", message: "Action deployment_site_lists returned HTTP 200 and captured 1 value(s)." },
      { position: 2, action: "deployment_site_list_create", state: "succeeded", replay_mode: "once-create", message: "Action deployment_site_list_create returned HTTP 201 and captured 2 value(s)." },
      { position: 3, action: "deployment_list_column_create", state: "succeeded", replay_mode: "once-create", message: "Action deployment_list_column_create returned HTTP 201 and captured 1 value(s)." },
      { position: 4, action: "deployment_list_columns", state: "failed", replay_mode: "repeatable-read", message: "Step failed. Check its configuration and external service status.", recovery: { operation: "deployment_list_columns", reason: "The connected service returned HTTP 404.", options: [{ id: "correct-input", label: "Correct the request and run again" }, { id: "retry", label: "Retry safely" }, { id: "retry-after-delay", label: "Retry after a delay" }, { id: "ask-agent", label: "Ask an agent to review" }, { id: "ask-human", label: "Ask a human to decide" }] } },
      { position: 5, action: "Select condition branch", state: "succeeded", replay_mode: "repeatable-control", message: "Condition selected the yes branch." },
      { position: 6, action: "deployment_site_list_delete", state: "succeeded", replay_mode: "once-delete", message: "Action deployment_site_list_delete returned HTTP 200 and captured 1 value(s)." }
    ] });
    expect(result.yes).toBe(true);
    expect(matchRunLog(matcher!, { id: "run-1", workflow_id: "workflow-1", state: "failed", steps: [
      { position: 0, action: "Finalize workflow", state: "failed", replay_mode: "repeatable-control", message: "The primary workflow failed; bounded final cleanup completed." },
      { position: 1, action: "deployment_site_lists", state: "succeeded", replay_mode: "repeatable-read", message: "Action deployment_site_lists returned HTTP 200 and captured 1 value(s)." },
      { position: 2, action: "deployment_site_list_create", state: "succeeded", replay_mode: "once-create", message: "Action deployment_site_list_create returned HTTP 201 and captured 2 value(s)." },
      { position: 3, action: "deployment_list_column_create", state: "succeeded", replay_mode: "once-create", message: "Action deployment_list_column_create returned HTTP 201 and captured 1 value(s)." },
      { position: 4, action: "deployment_list_columns", state: "failed", replay_mode: "repeatable-read", message: "Step failed. Check its configuration and external service status." },
      { position: 5, action: "Select condition branch", state: "succeeded", replay_mode: "repeatable-control", message: "Condition selected the yes branch." },
      { position: 6, action: "deployment_site_list_delete", state: "succeeded", replay_mode: "once-delete", message: "Action deployment_site_list_delete returned HTTP 200 and captured 1 value(s)." }
    ] }).yes).toBe(false);
    expect(matchRunLog(matcher!, { state: "failed", steps: [{ position: 0, action: "Finalize workflow", state: "failed" }] }).yes).toBe(false);
  });

  test("matcher can prove a selected recovery decision and forbid unsafe write retries", () => {
    const matcher = parseRunMatcher({
      format: "evalcase.automation-run-matcher",
      version: 1,
      id: "uncertain-create-recovery-v1",
      run: { state: "needs-review", stepCount: 1 },
      steps: [{
        position: 0,
        action: "deployment_site_list_create",
        state: "needs-review",
        replayMode: "once-create",
        recovery: { operation: "deployment_site_list_create", optionsInclude: ["inspect-result"], optionsExclude: ["retry", "retry-after-delay"], decision: "inspect-result" }
      }]
    });
    expect(matcher).toBeDefined();
    const run = { state: "needs-review", steps: [{
      position: 0,
      action: "deployment_site_list_create",
      state: "needs-review",
      replay_mode: "once-create",
      recovery: { operation: "deployment_site_list_create", options: [{ id: "inspect-result" }, { id: "ask-human" }] },
      recoveryDecision: "inspect-result"
    }] };
    expect(matchRunLog(matcher!, run).yes).toBe(true);
    const unsafe = structuredClone(run);
    unsafe.steps[0]!.recovery.options.push({ id: "retry" });
    expect(matchRunLog(matcher!, unsafe).yes).toBe(false);
    const undecided = structuredClone(run);
    undecided.steps[0]!.recoveryDecision = "";
    expect(matchRunLog(matcher!, undecided).yes).toBe(false);
  });

  test("matcher enforces delayed-only recovery after throttling", () => {
    const matcher = parseRunMatcher({
      format: "evalcase.automation-run-matcher",
      version: 1,
      id: "throttled-read-recovery-v1",
      run: { state: "failed", stepCount: 1 },
      steps: [{
        position: 0,
        action: "deployment_list_columns",
        state: "failed",
        replayMode: "repeatable-read",
        recovery: { operation: "deployment_list_columns", optionsInclude: ["retry-after-delay"], optionsExclude: ["retry"] }
      }]
    });
    expect(matcher).toBeDefined();
    const run = { state: "failed", steps: [{
      position: 0,
      action: "deployment_list_columns",
      state: "failed",
      replay_mode: "repeatable-read",
      recovery: { operation: "deployment_list_columns", reason: "The connected service asked you to wait 17 seconds before retrying.", options: [{ id: "retry-after-delay" }, { id: "ask-agent" }] }
    }] };
    expect(matchRunLog(matcher!, run).yes).toBe(true);
    const immediateRetry = structuredClone(run);
    immediateRetry.steps[0]!.recovery.options.push({ id: "retry" });
    expect(matchRunLog(matcher!, immediateRetry).yes).toBe(false);
  });

  test("accepts a non-SharePoint target bound to a typed connected resource", () => {
    const inventory = parseOperationInventory({
      format: "evalcase.mcp-operation-inventory",
      version: 1,
      id: "mail-v1",
      source: { repository: "control-plane", commit: "abc", capturedAt: "2026-11-13", note: "test" },
      actions: [{
        name: "mail.read",
        description: "Read messages from one connected mailbox.",
        inputSchema: { type: "object", properties: { mailboxId: { type: "string" } }, required: ["mailboxId"], additionalProperties: false },
        readOnly: true,
        coverage: "uncovered",
        livePolicy: "read-only"
      }],
      resourceCoverage: []
    });
    expect(inventory.value).toBeDefined();
    const invalidReplayMode = parseOperationInventory({ ...inventory.value, actions: [{ ...inventory.value!.actions[0], automationReplayMode: "automatic" }] });
    expect(invalidReplayMode.diagnostics.some((issue) => issue.code === "INVENTORY_REPLAY_MODE")).toBe(true);
    const pack = parseWorkflowPack({
      format: "evalcase.workflow-pack",
      version: 1,
      id: "mailbox-read-v1",
      name: "Mailbox read",
      inventory: { id: "mail-v1", version: 1 },
      trigger: { type: "manual" },
      target: { type: "connected-integration", service: "email", resourceType: "mailbox", bindings: ["mailboxId"] },
      cases: [{
        id: "mail.read.valid",
        operation: "mail.read",
        kind: "positive",
        arguments: { mailboxId: { $target: "mailboxId" } },
        expect: { outcome: "success", phase: "tool", assertions: [{ op: "exists", path: "/items", value: true }] }
      }],
      cleanup: []
    }, inventory.value!);
    expect(pack.diagnostics).toEqual([]);
    expect(pack.value?.target).toEqual({ type: "connected-integration", service: "email", resourceType: "mailbox", bindings: ["mailboxId"] });
  });
});
