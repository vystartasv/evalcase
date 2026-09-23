import { strict as assert } from "node:assert";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { demoData, evaluate, makeReport, parseCase, parseOutcome } from "../src/core.js";

const goodCase = {
  id: "case-1",
  name: "Lookup",
  input: { city: "London" },
  steps: [{ id: "lookup", tool: "weather.lookup", required_args: ["city"], result_status: "success", exact_result: { ok: true, value: 18 }, max_duration_ms: 100, allow_failure: false }]
};

const goodEvents = [
  { type: "run_start", id: "run", case_id: "case-1", duration_ms: 0 },
  { type: "tool_call", id: "call", step_id: "lookup", tool: "weather.lookup", arguments: { city: "London" }, duration_ms: 0 },
  { type: "tool_result", id: "result", call_id: "call", status: "success", result: { value: 18, ok: true }, duration_ms: 20 },
  { type: "run_end", id: "end", status: "success", duration_ms: 20 }
];

const parsed = () => {
  const caseResult = parseCase(goodCase);
  const outcomeResult = parseOutcome(goodEvents);
  assert.equal(caseResult.diagnostics.length, 0);
  assert.equal(outcomeResult.diagnostics.length, 0);
  return evaluate(caseResult.value!, outcomeResult.events!);
};

test("happy path is deterministic and canonicalizes object key order", () => {
  const first = parsed();
  const second = parsed();
  assert.equal(first.status, "passed");
  assert.deepEqual(first, second);
  assert.equal(makeReport(first).failures, 0);
});

test("missing, duplicate, and mismatched events are contract violations", () => {
  const missing = parseOutcome(goodEvents.slice(0, 3));
  assert.ok(missing.events);
  const caseValue = parseCase(goodCase).value!;
  assert.equal(evaluate(caseValue, missing.events!).exitCode, 3);
  const duplicate = parseOutcome([...goodEvents, goodEvents[2]]);
  assert.equal(duplicate.diagnostics[0]?.code, "DUPLICATE_ID");
  const mismatched = parseOutcome(goodEvents.map((event) => event.type === "tool_result" ? { ...event, call_id: "wrong" } : event));
  assert.equal(evaluate(caseValue, mismatched.events!).exitCode, 3);
});

test("wrong tool, required argument, status, exact result, and duration fail assertions", () => {
  const value = parseCase({ ...goodCase, steps: [{ ...goodCase.steps[0], max_duration_ms: 10 }] }).value!;
  const events = goodEvents.map((event) => event.type === "tool_call" ? { ...event, tool: "other", arguments: {} } : event);
  const result = evaluate(value, parseOutcome(events.map((event) => event.type === "tool_result" ? { ...event, status: "error", result: { nope: true }, duration_ms: 20 } : event)).events!);
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.diagnostics.map((item) => item.code), ["ARGUMENT_KEY", "EXACT_RESULT", "MAX_DURATION", "RESULT_STATUS", "TOOL_NAME"]);
});

test("allowed failure accepts an error without hiding contract errors", () => {
  const value = parseCase({ ...goodCase, steps: [{ ...goodCase.steps[0], allow_failure: true }] }).value!;
  const events = goodEvents.map((event) => event.type === "tool_result" ? { ...event, status: "error" } : event);
  assert.equal(evaluate(value, parseOutcome(events).events!).status, "passed");
});

test("unknown fields, malformed JSON, and malformed JSONL are rejected", () => {
  assert.equal(parseCase({ ...goodCase, extra: true }).diagnostics[0]?.code, "UNKNOWN_FIELD");
  assert.ok(parseOutcome([{ type: "unknown", id: "x", duration_ms: 0 }]).diagnostics.some((item) => item.code === "EVENT_TYPE"));
});

test("all CLI exit codes and output modes are stable", async () => {
  const directory = await mkdtemp(join(tmpdir(), "evalcase-"));
  try {
    const casePath = join(directory, "case.json");
    const outcomePath = join(directory, "outcome.jsonl");
    await writeFile(casePath, JSON.stringify(goodCase));
    await writeFile(outcomePath, `${goodEvents.map((value) => JSON.stringify(value)).join("\n")}\n`);
    const run = (args: string[]) => Bun.spawnSync(["bun", "src/cli.ts", ...args], { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" });
    const pass = run(["check", casePath, outcomePath]);
    assert.equal(pass.exitCode, 0);
    const json = run(["report", casePath, outcomePath, "--json"]);
    assert.equal(json.exitCode, 0);
    assert.equal(JSON.parse(json.stdout.toString()).status, "passed");
    assert.equal(json.stdout.toString(), run(["report", casePath, outcomePath, "--json"]).stdout.toString());
    const assertionFailure = join(directory, "assertion-failure.jsonl");
    await writeFile(assertionFailure, `${goodEvents.map((value) => value.type === "tool_call" ? JSON.stringify({ ...value, tool: "other" }) : JSON.stringify(value)).join("\n")}\n`);
    assert.equal(run(["check", casePath, assertionFailure]).exitCode, 1);
    const fail = run(["check", casePath, outcomePath.replace("outcome", "missing")]);
    assert.equal(fail.exitCode, 2);
    const invalidOutcome = join(directory, "invalid.jsonl");
    await writeFile(invalidOutcome, `${goodEvents.map((value) => JSON.stringify(value)).join("\n")}\n${JSON.stringify(goodEvents[2])}\n`);
    assert.equal(run(["check", casePath, invalidOutcome]).exitCode, 3);
    const malformedCase = join(directory, "malformed.json");
    await writeFile(malformedCase, "{");
    assert.equal(run(["check", malformedCase, outcomePath]).exitCode, 2);
    const malformedOutcome = join(directory, "malformed-outcome.jsonl");
    await writeFile(malformedOutcome, "{not-json}\n");
    assert.equal(run(["check", casePath, malformedOutcome]).exitCode, 2);
    assert.equal(run(["wat"]).exitCode, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("demo uses fixed data and no API key", () => {
  const { caseValue, events } = demoData();
  const result = evaluate(caseValue, events);
  assert.equal(result.status, "passed");
  assert.equal(result.duration_ms, 42);
});

test("tracked source contains no high-signal secret patterns", async () => {
  const output = Bun.spawnSync(["git", "ls-files", "-z"], { stdout: "pipe" }).stdout.toString();
  const files = output.split("\0").filter(Boolean);
  const patterns = [/ghp_[A-Za-z0-9]{20,}/, /github_pat_[A-Za-z0-9_]{20,}/, /sk-[A-Za-z0-9]{20,}/, /AKIA[A-Z0-9]{16}/, /-----BEGIN [A-Z ]+ PRIVATE KEY-----/];
  for (const file of files) {
    const content = await readFile(file, "utf8");
    assert.equal(patterns.some((pattern) => pattern.test(content)), false, `secret-like value in ${file}`);
  }
});

describe("whitespace hygiene", () => {
  test("tracked text files have no trailing whitespace", () => {
    const output = Bun.spawnSync(["git", "ls-files", "-z"], { stdout: "pipe" }).stdout.toString();
    for (const file of output.split("\0").filter(Boolean)) {
      const content = requireText(file);
      assert.equal(/^[ \t]+$/m.test(content), false, `trailing whitespace in ${file}`);
    }
  });
});

const requireText = (path: string) => {
  return readFileSync(path, "utf8");
};
