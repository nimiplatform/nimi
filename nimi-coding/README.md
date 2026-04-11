# Nimi Coding Module

`nimi-coding/**` is the formal execution system for the nimi-coding methodology.

It is the promoted, repo-tracked layer that owns methodology contracts, execution protocols, typed artifact schemas, gate policies, validators, CLI, and canonical samples.

## Authority Model

- `spec/**` is the repo-wide normative product authority family. Admitted app-local product authority slices may also live under `apps/**/spec/**` when they follow the same `kernel/*.md` plus `kernel/tables/**` discipline and do not create parallel truth. This module does not redefine product truth.
- `nimi-coding/**` is the promoted execution system. Only stable, reusable, decision-complete assets belong here.
- `nimi-coding/.local/**` is the local-only topic workspace for methodology research and trial artifacts. It is never committed. Promotion into this module follows `gates/promotion-policy.yaml`.

## Default Posture

`nimi-coding` defaults to inline manager-worker delivery.

- `manager` and `worker` remain distinct methodology roles.
- `worker` remains a bounded execution contract and artifact boundary.
- The default path is for the manager to freeze the phase, execute the phase against the worker contract, produce `worker-output`, then return to manager review for acceptance.
- External or provider-backed worker execution remains admitted as an optional operational path for isolation, long-running execution, or scheduler-backed unattended flows.

`nimi-coding` is continuity-agnostic.

- It requires durable artifacts, packet-bound run state, and recoverable governance.
- It does not require a persistent manager session, daemon, heartbeat, or any specific host runtime.
- Harnesses, automations, or outer agent runtimes may extend `nimi-coding` with stronger continuity, but those extensions are not part of the core methodology contract.

`nimi-coding` is not the default path for every change. Use it mainly for high-risk work: authority-bearing redesign, large refactor, cross-layer change, or multi-phase delivery. Small fixes and narrow spec repairs may stay outside `nimi-coding` when the authority boundary is already clear and correction cost is low.

Token-cost discussion belongs to methodology audit only. It helps judge whether this workflow is worth using for a class of work; it is not a routine topic artifact, phase gate, or day-to-day execution metric.

Capability-chain decomposition is intentionally bounded. `nimi-coding` is meant
to reduce ambiguity, not recursively manufacture more surfaces. When one
capability family already has repeated `preflight`, `boundary`, or `seed`
topics, the next valid step is collapse/audit or implementation. Opening
another same-family decomposition topic is an execution-system failure.

## What This Module Owns

| Directory | Responsibility |
|-----------|---------------|
| `contracts/` | System contracts: methodology, artifact model, staged delivery, finding lifecycle |
| `schema/` | Typed artifact schemas: topic index, explore, baseline, execution packet, orchestration state, evidence, finding ledger, and phase-execution markdown shape requirements |
| `protocol/` | Execution protocols: execution packet, orchestration state, dispatch, provider-worker-execution, worker-output, worker-runner-signal, acceptance, phase-lifecycle, reopen-defer |
| `gates/` | Gate policy (hard/soft/advisory gates) and promotion policy (incubator → promoted) |
| `samples/` | Canonical self-host topic for validation |
| `scripts/` | Module validators, lifecycle helpers, and module-owned repo-wide checks |
| `cli/` | Unified command entrypoint wrapping scripts |

## What This Module Does NOT Own

- Product spec authority (`spec/**`, plus admitted `apps/**/spec/**` app-local slices)
- Repo-wide collaboration hygiene (e.g., `check:agents-freshness`, `check:no-legacy-doc-contracts`)
- Topic workspace content (`nimi-coding/.local/**`)
- Runtime, SDK, desktop, web, or mod code

See `AGENTS.md` for the full script ownership tier breakdown.

## Script Ownership

Scripts fall into two categories:

**Module-internal**: validate and operate on nimi-coding artifacts (topics, docs, findings, the module itself). Invoked via CLI or directly.

**Module-owned repo-wide**: implementation in `nimi-coding/scripts/`, thin root wrappers in `scripts/`. These check repo-wide concerns where nimi-coding is the natural authority (AI context budgets, doc metadata, structure budgets).

Repo-wide checks that are not nimi-coding concerns stay in root `scripts/` with no counterpart here.

## Entry Points

