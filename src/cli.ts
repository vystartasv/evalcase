#!/usr/bin/env bun
import { readFile } from "node:fs/promises";
import { evaluate, formatText, makeReport, demoData, parseCase, parseOutcome, type Diagnostic, type EvalCase } from "./core.js";
import { compareHumanSurface, coverageReport, parseHumanSurface, parseOperationInventory, parseWorkflowPack } from "./workflow-pack.js";
import { matchRunLog, parseRunMatcher } from "./run-matcher.js";
import { parseAutomationPack } from "./automation-pack.js";

const usage = "Usage: evalcase check case.json outcome.jsonl | evalcase report case.json outcome.jsonl [--json] [--output FILE] | evalcase match-run matcher.json run-log.json [--json] | evalcase automation-pack-check inventory.json pack.json matcher.json [--json] | evalcase automation-pack-import inventory.json pack.json matcher.json [--output FILE] | evalcase automation-pack-export inventory.json pack.json matcher.json [--output FILE] | evalcase pack-check inventory.json pack.json [--json] | evalcase pack-import inventory.json pack.json | evalcase pack-export inventory.json pack.json [--output FILE] | evalcase surface-diff inventory.json human-surface.json [--json] | evalcase demo";

const malformed = (path: string, message: string): Diagnostic[] => [{ code: "MALFORMED_JSON", path, message }];

const readCase = async (path: string) => {
  try {
    const value = JSON.parse(await readFile(path, "utf8"));
    return { ...parseCase(value), malformed: false };
  } catch (error) {
    return { malformed: true, diagnostics: malformed("$", `could not parse ${path}: ${error instanceof Error ? error.message : "read failed"}`) };
  }
};

const readOutcome = async (path: string) => {
  try {
    const text = await readFile(path, "utf8");
    const lines = text.replace(/\r\n/g, "\n").split("\n");
    if (lines.at(-1) === "") lines.pop();
    const values: unknown[] = [];
    for (let index = 0; index < lines.length; index += 1) {
      if (lines[index].trim() === "") return { malformed: true, diagnostics: malformed(`$[${index}]`, "blank JSONL line is not supported") };
      try {
        values.push(JSON.parse(lines[index]));
      } catch (error) {
        return { malformed: true, diagnostics: malformed(`$[${index}]`, `invalid JSON: ${error instanceof Error ? error.message : "parse failed"}`) };
      }
    }
    return { ...parseOutcome(values), malformed: false };
  } catch (error) {
    return { malformed: true, diagnostics: malformed("$", `could not read ${path}: ${error instanceof Error ? error.message : "read failed"}`) };
  }
};

