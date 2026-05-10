# Release Gate Contract

> Owner Domain: `P-RELG-*`

This contract is the operational refinement of the release-related
rules in `governance-contract.md` (`P-GOV-003`, `P-GOV-011`,
`P-GOV-021`, `P-GOV-023`). Every `P-RELG-*` rule cites at least one
parent `P-GOV-*` anchor; no `P-RELG-*` rule introduces parallel
release authority. Implementation surfaces (release preflight, lint
chain, CI/release workflow step blocks) are projections of a single
release-gate registry governed by these rules.

## P-RELG-001 — Single Registry Truth

Refines: `P-GOV-003`, `P-GOV-023`.

`MUST`: Release gate identity (id, command, tier, target,
prerequisites, evidence shape, blocker semantics) lives in
`.nimi/spec/platform/kernel/tables/release-gate-registry.yaml` and
nowhere else.

`MUST`: No release gate may be invoked from `scripts/release-preflight.mjs`,
`pnpm lint`, or any `.github/workflows/*.yml` step block without a
row in this registry.

`MUST`: No registry row may exist without at least one downstream
consumer projection.

## P-RELG-002 — P-GOV Inheritance, No Parallel Authority

Refines: `P-GOV-023`.

`MUST`: Every `P-RELG-*` rule cites at least one `P-GOV-*` parent
anchor in its body. A `P-RELG-*` rule that conflicts with its
parent is invalid. The release-gate contract is operational
refinement of governance, not a separate authority.

## P-RELG-003 — Projection-Only Execution Surfaces

Refines: `P-GOV-003`, `P-GOV-021`.

`MUST`: `scripts/release-preflight.mjs`, the body of `pnpm lint` in
`package.json`, and any CI workflow marker-fenced step block are
projections of the registry. Each projection surface must be
reproducible by a deterministic generator.

`MUST NOT`: hand-edit a projection surface. The editor must edit
the registry and re-run the generator. The drift checker
(`gate.release-gate.projection-drift`) enforces this by
byte-comparing fence content to projected output.

## P-RELG-004 — Locked Evidence JSON Shape

Refines: `P-GOV-003`.

`MUST`: Preflight emits a single `preflight-evidence.json` document
per run, conforming to schema `release-gate-evidence/v1`:

```
{
  schema_version: "release-gate-evidence/v1",
  profile_id, registry_version, started_at, finished_at,
  host_environment, target_filter, tier_filter,
  gates: [{ gate_id, tier, target, command, started_at, finished_at,
            verdict, blocker_reason_code, exit_code, log_excerpt_path }],
  summary: { pass_count, fail_count, blocked_count, unreachable_count }
}
```

`SHOULD`: Document is ingestible by `nimicoding topic result record
--kind preflight --from <path>`.

`MUST`: Schema field rename or removal is breaking and requires a
contract revision plus downstream consumer migration. Schema field
additions are non-breaking and require a `schema_version` minor
bump.

## P-RELG-005 — Verdict Set Locked

Refines: `P-GOV-003`.

`MUST`: A gate verdict is exactly one of
`pass | fail | blocked | unreachable`.

- `pass` — command executed, exit 0
- `fail` — command executed, exit non-zero (or timed out)
- `blocked` — command not attempted; environment cannot satisfy
  declared requirements
- `unreachable` — prerequisite gate did not pass; this gate skipped
  to avoid cascade noise

`MUST NOT`: introduce verdicts such as `warn`, `partial`, `info`,
`skipped`, or `pending`.

## P-RELG-006 — Fail-Closed For Live, Secret, External-Repo

Refines: `P-GOV-011`.

`MUST`: When a registry row declares `requires_secrets`,
`requires_external_repo`, or `tier: live`, and the runtime
environment cannot satisfy the requirement, the gate emits
`blocked` with a typed `blocker_reason_code` (`SECRETS_MISSING`,
`EXTERNAL_REPO_UNAVAILABLE`, `LIVE_PROVIDER_UNAVAILABLE`). It does
NOT emit `pass`.

