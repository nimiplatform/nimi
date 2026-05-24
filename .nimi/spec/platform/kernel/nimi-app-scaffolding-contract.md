# Nimi App Scaffolding Contract

> Owner Domain: `P-SCAF-*`

## Scope

This contract is the Platform-level authority for Nimi app scaffolding and
app-authoring repository maintenance. It defines the scaffolded developer
repository shape, supported profiles, managed-file semantics, app-authoring
command family, and downstream consumption of upstream Nimi App admission /
developer workflow authority.

This contract consumes, and does not redefine, public Nimi App admission,
review, descriptor, install/update/launch, permission grant, Runtime account
custody, Runtime scoped binding, SDK transport, or app-local spec admission
truth. Those surfaces remain owned by `P-NAPP-*`, `P-DEV-*`, `P-AUDIT-*`,
`P-APP-*`, `P-PERM-*`, `K-ACCSVC-*`, `K-BIND-*`, `K-APP-*`, and `S-APP-*` as
cited below.

## P-SCAF Family Seam (OWNS / DOES NOT OWN)

`P-SCAF-*` OWNS:

- Nimi app scaffolding product authority;
- the `standalone` and `workspace-app` profile split;
- generated developer-repository scaffold requirements;
- managed-file taxonomy for package-owned projections, scaffold-managed glue,
  and app-owned product code;
- `nimi-app create`, `nimi-app doctor`, and `nimi-app update` authoring command
  semantics;
- the local-evidence acceptance harness role for this scaffolding topic;
- the A5 dependency that default scaffold content must not import
  `kit/features/model-test` until a kit-owned follow-up closes.

`P-SCAF-*` DOES NOT OWN:

- public Nimi App admission, registry rows, release descriptors, artifact
  mirrors, review decisions, kill-switch truth, or ordinary-user install truth
  (`P-NAPP-013`, `P-NAPP-014`, `P-NAPP-018`, `P-NAPP-023`,
  `P-AUDIT-001..005`);
- developer workflow admission truth beyond generating inputs consumed by
  `P-DEV-001..005`;
- app-slice admission authority except for the explicit `workspace-app`
  consumer exception under `P-APP-001..006`;
- permission grant lifecycle or enforcement (`P-PERM-*`);
- Runtime account/session custody, scoped bindings, app launch, health,
  install, update, uninstall, or file-scope authority (`K-ACCSVC-*`,
  `K-BIND-*`, `K-APP-*`);
- SDK transport or generated-app auth helper implementation (`S-APP-*`);
- kit renderer shell or Rust shell implementation (`P-KIT-041`, `P-KIT-042`).

## P-SCAF-001 — App-Authoring Ownership

`MUST`: Platform owns the Nimi app scaffolding contract. Generated apps own
their app-specific product logic, product routes, product state, and product
feature behavior only after the scaffold has placed the admitted boundaries.

`MUST`: scaffolding produces developer repositories that can enter the upstream
developer workflow admitted by `P-DEV-001..005`. Scaffolding may generate
inputs for that workflow, but any admission outcome remains upstream Platform
truth.

`MUST NOT`: generated app product code must not become a local shadow owner for
public Nimi App admission, Runtime account custody, Runtime registration,
SDK client semantics, Realm login, permission grants, or kit shell behavior.

## P-SCAF-002 — Accepted A0-A5 Pre-Wave-0 Inputs

`MUST`: the following decisions are accepted 2026-05-24 pre-wave-0 inputs and
are authoritative for this scaffolding contract:

| Decision | Accepted input |
|---|---|
| A0 | App authoring CLI authority stays `nimi-app create|doctor|update`; it does not move under the runtime-occupied `nimi app send|watch` namespace. |
| A1 | Public Rust crate delivery name is `nimi-shell-tauri`; standalone targets the published crate channel after Wave 1 cuts API/publication mechanics, and workspace apps use Cargo path dependency. |
| A2 | SDK auth cuts a generated-app helper shape with modes `local-first-party`, `third-party-nimi-app`, and `dev-standalone`; third-party apps must not reuse first-party helper paths as self-declared first-party. |
| A3 | Explicit `workspace-app` scaffolding may auto-write monorepo app-slice admission under `P-APP-*`; standalone scaffolding never writes admitted truth. |
| A4 | `dev-standalone` auth uses an explicit developer app session or returns typed unavailable; mock auth, disabled auth gates, pseudo-success, and first-party self-declaration are forbidden. |
| A5 | Default Wave 2 scaffold content cannot import `kit/features/model-test` until a kit-owned follow-up topic closes. |

`MUST NOT`: later implementation waves must not reopen A0-A5 as compatibility
choices unless a new authority-bearing topic explicitly supersedes this rule.

## P-SCAF-003 — Scaffold Profile Split

`MUST`: Nimi app scaffolding admits exactly two profile families:

