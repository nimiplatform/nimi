# The Package

`@nimiplatform/nimi-coding` is a **standalone host-agnostic
boundary package** for the Nimi Coding methodology. This page
describes what the package ships, what it deliberately does not
ship, and why this shape matters.

## What The Package Is

| Property | Value |
| --- | --- |
| Package name | `@nimiplatform/nimi-coding` |
| Repository stage | bootstrap |
| Self-hosting | No (runtime ownership delegated to external AI host) |
| Vendor neutral | Yes |
| Host class | `ai_native_coding_host` |
| License | MIT |
| Bin | `nimicoding` |

The product goal is to let arbitrary projects install a reusable
AI-coding governance toolkit, bootstrap a project-local
`/.nimi/**` layer, and use AI-native authority / packet /
acceptance discipline for high-risk work.

## What Lives Inside The Package

| Path | Purpose |
| --- | --- |
| `methodology/` | Methodology source (policies) |
| `contracts/` | Schema source (typed contracts) |
| `config/` | Bootstrap config (manifest, host-profile, etc.) |
| `spec/` | Bootstrap spec seed (`bootstrap-state`, `product-scope`) |
| `cli/` | CLI implementation |
| `bin/nimicoding.mjs` | Entry binary |
| `adapters/` | Host adapter overlays (e.g., `oh-my-codex`) |

When `nimicoding start` runs in a host project, it projects
package source under the project's `.nimi/**`:

| Source | Projected to |
| --- | --- |
| `methodology/` | `.nimi/methodology/` |
| `contracts/` | `.nimi/contracts/` |
| `config/` | `.nimi/config/` |
| `spec/` (bootstrap) | `.nimi/spec/` (bootstrap files only) |

## What The Package Deliberately Does NOT Ship

| Surface | Status | Why deferred |
| --- | --- | --- |
| Packet-bound run kernel | Deferred | Methodology owns shape, not execution |
| Provider-backed execution | Deferred | The package itself does not run AI |
| Scheduler | Deferred | Execution timing is a host concern |
| Notification | Deferred | UX is host concern |
| Automation backend | Deferred | Automation is host concern |
| Self-hosted methodology execution | Deferred | Runtime owner stays external |

These are explicitly **deferred surfaces**. The package is
"boundary-complete for its intended standalone scope" — meaning
it ships the methodology, the contracts, the bootstrap, and the
mechanical validators, but it does not run the work.

## Why "Boundary-Complete, Not Run-Complete"

A package that boundary-completes the methodology can be adopted
by any project. A package that also ships its own runtime would
couple to a particular execution model (an AI host, a scheduler,
a notification system).

The split exists because:

- The methodology is **portable** — it works regardless of host.
- The runtime is **host-specific** — the same execution can be
  routed through Claude, Codex, Gemini, OMX, or another
  contract-observing host.
- Coupling them would force adopters to take both the
  methodology and the execution layer.

The package's promise is "you can adopt the methodology today;
you can change AI hosts tomorrow without changing the
methodology contract."

## Package Surfaces (Today)

The current standalone scope is boundary-complete for:

- Package identity
- Repository foundation
- Initial AI-native methodology seed
- Package-owned bootstrap source projection
- Machine-readable reconstruction, doc-spec-audit, and
  high-risk execution result contracts
- Package-owned canonical high-risk admission schema contract
- Seed-only high-risk execution schemas (packet,
  orchestration-state, prompt, worker-output, acceptance)
- Vendor-neutral external host-profile seed
- Package-owned external host compatibility contract seed
- Host-adapter seed for constrained external execution-host
  interop
- Package-owned admitted host-profile overlay seed for
  `oh_my_codex`
- A bounded standalone CLI with staged `start`, validation,
  handoff, local closeout projection, explicit admission, and
  mechanical execution-artifact validation
- A host-agnostic semantic + interop boundary for external AI
  hosts

## Bootstrap Posture

`config/bootstrap.yaml` declares the package's bootstrap state:

