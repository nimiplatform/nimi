# CLI Commands

Field-level reference for the `nimicoding` 0.2.1 CLI. For the
concept-level overview see [CLI Surface](/nimicoding/cli).

## Bootstrap And Sync

| Command | Purpose |
| --- | --- |
| `nimicoding start` | Bootstrap or resume project-local `.nimi/**` |
| `nimicoding start --yes` | Run the non-interactive bootstrap path |
| `nimicoding start --host {host}` | Bootstrap with a host-targeted prompt |
| `nimicoding clear --yes` | Remove managed AI blocks and package-owned bootstrap files that still match the packaged seed |
| `nimicoding sync --check` | Refuse on package-canonical seed drift or missing seed entries |
| `nimicoding sync --apply` | Reproject package-canonical seed entries |
| `nimicoding sync --dry-run` | Show sync changes without applying them |
| `nimicoding doctor --json` | Emit machine-readable bootstrap and contract health |
| `nimicoding doctor --verbose` | Include internal contract detail |

`clear` preserves `.nimi/spec/**`, `.nimi/local/**`, `.nimi/cache/**`,
and locally modified bootstrap files.

## Skill Handoff And Closeout

| Command | Purpose |
| --- | --- |
| `nimicoding handoff --skill {skill-id} --json` | Emit an authoritative machine-readable payload |
| `nimicoding handoff --skill {skill-id} --prompt` | Emit a human-readable host briefing and local refs |
| `nimicoding closeout --skill {skill-id} --outcome {outcome} --verified-at {iso8601}` | Record a skill closeout |
| `nimicoding closeout --from {json} --write-local` | Import a typed result and write local closeout evidence |

Valid skill ids are `spec_reconstruction`, `doc_spec_audit`,
`audit_sweep`, and `high_risk_execution`.

## Topic Lifecycle

| Command | Purpose |
| --- | --- |
| `nimicoding topic create {slug} --justification {text} [--title {text}] [--json]` | Create a proposal topic |
| `nimicoding topic status [{topic-ref}] [--json]` | Show topic state |
| `nimicoding topic validate [{topic-ref}] [--json]` | Validate topic shape |
| `nimicoding topic validate graph {topic-id} [--json]` | Validate wave graph consistency |
| `nimicoding topic validate admission {topic-id} {wave-id} [--json]` | Validate admission readiness |
| `nimicoding topic wave add {topic-id} {wave-id} {slug} --goal {text} --owner-domain {text} [--dep {wave-id}] [--json]` | Add a wave |
| `nimicoding topic wave select {topic-id} {wave-id} [--json]` | Select the next wave target |
| `nimicoding topic wave admit {topic-id} {wave-id} [--json]` | Admit a selected wave |
| `nimicoding topic packet freeze {topic-id} --from {draft-path} [--json]` | Validate and freeze a packet artifact |
| `nimicoding topic worker dispatch {topic-id} --packet {packet-id} [--json]` | Dispatch a frozen packet to worker state |
| `nimicoding topic audit dispatch {topic-id} --packet {packet-id} [--json]` | Dispatch authority or audit review for a packet |
| `nimicoding topic result record {topic-id} --kind {result-kind} --verdict {result-verdict} --from {path} --verified-at {iso8601} [--json]` | Record typed evidence |
| `nimicoding topic remediation open {topic-id} --kind {remediation-kind} --reason {token} [--overflowed-packet {packet-id}] [--json]` | Open remediation |
| `nimicoding topic overflow continue {topic-id} --packet {continuation-packet-id} --overflowed-packet {packet-id} --manager-judgement {text} --same-owner-domain [--json]` | Continue an overflowed packet |
| `nimicoding topic hold {topic-id} --reason {token} --summary {text} [--reopen-criteria {text}] [--close-trigger {text}] [--json]` | Move a topic to pending |
| `nimicoding topic resume {topic-id} --criteria-met {text} [--json]` | Resume a pending topic |
| `nimicoding topic validate closure {topic-id} {wave-id} [--json]` | Validate closure readiness |
| `nimicoding topic closeout wave {topic-id} {wave-id} --authority {closure-state} --semantic {closure-state} --consumer {closure-state} --drift-resistance {closure-state} --disposition {closeout-disposition} [--json]` | Record wave closure |
| `nimicoding topic true-close-audit {topic-id} --judgement {text} [--json]` | Run the topic-level true-close gate |
| `nimicoding topic closeout topic {topic-id} --authority {closure-state} --semantic {closure-state} --consumer {closure-state} --drift-resistance {closure-state} --disposition {closeout-disposition} [--json]` | Record topic closure |
| `nimicoding topic decision-review {topic-id} {slug} --decision {text} --replaced-scope {text} --active-replacement-scope {text} [--disposition {decision-disposition}] [--target-wave {wave-id}] [--date {YYYY-MM-DD}] [--json]` | Record a manager decision review |