- Module docs: this file
- Public overview: [`docs/nimi-coding.md`](../docs/nimi-coding.md)
- Module AGENTS: [`AGENTS.md`](./AGENTS.md)
- CLI: [`cli/cli.mjs`](./cli/cli.mjs)
- Sample topic: [`samples/minimum-topic/topic.index.yaml`](./samples/minimum-topic/topic.index.yaml)

## Root Commands

### Lifecycle

```
pnpm nimi-coding:init-topic -- <topic-dir> [--title <title>] [--owner <owner>]
pnpm nimi-coding:set-topic-status -- <topic-dir> <status> --reason <text>
pnpm nimi-coding:set-baseline -- <topic-dir> <baseline-rel-path>
pnpm nimi-coding:set-baseline -- <topic-dir> --clear
pnpm nimi-coding:attach-evidence -- <topic-dir> <evidence-rel-path> [--final]
pnpm nimi-coding:finding-set-status -- <topic-dir> <finding-id> <next-status> --reason <text>
```

### Validate

```
pnpm nimi-coding:validate-topic -- <topic-dir>
pnpm nimi-coding:validate-doc -- <doc-path>
pnpm nimi-coding:validate-execution-packet -- <packet-path>
pnpm nimi-coding:validate-orchestration-state -- <state-path>
pnpm nimi-coding:validate-prompt -- <prompt-path>
pnpm nimi-coding:validate-worker-output -- <worker-output-path>
pnpm nimi-coding:validate-acceptance -- <acceptance-path>
pnpm nimi-coding:validate-finding-ledger -- <ledger-path>
pnpm nimi-coding:validate-notification-payload -- <payload-path>
pnpm nimi-coding:validate-module
pnpm nimi-coding:check
```

`validate-worker-output` now emits a machine-readable stdout record for both success and refusal:

```json
{
  "contract": "validator-cli-result.v1",
  "validator": "validate-worker-output",
  "target_ref": "/abs/path/to/phase.worker-output.md",
  "ok": false,
  "refusal": {
    "code": "RUNNER_SIGNAL_MISSING",
    "message": "worker-output artifact is missing the required Runner Signal block"
  },
  "errors": ["missing worker-output block: Runner Signal"],
  "warnings": [],
  "signal": null
}
```

This is still a mechanical validation surface only. It does not make semantic acceptance decisions and it does not judge finding lifecycle outcomes.

`validate-prompt` and `validate-acceptance` now use the same `validator-cli-result.v1` stdout surface for both success and failure:

```json
{
  "contract": "validator-cli-result.v1",
  "validator": "validate-prompt",
  "target_ref": "/abs/path/to/phase.prompt.md",
  "ok": false,
  "errors": ["missing prompt block: Required Checks"],
  "warnings": []
}
```

These two validators currently expose machine-readable result status, errors, and warnings only. They do not currently expose a validator-native refusal taxonomy, and they still remain mechanical contract validators rather than semantic judges.

### Assist (Manager)

```
pnpm nimi-coding:topic-summary -- <topic-dir>
pnpm nimi-coding:unresolved-findings -- <topic-dir>
pnpm nimi-coding:prompt-skeleton -- <topic-dir> --phase <name> --goal <text> [--output <path>]
pnpm nimi-coding:acceptance-skeleton -- --disposition <complete|partial|deferred> [--output <path>]
```

These commands are **assist**, not automation. They reduce manager token cost by consolidating topic state, listing unresolved findings, and generating skeletons with all required blocks pre-filled. The manager still makes all semantic decisions (what to dispatch, whether to accept, what disposition to assign).

Skeleton outputs align with `prompt.schema.yaml` and `acceptance.schema.yaml` required blocks. They are starting points, not final artifacts.

### Batch Delivery

```
pnpm nimi-coding:batch-preflight -- <topic-dir>
pnpm nimi-coding:batch-next-phase -- <topic-dir> [--after <phase-id>]
pnpm nimi-coding:batch-phase-done -- <topic-dir> --phase <name> --disposition <complete|partial|deferred> --acceptance <rel-path> [--evidence <rel-path>]
```

Batch mode now requires a **packet-driven frozen plan**: topic status=active, baseline status=frozen, valid finding ledger, non-empty protocol_refs including `execution-packet.v1`, and a valid `execution_packet_ref` whose packet route is linear and inspectable. `batch-preflight` checks those preconditions and outputs a structured pass/fail report. `batch-next-phase` prints the packet-declared entry phase or the next phase after a completed phase. `batch-phase-done` validates the acceptance artifact, optionally attaches evidence, re-validates the packet-driven preconditions, and reports one of three bounded outcomes: next frozen phase, same frozen phase redispatch after `partial`, or terminal human handoff after terminal `complete`.