const checkWorkflowPack = async (inventoryPath: string, packPath: string, json: boolean) => {
  try {
    const [inventoryRaw, packRaw] = await Promise.all([readFile(inventoryPath, "utf8"), readFile(packPath, "utf8")]);
    const inventory = parseOperationInventory(JSON.parse(inventoryRaw));
    if (!inventory.value) {
      process.stdout.write(`${JSON.stringify({ status: "invalid", diagnostics: inventory.diagnostics }, null, json ? 2 : 0)}\n`);
      process.exitCode = 3;
      return;
    }
    const pack = parseWorkflowPack(JSON.parse(packRaw), inventory.value);
    if (!pack.value) {
      process.stdout.write(`${JSON.stringify({ status: "invalid", pack: packPath, diagnostics: pack.diagnostics }, null, json ? 2 : 0)}\n`);
      process.exitCode = 3;
      return;
    }
    const coverage = coverageReport(pack.value, inventory.value);
    const report = {
      status: "valid-pack-not-run",
      pack: { id: pack.value.id, name: pack.value.name, cases: pack.value.cases.length },
      inventory: { id: inventory.value.id, version: inventory.value.version, operations: inventory.value.actions.length },
      operationCoverage: coverage,
      resourceCoverage: inventory.value.resourceCoverage
    };
    if (json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    else {
      const defined = coverage.filter((item) => item.status === "pack-defined-not-live-verified");
      const uncovered = coverage.filter((item) => item.status === "uncovered");
      const unsafe = coverage.filter((item) => item.status === "unsafe");
      const oneTime = coverage.filter((item) => item.status === "one-time-confirmation-required");
      const gated = coverage.filter((item) => item.status === "gated-uncovered");
      process.stdout.write(`VALID PACK (not run): ${pack.value.name}\n`);
      process.stdout.write(`Cases: ${pack.value.cases.length}; inventory operations: ${inventory.value.actions.length}\n`);
      process.stdout.write(`Pack-defined, not live-verified (${defined.length}): ${defined.map((item) => item.operation).join(", ") || "none"}\n`);
      process.stdout.write(`Uncovered (${uncovered.length}): ${uncovered.map((item) => item.operation).join(", ") || "none"}\n`);
      process.stdout.write(`Unsafe or not started (${unsafe.length}): ${unsafe.map((item) => item.operation).join(", ") || "none"}\n`);
      process.stdout.write(`One-time confirmation required (${oneTime.length}): ${oneTime.map((item) => item.operation).join(", ") || "none"}\n`);
      process.stdout.write(`Gated, valid calls outside the authorized run scope (${gated.length}): ${gated.map((item) => item.operation).join(", ") || "none"}\n`);
    }
    process.exitCode = 0;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ status: "invalid", diagnostics: malformed("$", `could not read pack or inventory: ${error instanceof Error ? error.message : "read failed"}`) }, null, json ? 2 : 0)}\n`);
    process.exitCode = 2;
  }
};

const transferWorkflowPack = async (inventoryPath: string, packPath: string, output?: string) => {
  try {
    const [inventoryRaw, packRaw] = await Promise.all([readFile(inventoryPath, "utf8"), readFile(packPath, "utf8")]);
    const inventory = parseOperationInventory(JSON.parse(inventoryRaw));
    if (!inventory.value) throw new Error(`invalid inventory: ${inventory.diagnostics.map((d) => d.code).join(", ")}`);
    const pack = parseWorkflowPack(JSON.parse(packRaw), inventory.value);
    if (!pack.value) throw new Error(`invalid pack: ${pack.diagnostics.map((d) => d.code).join(", ")}`);
    const serialized = `${JSON.stringify(pack.value, null, 2)}\n`;
    if (output) await Bun.write(output, serialized);
    else process.stdout.write(serialized);
    process.exitCode = 0;
  } catch (error) {
    process.stderr.write(`invalid pack transfer: ${error instanceof Error ? error.message : "read failed"}\n`);
    process.exitCode = 2;
  }
};

const checkSurfaceDiff = async (inventoryPath: string, surfacePath: string, json: boolean) => {
  try {
    const [inventoryRaw, surfaceRaw] = await Promise.all([readFile(inventoryPath, "utf8"), readFile(surfacePath, "utf8")]);
    const inventory = parseOperationInventory(JSON.parse(inventoryRaw));
    const surface = parseHumanSurface(JSON.parse(surfaceRaw));
    const diagnostics = [...inventory.diagnostics, ...surface.diagnostics];
    if (!inventory.value || !surface.value) {
      process.stdout.write(`${JSON.stringify({ status: "invalid", diagnostics }, null, json ? 2 : 0)}\n`);
      process.exitCode = 3;
      return;
    }
    const rows = compareHumanSurface(surface.value, inventory.value);
    const gaps = rows.filter((row) => row.status === "agent-gap");
    const report = { status: "surface-compared", source: surface.value.source, inventory: { id: inventory.value.id, version: inventory.value.version, operations: inventory.value.actions.length }, humanOperations: rows.length, agentGaps: gaps, rows };
    if (json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    else {
      process.stdout.write(`Human/backend operations compared: ${rows.length}\n`);
      process.stdout.write(`Mapped in agent catalog: ${rows.length - gaps.length}; agent gaps: ${gaps.length}\n`);
      for (const gap of gaps) process.stdout.write(`GAP ${gap.id}: ${gap.endpoint} has no corresponding agent operation\n`);
    }
    process.exitCode = 0;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ status: "invalid", diagnostics: malformed("$", `could not read surface or inventory: ${error instanceof Error ? error.message : "read failed"}`) }, null, json ? 2 : 0)}\n`);
    process.exitCode = 2;
  }
};