`MUST`: Preflight invocation with `--require-release` treats
`blocked` as `fail` for summary purposes. Preflight invocation
without that flag (local-developer mode) permits `blocked`.

`MUST`: CI invocation in any release-blocking job runs preflight
with `--require-release`.

## P-RELG-007 — No Pseudo-Success On Stable Paths

Refines: `P-GOV-003`, `P-GOV-011`.

`MUST`: A gate that fails because of a transient condition emits
`fail` or `blocked` with a typed reason code. It MUST NOT emit
`pass`. Specifically:

- a Go binary not on PATH emits `blocked` with `BINARY_MISSING`
  (or `fail` if `blocker_semantics.on_binary_missing: fail` for a
  release-blocking row; coherence checker enforces consistency)
- a command timeout emits `fail` with `TIMEOUT`
- a tier-filter exclusion omits the gate from `gates[]` rather than
  emitting any verdict

## P-RELG-008 — Owner Namespace Allow-List

Refines: `P-GOV-023`. The `<owner>` segment of every gate id is the
operational mechanism that prevents an app or workspace from
declaring a release-gate identity outside the platform-managed
namespace; this is the same property `P-GOV-023` governs at the
rule level.

`MUST`: The `<owner>` segment of `gate.id` is drawn from a locked
allow-list:
`runtime`, `proto`, `sdk`, `desktop`, `web`, `cargo`, `nimicoding`,
`spec-governance`, `docs`, `security`, `workflow`, `release-gate`,
`platform-hardcut`, `runtime-provider`, `runtime-mod`, `realm`,
`cognition`, `ui`, `live`, `dev-loop`.

`MUST`: Adding to the allow-list requires editing the coherence
checker AND a `decision-review-*.md`.

## P-RELG-009 — Drift Gate Self-Bootstrap

Refines: `P-GOV-003`.

`MUST`: `gate.release-gate.registry-coherence` and
`gate.release-gate.projection-drift` are themselves registry rows
with `tier: [fast, release]`.

The bootstrap order is locked as: registry data and the coherence
checker land first; the consumer projections (preflight, lint
chain, CI fences) wire the checker rows into fast tier afterward.
From that point onward, registry edits are protected by gates
generated from the registry.

`MUST`: The coherence checker's own row is exempt from coherence
pre-check. This exception is locked here, not in code.

## P-RELG-010 — Owner Of `.github/**` Step Block Codegen

Refines: `P-GOV-021`, `P-GOV-023`.

`MUST`: A CI workflow file that contains a marker-fenced step block
generated from the registry MUST declare the fence boundary
explicitly:

```yaml
      # >>> nimi-release-gate-projection: <projection-key> >>>
      ... generated steps ...
      # <<< nimi-release-gate-projection: <projection-key> <<<
```

The drift checker reads each fence's `projection-key`, looks up the
corresponding registry projection, and byte-compares the fenced
content to the projected output. Hand-edits inside a fence are a
projection-drift `fail`.

`MUST`: Job-level orchestration (matrix, secrets, runs-on,
permissions, job dependencies, concurrency, env) is NOT projected
and remains hand-authored. Only step lists derived from the
registry are fenced.

## P-RELG-011 — Undefined CI Script Hardcut

Refines: `P-GOV-023`.

`MUST`: Every `pnpm <script>` reference in
`.github/workflows/*.yml` resolves to either:

- a `scripts.<key>` entry in a `package.json` reachable from the
  workspace, OR
- a registry-tracked gate with `runner: pnpm` whose `command:`
  field is the same `pnpm <script>` reference.

`MUST`: An unresolved reference is a coherence-checker `fail`. The
checker is registered as `gate.release-gate.registry-coherence`
and includes a workflow-yml resolution pass that walks every
`run: pnpm <token>` line and verifies resolution.

## P-RELG-012 — Tier Membership Constraint

Refines: `P-GOV-003`.