**Packet-driven orchestration remains mechanically bounded.** It consumes only the frozen packet plus existing topic artifacts. Semantic acceptance and finding lifecycle judgment remain outside the current batch cut; notification transports are layered separately on top of the continuous-run handoff surface.

### Continuous Run

```
pnpm nimi-coding:run-start -- <topic-dir> [--state-ref <rel-path>] [--run-id <id>]
pnpm nimi-coding:run-status -- <topic-dir>
pnpm nimi-coding:run-next-prompt -- <topic-dir> [--output <topic-local-path>]
pnpm nimi-coding:run-loop-once -- <topic-dir> [--worker-output <topic-local-path>] [--acceptance <topic-local-path>] [--timeout-ms <ms>]
pnpm nimi-coding:run-until-blocked -- <topic-dir> [--timeout-ms <ms>] [--max-steps <n>]
pnpm nimi-coding:run-schedule-status -- <topic-dir>
pnpm nimi-coding:run-schedule-once -- <topic-dir> [--timeout-ms <ms>] [--max-steps <n>] [--lease-ttl-ms <ms>] [--lease-holder <id>]
pnpm nimi-coding:run-schedule-codex-bridge -- <topic-dir> [--codex-home <path>] [--rrule <rrule>] [--status <ACTIVE|PAUSED>] [--name <name>] [--model <model>] [--reasoning-effort <effort>] [--execution-environment <local|worktree>]
pnpm nimi-coding:run-schedule-codex-once -- <topic-dir> [--timeout-ms <ms>] [--max-steps <n>] [--lease-ttl-ms <ms>] [--lease-holder <id>]
pnpm nimi-coding:run-schedule-codex-setup -- <topic-dir>
pnpm nimi-coding:run-schedule-codex-automation-upsert -- <topic-dir> [--codex-home <path>] [--rrule <rrule>] [--status <ACTIVE|PAUSED>] [--name <name>] [--model <model>] [--reasoning-effort <effort>] [--execution-environment <local|worktree>]
pnpm nimi-coding:run-ingest -- <topic-dir> --worker-output <topic-local-path> [--evidence <topic-local-path>]... [--acceptance <topic-local-path>] [--escalate <reason>]... [--fail <reason>]
pnpm nimi-coding:run-review -- <topic-dir> --worker-output <topic-local-path> --acceptance <topic-local-path> --disposition <complete|partial|deferred> [--evidence <topic-local-path>]... [--awaiting-human-action <action>] [--defer-reason <reason>]
pnpm nimi-coding:run-ack-status -- <topic-dir> --consumer <consumer-id> [--run-id <run-id>]
pnpm nimi-coding:run-ack -- <topic-dir> --consumer <consumer-id> --cursor <n> [--run-id <run-id>]
pnpm nimi-coding:run-notify -- <topic-dir> --consumer <consumer-id> --sink-dir <sink-dir> [--run-id <run-id>]
pnpm nimi-coding:run-notify-telegram -- <topic-dir> --consumer <consumer-id> [--run-id <run-id>] [--timeout-ms <ms>]
pnpm nimi-coding:run-notify-webhook -- <topic-dir> --consumer <consumer-id> --endpoint <url> [--run-id <run-id>] [--header <name:value>]... [--timeout-ms <ms>]
pnpm nimi-coding:run-notifications -- <topic-dir> [--run-id <run-id>] [--after-cursor <n>] [--after-ack <consumer-id>]
pnpm nimi-coding:run-resume -- <topic-dir> --reason <packet-allowed-reason>
pnpm nimi-coding:run-confirm -- <topic-dir> [--final-evidence <topic-local-path>] [--reason <closeout-reason>]
```

Continuous run is the first packet-bound autonomous orchestration cut.

The default attended flow still remains inline manager-worker. The continuous-run and provider-backed commands below are optional operational surfaces for cases that benefit from process isolation, foreground looping, or scheduler-backed continuation; they do not replace manager-owned semantic review.

These operational surfaces also do not change the continuity boundary: they can supply stronger execution continuity when the host environment supports it, but `nimi-coding` itself remains continuity-agnostic and recoverable rather than continuity-dependent.

