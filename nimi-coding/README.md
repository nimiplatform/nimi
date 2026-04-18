# @nimiplatform/nimi-coding

`@nimiplatform/nimi-coding` is the standalone host-agnostic boundary package
for the Nimi Coding methodology.

The product goal is to let arbitrary projects install a reusable AI coding
governance toolkit, bootstrap a project-local `.nimi/**` layer, and then use
AI-native authority, packet, and acceptance discipline for high-risk work.

## Primary Path

The primary `nimicoding` path is for an ordinary project with mixed inputs:

1. gather code/docs/structure/human notes
2. hand off `spec_reconstruction` to an external host
3. generate a canonical tree under `/.nimi/spec/**`
4. run `validate-spec-tree`
5. run `validate-spec-audit`
6. close out reconstruction
7. hand off `doc_spec_audit` and close it out locally

`blueprint-audit`, benchmark parity, and direct-copy helpers remain available,
but they are support-only or repo-local special cases. They do not define
default reconstruction completion.

In this monorepo, `/.nimi/spec/**` is now the repo-wide product authority.
Pre-cutover authority history now lives in Git rather than a repo-local
archive tree. Pre-cutover readiness work was evidence only and did not
authorize the flip by itself.

## Current Status

This repository is boundary-complete for its intended standalone scope.

Its completed standalone scope is:

- package identity
- repository foundation
- initial AI-native methodology seed
- package-owned repo-local support profile source for future governance slices
- machine-readable reconstruction, doc-spec-audit, and high-risk execution result contracts
- package-owned canonical high-risk admission schema contract
- seed-only high-risk execution schemas for packet, orchestration-state, prompt, worker-output, and acceptance
- vendor-neutral external host-profile seed
- package-owned external host compatibility contract seed
- host-adapter seed for constrained external execution-host interop
- package-owned admitted host-profile overlay seed for `oh_my_codex`
- package-owned external execution artifact landing-path contract seed
- vendor-neutral external delegated skill runtime contract seed
- vendor-neutral delegated skill installer seed
- fail-closed delegated skill installer result-contract seed
- local-only installer operational evidence-home seed
- fail-closed collapsed installer summary projection lifecycle-contract seed
- package-owned bootstrap source under `config/**`, `contracts/**`, `methodology/**`, and `spec/**`
- a bounded standalone CLI with staged `start`, validation, handoff, local closeout projection, explicit admission, and mechanical execution-artifact validation
- a host-agnostic semantic + interop boundary for external AI hosts such as OMX, Codex, Claude, Gemini, or another contract-observing host

It intentionally defers:

- packet-bound run kernel
- provider-backed execution
- scheduler, notification, and automation backend surfaces
- self-hosted methodology execution

## CLI Status

This repository now carries a boundary-complete standalone `nimicoding` CLI.

At the current stage it provides:

- executable package bin wiring
- help and version output
- a primary `nimicoding start` entrypoint for bootstrap, resume, and next-stage AI task prep
- a conservative `nimicoding clear` entrypoint for removing package-managed setup without deleting project-owned truth
- a bounded `nimicoding doctor`
- an explicit `nimicoding blueprint-audit` equivalence check for comparing a repo-local blueprint root with the candidate canonical tree under `.nimi/spec`
- a repo-local `pnpm check:spec-authority-cutover-readiness` gate for pre-cutover readiness validation before authority execution
- an explicit `nimicoding handoff` export
- an explicit `nimicoding admit-high-risk-decision` semantic admission surface
- a local-only `nimicoding closeout` projection
- a bounded local-only `nimicoding ingest-high-risk-execution` projection
- a bounded local-only `nimicoding review-high-risk-execution` projection
- a bounded local-only `nimicoding decide-high-risk-execution` projection
- mechanical validators for execution-packet, orchestration-state, prompt, worker-output, and acceptance
- skill-specific result contract seeding for reconstruction, doc/spec audit, and local-only high-risk execution closeout
- seed-only execution contract extraction under `.nimi/contracts/**`
- package-owned bootstrap source projection from `config/**`, `contracts/**`, `methodology/**`, and `spec/**`

Current `nimicoding start` behavior is intentionally narrow:

