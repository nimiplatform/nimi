# Nimi Coding

> Status: Active
> Version: 2.5
> Maintainer: @snowzane
> Created: 2026-03-03
> Last Updated: 2026-04-08
> Scope: Nimi public overview
> Language: English
> Legacy Alias: Oriented-AI Spec Coding

---

## Overview

**Nimi Coding** is the engineering methodology used in this repository for AI-first, authority-driven delivery.

Its base lifecycle is:

`Rule -> Table -> Generate -> Check -> Evidence`

Its execution-orchestration extension adds:

`Preflight -> Converge -> Phase Freeze -> Dispatch -> Execute -> Verify -> Accept -> Close / Reject / Defer`

For human-converged autonomous delivery, `nimi-coding/**` now formalizes both the frozen execution packet artifact and the orchestration-state artifact. The packet is post-freeze execution authority; the orchestration state is future packet-bound mutable run position. Neither artifact is the autonomous runtime itself.

This document is the public overview only. It does not carry contracts, schemas, protocols, scripts, or CLI surface. Those live in the formal module.

## Authority Model

1. `spec/**` is the only normative product authority.
2. `.local/**` is local-only and never committed.
3. `nimi-coding/**` is the formal execution system module — promoted, repo-tracked, with its own AGENTS, contracts, validators, and CLI.

## What Lives Where

| Layer | Location | Role |
|-------|----------|------|
| Public overview | `docs/nimi-coding.md` (this file) | High-level model for readers |
| Formal execution system | `nimi-coding/**` | Contracts, schemas, protocols, gates, scripts, CLI, samples |
| Module AGENTS | `nimi-coding/AGENTS.md` | Module-local ownership, workflow rules, script tiers |
| Topic workspace | `.local/coding/**` | Local-only incubator for methodology research and trial artifacts |

## Formal Module Structure

| Directory | Contents |
|-----------|----------|
| `nimi-coding/contracts/` | Methodology, artifact model, staged delivery, finding lifecycle |
| `nimi-coding/schema/` | Typed artifact schemas (topic index, explore, baseline, execution packet, orchestration state, evidence, finding ledger) |
| `nimi-coding/protocol/` | Execution protocols (execution packet, orchestration state, dispatch, worker-output, acceptance, phase-lifecycle, reopen-defer) |
| `nimi-coding/gates/` | Gate policy and promotion policy |
| `nimi-coding/scripts/` | Module validators, lifecycle helpers, module-owned repo-wide checks |
| `nimi-coding/cli/` | Unified command entrypoint |
| `nimi-coding/samples/` | Canonical self-host topic |

## Script Ownership

`nimi-coding/scripts/` owns two categories:

1. **Module-internal**: validators and lifecycle operations on nimi-coding artifacts
2. **Module-owned repo-wide**: checks where nimi-coding is the natural authority (AI context budgets, doc metadata, structure budgets). Root `scripts/` has thin wrappers that delegate to these.

Repo-wide collaboration hygiene checks (e.g., `check:agents-freshness`, `check:no-legacy-doc-contracts`) remain in root `scripts/` — they are not nimi-coding module concerns.

## CLI Command Surface

The CLI supports a complete staged-delivery lifecycle without manual YAML surgery.

**Lifecycle commands**: `init-topic`, `set-topic-status`, `set-baseline`, `attach-evidence`, `finding-set-status`

**Validation commands**: `validate-topic`, `validate-doc`, `validate-execution-packet`, `validate-orchestration-state`, `validate-prompt`, `validate-worker-output`, `validate-acceptance`, `validate-finding-ledger`, `validate-module`

**Manager assist commands**: `topic-summary`, `unresolved-findings`, `prompt-skeleton`, `acceptance-skeleton`

**Batch delivery commands**: `batch-preflight`, `batch-next-phase`, `batch-phase-done`

Content authoring remains manual. Execution packets and orchestration states are typed YAML artifacts; other lifecycle and phase artifacts remain structured markdown or YAML as defined by the formal module. The CLI handles topic routing, status transitions, validation, manager assist, and batch delivery orchestration. Batch mode still works in stateless packet-driven form. The new orchestration-state artifact exists only as formal preparation for future resumable autonomous mode. This module still does not implement runner persistence, notification transport, TG integration, worker execution, semantic acceptance automation, or final confirmation.

See `nimi-coding/README.md` for the full command reference and a minimum staged-delivery loop example.

## Default Use

1. Read this overview for the high-level model.
2. Read `nimi-coding/AGENTS.md` for module ownership and workflow rules.
3. Read `nimi-coding/contracts/` for authoritative system semantics.
4. Read `nimi-coding/schema/` and `nimi-coding/protocol/` for typed execution artifacts.
5. Use `pnpm nimi-coding:cli -- --help` for the full command surface.
6. Use `.local/coding/**` only for incubating new patterns before promotion.
7. Run `pnpm nimi-coding:check` to validate the promoted module itself.