- `standalone`: an external developer app repository with its own `.nimi/**`
  host truth surface, published SDK/kit/Rust-shell dependencies, generated
  submitted-manifest input, and no admitted Platform truth by default.
- `workspace-app`: a monorepo app slice under `apps/<app>/...` that uses
  workspace dependencies and Cargo path dependency for the Rust shell crate
  surface; app-local `apps/<app>/spec/**` authority is admitted only through
  `P-APP-001..006`.

`MUST NOT`: scaffolding must not invent a third profile that bypasses
`P-APP-*`, `P-NAPP-*`, `P-DEV-*`, or Runtime account/session authority.
Implementing only one profile does not satisfy this contract's product line.

## P-SCAF-004 — Submitted Manifest Input Is Not Admitted Descriptor Truth

`MUST`: scaffolding may generate `nimi.app.yaml` only as a
developer-submitted manifest input consumed by `P-DEV-001`, `P-DEV-002`, and
the upstream review flow resolving to `P-NAPP-018` descriptor shape.

`MUST`: generated repository wording, scripts, tests, and local audit output
must label `nimi.app.yaml` as submitted input. The admitted descriptor remains
the Platform-owned release descriptor produced by review under `P-NAPP-013`,
`P-NAPP-014`, and `P-NAPP-018`.

`MUST NOT`: scaffolding must not create or imply admitted release descriptor
truth, registry row truth, review decision truth, mirror truth, ordinary-user
install truth, or public admission by generating `nimi.app.yaml`.

## P-SCAF-005 — Build Profile Requirements

`MUST`: generated repositories must include a build profile input for the
supported Tauri + pnpm scaffold profile. The input must carry at minimum:

- `build_profile_ref`;
- toolchain version;
- build command;
- output path;
- lockfile path.

`MUST`: the build profile is a developer workflow input consumed by
`P-DEV-002`, `P-NAPP-018`, and `P-NAPP-023`; it is not an admitted
descriptor, install source, or proof that a third-party artifact is safe.

`MUST NOT`: scaffolding must not emit `checksum-pinned` as an admitted
third-party publish path, must not turn local build success into admission, and
must not represent direct `npm install`, direct `npx`, mutable git refs, or
direct clone/build/run as ordinary-user install truth.

## P-SCAF-006 — Permission Declarations Are Transparency Only

`MUST`: generated manifests may declare closed `P-PERM-002` scope names,
qualifiers, and purpose strings as transparency and review input consumed by
`P-DEV-001`, `P-NAPP-018`, and SDK projection rules such as `S-APP-012`.

`MUST`: scaffolded app readiness and launch flows must consume real grant or
promptable-grant projection from the admitted Runtime / Realm / Platform
permission surfaces.

`MUST NOT`: submitted permission declarations must not be treated as granted
permissions, entitlement claims, launch authorization, AI spend authorization,
or a way to bypass the fail-closed denial state machine owned by `P-PERM-*`
and backend grant authorities.

## P-SCAF-007 — Managed File Taxonomy

`MUST`: generated repositories must classify generated files and regions into
exactly these mutation classes:

| Class | Mutation rule |
|---|---|
| package-owned projection | Regenerated by the owning package or `nimicoding`; user edits are drift. |
| scaffold-managed glue | Managed by `nimi-app update`; user changes require an explicit ownership escape hatch. |
| app-owned product code | Owned by the app developer and never overwritten by scaffold update. |

`MUST`: managed regions must be explicit. Whole-file management is allowed only
when the file exists solely as projection or glue.

`MUST NOT`: app-owned product files must not hide platform-owned auth/session,
Runtime, SDK, kit, descriptor, or permission behavior in local copies that the
scaffold cannot update or diagnose.

## P-SCAF-008 — App-Authoring Command Family

`MUST`: the admitted app-authoring command family is:

- `nimi-app create`;
- `nimi-app doctor`;
- `nimi-app update`.

`MUST`: these commands are developer-repository authoring commands. They may be
implemented by developer tooling packages, but their authority remains this
Platform scaffolding contract plus the upstream contracts they consume.

`MUST NOT`: Runtime `nimi` public onboarding CLI must not own app scaffold
templates, build profiles, pack/publish flow, public admission, or scaffold
doctor/update semantics. Runtime CLI owns only the negative boundary recorded
by `K-CLI-009` and `K-CLI-009a`.

## P-SCAF-009 — Doctor And Update Semantics

`MUST`: `nimi-app doctor` operates on developer scaffold state. It may inspect
scaffold lock/version state, managed-region drift, dependency version matrix,
SDK/kit/Rust shell/nimicoding alignment, forbidden auth/token/Realm bypass
patterns, `.nimi/**` projection drift, `AGENTS.md` freshness, submitted
manifest readiness, build profile readiness, support-file readiness, and
developer-side local audit dry-run readiness.

`MUST`: `nimi-app update` operates on scaffold-managed glue only. It may update
dependency versions under an admitted version matrix, rewrite managed files or
regions, and apply admitted codemods. It must preserve app-owned product code.