const invalidEvaluation = (diagnostics: Diagnostic[], exitCode: 2 | 3) => ({ status: "invalid" as const, exitCode, diagnostics, steps: [], duration_ms: 0 });

const matchRun = async (matcherPath: string, logPath: string, json: boolean) => {
  try {
    const [matcherRaw, logRaw] = await Promise.all([readFile(matcherPath, "utf8"), readFile(logPath, "utf8")]);
    const matcher = parseRunMatcher(JSON.parse(matcherRaw));
    if (!matcher) throw new Error("invalid run matcher");
    const result = matchRunLog(matcher, JSON.parse(logRaw));
    if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else process.stdout.write(`${result.yes ? "YES" : "NO"}\n`);
    process.exitCode = result.yes ? 0 : 1;
  } catch (error) {
    process.stderr.write(`cannot match automation run: ${error instanceof Error ? error.message : "invalid input"}\n`);
    process.exitCode = 2;
  }
};

const checkAutomationPack = async (inventoryPath: string, packPath: string, matcherPath: string, json: boolean) => {
  try {
    const [inventoryRaw, packRaw, matcherRaw] = await Promise.all([readFile(inventoryPath, "utf8"), readFile(packPath, "utf8"), readFile(matcherPath, "utf8")]);
    const inventory = parseOperationInventory(JSON.parse(inventoryRaw));
    if (!inventory.value) throw new Error(`invalid inventory: ${inventory.diagnostics.map((item) => item.code).join(", ")}`);
    const pack = parseAutomationPack(JSON.parse(packRaw), inventory.value, JSON.parse(matcherRaw));
    const report = { status: pack.value ? "valid-backend-automation-pack" : "invalid", id: pack.value?.id, automationName: pack.value?.automation.name, diagnostics: pack.diagnostics };
    process.stdout.write(`${JSON.stringify(report, null, json ? 2 : 0)}\n`);
    process.exitCode = pack.value ? 0 : 3;
  } catch (error) {
    process.stderr.write(`cannot validate automation pack: ${error instanceof Error ? error.message : "invalid input"}\n`);
    process.exitCode = 2;
  }
};

const transferAutomationPack = async (mode: "import" | "export", inventoryPath: string, packPath: string, matcherPath: string, output?: string) => {
  try {
    const [inventoryRaw, packRaw, matcherRaw] = await Promise.all([readFile(inventoryPath, "utf8"), readFile(packPath, "utf8"), readFile(matcherPath, "utf8")]);
    const inventory = parseOperationInventory(JSON.parse(inventoryRaw));
    if (!inventory.value) throw new Error(`invalid inventory: ${inventory.diagnostics.map((item) => item.code).join(", ")}`);
    const parsed = parseAutomationPack(JSON.parse(packRaw), inventory.value, JSON.parse(matcherRaw));
    if (!parsed.value) throw new Error(`invalid automation pack: ${parsed.diagnostics.map((item) => item.code).join(", ")}`);
    const data = mode === "import" ? parsed.value.automation : parsed.value;
    const serialized = `${JSON.stringify(data, null, 2)}\n`;
    if (output) await Bun.write(output, serialized);
    else process.stdout.write(serialized);
    process.exitCode = 0;
  } catch (error) {
    process.stderr.write(`cannot ${mode} automation pack: ${error instanceof Error ? error.message : "invalid input"}\n`);
    process.exitCode = 2;
  }
};

