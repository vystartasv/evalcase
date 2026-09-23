#!/usr/bin/env bun
import { readFile } from "node:fs/promises";
import { evaluate, formatText, makeReport, demoData, parseCase, parseOutcome, type Diagnostic, type EvalCase } from "./core.js";

const usage = "Usage: evalcase check case.json outcome.jsonl | evalcase report case.json outcome.jsonl [--json] [--output FILE] | evalcase demo";

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

const invalidEvaluation = (diagnostics: Diagnostic[], exitCode: 2 | 3) => ({ status: "invalid" as const, exitCode, diagnostics, steps: [], duration_ms: 0 });

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
