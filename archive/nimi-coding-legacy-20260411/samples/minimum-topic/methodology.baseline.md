---
title: Minimum Topic Baseline
doc_type: baseline
status: frozen
reason: This is the frozen execution truth for the minimum sample topic and its execution packet.
owner: nimi-coding/samples
updated_at: 2026-04-08T16:00:00+08:00
phase: sample-baseline
---

# Minimum Topic Baseline

## Phase Goal

Represent the minimum self-hosting `nimi-coding` topic.

## Confirmed State

The sample topic includes a topic index, an explore doc, a frozen baseline doc, an execution packet, an orchestration state, an evidence doc, and a finding ledger.

## Entry Criteria

- Module contracts and schema are present.

## Hard Constraints

- `spec/**` remains the only product authority.
- The sample must remain validator-friendly.

## Explicit Non-Goals

- No product-specific authority changes.
- No CI integration in the sample itself.

## Required Checks

- `validate-topic`
- `validate-doc`
- `validate-execution-packet`
- `validate-orchestration-state`
- `validate-finding-ledger`

## Completion Criteria

- Sample topic passes module validators.

## Reject / Reopen Conditions

- Reopen if any route target or doc_type mismatch is detected.

## Next Step

Use the sample topic as validator and CLI fixture coverage.