- detect the current project state and continue from the right stage
- create or resume the `.nimi/**` seed by projecting package-owned source into host paths
- seed AI-native spec-reconstruction guidance inside `.nimi/**`
- keep repo-local support-only methodology assets package-owned unless a host explicitly opts into them
- seed package-owned machine contracts inside `.nimi/contracts/**`
- seed package-owned execution schemas for future high-risk methodology artifacts without admitting runtime ownership
- seed canonical skill-manifest, host-profile, installer, delegated runtime contract, installer result contract, installer operational evidence home, and external handoff truth inside `.nimi/**`
- seed canonical host-adapter truth inside `.nimi/**` so external execution hosts can be admitted without becoming semantic owners
- seed canonical collapsed installer summary projection lifecycle truth inside `.nimi/**`
- update `.gitignore` for local runtime state
- optionally update `AGENTS.md` and `CLAUDE.md` as a staged confirmation inside `start`
- explain one step at a time, confirm one step at a time, and apply one step at a time in interactive mode
- prepare one authoritative JSON AI task package for `spec_reconstruction` or `doc_spec_audit` when the current project stage requires it
- let the user choose a target host such as Codex, Claude, or oh-my-codex for that next AI task
- print a short paste-ready prompt directly in the terminal during `start` instead of requiring users to open a generated prompt file
- fail closed on unknown CLI options
- validate bootstrap integrity and delegated-runtime posture with `doctor`
- preserve existing truth files rather than overwriting them
- refuse unsupported bootstrap contract versions

Current `nimicoding clear` behavior is intentionally narrow:

- remove only managed AI blocks in `AGENTS.md` and `CLAUDE.md`
- remove only package-owned bootstrap files under `.nimi/config/**`, `.nimi/contracts/**`, and `.nimi/methodology/**` when the local file still exactly matches the packaged seed
- preserve locally modified bootstrap files even when they live under those package-owned bootstrap paths
- preserve `.nimi/spec/**`, `.nimi/local/**`, and `.nimi/cache/**`
- avoid deleting project-owned truth or local operational artifacts implicitly

## Topic Lifecycle Reports

Human-authored local report work now uses a topic lifecycle workspace rooted at:

- `/.nimi/local/report/**`

Canonical topic lifecycle roots are:

- `proposal`
- `ongoing`
- `pending`
- `closed`

The primary organization unit is a topic folder:

- `.nimi/local/report/<state>/YYYY-MM-DD-topic-slug/`

Each topic folder should carry a lightweight `topic.yaml` state record and may
include:

- `README.md`
- `design.md`
- `preflight.md`
- `waves.md`
- `packet-*.md`
- `closeout.md`

Topic folder rules:

- use sortable date-first topic ids: `YYYY-MM-DD-topic-slug`
- express lifecycle by moving the topic folder between `proposal`, `ongoing`,
  `pending`, and `closed`
- keep one canonical copy of a topic at a time
- record lifecycle transitions in `topic.yaml`; do not rely on folder moves
  alone as the state evidence surface

Canonical constraints:

- human-authored topic lifecycle reports must use
  `/.nimi/local/report/{proposal|ongoing|pending|closed}/<topic-id>/**`
- flat markdown files directly under `/.nimi/local/report/` are outside the
  admitted methodology model
- `.local/report/**` is not an accepted root for human-authored topic
  lifecycle reports; keep it only for execution evidence or machine outputs
- `.local/work/**` is no longer the primary methodology workspace for
  human-authored topic execution materials

Development rhythm:

- a topic is the canonical home for one major iteration line, not a micro
  requirement backlog
- waves are the bounded execution unit inside a topic
- entering `ongoing` requires a topic-local `preflight.md` with one selected
  next execution target, a bounded stop line, consumed inputs/contexts, expected
  closeout checks, and explicit forbidden reopenings
- `pending` is an optional no-active-development state for topics that are not
  ready to close: use it when you want to distinguish "waiting on evidence or
  an external trigger" from active `ongoing` work, and record explicit reopen
  or close criteria instead of leaving that wait implicit
- each wave should own one primary closure goal and end in a bounded result such
  as an authority cut, implementation packet, bounded re-audit, or explicit
  pause/defer note
- planning-only waves may harden one execution target, but they must not chain
  indefinitely; if no bounded closure is reached after a planning wave, pause or
  re-preflight instead of opening unbounded new planning waves
- closeout stays layered: context closure, wave closeout, and final topic
  closeout are distinct evidence surfaces

Avoid the older `slug-YYYY-MM-DD.md` shape because it sorts poorly and makes
cross-report navigation harder. Stable machine report artifacts that are meant
to behave like a current snapshot, such as `blueprint-equivalence-audit.json`,
should keep their fixed names.

## Canonical Spec Redesign Prep