- `run-start` creates a `running` orchestration state for a frozen packet.
- `run-next-prompt` generates a formal `*.prompt.md` artifact from the current packet phase and topic state.
- `run-loop-once` is the single-step provider-backed execution cut. It generates the current prompt, invokes `codex exec` headlessly from repository root, captures the final worker-output artifact directly at the packet-bound topic path, requires a machine-readable `Runner Signal` block, and then routes that signal through the existing ingest/state-progression path. Provider invocation failure, missing worker output, malformed signal, and signal/artifact mismatch all fail-close and return structured refusal.
- `run-until-blocked` is the foreground continuous loop cut. It repeats the same provider-backed step until the run becomes `paused`, `failed`, `completed`, `superseded`, or legacy `awaiting_confirmation`. It never loops silently: `--max-steps` is a hard guard, and guard exhaustion returns structured refusal.
- `run-schedule-status` is the first scheduler preflight/status surface. It does not mutate topic truth. It reports one topic as `eligible`, `blocked_by_active_lease`, `run_terminal`, `run_blocked`, or missing required provider-backed prerequisites, and it includes machine-readable lease/refusal state for future automation backends.
- `run-schedule-once` is the first foreground scheduler cut. It runs scheduler preflight, acquires a local operational lease, invokes `run-until-blocked`, then releases the lease on normal exit and emits `scheduler-result.v1`. It is still a foreground command, not a daemon and not an automation backend.
- `run-schedule-codex-bridge` is the first assistant/UI-facing convenience bridge. It composes `codex-automation-setup.v1` and the one-topic automation upsert flow into one `codex-automation-bridge-result.v1` record with setup summary, upsert action, automation identity, topic target, and scheduler command binding. It is convenience only; setup/upsert contracts remain authoritative.
- `run-schedule-codex-once` is the first admitted Codex automation backend binding. It is a thin wrapper over `run-schedule-once`, preserves the exact `scheduler-result.v1` output surface, and only stamps a Codex-backend lease holder identity. It does not add scheduler semantics and it does not inspect topic files directly.
- `run-schedule-codex-setup` is the first actual automation setup surface. It emits `codex-automation-setup.v1` for one explicit topic only: target path, repository cwd, exact scheduler commands, expected result contracts, and a suggested Codex automation prompt. It does not scan for topics and it does not invent another scheduler contract.
- `run-schedule-codex-automation-upsert` is the first actual create/update flow. It consumes the same one-topic setup contract, derives one stable automation identity for that explicit topic, and writes or updates one Codex automation instance without creating duplicates for the same target. It does not broaden into repo scanning or multi-topic orchestration.
- The bridge does not become an owner. Scheduler outputs, setup payloads, and upsert results remain the authoritative control surfaces. The bridge only makes those surfaces easier for an assistant or UI to consume and display.
- `run-ingest` validates worker output, runs packet-declared checks, writes mechanical `complete` or `deferred` acceptance, updates orchestration state, and emits transport-agnostic local notifications for `run_paused`, `run_failed`, and `run_completed`. It is the autonomous/mechanical path and must not infer `partial`.
- `run-review` is the manager-reviewed closeout path for one execution attempt inside the current frozen phase. It validates prompt continuity, worker output, acceptance, and evidence refs, refuses `complete` when packet-declared checks fail, records `complete | partial | deferred`, and either advances, redispatches the same frozen phase, pauses, or completes a terminal run under manager ownership.
- Notification payloads are now formalized by `notification-payload.v1` and can be validated independently from transport.
- `.nimi-coding/notifications/<run_id>.jsonl` is now a run-scoped append-only operational log. Each non-empty line must be one `notification-payload.v1` JSON object for that run, and readback preserves file order.
- `.nimi-coding/provider-execution/<run_id>.jsonl` is now the minimum provider-backed operational audit surface. Each line records one provider-backed step with `run_id`, `phase_id`, `provider`, `prompt_ref`, `worker_output_ref`, `signal_result_kind`, `started_at`, `finished_at`, `exit_status`, `refusal_code`, bounded `stdout/stderr` transcript capture, and a structured `status_summary`. It is runtime-only and not canonical topic truth.
- `.nimi-coding/scheduler-state/<topic_id>.lease.yaml` is now the minimum scheduler single-flight surface. It is operational only. It records `topic_id`, `run_id`, `holder_id`, `acquired_at`, `updated_at`, and `expires_at`, and it must never be routed from `topic.index.yaml` or `*.orchestration-state.yaml`.
- Provider transcript capture is intentionally bounded and redacted. `stdout` and `stderr` are truncated per stream, prompt body and raw command arguments are not logged, and env/token-like values are redacted before writeback. Oversized provider output is truncated in the operational record; it does not become canonical topic truth.
- Fields that must never enter the provider execution log: prompt body, inline repository file contents, raw command arguments containing the provider prompt, env values, access tokens, and chat/webhook secrets.
- `notification-handoff.v1` is now formalized as a protocol-only layer on top of that log. It does not create a new topic artifact; it defines stable cursor semantics, replay-from-cursor, and future ack meaning for transport consumers.
- Stable cursor means the 1-based append ordinal within one run log. `run-notifications --after-cursor <n>` returns only entries where `cursor > n`.
- Transport-local ack persistence now lives at `.nimi-coding/transport-state/<consumer-id>/<run_id>.checkpoint.yaml`. This is operational state for one consumer stream only; it is not routed from `topic.index.yaml` and it is not canonical topic or orchestration truth.
- `run-ack-status` reads the current checkpoint. Missing checkpoint files are valid and imply `last_acked_cursor=0`. Unknown runs, malformed checkpoint state, cursor regression, and ack beyond the current max cursor all refuse.
- `run-ack` advances one consumer checkpoint to cursor `N` after validating the current notification log and handoff max cursor. It does not imply semantic acceptance, human receipt, or topic mutation.
- `run-notifications --after-ack <consumer-id>` replays entries after that consumer's last acknowledged cursor. Future external transports should consume this operational layer rather than rewriting topic truth.
- `run-notify` is the file-sink adapter cut. It remains useful for local transport verification: for each handoff entry after the consumer checkpoint, it writes one transport-owned JSON file into `--sink-dir`, then advances the checkpoint only if that write succeeds.
- `run-notify-telegram` is the Telegram adapter cut. It consumes the same handoff and checkpoint substrate, renders one plain-text Telegram message per handoff entry, sends with the Bot API, and advances the checkpoint only after each successful send.
- Telegram configuration is local operational input only. The adapter reads exactly two env files in fixed order: repository root `.env`, then `nimi-coding/.env`, with the second overriding the first by key. Required keys are `TG_BOT_TOKEN` and `TG_CHAT_ID`; missing files, missing keys, empty values, or malformed values all refuse before any send or ack attempt.
- `run-notify-webhook` is the first real transport cut. It POSTs one minimal HTTP envelope per handoff entry to a single webhook endpoint and only advances the checkpoint after each successful `2xx` delivery. Non-`2xx`, network errors, malformed JSON responses declared as `application/json`, and ack failures all fail-close with no checkpoint advance for the failed entry.
- Adapter consumer identity is explicit and transport-local. Use a stable adapter-specific id such as `notify-file-primary`; the checkpoint and replay boundary are keyed by that consumer id plus run id.
- `run-resume` allows same-packet continuation only when the packet `resume_policy` explicitly allows the supplied reason.
- `run-confirm` is now the optional human final closeout step after a run is already `completed` under manager ownership. When strict preconditions pass, it attaches final evidence, closes the topic, and preserves the already-completed run without mutating finding lifecycle or inferring semantic acceptance.
- The notification layer is still operational only. It is not external transport, not a generic event bus, and not canonical topic or orchestration state.
- `provider-worker-execution.v1` and `worker-runner-signal.v1` are now the module-owned authority boundary for the first provider-backed worker invocation cut.
- The current admitted provider set for that future provider-backed boundary is intentionally limited to `codex exec`; `claude`, `gemini`, and `kimi` are not admitted in the first cut.
- Structured refusal taxonomy is now a stable runner-facing contract for provider-backed execution. Worker artifact and signal categories are now validator-native: `WORKER_OUTPUT_MISSING`, `WORKER_OUTPUT_INVALID`, `RUNNER_SIGNAL_MISSING`, `RUNNER_SIGNAL_INVALID`, and `RUNNER_SIGNAL_ARTIFACT_MISMATCH` come directly from `validateWorkerOutput` / `readWorkerRunnerSignal` as typed validator refusal results.
- Runner core still owns only provider/process/loop-level categories such as `PROVIDER_NOT_ADMITTED`, `PROVIDER_INVOCATION_FAILED`, `PROVIDER_TIMEOUT`, `PROMPT_GENERATION_FAILED`, `LOOP_GUARD_HIT`, and `STATE_PRECONDITION_FAILED`.
- Validator-native refusal taxonomy is still mechanical validation only. It does not make semantic acceptance decisions and it does not own finding lifecycle judgment.
- Standalone validator CLI now exposes the same refusal surface directly. `validate-worker-output` writes `validator-cli-result.v1` JSON to stdout and includes `refusal.code` / `refusal.message` in refusal cases, so humans, runner code, and future automation can consume the same taxonomy.
- `validate-prompt` and `validate-acceptance` now also emit `validator-cli-result.v1` JSON on stdout for both success and failure, so standalone validator CLI output is consistent across the main artifact validators.
- Only `validate-worker-output` currently exposes validator-native refusal taxonomy. Prompt and acceptance validators currently expose structured `errors` / `warnings` only; this avoids implying semantic judgment where none exists.
- `run-loop-once` and `run-until-blocked` now emit a stable top-level `summary` object alongside detailed fields. Future automation may consume that structured summary and refusal taxonomy, but automation still does not own loop semantics.
- `run-schedule-once` now emits a stable `scheduler-result.v1` surface with `topic_id`, `run_id`, lease state, `scheduler_outcome`, `loop_summary`, and structured refusal when present.
- Codex automation is now the first admitted scheduler backend, but only as a backend wrapper over the same scheduler surface. It must consume `run-schedule-status` and `run-schedule-codex-once` output, not parse `topic.index.yaml`, `*.orchestration-state.yaml`, or worker artifacts directly as its primary control surface.
- Automation is still not the core loop owner. Codex automation must not replace module-owned scheduler policy, provider execution, runner signaling, acceptance semantics, or finding lifecycle semantics.
- The assistant/UI bridge is also not an owner. It may orchestrate one-topic setup and create/update convenience, but it must not redefine scheduler retry/stop semantics or inspect topic files directly beyond the existing setup/upsert surfaces.
- Daemon mode, multi-topic orchestration, and multi-provider automation remain out of scope in this cut.
- `Runner Signal` now lives inside each `*.worker-output.md` as a strict machine-readable `## Runner Signal` section with one fenced `yaml` block. Missing or malformed signal, missing worker artifact writeback, provider failure, or signal/artifact mismatch all fail-close in the provider-backed loop.

