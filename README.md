# evalcase

Dependency-free at runtime, deterministic evaluation for recorded AI-agent outcomes.

`evalcase` checks a bounded case contract against an outcome JSONL recording. It matches ordered tool calls and results, checks data-only assertions, prints stable diagnostics, and returns a CI-friendly exit code. It does not call a model or run an agent.

## Hypothesis

Teams that already record agent outcomes can get a repeatable regression signal from a small, framework-neutral case contract: expected tool names, required argument keys, result status, exact JSON, and duration bounds. This repository tests that hypothesis as a local CLI; it does not claim customer demand or adoption.

## Evidence, classified

| Class | Evidence | What it supports | What it does not support |
| --- | --- | --- | --- |
| Documented | GitHub authenticated searches on 2026-09-23: `rogue-security/rogue` 1,064 stars; `reworkd/bananalyzer` 330; `BaseIntelligence/agent-challenge` 157; `AgentEvalHQ/AgentEval` 148; `microsoft/eval-guide` 133; `microsoft/thinkingbox-data` 17. | Existing public interest/activity signals around agent evaluation. | Demand, willingness to adopt, or market size. Stars/activity can be stale or unrelated to this contract. |
| Reported | HN Algolia reported: NIST “Strengthening AI Agent Hijacking Evaluations” 43 points; Agenteval.org 6; “Rogue: Open-source AI agent evaluation framework” 3. | Public discussion has mentioned adjacent evaluation work. | Validated demand or representative usage. These are reported discussion signals only. |
| Measured | Local incumbent comparison: shell assertions and `jq` can inspect one JSON artifact. `evalcase` adds a bounded case contract, ordered outcome matching, deterministic diagnostics, a summary, and one CI exit code. | The proposed workflow is a small amount of reusable local glue around recorded data. | That shell tools cannot be composed; they can be composed, with the caller owning the contract and reporting conventions. |
| Inferred | A fixed contract and stable output may make recorded-outcome checks easier to review and repeat. | A design rationale to test locally. | Customer value, adoption, or production reliability. |
| Untestable here | No customer interviews, usage telemetry, deployment data, benchmark corpus, or production incident history is included. | Explicitly bounds what this project knows. | Any market, customer, or adoption conclusion. |

## Quickstart (under five minutes)

Requires Bun 1.3.14+.

```sh
git clone https://github.com/vystartasv/evalcase.git
cd evalcase
bun install --frozen-lockfile
bun src/cli.ts check fixtures/happy.case.json fixtures/happy.outcome.jsonl
bun src/cli.ts report fixtures/happy.case.json fixtures/happy.outcome.jsonl --json
bun src/cli.ts demo
```

The demo is fixed: it uses no API key, model, network, current timestamp, or agent runtime.

## Commands

```text
evalcase check case.json outcome.jsonl
evalcase report case.json outcome.jsonl [--json] [--output FILE]
evalcase match-run matcher.json run-log.json [--json]
evalcase automation-pack-check inventory.json automation-pack.json matcher.json [--json]
evalcase automation-pack-import inventory.json automation-pack.json matcher.json [--output FILE]
evalcase automation-pack-export inventory.json automation-pack.json matcher.json [--output FILE]
evalcase pack-check inventory.json pack.json [--json]
evalcase pack-import inventory.json pack.json
evalcase pack-export inventory.json pack.json [--output FILE]
evalcase surface-diff inventory.json human-surface.json [--json]
evalcase demo
```

`automation-pack-check` validates one ordinary manual backend automation and its separate deterministic matcher. `automation-pack-import` validates the portable pack and emits the workflow definition accepted by the existing `automation_workflow` API. `automation-pack-export` validates and writes the portable pack. These commands only read and write local files; they never call connected services or start runs. `pack-check`, `pack-import`, and `pack-export` retain the earlier operation inventory format for catalog coverage and migration. `surface-diff` compares a versioned human portal/backend inventory to the agent MCP action catalog and lists agent capability gaps.

`check` prints stable human-readable output. `report --json` emits deterministic, JUnit-like JSON with `tests`, `failures`, `errors`, `testcases`, a summary, and diagnostics. `--output` writes only the explicitly requested report file.

Exit codes:

- `0` — all assertions pass.
- `1` — valid contracts, but an assertion fails.
- `2` — malformed JSON/JSONL or invalid command usage/read input.
- `3` — valid JSON, but a case/outcome contract or event sequence is invalid.

## Contract

Case files are strict objects with only `id`, `name`, `input`, and `steps`. `input` is JSON metadata. Each step has:

```json
{
  "id": "lookup",
  "tool": "weather.lookup",
  "required_args": ["city"],
  "result_status": "success",
  "exact_result": {"city": "London"},
  "max_duration_ms": 100,
  "allow_failure": false
}
```

`exact_result` is optional and compares the complete JSON value using canonical object-key ordering; arrays keep their order. `allow_failure: true` permits an error result when success was expected. An expected error still requires an error result. Exact-result checking is skipped only for that explicitly allowed error.