| Field | Value |
| --- | --- |
| `bootstrap_contract` | `nimicoding.bootstrap` |
| `bootstrap_contract_version` | 1 |
| `profile` | `default` |

A host project picks up the bootstrap when `nimicoding start`
runs. The host project is then a Nimi-Coding-adopting project.

## Skill Manifest

`config/skills.yaml` declares four skill surfaces (see
[Skills](/nimicoding/skills) for detail):

| Skill | Required |
| --- | --- |
| `spec_reconstruction` | yes |
| `doc_spec_audit` | yes |
| `audit_sweep` | no |
| `high_risk_execution` | no |

Bootstrap state declares `runtime_installed: false`,
`installation_mode: deferred`. The package does not assume
runtime presence; an external host implements skills.

## Host Profile

`config/host-profile.yaml` declares vendor-neutral host
expectations:

| Property | Value |
| --- | --- |
| `host_class` | `ai_native_coding_host` |
| `runtime_contract_ref` | `.nimi/methodology/skill-runtime.yaml` |
| `compatibility_contract_ref` | `.nimi/contracts/external-host-compatibility.yaml` |
| `ownership_mode` | `external` |
| `execution_mode` | `delegated` |
| `install_state` | `not_installed` |
| `self_hosted` | `false` |

Required host capabilities are minimal:

- `read_project_local_nimi_truth`
- `route_declared_external_skills`
- `fail_closed_on_missing_authority`

Hard host constraints:

- `vendor_neutral_profile_only`
- `do_not_assume_local_runtime_install`
- `do_not_claim_packet_orchestration_ownership`

## Reader Scenario: A Project Adopting The Package

A project wants to adopt Nimi Coding methodology.

1. **Acquire the package.** Install
   `@nimiplatform/nimi-coding` from npm as described in
   [Installation](/nimicoding/installation).
2. **Run bootstrap.** `nimicoding start` initializes
   `.nimi/**` in the project root.
3. **Project source projected.** Package's methodology /
   contracts / config / spec source is projected into project
   paths.
4. **Spec reconstruction skill becomes available.** Project can
   hand off to its admitted external AI host for canonical spec
   reconstruction.
5. **Methodology in use.** Project can now admit topics, freeze
   packets, run preflight, dispatch worker (via host),
   record audit, close out waves.

The package adopts the project; the project gets the
methodology layer.

## Reader Scenario: Switching AI Hosts

A project that adopted Nimi Coding under one AI host wants to
switch to a different host.

1. **No methodology change.** `.nimi/methodology/` and
   `.nimi/contracts/` stay the same.
2. **Host adapter swap.** The adapter overlay
   (`adapters/<host-name>/profile.yaml`) is the host-specific
   piece that changes.
3. **Same packets.** Existing topic / wave / packet artifacts
   continue to be the canonical work record.
4. **Same closure conditions.** Four-closure framework continues
   to apply.

The methodology lives in the project; the host is interchangeable.

## What The Package Currently Doesn't Do

If you're hoping to use Nimi Coding for things outside its
admitted scope, the answer is "not yet, by design." Specifically:

- **No automated packet execution.** The CLI bootstraps and
  validates; it does not execute packets autonomously.
- **No built-in scheduling.** Scheduling lives outside the
  package.
- **No provider-backed execution.** The package does not call
  AI providers itself; the host AI does.
- **No self-hosted methodology runtime.** Runtime ownership stays
  external.

These are deferred, not abandoned. They live outside the
boundary-complete standalone scope.

## Source Basis

- [`nimi-coding/README.md`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/README.md)
- [`nimi-coding/package.json`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/package.json)
- [`nimi-coding/AGENTS.md`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/AGENTS.md)
- [`nimi-coding/config/bootstrap.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/config/bootstrap.yaml)
- [`nimi-coding/config/skills.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/config/skills.yaml)
- [`nimi-coding/config/host-profile.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/config/host-profile.yaml)
- [`nimi-coding/spec/bootstrap-state.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/spec/bootstrap-state.yaml)
- [`nimi-coding/spec/product-scope.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/spec/product-scope.yaml)
