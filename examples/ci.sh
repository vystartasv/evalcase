#!/usr/bin/env sh
set -eu
bun src/cli.ts check fixtures/happy.case.json fixtures/happy.outcome.jsonl
