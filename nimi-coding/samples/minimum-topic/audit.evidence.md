---
title: Minimum Topic Audit Evidence
doc_type: evidence
status: accepted
reason: The minimum topic is structurally self-hosting and suitable for validator coverage.
owner: nimi-coding/samples
updated_at: 2026-04-08T16:00:00+08:00
decision: accepted
---

# Minimum Topic Audit Evidence

## Findings

- The minimum topic contains all required typed artifacts.
- The topic index routes to valid sample artifacts.
- The execution packet is validator-backed and aligned to the frozen baseline.
- The orchestration state is validator-backed and aligned to the packet.
- The execution packet route is a linear two-phase chain suitable for packet-driven orchestration skeleton smoke.

## Checks Run

- `validate-topic`
- `validate-doc`
- `validate-execution-packet`
- `validate-orchestration-state`
- `validate-finding-ledger`

## Decision

Accept the sample topic as the minimum self-host topic for `nimi-coding/**`.

## Why This Decision

The topic is small, structured, and directly consumable by validators and CLI helpers.

## Deferred Findings

- `MIN-001`

## Remaining Risks or Gaps

- This sample does not cover final evidence routing.

## Next Action or Reopen Condition

Extend the sample only when a new validator or protocol requires additional coverage.