The package now seeds Phase 0 / Phase 1 canonical-spec redesign contracts under
`.nimi/spec/_meta/**` together with rewritten `bootstrap-state.yaml` and
`product-scope.yaml`.

At this stage:

- these files are machine contracts and implementation authority for canonical spec generation
- active repository authority now lives under `/.nimi/spec/**`
- `start`, `doctor`, `handoff`, `closeout`, and high-risk gating already read the canonical tree lifecycle instead of treating the old five-file compact model as authoritative completion
- `nimicoding blueprint-audit` remains the explicit audit surface for benchmark-vs-canonical equivalence checks; it does not perform routing changes on its own
- `pnpm check:spec-authority-cutover-readiness` remains a pre-cutover readiness aggregator; after cutover it is historical/preflight-only rather than the active authority source
- canonical spec generation now reads mixed inputs from `.nimi/config/spec-generation-inputs.yaml` and treats any blueprint root as an optional benchmark rather than a universal host assumption
- completed canonical reconstruction now requires both structural validity and file-level auditability under `.nimi/spec/_meta/spec-generation-audit.yaml`
- `nimicoding validate-spec-tree` checks canonical tree structure, while `nimicoding validate-spec-audit` checks per-file grounding, inference, and unresolved-gap tracking

Current `nimicoding doctor` behavior is intentionally narrow:

- validate that `.nimi/**` bootstrap seed files are present
- validate that `.nimi/local/` and `.nimi/cache/` exist and remain ignored
- validate bootstrap contract compatibility metadata
- validate bootstrap-only and reconstruction-seeded lifecycle markers
- validate cross-contract reference alignment across manifest, handoff, runtime, installer, and host-profile truth
- validate host-adapter boundary truth and adapter selection posture
- validate admitted package-owned adapter profile overlays for named external hosts
- validate the packaged external host compatibility contract
- expose the supported external host posture, examples, and required/forbidden host behavior
- validate skill result-contract alignment
- validate the packaged high-risk execution result contract
- validate the packaged canonical high-risk admission schema contract
- validate the external execution artifact landing-path contract
- validate seed-only high-risk execution schemas under `.nimi/contracts/**`
- validate handoff context-order readiness for an external AI host
- expose the standalone completion profile, status, completed surfaces, deferred execution surfaces, and promoted parity gaps
- expose the generic external-host compatibility posture, admitted named overlay posture, and future-only host-specific surfaces
- validate canonical `.nimi/spec/high-risk-admissions.yaml` record shape against the packaged admission schema contract when present
- fail closed when lifecycle state, canonical tree readiness, and auditability drift apart
- report local `doc_spec_audit` closeout artifact status without promoting it to semantic truth
- emit either human-readable output or machine-readable JSON with `--json`

Current `nimicoding handoff` behavior is intentionally narrow:

- require explicit `--skill <skill-id>`
- export an authoritative machine-readable external handoff payload with `--json`
- optionally project a human-readable host briefing with `--prompt`
- remain host-agnostic: Claude, Codex, Gemini, OMX, or another external host may consume the same contract if it respects the declared boundaries
- export the package-owned host compatibility contract ref, supported host posture, supported host examples, and required/forbidden host behavior
- expose whether a generic external host is compatible, whether a named admitted overlay is merely available or currently selected, and which host-specific surfaces remain future-only
- reuse `doctor` validation and fail closed when bootstrap or delegated handoff posture is invalid
- allow `spec_reconstruction` handoff during bootstrap-only mode
- expose selected named adapter overlay metadata when an admitted host profile is selected
- export `resultContractRef` plus skill-specific closeout summary expectations
- export execution schema refs, expected artifact kinds, expected local artifact roots, and external execution summary status for `high_risk_execution`
- refuse `doc_spec_audit` and `high_risk_execution` handoff until the canonical tree under `.nimi/spec` is ready

Current `nimicoding closeout` behavior is intentionally narrow:

- require explicit `--skill`, `--outcome`, and `--verified-at`
- optionally import those fields plus an optional contract-validated `summary` from an external JSON payload with `--from`
- project external skill results into a local-only closeout payload
- optionally write the payload under `.nimi/local/handoff-results/` with `--write-local`
- fail closed if a `completed` outcome contradicts the current canonical-tree or audit state
- support contract-validated local-only summary import for `high_risk_execution`
- fail closed if imported high-risk execution refs escape the declared local artifact roots
- fail closed if imported high-risk execution summaries omit refs, drift in shape, or claim an illegal external execution status
- fail closed if imported `summary` content violates the declared skill result contract
- fail closed if an imported JSON summary does not match the current project or required shape
- never promote local closeout artifacts to project semantic truth