Topic result timestamps use UTC seconds precision, such as
`2026-05-06T16:47:20Z`.

## Topic Runner

| Command | Purpose |
| --- | --- |
| `nimicoding topic run-next-step {topic-id} [--json]` | Compute the next typed lifecycle decision |
| `nimicoding topic run-ledger {ledger-action} {topic-id} --run-id {id} [--json]` | Maintain the run ledger |
| `nimicoding topic-runner step {topic-id} --run-id {id} --adapter {adapter} [--execute-host] [--json]` | Run one governed step |
| `nimicoding topic-runner run {topic-id} --run-id {id} --adapter {adapter} [--execute-host] [--json]` | Run repeated governed steps |

For repeated work, prefer `topic-runner step` or `topic-runner run`
over manually chaining `topic run-ledger record` primitives.

## Sweep Audit

| Command | Purpose |
| --- | --- |
| `nimicoding sweep audit plan --root {dir} [--criteria {csv}] [--exclude {csv}] [--max-files {n}] [--sweep-id {id}] [--json]` | Build an audit plan and chunk files |
| `nimicoding sweep audit chunk dispatch --sweep-id {id} --chunk-id {chunk-id} --dispatched-at {iso8601} [--auditor {id}] [--json]` | Dispatch one chunk |
| `nimicoding sweep audit chunk audit-codex --sweep-id {id} --chunk-id {chunk-id} --dispatched-at {iso8601} --verified-at {iso8601} --reviewed-at {iso8601} [--from-raw-output {ref}] [--timeout-ms {ms}] [--json]` | Run the Codex adapter chunk-audit path |
| `nimicoding sweep audit chunk ingest --sweep-id {id} --chunk-id {chunk-id} --from {json} --verified-at {iso8601} [--json]` | Ingest auditor evidence |
| `nimicoding sweep audit chunk review --sweep-id {id} --chunk-id {chunk-id} --verdict {review-verdict} --reviewed-at {iso8601} [--summary {text}] [--json]` | Record manager review |
| `nimicoding sweep audit chunk skip --sweep-id {id} --chunk-id {chunk-id} --reason {text} --skipped-at {iso8601} [--json]` | Skip a chunk with explicit reason |
| `nimicoding sweep audit ledger build --sweep-id {id} [--verified-at {iso8601}] [--json]` | Build an immutable ledger snapshot |
| `nimicoding sweep audit remediation-map build --sweep-id {id} [--max-findings {n}] [--verified-at {iso8601}] [--json]` | Build a candidate remediation map |
| `nimicoding sweep audit finding resolve --sweep-id {id} --finding-id {id} --disposition {finding-disposition} --from {json} --verified-at {iso8601} [--json]` | Record resolution evidence |
| `nimicoding sweep audit closeout summary --sweep-id {id} --verified-at {iso8601} [--json]` | Build local-only closeout summary |
| `nimicoding sweep audit status --sweep-id {id} [--json]` | Report sweep state |

Sweep-audit timestamps use full JavaScript ISO UTC shape with
milliseconds, such as `2026-05-06T16:47:20.705Z`.

## Sweep Design

| Command | Purpose |
| --- | --- |
| `nimicoding sweep design intake --sweep-id {id} [--run-id {id}] [--json]` | Fork findings into a design workset |
| `nimicoding sweep design packet-build --run-id {id} --packet-id {id} (--finding-id {id} or --finding-ids {csv}) [--explicit-question {text}] [--prior-design-state-refs {csv}] [--prior-design-state-marker {state}] [--current-cluster-refs {csv}] [--current-wave-refs {csv}] [--authority-only] [--json]` | Build one design-auditor packet |
| `nimicoding sweep design packet-build-batch --run-id {id} --batch-size {n} [--finding-ids {csv}] [--packet-prefix {id}] [--manifest-id {id}] [--explicit-question {text}] [--json]` | Build a batch manifest |
| `nimicoding sweep design auditor-prompt --run-id {id} --packet-id {id} [--json]` | Emit a host prompt for a design packet |
| `nimicoding sweep design result-ingest --run-id {id} --from {yaml} [--mode {mode}] [--json]` | Ingest typed design-auditor result |
| `nimicoding sweep design ledger-validate --run-id {id} [--json]` | Validate revision-ledger provenance |
| `nimicoding sweep design finalize --run-id {id} [--json]` | Emit final local design state |
| `nimicoding sweep design wave-plan --run-id {id} --topic-id {id} [--json]` | Emit candidate topic-wave commands |
| `nimicoding sweep design fix-topic --run-id {id} [--slug {slug}] [--title {title}] [--admit-first-wave or --admit-wave-id {id}] [--json]` | Apply a validated wave plan to a topic |

