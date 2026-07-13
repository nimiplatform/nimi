# Nimi App Developer Workflow Contract

> Owner Domain: `P-DEV-*`

## Scope

This contract is the Platform-level authority for the third-party Nimi
App developer-side workflow: the developer repository layout that
precedes a submission, the ordered developer workflow step sequence,
the developer-side `nimi audit` dry-run command (non-gate posture
cross-referenced from `P-AUDIT-005`), the immutable-submission rule
on the candidate artifact's source reference, and the PR-based
admission obligations placed on the developer side that consume the
already-admitted `P-NAPP-013` admission-path mechanism.

It also owns the single production-shipped Developer Mode product workflow for
mutable `local_development` projects. That workflow is independent of package
format/import implementation: it consumes the final 0K principal, protected
launch/session, grant, and owner-operation seams and cannot create a dev-only
authorization model.

This contract does not own and MUST NOT redefine:

- the `P-NAPP-013` PR-admission path mechanism (the registry-row,
  permission-requirement, Runtime-registration-requirement,
  AIConfig/profile-hint, exact-version, immutable-source-reference,
  release-descriptor-reference, artifact-digest/size/signature/
  provenance-evidence, and storage-policy reviewable change-set
  enumeration). That mechanism remains `P-NAPP-013` authority and is
  cross-referenced from `P-DEV-005`, never redefined;
- the `P-NAPP-014` release-descriptor immutability and digest
  verification rule. That rule remains `P-NAPP-014` authority and is
  cross-referenced from `P-DEV-004`, never redefined;
- the `P-NAPP-018` third-party release-descriptor shape (publisher,
  source, artifact, build/dependency/platform-signing assurance,
  permissions, storage, review). That shape remains `P-NAPP-018`
  authority and is referenced as the schema target consumed by the
  developer-authored `nimi.app.yaml` input under `P-DEV-001`;
- the `P-AUDIT-001` publish-to-admission gate sequence
  (`submit → preflight → audit → review → admit`). That sequence
  remains `P-AUDIT-001` authority; the developer workflow under
  `P-DEV-002` is the developer-side surface that produces the
  `submit`-stage input and the dry-run pre-submission self-check that
  precedes it;
- the `P-AUDIT-002` typed audit-pipeline composition by evidence
  classes. That composition remains `P-AUDIT-002` authority; the
  developer-side `nimi audit` command admitted under `P-DEV-003` is
  not a substitute for any evidence class admitted there;
- the `P-AUDIT-005` non-gate posture of the developer-side `nimi
  audit` command. That posture remains `P-AUDIT-005` authority and is
  cross-referenced from `P-DEV-003`. `P-DEV-003` admits the
  developer-side command and its developer-workflow positioning;
  `P-AUDIT-005` admits the non-gate posture. The two rules are
  coupled by mutual cross-reference and admit disjoint surfaces;
- the descriptor floor `forbidden_install_inputs` in
  `tables/nimi-app-release-descriptors.yaml` (mutable git branches,
  mutable git tags without protection, npm dist-tags, npm version
  ranges, direct `npx`, direct clone-build-run, arbitrary install
  scripts). That floor remains `P-NAPP-018` table authority; the
  developer-side immutable-submission rule under `P-DEV-004`
  references this floor as the consumer-of-source-reference
  constraint, never re-authors it.

## P-DEV Family Seam (OWNS / DOES NOT OWN)

`P-DEV-*` OWNS:

- the developer repository layout required-item set
  (`P-DEV-001`);
- the developer workflow step sequence with per-step
  required-truth and forbidden-shortcut (`P-DEV-002`);
- the developer-side `nimi audit` dry-run command surface
  (`P-DEV-003`), coupled to `P-AUDIT-005` by mutual
  cross-reference;
- the immutable-submission rule on the candidate artifact's
  source reference (`P-DEV-004`), with typed fail reason
  `mutable_submission_artifact`;
- the developer-side PR-based admission workflow obligations
  (`P-DEV-005`) layered on top of the already-admitted
  `P-NAPP-013` admission-path mechanism.

`P-DEV-*` DOES NOT OWN:

- the `P-NAPP-013` PR-admission path mechanism — owned by
  `nimi-app-admission-contract.md`;
- the `P-NAPP-014` release-descriptor immutability and digest
  verification rule — owned by `nimi-app-admission-contract.md`;