### Codex Automation Backend Invocation

Codex automation is now admitted only as a thin backend over the scheduler.

- Required cwd: repository root (`/Users/snwozy/nimi-realm/nimi`)
- Optional preflight command: `pnpm nimi-coding:run-schedule-status -- <absolute-topic-dir>`
- Automation execution command: `pnpm nimi-coding:run-schedule-codex-once -- <absolute-topic-dir>`
- Optional bounded overrides: `--max-steps <n>`, `--timeout-ms <ms>`, `--lease-ttl-ms <ms>`

### Assistant/UI Bridge

For one explicit topic, an assistant or UI can now consume one convenience bridge command instead of separately invoking setup then upsert:

`pnpm nimi-coding:run-schedule-codex-bridge -- <absolute-topic-dir> [--codex-home <path>]`

The returned `codex-automation-bridge-result.v1` keeps the same authority layering:

- `setup_payload_summary` summarizes the one-topic `codex-automation-setup.v1` binding
- `upsert_action` reports `created` or `updated`
- `automation_identity` exposes the stable one-topic automation identity
- `command_binding` repeats the scheduler control surface the automation must invoke

This bridge is convenience only. Scheduler outputs, setup payloads, and upsert results remain authoritative. The bridge does not become a scheduler, packet, acceptance, or finding owner.

