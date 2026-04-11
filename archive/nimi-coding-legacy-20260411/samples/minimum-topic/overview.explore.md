---
title: Minimum Topic Exploration
doc_type: explore
status: active
reason: Active exploration retained for sample self-host topic.
owner: nimi-coding/samples
updated_at: 2026-04-08T16:00:00+08:00
---

# Minimum Topic Exploration

## Question / Scope

How should a minimum self-host `nimi-coding` topic be represented?

## Current Understanding

The topic needs one index, one frozen baseline, one execution packet, one orchestration state, one evidence record, and one finding ledger.

## Options

1. Keep topic prose-only.
2. Use typed topic artifacts.

## Recommendation or Current Lean

Use typed topic artifacts so validators and CLI can consume the topic directly.

## Open Questions

- Which orchestration-state relations should later become required only for resumable mode?