- the `P-NAPP-018` third-party release-descriptor shape — owned by
  `nimi-app-admission-contract.md`;
- the `P-AUDIT-001` publish-to-admission gate sequence — owned by
  `nimi-app-audit-pipeline-contract.md`;
- the `P-AUDIT-002` audit-pipeline composition by evidence classes
  — owned by `nimi-app-audit-pipeline-contract.md`;
- the `P-AUDIT-005` non-gate posture of the developer-side `nimi
  audit` command — owned by `nimi-app-audit-pipeline-contract.md`;
- the `tables/nimi-app-release-descriptors.yaml` descriptor floor
  `forbidden_install_inputs` enumeration — owned by
  `nimi-app-admission-contract.md` via its admitted table.

`P-DEV-*` is additive on TOP of the already-admitted `P-NAPP-013`,
`P-NAPP-014`, `P-NAPP-018`, `P-AUDIT-001..007`, and the
`tables/nimi-app-release-descriptors.yaml`
`third_party_descriptor_floor.forbidden_install_inputs` projection.
It admits the developer-side workflow obligations that produce the
inputs the admitted gate sequence consumes; it does not replace any
admitted rule.

## P-DEV-001 — Developer Repository Layout

`MUST`：every third-party Nimi App candidate submission MUST be backed
by a developer repository whose root (or admitted equivalent
location) carries the following items. Each item is independently
required; a missing item fails the developer workflow before the
`submit` step of `P-DEV-002` produces a PR.

| Item | Required-truth | Notes |
|---|---|---|
| `nimi.app.yaml` | developer-authored manifest input resolving the `P-NAPP-018` descriptor-shape field set as a submitted-manifest input | submitted-manifest input only; never admitted truth (per `P-NAPP-018` `MUST NOT` against developer-manifest-as-admission-truth and `P-NAPP-013` `MUST NOT` against parallel-truth substrates) |
| `LICENSE` | SPDX-detectable or explicit-custom license file | mirror-license clearance under `P-NAPP-022` consumes this; absence forecloses mirror admission |
| `SECURITY.md` | vulnerability-report channel disclosure | post-release detectability requirement on the developer side |
| `README.md` | product purpose, support, data handling, minimum Runtime / SDK statement | reviewable product description input |
| `AGENTS.md` | per `nimi-coding` governance — repository-local AI-coding agent guidance authoritative for AI-mediated changes to the developer repository | required at the developer-repository root per `nimi-coding` governance posture; this contract admits the requirement on the developer side |
| release artifact + attestation | the candidate release artifact and its signature / attestation bundle (`P-NAPP-018` `artifact.locator` / `artifact.signature_or_provenance_ref` inputs; `P-NAPP-014` digest-verifiable artifact input) | produced by the developer's build (or the Nimi CI build for `build_assurance: nimi-built`); the artifact is the candidate `submit`-stage input |

`MUST`：the required items are MUST-required at the developer
repository root OR at an admitted equivalent location (the equivalent
location is itself admitted by the submitted-manifest reviewable
change set per `P-NAPP-013`; a developer cannot unilaterally relocate
required items without an admitted equivalent-location declaration).
A required item resident only at an un-admitted location does not
satisfy this rule and fails the developer workflow with typed reason
`developer_repo_layout_incomplete`.

`MUST NOT`：`nimi.app.yaml` MUST NOT be treated as admission truth.
The admitted truth is the Platform-owned admitted release descriptor
in `tables/nimi-app-release-descriptors.yaml`, produced by review per
`P-NAPP-013`, `P-NAPP-014`, and `P-NAPP-018`. The developer manifest
is reviewable input only; this rule admits its presence at the
developer repository as a required input, not as admission truth.

`MUST NOT`：this rule MUST NOT redefine the `P-NAPP-018` descriptor
shape. The `nimi.app.yaml` developer manifest is an input that the
review stage resolves against the `P-NAPP-018` admitted shape; the
shape itself remains `P-NAPP-018` authority.

`MUST NOT`：this rule MUST NOT admit `optional SBOM` or `optional
scanner outputs` as required items. Such artifacts MAY be present in
the developer repository as developer-supplied context (consistent
with `P-AUDIT-003` `self_attested_scan` posture: developer-side scan
results MAY appear as developer-supplied context but MUST NOT
substitute for Nimi-run scanner output); they are not admitted as
required by this contract surface.

## P-DEV-002 — Developer Workflow Step Sequence