`MUST`: doctor and update must fail closed on drift, conflicts, mixed-version
state, stale auth/session claims, or unsupported scaffold versions.

`MUST NOT`: doctor output, update output, local audit dry-run output, endpoint
reachability, file existence, or local build success must be projected as
public admission, ordinary-user installed-app update, installed-app health,
launch readiness, rollback truth, or kill-switch truth. Runtime app lifecycle
truth remains `K-APP-*`; public admission and review truth remain `P-NAPP-*`
and `P-AUDIT-*`.

## P-SCAF-010 — Nimicoding Projection Ownership

`MUST`: package-owned `.nimi/{config,contracts,methodology}/**` projections in
generated repositories remain owned by the external `@nimiplatform/nimi-coding`
package. Host repositories consume them through `pnpm exec nimicoding` and
admitted generated projections.

`MUST`: generated scaffolds must keep host-local truth under the generated
repository's `.nimi/**` boundaries and must preserve the package/host
projection distinction.

`MUST NOT`: scaffolding must not promote concrete installer evidence,
package-owned projections, local execution artifacts, or generated app topic
reports into semantic truth unless an admitted `nimicoding` admission flow
produces that projection.

## P-SCAF-011 — External Harness Is Local Evidence Only

`MUST`: the black-box acceptance harness for this topic is local operational
evidence. It may run later waves against fresh generated fixture targets and
record evidence that scaffold outputs obey this contract.

`MUST`: repo-wide spec language must use a portable acceptance-harness concept
or topic-local evidence wording. Any workstation-local absolute path belongs in
topic evidence only.

`MUST NOT`: the harness must not become generated app output, a scaffold
template source, an admitted Nimi App, public distribution authority, or
repo-wide spec truth.

## P-SCAF-012 — Public Nimi App Admission And App-Slice Admission Are Separate

`MUST`: scaffolding must keep these surfaces separate:

- public Nimi App admission is owned by `P-NAPP-*`, `P-AUDIT-*`, and related
  upstream rules;
- app-slice admission is owned by `P-APP-001..006`;
- scaffolded developer repository shape is owned by `P-SCAF-*`.

`MUST`: standalone scaffolding never writes admitted truth. Explicit
`workspace-app` scaffolding may auto-write monorepo app-slice admission only
under existing `P-APP-001..006` authority, and only for the explicit
`workspace-app` profile.

`MUST NOT`: scaffolding must not create public Nimi App admission, registry
rows, release descriptors, mirrors, kill-switch posture, public review
decisions, ordinary-user install truth, ordinary-user visibility, or any
substitute for the `P-NAPP-013` PR admission path. App-slice admission does not
substitute for public Nimi App admission, and public Nimi App admission does
not substitute for app-slice audit authority (`P-NAPP-010`).

## P-SCAF-013 — A5 Model-Test Follow-Up Dependency

`MUST`: ST-L1-1 Wave 2 default scaffold content must not import default
`kit/features/model-test` content until a kit-owned follow-up topic admits that
feature surface and closes its implementation/evidence obligations.

`MUST`: before that follow-up closes, scaffold examples may use only already
admitted SDK/kit/Runtime surfaces or app-owned placeholder product areas that
do not claim model-test feature availability.

`MUST NOT`: scaffolding must not fabricate a shipped `kit/features/model-test`
export, edit kit source/package files in this wave, or treat a planned feature
as available package surface.

## Fact Sources

- `.nimi/spec/platform/kernel/nimi-app-admission-contract.md` --
  `P-NAPP-013`, `P-NAPP-014`, `P-NAPP-018`, `P-NAPP-023`
- `.nimi/spec/platform/kernel/nimi-app-developer-workflow-contract.md` --
  `P-DEV-001..P-DEV-005`
- `.nimi/spec/platform/kernel/nimi-app-audit-pipeline-contract.md` --
  `P-AUDIT-001..P-AUDIT-005`
- `.nimi/spec/platform/kernel/app-slice-admission-contract.md` --
  `P-APP-001..P-APP-006`
- `.nimi/spec/platform/kernel/app-permission-contract.md` -- `P-PERM-*`
- `.nimi/spec/platform/kernel/kit-contract.md` -- `P-KIT-041`, `P-KIT-042`
- `.nimi/spec/sdk/kernel/nimi-app-client-contract.md` -- `S-APP-*`
- `.nimi/spec/runtime/kernel/account-session-contract.md` -- `K-ACCSVC-*`
- `.nimi/spec/runtime/kernel/scoped-app-binding-contract.md` -- `K-BIND-*`
- `.nimi/spec/runtime/kernel/app-messaging-contract.md` -- `K-APP-*`
- `.nimi/topics/ongoing/2026-05-23-nimi-app-scaffolding-industrial-shell/design.md`
- `.nimi/topics/ongoing/2026-05-23-nimi-app-scaffolding-industrial-shell/preflight.md`