Outcome JSONL has one strict object per line. Every event has a unique `id` and explicit non-negative integer `duration_ms`:

```json
{"type":"run_start","id":"run-1","case_id":"weather-summary","duration_ms":0}
{"type":"tool_call","id":"call-1","step_id":"lookup","tool":"weather.lookup","arguments":{"city":"London"},"duration_ms":0}
{"type":"tool_result","id":"result-1","call_id":"call-1","status":"success","result":{"city":"London"},"duration_ms":42}
{"type":"run_end","id":"run-end-1","status":"success","duration_ms":42}
```

The supported order is exactly `run_start`, then one `tool_call`/`tool_result` pair per case step in case order, then `run_end`. IDs, call/result links, case ID, duplicate or missing events, event counts, field types, bounds, and unknown fields are validated. Diagnostics use stable codes and JSON paths, are sorted by code/path/message, and are capped at 50.

## Non-goals and security

- No model calls, judges, network access, sandboxing, agent runtime, framework adapter, or hidden execution.
- Assertions are data-only: no code, `eval`, templates, expressions, or plugins are loaded from case/outcome files.
- The CLI reads only the two named inputs. It writes nothing unless `report --output FILE` is explicitly supplied; normal reports go to stdout.
- JSON values are treated as data. This tool is not a sandbox and does not make an untrusted agent safe.
- Runtime dependencies are zero. TypeScript, Bun, and Node type packages are development-only.

## Backend automation boundary

The execution pack is a normal `automation_workflow` request with one manual trigger, a connected target binding, and ordered backend steps. The backend performs every operation through its existing action catalog and writes ordinary run and step logs. Control flow uses the same bounded conditions, repeats, condition-driven loops, delays, and timeouts available to workflows generally. Conditions can inspect earlier captured action values. Pack validation checks matcher replay modes against the operation inventory and backend defaults. The separate matcher artifact checks those logs and emits `YES` or `NO`; it does not run operations, call an agent, or ask a model to judge results. Upload the automation through the existing automation API, invoke `automation_run` manually, wait for completion, inspect its run log, then pass that log and the matcher to `match-run`. No evaluation-specific API is involved. `examples/sharepoint-list-crud.pack.json` covers exact-site preflight, list/item CRUD, custom-column readback, captured results, fresh ETags, batch reads, batch create/update, and run-owned cleanup. Cleanup rereads the batch-created item and uses its current ETag. `examples/sharepoint-list-crud-cleanup-failure.pack.json` exercises a controlled invalid-ID read and verifies failure cleanup; its matcher requires recovery guidance from the ordinary log. The SharePoint packs positively define 16 actions. `examples/control-plane-readonly.automation-pack.json` covers nine safe service-scope reads, including all nine starter-template definitions in its catalog action. Separate `work-results-read` and `feed-read` packs use typed exact record bindings. `sharepoint-site-read` reads the exact site's lists and bounded recycle-bin assessment. `examples/control-plane-mcp-schema-guards.workflow-pack.json` has one unknown-field rejection case for every one of the 95 current MCP operations; `examples/sharepoint-batch-item-guards.workflow-pack.json` rejects empty batch create and update inputs. The local inventory marks 27 operations as pack-defined, 37 as gated outside this authorized scope, 27 as unsafe or not started, and two as one-time confirmed-target operations. Two further safe/run-owned operations have schema guards but no positive pack. The full operation-by-operation matrix is in `docs/evaluation-coverage.md`. These are schema and pack-definition results only; no operation has fresh deployed run evidence. Email delivery, invitation, tenant-wide catalog enumeration, site creation, and other external side effects stay gated until exact local checks and deployment authorization are complete.

## Local incumbent comparison

A one-artifact shell check is straightforward:

```sh
jq '.steps[] | select(.tool == "weather.lookup")' fixtures/happy.case.json
jq 'select(.type == "tool_result" and .status == "success")' fixtures/happy.outcome.jsonl
```

Those commands are composable and useful. The bounded case schema, ordered pairing, deterministic failure taxonomy, summary, and exit code are the additional behavior `evalcase` owns in one command.

## Verification transcript

Run the authoritative test command and full verification from the repository root:

```sh
bun install --frozen-lockfile
bun run typecheck
bun test test
bun run build
bun run demo
```

The test suite covers the happy path; missing, duplicate, and mismatched events; wrong tools, required arguments, statuses, exact JSON, and duration bounds; malformed JSON/JSONL; deterministic output; all exit codes; secret scanning; and whitespace hygiene. `bun test test` is authoritative and discovers every test file under `test/`.

## Limitations, dropped unknowns, and reopen trigger

Current scope deliberately drops partial-result matching, nested required-argument paths, retries, parallel calls, timestamps, streaming, custom assertion languages, external reports, and any attempt to infer quality from text. These can be reconsidered only when a concrete recorded-outcome example demonstrates that the bounded contract cannot express a required assertion without weakening deterministic behavior. Reopen the hypothesis after measured local usage produces such examples; do not reopen it from star counts or discussion points alone.

## License

MIT.
