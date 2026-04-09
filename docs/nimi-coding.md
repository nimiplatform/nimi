# Nimi Coding

> Status: Active
> Version: 2.6
> Maintainer: @snowzane
> Created: 2026-03-03
> Last Updated: 2026-04-09
> Scope: Nimi public overview
> Language: English
> Historical Note: Earlier repo discussions used `Oriented-AI Spec Coding`; that alias is retired and `nimi-coding` is the formal current name.

---

## Overview

**Nimi Coding** is the engineering methodology used in this repository for AI-first, authority-driven delivery.

`nimi-coding` is the formal module and methodology name used in this repository today. Earlier references to `Oriented-AI Spec Coding` are historical only and should not be treated as an active parallel name.

Its base lifecycle is:

`Rule -> Table -> Generate -> Check -> Evidence`

Its execution-orchestration extension adds:

`Preflight -> Converge -> Phase Freeze -> Dispatch -> Execute -> Verify -> Accept -> Close / Reject / Defer`

For human-converged autonomous delivery, `nimi-coding/**` now formalizes both the frozen execution packet artifact and the orchestration-state artifact, and it now ships a first packet-bound continuous runner cut. The packet is post-freeze execution authority; the orchestration state is packet-bound mutable run position; the runner is a bounded mechanical loop that still stops at explicit escalation and final human confirmation.

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
| Topic workspace | `nimi-coding/.local/**` | Local-only incubator for methodology research and trial artifacts |

## Formal Module Structure

| Directory | Contents |
|-----------|----------|
| `nimi-coding/contracts/` | Methodology, artifact model, staged delivery, finding lifecycle |
| `nimi-coding/schema/` | Typed artifact schemas (topic index, explore, baseline, execution packet, orchestration state, evidence, finding ledger) |
| `nimi-coding/protocol/` | Execution protocols (execution packet, orchestration state, dispatch, provider-worker-execution, worker-output, worker-runner-signal, acceptance, phase-lifecycle, reopen-defer) |
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

**Validation commands**: `validate-topic`, `validate-doc`, `validate-execution-packet`, `validate-orchestration-state`, `validate-notification-payload`, `validate-prompt`, `validate-worker-output`, `validate-acceptance`, `validate-finding-ledger`, `validate-module`

**Manager assist commands**: `topic-summary`, `unresolved-findings`, `prompt-skeleton`, `acceptance-skeleton`

**Batch delivery commands**: `batch-preflight`, `batch-next-phase`, `batch-phase-done`

**Continuous run commands**: `run-start`, `run-status`, `run-next-prompt`, `run-loop-once`, `run-until-blocked`, `run-schedule-status`, `run-schedule-once`, `run-schedule-codex-bridge`, `run-schedule-codex-once`, `run-schedule-codex-setup`, `run-schedule-codex-automation-upsert`, `run-ingest`, `run-ack-status`, `run-ack`, `run-notify`, `run-notify-telegram`, `run-notify-webhook`, `run-notifications`, `run-resume`, `run-confirm`

Content authoring remains manual. Execution packets and orchestration states are typed YAML artifacts; other lifecycle and phase artifacts remain structured markdown or YAML as defined by the formal module. The CLI now handles topic routing, status transitions, validation, manager assist, stateless batch delivery, a foreground continuous packet-bound provider loop, and a first foreground scheduler cut above that loop. Notification payloads are formalized as transport-agnostic operational outputs, `.nimi-coding/notifications/<run_id>.jsonl` is a narrow append-order readback surface, `notification-handoff.v1` formalizes stable cursor plus replay-from-cursor as a protocol-only handoff layer, `.nimi-coding/transport-state/<consumer>/<run_id>.checkpoint.yaml` persists transport-local ack progress, `run-notify` provides a local file-sink adapter, `run-notify-telegram` provides a Telegram Bot API adapter with explicit two-file env loading, `run-notify-webhook` provides a generic webhook transport cut, `.nimi-coding/provider-execution/<run_id>.jsonl` provides the minimum runtime-only audit log for provider-backed steps, and `.nimi-coding/scheduler-state/<topic_id>.lease.yaml` provides the minimum operational single-flight lease surface for the foreground scheduler. `run-confirm` can perform strict mechanical topic closeout after human confirmation when final evidence is already present. This module still does not implement fan-out runtime, semantic acceptance automation, finding lifecycle automation, a background daemon, or an automation backend.

Standalone validator CLI output is now also structured. `validate-worker-output` emits `validator-cli-result.v1` JSON on stdout for both success and refusal, and refusal cases include the same validator-native `refusal.code` / `refusal.message` surface that the runner consumes.

`validate-prompt` and `validate-acceptance` now use the same `validator-cli-result.v1` stdout contract for success and failure as well. They expose machine-readable `ok`, `errors`, and `warnings`, but they do not currently define a validator-native refusal taxonomy.

The module also now formalizes `provider-worker-execution.v1` and `worker-runner-signal.v1` as module-owned authority for provider-backed worker execution. The current implementation cut routes one running phase through `run-loop-once` and a guarded foreground loop through `run-until-blocked`: prompt generation, headless `codex exec` invocation from repository root, strict `Runner Signal` parsing from the worker-output artifact, stable refusal taxonomy, and existing ingest/state progression. The current admitted provider set remains intentionally limited to `codex exec`. `claude`, `gemini`, and `kimi` are not admitted in this cut, and automation still remains a scheduler layer rather than the core loop owner.

