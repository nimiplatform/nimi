# Host-Agnostic Boundary

The single most distinctive property of the Nimi Coding package
is that it is **vendor-neutral and host-agnostic**. The package
ships methodology and contracts; any contract-observing AI host
provides execution. Switching hosts does not change the
methodology contract.

This is unique in AI engineering tooling. Most AI coding products
are host-coupled — Cursor's behavior is Cursor's behavior;
Copilot's behavior is Copilot's. Nimi Coding's positioning is
that the methodology lives in the **project**, not in the
**tool**, and the tool is interchangeable.

## What "Host" Means Here

A "host" in this context is the AI environment that actually
performs the work — reads contracts, runs the skill (e.g.,
`spec_reconstruction`), produces output for the package to admit.

| Property | Value |
| --- | --- |
| Host class | `ai_native_coding_host` |
| Ownership mode | `external` |
| Execution mode | `delegated` |
| Install state | `not_installed` (package does not install runtime) |
| Self-hosted | false |

The package does not own the host. The package projects context
into the project, hands off skill requests, and admits results
under typed contracts.

## Required Host Capabilities

Minimal and explicit:

| Capability | What it requires |
| --- | --- |
| `read_project_local_nimi_truth` | Host must read `.nimi/methodology`, `.nimi/spec`, `.nimi/contracts` |
| `route_declared_external_skills` | Host can dispatch the four declared skills |
| `fail_closed_on_missing_authority` | Host must not synthesize output when required authority is absent |

A host that satisfies these three is admitted. The package does
not require host-specific features beyond these.

## Hard Host Constraints

| Constraint | What it forbids |
| --- | --- |
| `vendor_neutral_profile_only` | Host adapter cannot smuggle vendor-specific contracts |
| `do_not_assume_local_runtime_install` | Host cannot require local runtime presence |
| `do_not_claim_packet_orchestration_ownership` | Host cannot pretend to own packet lifecycle |

The constraints are what make the package portable.

## How The Same Project Switches Hosts

| Concern | Stays the same | Changes |
| --- | --- | --- |
| `.nimi/spec/**` (project canonical truth) | yes | — |
| `.nimi/methodology/**` (policies) | yes | — |
| `.nimi/contracts/**` (schemas) | yes | — |
| Topic artifacts (closed and pending) | yes | — |
| Adapter overlay path | — | yes (host-specific) |

The change is the adapter. The methodology is portable.

## Why The Two Constraints Compose

`vendor_neutral_profile_only` + `do_not_claim_packet_orchestration_ownership`
together mean:

- A host adapter can be added for a specific vendor (e.g.,
  `oh-my-codex`).
- The adapter is admitted as a **constrained bridge**, not as
  semantic owner.
- Host-specific behavior lives in the adapter, not in the
  methodology.

This is what allows `oh-my-codex`, Codex, Claude, Gemini, and
others to be admitted as bridges without making the package
vendor-coupled.

## Adapter Overlay Pattern

The package ships adapter overlays under
`adapters/<host-name>/profile.yaml`. An admitted overlay declares
host-specific properties without changing the package's
vendor-neutral core.

| Adapter overlay path | Purpose |
| --- | --- |
| `adapters/oh-my-codex/profile.yaml` | Admits `oh-my-codex` as a constrained external execution host |

For more on `oh-my-codex` specifically, see
[Appendix → oh-my-codex](/nimicoding/appendix/oh-my-codex).

Other host overlays can be added under the same pattern. Each
overlay names which host-class capabilities the host satisfies
and any host-specific routing details that the package can use
without becoming vendor-coupled.

## Reader Scenario: The Same Project Used With Two Hosts

A project adopts Nimi Coding under host A. Later, the team
decides to use host B for some work.

1. **Project state.** All `.nimi/**` artifacts in place.
2. **Adopt host B.** Add or admit the adapter overlay for B
   (`adapters/B/profile.yaml`).
3. **Switch hosts for new work.** New topic / wave / packet uses
   host B; old artifacts under host A stay valid.
4. **Cross-host audits.** A wave authored under host A can be
   audited under host B (independent loop guarantee).
5. **Methodology unchanged.** Same four-closure framework, same
   role separation, same forbidden-shortcuts catalog.

The portability is the product.

## Reader Scenario: A Host That Doesn't Meet Required Capabilities

A new AI host wants to be used with a Nimi-Coding-adopting
project. The host satisfies `read_project_local_nimi_truth` but
not `fail_closed_on_missing_authority` (it synthesizes output
when authority is absent).

1. **Compatibility check.** Host adapter compatibility contract
   evaluates capability flags.
2. **Required capability missing.** `fail_closed_on_missing_authority`
   is required.
3. **Refuse admission.** The host is not admitted as a bridge.
4. **Path forward.** Either fix the host (no synthesis on
   missing authority) or do not use it for Nimi-Coding-governed
   work.

The capability requirements are what keep methodology integrity
under host swaps.

## Reader Scenario: A Solo Founder Using Two Hosts

A solo founder uses host A for primary AI work and host B for
audit (different blind spots).

1. **Primary work.** Host A is the manager + worker (in
   `inline_manager_worker` mode for low-risk work, or as worker
   only in `manager_worker_auditor` mode).
2. **Audit.** Host B runs the auditor role on host A's output.
3. **Same methodology.** Both hosts are admitted under the same
   `.nimi/methodology/**` contracts.
4. **Independent blind spots.** Host A's failure modes do not
   carry into host B's audit.

This is the methodology's solo-founder pitch: simulate the
review redundancy a team would provide, by routing the audit
through a different host.

## What Host-Agnostic Does Not Mean

| Statement | Truth |
| --- | --- |
| "The package runs without any AI host" | False — adoption requires admitted host |
| "Any AI tool works as a host" | False — host must satisfy required capabilities |
| "Adapters are unbounded" | False — adapters are admitted under compatibility contract |
| "The methodology can change per host" | False — methodology is package-owned and host-invariant |

The promise is **host-swappable**, not **host-free**.

## Source Basis

- [`nimi-coding/AGENTS.md`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/AGENTS.md)
- [`nimi-coding/config/host-profile.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/config/host-profile.yaml)
- [`nimi-coding/config/host-adapter.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/config/host-adapter.yaml)
- [`nimi-coding/methodology/skill-runtime.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/methodology/skill-runtime.yaml)
- [`nimi-coding/contracts/external-host-compatibility.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/external-host-compatibility.yaml)
- [`nimi-coding/adapters/oh-my-codex/profile.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/adapters/oh-my-codex/profile.yaml)