Automation should treat outputs this way:

- `run-schedule-status` with `contract=scheduler-preflight.v1` and `eligible=true`: topic is schedulable now.
- `run-schedule-status` or `run-schedule-codex-once` with `ok=false`: structured refusal. Read `refusal.code`, `refusal.message`, and `preflight.scheduler_status`; do not guess from stderr or inspect topic files directly.
- `run-schedule-codex-once` with `ok=true`: scheduler invocation succeeded. Read `loop_summary.stop_reason` to see whether the run stopped at `paused`, `failed`, `completed`, `superseded`, or legacy `awaiting_confirmation`.
- `failed` inside `loop_summary.stop_reason` is still a successful command invocation with a mechanically failed run, not an automation transport failure.

Automation should schedule these commands and consume their JSON output only. It must not become the semantic owner, and it must not redefine stop or retry semantics.

### Codex Automation Setup Surface

For one explicit topic, generate the setup payload from repository root:

```bash
pnpm nimi-coding:run-schedule-codex-setup -- /absolute/path/to/topic
```

The returned `codex-automation-setup.v1` payload makes these binding inputs explicit:

- `target.topic_path`: one explicit topic only
- `execution.cwd`: repository root for the automation instance
- `execution.preflight_command`: exact `run-schedule-status` invocation
- `execution.invoke_command`: exact `run-schedule-codex-once` invocation
- `execution.expected_preflight_contract`: `scheduler-preflight.v1`
- `execution.expected_result_contract`: `scheduler-result.v1`
- `suggested_automation.prompt`: a scheduler-only Codex automation prompt

