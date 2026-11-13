import { describe, expect, test } from "bun:test";
import { parseOperationInventory, parseWorkflowPack } from "../src/workflow-pack.js";
import { parseAutomationPack } from "../src/automation-pack.js";
import { readFile } from "node:fs/promises";

describe("portable connected-integration packs", () => {
  test("validates a normal manual backend automation against a separate run matcher", async () => {
    const root = new URL("../", import.meta.url);
    const [inventoryRaw, packRaw, matcherRaw] = await Promise.all([
      readFile(new URL("catalog/control-plane-mcp-v1.json", root), "utf8"),
      readFile(new URL("examples/sharepoint-site-read.automation-pack.json", root), "utf8"),
      readFile(new URL("examples/sharepoint-site-read.matcher.json", root), "utf8")
    ]);
    const inventory = parseOperationInventory(JSON.parse(inventoryRaw));
    expect(inventory.value).toBeDefined();
    const pack = parseAutomationPack(JSON.parse(packRaw), inventory.value!, JSON.parse(matcherRaw));
    expect(pack.diagnostics).toEqual([]);
    expect(pack.value?.automation.triggerType).toBe("manual");
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