`MUST`: Every gate is in at least one tier. A gate not in any tier
is a coherence error. A gate in only `nightly` is permitted; a
gate in only `pre-commit` is permitted; a gate in `release`
without also being in `release-target:<t>` for any target is
permitted (target-agnostic gates use `targets: [any]`).

`MUST`: A gate in `release-target:<t>` must also be in `release`
(the target tier is a filter on the release tier, not a separate
authority).

`MUST`: A gate in `live` must also be in `release` (live tier is a
release subset).

## P-RELG-013 — Registry Version Discipline

Refines: `P-GOV-003`.

`MUST`: `registry_version` in
`tables/release-gate-registry.yaml` is bumped on every gate row
mutation. Patch bump for non-breaking row addition or
notes/description edit. Minor bump for any field change that
affects projection output. Major bump for `gate.id` rename or
removal of a tier/target/reason-code.

`MUST`: The coherence checker compares `registry_version` against
the previous git revision and fails on regression.

## P-RELG-014 — Local Workspace Evidence Output

Refines: `P-GOV-003`.

`MUST`: Preflight evidence files land in
`.local/report/release/preflight-evidence-<ISO8601>.json`. Per-gate
log excerpts land in
`.local/report/release/preflight-logs/<gate_id>-<ISO8601>.log`.
This directory is `.gitignore`d.

`MUST NOT`: write evidence to `.iterate/`, `.cache/`, or any path
under `.nimi/spec/`.

## Cross-Reference Table

| P-RELG | Parent P-GOV | Operationalizes |
|---|---|---|
| 001 | 003, 023 | Single source of release gate identity |
| 002 | 023 | Inheritance, not parallel authority |
| 003 | 003, 021 | Projection-only execution surfaces |
| 004 | 003 | Evidence JSON shape lock |
| 005 | 003 | Verdict set lock |
| 006 | 011 | Fail-closed for live/secret/external-repo |
| 007 | 003, 011 | No pseudo-success |
| 008 | 023 | Owner namespace allow-list |
| 009 | 003 | Drift gate self-bootstrap |
| 010 | 021, 023 | CI workflow step block codegen |
| 011 | 023 | Undefined CI script hardcut |
| 012 | 003 | Tier membership constraint |
| 013 | 003 | Registry version discipline |
| 014 | 003 | Local workspace evidence output |

## Deliberate P-GOV Refinement Omissions

The following `P-GOV-*` rules were considered for a `P-RELG-*`
refinement during design and **deliberately not given their own
rule**. Each is documented here so a future reviewer can see the
omission was intentional.

### P-GOV-001 (open-source boundary), P-GOV-002 (license matrix)

License-related release gates (`gate.docs.license-headers`,
`gate.platform-license.matrix-check`, etc.) are registry rows
governed by `P-RELG-001` (single registry truth). A separate
`P-RELG-LICENSE-*` rule would either duplicate `P-GOV-001` /
`P-GOV-002` (forbidden by `P-RELG-002`) or restate `P-RELG-001`
mechanically (no semantic content). Therefore: omitted.

### P-GOV-010 (P0/P1/P2 priority model)

`P-GOV-010` declares a priority taxonomy. Release gates already
express priority operationally through tiers: `tier: release` is
P0-equivalent; `tier: nightly` is P2-equivalent;
`tier: fast` is P0-or-P1 depending on whether it gates the
`pnpm preflight --require-release` summary. A separate `priority:`
axis on registry rows would double-encode information already
present in `tiers:`. Therefore: omitted. If a future audit shows
that the tier model cannot distinguish P0 from P1 for some gate,
a `P-RELG-PRIORITY-*` rule may be added through a separate topic.

### P-GOV-020 (governance task naming `OSG-<Priority>-NN`)

`P-GOV-020` governs the naming of platform governance tasks
recorded in local execution workspaces. Release gate identities
use the `gate.<owner>.<short-name>` format defined by `P-RELG-008`;
the two namespaces are disjoint and serve different purposes.
`P-GOV-020` remains the authority for execution-task naming;
`P-RELG-008` owns gate-id naming. No conflict, no refinement
needed.