This setup surface is intentionally narrow. It does not choose schedules, does not scan the repo for topics, and does not allow implicit topic selection. The automation instance must still consume scheduler outputs as its control surface.

### Codex Automation Create / Update

To create or update one Codex automation instance for one explicit topic:

```bash
pnpm nimi-coding:run-schedule-codex-automation-upsert -- /absolute/path/to/topic
```

Defaults for the first cut are intentionally conservative:

- status: `PAUSED`
- schedule: `FREQ=HOURLY;INTERVAL=1`
- model: `gpt-5.4`
- reasoning effort: `high`
- execution environment: `local`
- Codex home: `$CODEX_HOME`, else `~/.codex`

The command writes or updates exactly one automation under the detected Codex automation home and returns `codex-automation-upsert-result.v1` with:

- `action`: `created` or `updated`
- `topic_id` and `topic_target`
- stable `automation.automation_id`
- scheduler command binding copied from setup payload

Automation identity is deterministic for one explicit topic target. Re-running the command for the same topic updates the same automation instead of creating a duplicate.

This cut still does **not** implement fan-out runtime, semantic acceptance automation, finding lifecycle automation, a background daemon, heartbeat/lease renewal, multi-topic orchestration, or multi-provider automation. File-sink, Telegram, and webhook are all narrow adapters over the same handoff surface; none of them is a transport manager or broker.

## Orchestration State Formalization

`*.orchestration-state.yaml` is now a formal topic lifecycle artifact for continuous packet-bound execution.

- It persists the minimum packet-bound mutable run position for `running`, `paused`, `completed`, `failed`, `superseded`, and legacy `awaiting_confirmation`.
- It is routed from `topic.index.yaml` by `orchestration_state_ref` when present.
- It is not runner implementation, notification transport, or resume runtime.
- It does not carry semantic acceptance, final confirmation, or finding lifecycle judgment.

Stateless batch mode remains valid. Current `batch-preflight`, `batch-next-phase`, and `batch-phase-done` continue to operate packet-only. Continuous run is the new stateful orchestration layer built on top of the same frozen packet model.

## Execution Packet Formalization

`*.execution-packet.yaml` is now a formal topic lifecycle artifact.

- It freezes the minimum post-convergence execution surface for bounded autonomous continuation.
- It is routed from `topic.index.yaml` by `execution_packet_ref` when present.
- It is not the autonomous runner itself.
- It does not contain notification transport configuration, runtime state, semantic acceptance outcomes, or finding inference.

Runner implementation is now present as a packet-bound mechanical loop. Narrow notification transports now exist, and the first provider-backed loop cut now exists for `codex exec` only. Fan-out runtime, transport-manager behavior, automation ownership, semantic acceptance automation, and finding lifecycle automation remain intentionally out of scope.

**Batch delivery loop:**

```
# 0. Freeze baseline (manual: set baseline frontmatter status to frozen)
# 1. Check frozen-plan preconditions
pnpm nimi-coding:batch-preflight -- <topic-dir>

# 2. Inspect the next packet-declared phase
pnpm nimi-coding:batch-next-phase -- <topic-dir>

# 3. Generate prompt for this phase
pnpm nimi-coding:prompt-skeleton -- <topic-dir> --phase <name> --goal <text> --output <prompt-path>
# (manager edits prompt, then validates)
pnpm nimi-coding:validate-prompt -- <prompt-path>

# 4. Worker executes, produces output (manual)
pnpm nimi-coding:validate-worker-output -- <worker-output-path>

# 5. Manager writes acceptance (manual or from skeleton)
pnpm nimi-coding:acceptance-skeleton -- --disposition <value> --output <acceptance-path>
# (manager edits acceptance, then validates)
pnpm nimi-coding:validate-acceptance -- <acceptance-path>

# 6. Commit phase completion and inspect next phase / terminal manager closeout
pnpm nimi-coding:batch-phase-done -- <topic-dir> --phase <name> --disposition <value> --acceptance <rel-path> --evidence <rel-path>

# 7. If disposition=partial, redispatch the same frozen phase. If disposition=complete, inspect next phase or finish the terminal run under manager ownership.
```