## High-Risk Execution Gates

| Command | Accepts |
| --- | --- |
| `nimicoding admit-high-risk-decision --from {json} --admitted-at {iso8601} [--json] [--write-spec]` | `nimicoding.high-risk-decision.v1` payloads with `decisionStatus: manager_decision_recorded` |
| `nimicoding ingest-high-risk-execution --from {json} [--json] [--write-local]` | `high_risk_execution` closeout artifacts with `outcome: completed` and `summary.status: candidate_ready` |
| `nimicoding review-high-risk-execution --from {json} [--json] [--write-local]` | Valid high-risk ingest payloads |
| `nimicoding decide-high-risk-execution --from {json} --acceptance {path} --verified-at {iso8601} [--json] [--write-local]` | Review payload plus acceptance artifact with explicit `Disposition:` line |

## Spec And Governance Validators

| Command | Purpose |
| --- | --- |
| `nimicoding validate-spec-tree [.nimi/spec]` | Validate canonical tree structure |
| `nimicoding validate-spec-audit [.nimi/local/state/spec-generation/spec-generation-audit.yaml]` | Validate file-level source evidence, inference, and unresolved-gap tracking |
| `nimicoding validate-spec-governance --profile {profile-id} --scope {scope}` | Validate configured spec governance scope |
| `nimicoding classify-spec-tree --profile {profile-id} --root .nimi/spec [--emit {path}] [--json]` | Classify spec surface entries |
| `nimicoding generate-spec-migration-plan --profile {profile-id} --root .nimi/spec --emit .nimi/local/state/spec-surface/migration-plan.json [--json]` | Emit migration plan |
| `nimicoding validate-placement --profile {profile-id} --root .nimi/spec [--json]` | Validate placement contracts |
| `nimicoding validate-table-family --profile {profile-id} --root .nimi/spec [--json]` | Validate table-family contracts |
| `nimicoding validate-projection-edges --profile {profile-id} --root .nimi/spec [--json]` | Validate projection edge contracts |
| `nimicoding validate-guidance-bodies --profile {profile-id} --root .nimi/spec [--json]` | Validate guidance body shape |
| `nimicoding validate-domain-admission --profile {profile-id} --root .nimi/spec [--json]` | Validate domain admission records |
| `nimicoding validate-tracked-output-admission --profile {profile-id} --root .nimi/spec [--json]` | Validate tracked-output admission |
| `nimicoding generate-spec-derived-docs --profile {profile-id} --scope {scope} [--check]` | Generate or check derived docs |
| `nimicoding validate-ai-governance --profile {profile-id} --scope {scope}` | Validate AI governance constraints |
| `nimicoding blueprint-audit [--blueprint-root {path}] [--canonical-root {path}] [--json] [--write-local]` | Compare blueprint and canonical spec roots |

## Mechanical Artifact Validators

| Command | Validates |
| --- | --- |
| `nimicoding validate-execution-packet {path}` | Frozen execution packet shape |
| `nimicoding validate-orchestration-state {path}` | Orchestration state record |
| `nimicoding validate-prompt {path}` | Prompt payload |
| `nimicoding validate-worker-output {path}` | Worker output shape |
| `nimicoding validate-acceptance {path}` | Acceptance evidence |

## Source Basis

- [`nimi-coding/cli/help.mjs`](https://github.com/nimiplatform/nimi-coding/blob/main/cli/help.mjs)
- [`nimi-coding/cli/index.mjs`](https://github.com/nimiplatform/nimi-coding/blob/main/cli/index.mjs)
- [`nimi-coding/README.md`](https://github.com/nimiplatform/nimi-coding/blob/main/README.md)
- [`nimi-coding/contracts/topic.schema.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/topic.schema.yaml)
- [`nimi-coding/contracts/packet.schema.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/packet.schema.yaml)
- [`nimi-coding/contracts/audit-plan.schema.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/audit-plan.schema.yaml)
- [`nimi-coding/contracts/sweep-design-result.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/sweep-design-result.yaml)
- [`nimi-coding/contracts/topic-step-decision.schema.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/topic-step-decision.schema.yaml)