const load = async (casePath: string, outcomePath: string) => {
  const caseResult = await readCase(casePath);
  if (caseResult.diagnostics.length) return invalidEvaluation(caseResult.diagnostics, caseResult.malformed ? 2 : 3);
  const outcomeResult = await readOutcome(outcomePath);
  if (outcomeResult.diagnostics.length) return invalidEvaluation(outcomeResult.diagnostics, outcomeResult.malformed ? 2 : 3);
  const result = evaluate(caseResult.value as EvalCase, outcomeResult.events!);
  return result;
};

const print = async (evaluation: ReturnType<typeof invalidEvaluation> | ReturnType<typeof evaluate>, json: boolean, output?: string) => {
  const content = json ? `${JSON.stringify(makeReport(evaluation as ReturnType<typeof evaluate>), null, 2)}\n` : formatText(evaluation as ReturnType<typeof evaluate>);
  if (output) await Bun.write(output, content);
  else process.stdout.write(content);
  process.exitCode = evaluation.exitCode;
};

const main = async (args: string[]) => {
  const command = args[0];
  if (command === "demo" && args.length === 1) {
    const { caseValue, events } = demoData();
    const evaluation = evaluate(caseValue, events);
    await print(evaluation, false);
    return;
  }
  if (command === "match-run" && args.length >= 3) {
    if (args.length === 4 && args[3] === "--json") return matchRun(args[1], args[2], true);
    if (args.length === 3) return matchRun(args[1], args[2], false);
    return usageError();
  }
  if (command === "automation-pack-check" && args.length >= 4) {
    if (args.length === 4) return checkAutomationPack(args[1]!, args[2]!, args[3]!, false);
    if (args.length === 5 && args[4] === "--json") return checkAutomationPack(args[1]!, args[2]!, args[3]!, true);
    return usageError();
  }
  if ((command === "automation-pack-import" || command === "automation-pack-export") && args.length >= 4) {
    const mode = command === "automation-pack-import" ? "import" : "export";
    if (args.length === 4) return transferAutomationPack(mode, args[1]!, args[2]!, args[3]!);
    if (args.length === 6 && args[4] === "--output") return transferAutomationPack(mode, args[1]!, args[2]!, args[3]!, args[5]!);
    return usageError();
  }
  if (command === "pack-check" && args.length >= 3) {
    if (args.length === 4 && args[3] === "--json") return checkWorkflowPack(args[1], args[2], true);
    if (args.length === 3) return checkWorkflowPack(args[1], args[2], false);
    return usageError();
  }
  if (command === "pack-import" && args.length === 3) return transferWorkflowPack(args[1], args[2]);
  if (command === "pack-export" && args.length >= 3) {
    if (args.length === 3) return transferWorkflowPack(args[1], args[2]);
    if (args.length === 5 && args[3] === "--output") return transferWorkflowPack(args[1], args[2], args[4]);
    return usageError();
  }
  if (command === "surface-diff" && args.length >= 3) {
    if (args.length === 4 && args[3] === "--json") return checkSurfaceDiff(args[1], args[2], true);
    if (args.length === 3) return checkSurfaceDiff(args[1], args[2], false);
    return usageError();
  }
  if ((command === "check" || command === "report") && args.length >= 3) {
    const casePath = args[1];
    const outcomePath = args[2];
    let json = false;
    let output: string | undefined;
    for (let index = 3; index < args.length; index += 1) {
      if (args[index] === "--json") json = true;
      else if (args[index] === "--output" && args[index + 1]) output = args[++index];
      else return usageError();
    }
    if (command === "check" && (json || output)) return usageError();
    await print(await load(casePath, outcomePath), command === "report" && json, output);
    return;
  }
  return usageError();
};

const usageError = () => {
  process.stderr.write(`${usage}\n`);
  process.exitCode = 2;
};

await main(process.argv.slice(2));