`MUST`：every third-party Nimi App candidate submission MUST progress
through the ordered developer-side step sequence
`pack → validate → local-audit-dry-run → submit → review-evidence →
CI-build → release-promotion`. The sequence is strictly ordered: a
later step MUST NOT proceed before its predecessor has produced its
required-truth output. Each step has a required-truth statement and a
forbidden-shortcut statement; the developer workflow fails closed
when a step's required truth is absent or when its forbidden shortcut
is taken.

The ordered steps, with required truth and forbidden shortcut, are:

| Step | Required truth | Forbidden shortcut |
|---|---|---|
| `pack` | `nimi-coding` packs the developer source tree against the `P-NAPP-018` admitted descriptor shape, producing a candidate `nimi.app.yaml` and a candidate build descriptor | hand-authored or hand-edited `nimi.app.yaml` that bypasses the `nimi-coding` pack step (manual authoring without the pack-step's schema-targeting output is not the admitted `pack` step output) |
| `validate` | `nimi-coding` validates the candidate manifest and build descriptor against the `P-NAPP-018` schema locally, producing a typed pass / typed-fail schema check before submission | a validate pass that ignores or masks one or more `P-NAPP-018` required descriptor fields (a present-field subset is not a validated descriptor) |
| `local-audit-dry-run` | the developer runs the developer-side `nimi audit` command (admitted under `P-DEV-003`) locally, producing a typed pre-submission self-check output | substituting the developer-side `nimi audit` output for the Nimi-run authoritative audit (forbidden under `P-DEV-003` and `P-AUDIT-005`; consistent with `P-AUDIT-003` `self_attested_scan` posture) |
| `submit` | the developer opens a PR into the Nimi App registry / package tables admitting, in one reviewable change set, the inputs enumerated by the already-admitted `P-NAPP-013` PR-admission path | submitting an artifact built from a mutable branch or a mutable tag without protection (forbidden under `P-DEV-004` and the descriptor-floor `forbidden_install_inputs` projection of `tables/nimi-app-release-descriptors.yaml`); GitHub repository ownership, npm package name, source directory, or app-local spec presence as admission claim (forbidden under `P-NAPP-013` `MUST NOT`) |
| `review-evidence` | Nimi runs the authoritative audit pipeline admitted under `P-AUDIT-001..007` on the exact reviewed commit and the exact admitted artifact; the output is Nimi-owned review evidence | developer-supplied scan output as the review evidence (forbidden under `P-AUDIT-003` `self_attested_scan` clause); AI-only verdict as review evidence (forbidden under `P-AUDIT-003` `ai_only_review` clause) |
| `CI-build` | for `build_assurance: nimi-built`, a Nimi-org reusable GitHub Actions workflow builds from the reviewed commit SHA, producing the admitted Nimi-signed artifact and its attestation; for `build_assurance: reproducible-verified` or `developer-attested`, the artifact and attestation produced by the admitted build posture are consumed as the admitted artifact | a `nimi-built` artifact built from a SHA other than the reviewed one, or built outside the Nimi-org reusable workflow (not the admitted CI build output); a `checksum-pinned` third-party build (third-party `checksum-pinned` not admitted per `P-NAPP-023` enum constraint) |
| `release-promotion` | upon review approval, Platform admits the registry row in `tables/nimi-app-registry.yaml` and the release descriptor in `tables/nimi-app-release-descriptors.yaml` together as a single admission event (per `P-AUDIT-001` `admit`-stage required truth) | promoting a release on app-local spec presence, GitHub repository ownership, npm package name, or any parallel-truth artifact (forbidden under `P-AUDIT-001` `admit`-stage forbidden-shortcut clause and `P-NAPP-013` `MUST NOT`) |

`MUST`：the sequence is strictly ordered. `release-promotion` MUST
NOT precede `CI-build`. `CI-build` MUST NOT precede `review-evidence`.
`review-evidence` MUST NOT precede `submit`. `submit` MUST NOT
precede `local-audit-dry-run`. `local-audit-dry-run` MUST NOT precede
`validate`. `validate` MUST NOT precede `pack`. A later step
proceeding before its predecessor has produced its required-truth
output fails the developer workflow with typed reason
`developer_workflow_sequence_violation`.

`MUST`：steps `pack`, `validate`, and `local-audit-dry-run` are
developer-side surfaces; they produce pre-submission inputs and
self-checks and MUST NOT be construed as admission gates. The
authoritative gate sequence is `P-AUDIT-001` `submit → preflight →
audit → review → admit`; `P-DEV-002`'s `submit` step is the input
boundary at which the developer side hands the candidate to the
Nimi-owned gate sequence.

`MUST`：steps `review-evidence`, `CI-build`, and `release-promotion`
project the Nimi-owned operations admitted under `P-AUDIT-001..007`
and `P-NAPP-013` onto the developer-side workflow surface. The
projection records the developer-visible step boundary; it does NOT
admit a developer-side authority over those operations. The
Nimi-owned authority over each of these steps remains with the
referenced rules.

`MUST NOT`：the step sequence MUST NOT be reduced to a proper subset
or re-ordered. Each step is independently required; collapsing any
two or skipping any step fails the developer workflow with typed
reason `developer_workflow_sequence_violation`.

`MUST NOT`：this rule MUST NOT admit a hosted developer portal, a
developer dashboard, or any non-PR submission substrate as the
`submit`-step substrate. The `submit`-step substrate is the PR
admitted under `P-NAPP-013`; any alternative substrate is out of
scope for this rule.

## P-DEV-003 — Developer-Side `nimi audit` Is Dry-Run Only

`MUST`：the developer-side `nimi audit` command admitted by this rule
is a pre-submission self-check that runs on the developer's local
machine against the developer-authored candidate `nimi.app.yaml` and
the developer's local source tree. Its output is a typed
self-check projection that the developer consumes locally before
opening a submission PR per `P-DEV-002` `submit` step.

`MUST`：the developer-side `nimi audit` command produces output that
MAY appear in the review-evidence record only as developer-supplied
context (per `P-AUDIT-005` `MUST` clause). It is not Nimi-run scanner
output for any evidence class admitted under `P-AUDIT-002`.

`MUST NOT`：the developer-side `nimi audit` command MUST NOT be
admitted as the authoritative admission gate. The authoritative audit
is the Nimi-run composite pipeline admitted under `P-AUDIT-002`,
executed on the exact reviewed commit and the exact admitted artifact
at the `audit` stage of `P-AUDIT-001` per `P-AUDIT-005`. Attempting
to admit on the strength of a developer-side `nimi audit` outcome
fails admission closed with typed reason
`developer_side_audit_not_gate` (the same typed reason admitted by
`P-AUDIT-005`).

`MUST NOT`：a developer-side `nimi audit` output MUST NOT substitute
for the Nimi-run scanner output for any deterministic evidence class
admitted under `P-AUDIT-002` (`malicious-package-scanner`,
`known-vuln-scanner`, `sast`, `repository-posture-scorer`,
`malware-reputation-scanner`). Such substitution is forbidden under
`P-AUDIT-003` `self_attested_scan` clause; this rule admits the
developer-side command surface within that bound.

**Cross-reference**：`P-AUDIT-005`
in `nimi-app-audit-pipeline-contract.md` admits the non-gate posture
of the developer-side `nimi audit` command and forward-references
`P-DEV-003` (this rule) as the developer-workflow surface admitting
the command itself. The two rules are coupled by mutual
cross-reference and admit disjoint surfaces: `P-AUDIT-005` admits
the non-gate posture (i.e. the developer-side command is NOT an
admission gate); `P-DEV-003` admits the developer-side command
itself and its developer-workflow positioning (i.e. WHERE the
developer-side command sits in the workflow). The freeze-protected
coupling is the mechanism by which the cross-reference remains a
single active authority relation rather than a parallel-truth admission.

## P-DEV-004 — Immutable Submission

`MUST`：the candidate artifact submitted at `P-DEV-002` `submit`-step
MUST be built from one of the following immutable source references
on the developer repository:

- a protected immutable Git tag (tag protection MUST be enforced by
  the developer repository host such that the tag's commit SHA cannot
  be re-pointed once protected; the protected tag's resolved commit
  SHA is the immutable source reference);
- a reviewed commit SHA (the commit SHA itself is immutable; the
  review-evidence record refers to this SHA as the audited commit
  per `P-AUDIT-001` `audit`-stage required-truth clause).

`MUST`：the submitted artifact's immutable source reference MUST be
recorded in the candidate `nimi.app.yaml` developer manifest input
under the `source.ref` field admitted by the `P-NAPP-018`
third-party descriptor shape, and MUST be carried through to the
admitted release descriptor in
`tables/nimi-app-release-descriptors.yaml` as the descriptor's
`source.ref`. The admitted descriptor is itself immutable per
`P-NAPP-014`.

`MUST NOT`：a mutable Git branch MUST NOT be admitted as the
candidate artifact's source reference. Admission on the strength of a
mutable branch reference fails closed with typed reason
`mutable_submission_artifact` (this rule's named typed fail reason).

`MUST NOT`：a mutable Git tag without protection (a tag whose commit
SHA can be re-pointed after creation by the developer or by repository
hosts other than via the protected-tag mechanism) MUST NOT be
admitted as the candidate artifact's source reference. Admission on
the strength of an unprotected mutable tag reference fails closed
with typed reason `mutable_submission_artifact`.

`MUST NOT`：an npm dist-tag, an npm version range, a `latest`
substring projection, or any other mutable resolver MUST NOT be
admitted as the candidate artifact's source reference. These are
already enumerated in the descriptor-floor
`forbidden_install_inputs` projection of
`tables/nimi-app-release-descriptors.yaml` (owned by
`P-NAPP-018`); this rule references that floor and admits the
developer-side workflow constraint that produces a source reference
consistent with the floor. Attempting to submit with such a resolver
fails closed with typed reason `mutable_submission_artifact`.

`MUST NOT`：this rule MUST NOT redefine `P-NAPP-014` or the
`forbidden_install_inputs` descriptor-floor enumeration. The
immutability of the admitted release descriptor itself is
`P-NAPP-014` authority; the floor enumeration is the
`P-NAPP-018`-owned table authority. This rule admits the
developer-side immutable-source-reference rule on the candidate
submission, layered on top of those already-admitted rules.

## P-DEV-005 — PR-Based Admission Workflow Obligations

`MUST`：the developer-side PR submission opened at `P-DEV-002`
`submit` step MUST consume the already-admitted `P-NAPP-013`
admission-path mechanism. The reviewable change set in the PR MUST
admit, in one PR, the inputs enumerated by `P-NAPP-013`:

- registry row metadata;
- permission requirements;
- Runtime registration requirements;
- AIConfig / profile requirement hints;
- exact version;
- immutable source reference (consistent with `P-DEV-004`);
- release descriptor reference;
- artifact digest, size, signature or provenance evidence where
  applicable;
- storage policy.

The above enumeration is the verbatim `P-NAPP-013` admission-path
input set; this rule cross-references that set and admits the
developer-side obligation to populate it. This rule does NOT
re-author the enumeration; `P-NAPP-013` remains the authority.

`MUST`：the developer-side workflow obligations admitted by this
rule are layered on top of `P-NAPP-013` and consist of:

- the PR opener (developer-side identity attached to the PR) is the
  developer who controls the developer repository (i.e. the
  publisher's GitHub namespace under `P-NAPP-018`
  `publisher.github_namespace`);
- the PR's submitted-artifact source reference satisfies `P-DEV-004`
  (protected immutable tag or reviewed commit SHA; no mutable
  branch, no unprotected mutable tag);
- the PR's accompanying developer-side `nimi audit` dry-run output
  (if surfaced) is presented as developer-supplied context only, per
  `P-DEV-003` and `P-AUDIT-005`;
- the PR's developer-authored `nimi.app.yaml` is the submitted
  manifest input under `P-DEV-001`, not the admitted truth (the
  admitted truth is the Platform-owned admitted release descriptor
  per `P-NAPP-018` and `P-NAPP-013`).

`MUST NOT`：this rule MUST NOT redefine the `P-NAPP-013`
admission-path mechanism. The mechanism — namely, that early
third-party app admission may begin as a GitHub PR into the
Platform-owned Nimi App registry / package tables admitting registry
row metadata, permission requirements, Runtime registration
requirements, AIConfig / profile requirement hints, exact version,
immutable source reference, release descriptor reference, artifact
digest / size / signature / provenance evidence where applicable, and
storage policy in the same reviewable change set — is owned by
`nimi-app-admission-contract.md` `P-NAPP-013`. This rule
cross-references that mechanism as the admission path the developer
side consumes; the path itself remains `P-NAPP-013` authority.

`MUST NOT`：a developer-side workflow obligation admitted by this
rule MUST NOT introduce a parallel admission substrate. GitHub
repository ownership, npm package name, source directory, app-local
spec presence, direct `npm install`, direct `npx`, mutable git
branch / tag, direct clone / build / run, or installer script
execution MUST NOT be admitted as the developer-side admission
substrate (the `MUST NOT` clauses of `P-NAPP-013` apply here by
cross-reference; this rule does NOT re-author them).

`MUST NOT`：this rule MUST NOT admit a non-PR substrate as the
developer-side admission entry. The PR is the admitted entry per
`P-NAPP-013` and the `P-AUDIT-001` `submit`-stage required-truth
clause; any alternative substrate (hosted developer portal,
developer dashboard, email submission, RPC submission) is out of
scope for this rule.

## P-DEV-006 — One Production Developer Mode

Nimi exposes one Developer Mode and one Dev Trust Set for platform integration
and third-party app development. The global toggle is discoverable in
production Desktop, defaults off, and grants nothing. Each project approval
uses Runtime-owned fresh presence and chooses exactly `run_once` or
`remember_project`.

The authorization binds Runtime-derived OS-user anchor, isolated local
principal, canonical project-root file identity, declared app id, exact
capability fingerprint, current account, and fixed shell/entry policy. Native
host/process/build identity is short-lived launch/session proof and rotates on
every controlled replacement. HMR, rebuild, host restart, and Runtime restart
do not repeat consent only while the durable authorization and live supervisor
run remain exact.

Mode off revokes sessions and run-once authority; remembered projects become
dormant and require fresh presence to reactivate. Account switch/logout,
revoke, supervisor termination, copied/changed project, capability expansion,
or shell/origin mismatch invalidates or reapproves as specified by
`tables/nimi-app-local-development-admission.yaml`.

An approved project may use a controlled production account solely through
Runtime-mediated operations and the same account-and-principal grant/owner
policy as every local app. It never receives account/provider credentials,
portable session proof, a generic protected proxy, or persistent Nimi-managed
logon/boot autostart. Product UX continuously identifies project/account/risk
and states that Nimi grants constrain Nimi APIs, not all ordinary Windows
rights of native development code.

## P-DEV-007 — External AI Host Workflow Boundary

The external AI host exclusively owns planning, decomposition, task lifecycle,
subagent coordination, continuation, waiting, resumption and completion. Nimi,
Nimicoding, Runtime, SDK, Kit, Desktop, app-tools and local apps may validate,
generate, build, run or project bounded product operations, but must not create,
mirror, advance, resume, close or execute host workflow state.

Repository topics, selected-target state, dispatch ledgers, manager/worker/
auditor state, daemon heartbeats and repository-owned task packets are not
product authority. Deterministic guarded generation/validation evidence may be
written only to its admitted owner surface and cannot become workflow truth.

## Fact Sources

- `.nimi/spec/platform/kernel/nimi-app-admission-contract.md` — `P-NAPP-013`
  (PR-admission path mechanism), `P-NAPP-014` (release-descriptor
  immutability and digest verification), `P-NAPP-018` (third-party
  release-descriptor shape; consumed by `P-DEV-001` as the
  developer-manifest schema target, and by `P-DEV-004` and
  `P-DEV-005` as the source-reference and reviewable-change-set
  authority surfaces; never redefined)
- `.nimi/spec/platform/kernel/nimi-app-audit-pipeline-contract.md` —
  `P-AUDIT-001` (publish-to-admission gate sequence; consumed at
  `P-DEV-002` `submit` / `review-evidence` / `release-promotion`
  steps), `P-AUDIT-002` (typed audit-pipeline composition; consumed
  at `P-DEV-003` `MUST NOT` against substitution), `P-AUDIT-003`
  (`ai_only_review` and `self_attested_scan` forbidden shortcuts;
  consumed at `P-DEV-002` `review-evidence` step forbidden-shortcut
  clause and at `P-DEV-003` `MUST NOT`), `P-AUDIT-005` (developer-side
  `nimi audit` non-gate posture; coupled by mutual cross-reference to
  `P-DEV-003` under the parent plan's rule-ID freeze posture)
- `.nimi/spec/platform/kernel/tables/nimi-app-release-descriptors.yaml`
  (`third_party_descriptor_floor.forbidden_install_inputs` referenced
  at `P-DEV-004` `MUST NOT` clause against mutable resolvers; the
  floor enumeration itself is owned by `P-NAPP-018`)
- This contract is the active authority for developer repository layout,
  workflow steps, local audit dry-run, CI build, immutable submission,
  production Developer Mode, and workflow non-targets.