Current `nimicoding admit-high-risk-decision` behavior is intentionally narrow:

- require explicit `--from <json>` and `--admitted-at <iso8601>`
- accept only `nimicoding.high-risk-decision.v1` payloads with `decisionStatus: manager_decision_recorded`
- derive `topic_id` and `packet_id` from the mechanically valid attached packet
- project canonical admission preview for `.nimi/spec/high-risk-admissions.yaml`
- write tracked semantic truth only when `--write-spec` is given explicitly
- fail closed on malformed decision payloads, malformed admissions truth, or missing packet identity

Current `nimicoding ingest-high-risk-execution` behavior is intentionally narrow:

- require explicit `--from <json>` pointing at a local high-risk closeout artifact
- accept only `high_risk_execution` closeout artifacts with `outcome: completed` and `summary.status: candidate_ready`
- mechanically validate the referenced packet, orchestration-state, prompt, and worker-output artifacts using the packaged validators
- require all evidence refs to exist under the declared local artifact roots
- project a local-only ingest payload and optionally write it under `.nimi/local/handoff-results/`
- fail closed on contract drift, root escape, missing artifacts, or invalid worker-output/prompt/schema shape
- never decide semantic acceptance, disposition, or finding judgment

Current `nimicoding review-high-risk-execution` behavior is intentionally narrow:

- require explicit `--from <json>` pointing at a local high-risk ingest artifact
- accept only `nimicoding.high-risk-ingest.v1` payloads with `ok: true`
- project a local-only review-ready attachment payload for manager-owned review
- carry attachment refs, ingest validation evidence, and the declared semantic review owner
- fail closed if the ingest payload is malformed, not local-only, or mechanically invalid
- never decide semantic acceptance, disposition, or finding judgment

Current `nimicoding decide-high-risk-execution` behavior is intentionally narrow:

- require explicit `--from <json>`, `--acceptance <path>`, and `--verified-at <iso8601>`
- accept only `nimicoding.high-risk-review.v1` payloads with `ok: true`
- require `reviewStatus: ready_for_manager_review`
- mechanically validate the provided acceptance artifact and require an explicit `Disposition:` line
- project a local-only manager decision payload and optionally write it under `.nimi/local/handoff-results/`
- fail closed if the review payload is malformed, not local-only, or points at another project
- never auto-promote the manager decision into canonical semantic truth without explicit admission

Current mechanical validator behavior is intentionally narrow:

- require an explicit artifact path for each validator command
- emit machine-readable `validator-cli-result.v1` JSON on both success and refusal
- validate only the package-owned seed contract shape for execution-packet, orchestration-state, prompt, worker-output, and acceptance
- fail closed on missing required sections, malformed YAML, or seed-contract drift
- avoid semantic acceptance, topic orchestration, scheduler ownership, or provider execution claims

The package now carries package-owned bootstrap source under `config/**`,
`contracts/**`, `methodology/**`, and `spec/**`. `nimicoding start`
projects those files into a host project's `/.nimi/**`
surface at runtime. The package also carries adapter overlays under
`adapters/**/profile.yaml` so external execution hosts such as
`oh-my-codex` can be admitted as constrained bridges instead of semantic
owners while keeping external execution closeout local-only, root-bounded,
and non-semantic until an explicit manager-owned admission writes canonical
summary truth into `.nimi/spec/high-risk-admissions.yaml`.

Boundary-complete in this package does not mean promoted-runtime parity. The
package-owned source lives directly under `config/**`, `contracts/**`,
`methodology/**`, and `spec/**`. Only generated or adopted host projects use
`.nimi/**`. Standalone does not add `run-*` commands, provider invocation,
scheduler logic, or transport adapters in this cut.

## Intended Direction

The expected future experience is roughly:

1. install `@nimiplatform/nimi-coding`
2. run `nimicoding start`
3. confirm or accept managed AI entrypoints
4. let an external AI host use seeded `.nimi/**` reconstruction guidance, manifest, host-profile, installer, delegated runtime contract, installer result contract, collapsed installer summary projection lifecycle contract, installer operational evidence guidance, and the authoritative handoff JSON contract to
   reconstruct the project canonical tree
5. use the methodology for later high-risk work

## Development Posture

This repository is the standalone boundary package. Deferred runtime surfaces
such as packet-bound execution, provider-backed execution, scheduler,
notification, and automation remain outside the packaged scope.