**Default inline manager-worker loop:**

```bash
# 0. Start one packet-bound run
pnpm nimi-coding:run-start -- <topic-dir>

# 1. Generate the current frozen phase prompt
pnpm nimi-coding:run-next-prompt -- <topic-dir> --output <prompt-path>

# 2. Manager executes the frozen phase against the worker contract and writes output
pnpm nimi-coding:validate-worker-output -- <worker-output-path>

# 3. Manager writes acceptance for this attempt and validates it
pnpm nimi-coding:validate-acceptance -- <acceptance-path>

# 4. Close one attempt
pnpm nimi-coding:run-review -- <topic-dir> --worker-output <worker-output-path> --acceptance <acceptance-path> --disposition <value> [--evidence <rel-path>]

# 5. If disposition=partial, repeat run-next-prompt for the same frozen phase.
#    If disposition=complete, the run advances or completes terminally under manager ownership.
#    If disposition=deferred, the run pauses with explicit human action.
```

**Optional provider-backed loop:**

Use `run-loop-once`, `run-until-blocked`, and the scheduler-backed commands only when the operating context benefits from an external worker process or bounded unattended continuation. These surfaces remain packet-bound and operational only; they do not change manager review semantics or topic authority.

### Reports

```
pnpm nimi-coding:report-hotspots
pnpm nimi-coding:report-structure-hotspots
```

## Minimum Staged-Delivery Loop

A single topic can be driven through a complete lifecycle using CLI commands:

```
# 1. Initialize topic
pnpm nimi-coding:init-topic -- nimi-coding/.local/my-topic

# 2. Author explore doc (manual), then validate
pnpm nimi-coding:validate-doc -- nimi-coding/.local/my-topic/overview.explore.md

# 3. Author baseline doc (manual), set it as active, promote topic
pnpm nimi-coding:set-baseline -- nimi-coding/.local/my-topic methodology.baseline.md
pnpm nimi-coding:set-topic-status -- nimi-coding/.local/my-topic active --reason "Baseline ready"

# 4. Freeze a packet-driven route and start a run or batch loop
pnpm nimi-coding:batch-preflight -- nimi-coding/.local/my-topic

# 5. Generate a prompt for the current frozen phase and execute inline by default
pnpm nimi-coding:run-start -- nimi-coding/.local/my-topic
pnpm nimi-coding:run-next-prompt -- nimi-coding/.local/my-topic

# 6. Manager executes against the worker contract, produces output, validate
pnpm nimi-coding:validate-worker-output -- nimi-coding/.local/my-topic/phase-1.worker-output.md

# 7. Manager writes acceptance for this attempt (manual), validate, and review
pnpm nimi-coding:validate-acceptance -- nimi-coding/.local/my-topic/phase-1.acceptance.md
pnpm nimi-coding:run-review -- nimi-coding/.local/my-topic --worker-output phase-1.worker-output.md --acceptance phase-1.acceptance.md --disposition partial

# 8. If partial, repeat the same frozen phase. Record evidence and findings as needed.
pnpm nimi-coding:attach-evidence -- nimi-coding/.local/my-topic phase-1.evidence.md
pnpm nimi-coding:finding-set-status -- nimi-coding/.local/my-topic F-001 fixed --reason "Resolved" --evidence-ref phase-1.evidence.md

# 9. Optionally close topic with final evidence after terminal manager completion
pnpm nimi-coding:attach-evidence -- nimi-coding/.local/my-topic final.evidence.md --final
pnpm nimi-coding:run-confirm -- nimi-coding/.local/my-topic --final-evidence final.evidence.md
```

Content authoring remains manual. Markdown docs cover explore/baseline/evidence/prompt/worker-output/acceptance; execution packets are typed YAML artifacts. The CLI handles topic routing, status transitions, and validation.

## Promotion Rules

Only promoted, reusable, decision-complete assets belong in this module:

- Stable contracts
- Reusable schemas and protocol units
- Reusable validators and helpers
- Self-hosting samples

Active research, audit notes, and trial topics stay in `nimi-coding/.local/**` until they meet the promotion requirements in `gates/promotion-policy.yaml`.
