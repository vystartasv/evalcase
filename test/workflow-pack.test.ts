import { describe, expect, test } from "bun:test";
import { parseOperationInventory, parseWorkflowPack, schemaIssuesWithBindings } from "../src/workflow-pack.js";
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
    expect(inventory.value!.actions.filter((action) => action.coverage === "pack-defined-not-live-verified")).toHaveLength(13);
    for (const name of ["automation_recovery_decision", "deployment_site_uninstall"]) {
      expect(inventory.value!.actions.find((action) => action.name === name)?.livePolicy).toBe("gated-outside-authorized-scope");
    }
    const pack = parseAutomationPack(JSON.parse(packRaw), inventory.value!, JSON.parse(matcherRaw));
    expect(pack.diagnostics).toEqual([]);
    expect(pack.value?.automation.triggerType).toBe("manual");
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