The first scheduler implementation cut is now present too. `run-schedule-status` is the machine-readable scheduler preflight surface for one topic, and `run-schedule-once` is the first foreground scheduler command: it checks eligibility, acquires an operational lease, invokes `run-until-blocked`, then releases the lease on normal exit. The lease is operational only and must not be treated as canonical topic or orchestration truth.

Codex automation is now the first admitted scheduler backend, but only as a backend binding. `run-schedule-codex-once` is a thin wrapper over `run-schedule-once` that preserves the same `scheduler-result.v1` output and only stamps a Codex-backend holder identity. `run-schedule-codex-setup` is the first actual setup surface for one explicit topic: it emits a machine-readable binding payload with the exact repo cwd, preflight command, invoke command, and expected result contracts that a Codex automation instance should use. `run-schedule-codex-automation-upsert` is the first create/update flow on top of that setup payload: it creates or updates one deterministic automation instance for one explicit topic target. `run-schedule-codex-bridge` is a convenience-only assistant/UI layer over those same setup + upsert contracts: it returns one machine-readable bridge result with setup summary, upsert action, automation identity, topic target, and command binding, without inventing new scheduler semantics. None of these commands becomes a new orchestration owner, and none may drive behavior by parsing topic files as its primary control surface.

Provider transcript and refusal boundaries are now explicit:

- `.nimi-coding/provider-execution/<run_id>.jsonl` is operational only, not canonical topic or orchestration truth.
- The log records bounded and redacted `stdout/stderr` capture, but never prompt bodies, raw command arguments containing prompts, env values, tokens, or file contents.
- Stable refusal codes now include runner-level categories `PROVIDER_NOT_ADMITTED`, `PROVIDER_INVOCATION_FAILED`, `PROVIDER_TIMEOUT`, `PROMPT_GENERATION_FAILED`, `LOOP_GUARD_HIT`, and `STATE_PRECONDITION_FAILED`.
- Worker artifact and Runner Signal categories are now validator-native: `WORKER_OUTPUT_MISSING`, `WORKER_OUTPUT_INVALID`, `RUNNER_SIGNAL_MISSING`, `RUNNER_SIGNAL_INVALID`, and `RUNNER_SIGNAL_ARTIFACT_MISMATCH` are emitted directly from the validator layer and then propagated by the runner.
- This is still mechanical validation only. The validator does not become the semantic owner of acceptance or finding lifecycle judgment.
- Prompt and acceptance validator CLI output is now machine-readable too, but that does not imply semantic correctness judgment. It is still structural/contract validation only.
- Future automation may read the standalone validator CLI output directly, but that does not make the validator CLI an orchestration owner.
- Future automation may consume these structured summaries and refusal codes, but it still must not become the loop's semantic owner.
- Future automation should consume `scheduler-result.v1` / `scheduler-preflight.v1` and existing runner summaries rather than parsing topic files directly as its primary scheduling surface.
- Future automation must not own lease policy, packet progression semantics, semantic acceptance, or finding lifecycle judgment.
- The admitted Codex backend invocation shape is foreground only: run from repository root, optionally preflight with `run-schedule-status`, then invoke `run-schedule-codex-once` for one explicit topic and consume only the returned JSON.
- The admitted Codex setup shape is one-topic only: generate `codex-automation-setup.v1` with `run-schedule-codex-setup`, then bind one automation instance to that explicit target and the emitted scheduler commands.
- The admitted Codex create/update shape is also one-topic only: use `run-schedule-codex-automation-upsert` to create or update exactly one deterministic automation instance for that explicit topic target.
- The admitted assistant/UI bridge shape is still one-topic only: use `run-schedule-codex-bridge` to compose setup and upsert convenience for one explicit topic target, while treating the underlying setup/upsert contracts and scheduler outputs as the authoritative surfaces.
- Daemon mode, multi-topic orchestration, and multi-provider automation still remain out of scope.
- `ok=false` from the scheduler surface is a structured refusal. `ok=true` with `loop_summary.stop_reason` in `paused`, `failed`, `awaiting_confirmation`, `completed`, or `superseded` is a successful invocation that reached a scheduler stop condition.

`notification-handoff.v1` still does not create a new artifact. Its cursor is the per-run 1-based append ordinal, `run-notifications --after-cursor <n>` returns only entries after that cursor, and `run-notifications --after-ack <consumer>` replays from one consumer's transport-local checkpoint. `run-notify` writes file-sink envelopes, `run-notify-telegram` renders one plain-text Telegram message per handoff entry using `TG_BOT_TOKEN` and `TG_CHAT_ID` loaded only from root `.env` then `nimi-coding/.env`, and `run-notify-webhook` POSTs minimal HTTP envelopes to one endpoint. All three only advance checkpoints after successful delivery, and none writes back into topic or orchestration artifacts.

See `nimi-coding/README.md` for the full command reference and a minimum staged-delivery loop example.

## Default Use

1. Read this overview for the high-level model.
2. Read `nimi-coding/AGENTS.md` for module ownership and workflow rules.
3. Read `nimi-coding/contracts/` for authoritative system semantics.
4. Read `nimi-coding/schema/` and `nimi-coding/protocol/` for typed execution artifacts.
5. Use `pnpm nimi-coding:cli -- --help` for the full command surface.
6. Use `nimi-coding/.local/**` only for incubating new patterns before promotion.
7. Run `pnpm nimi-coding:check` to validate the promoted module itself.
