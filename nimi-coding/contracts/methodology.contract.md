# Methodology Contract

`nimi-coding` is AI-first software delivery against a layered, enforceable source of truth.

Its base lifecycle is:

`Rule -> Table -> Generate -> Check -> Evidence`

Its execution-orchestration extension is:

`Preflight -> Converge -> Phase Freeze -> Dispatch -> Execute -> Verify -> Accept -> Close / Reject / Defer`

Its human-converged autonomous delivery posture is:

- human-heavy before freeze
- inline manager-worker by default after freeze
- automation-heavy or provider-backed execution only when the packet or operating context justifies it
- continuity-agnostic by design: recoverable governance is required, persistent manager presence is not
- explicit escalation on bounded packet-declared conditions
- manager-owned phase and terminal run closeout
- optional final human overall acceptance before topic closeout

## Core Rules

1. `spec/**` is the only normative product authority.
2. `.local/**` is local-only and never committed.
3. `nimi-coding/**` is the promoted system layer for reusable `nimi-coding` components.
4. Any machine-checkable rule should be enforced by validators or gates.
5. Evidence is required for closeout; assertion is insufficient.
6. Post-freeze automation may continue only against a frozen execution packet; it must not replace manager semantic acceptance, and it must not confuse per-phase closeout with optional final human overall acceptance.
7. Resumable autonomous mode may persist orchestration state, but that state remains packet-bound run position only; it does not become semantic authority.
8. Provider-backed worker invocation and worker runner signaling may be formalized as protocol-only operational surfaces, but they must not become product authority, semantic acceptance authority, or topic-state ownership.
9. `nimi-coding` is the formal system for high-risk work: authority-bearing redesign, large refactor, cross-layer change, or multi-phase delivery. It is not the default entry path for every code or spec edit.
10. Token-cost discussion belongs to methodology audit and workflow evaluation only. It must not become a routine topic artifact, phase gate, or everyday execution metric.
11. `nimi-coding` is continuity-agnostic. It requires durable artifacts, packet-bound state, and recoverable governance, but it does not require a persistent manager process, heartbeat, daemon, or session-continuity substrate.
12. Any full-automation, persistent-manager, or harness-level continuity system may extend `nimi-coding`, but it must do so as an outer engineering layer rather than redefining the methodology itself.
13. Same-owner, same-lifecycle, or same-consumer stages must not be split into new authority surfaces by default. If the distinction is only phased naming, keep it inside one surface rather than opening another packet family.
14. Repeated same-family packet decomposition is a methodology failure. Once one capability chain already has repeated `preflight`, `boundary`, or `seed` slices, the next allowed step is collapse/audit or implementation, not another decomposition packet.
15. Validator and gate behavior should fail-close on capability-chain fragmentation when a topic belongs to an over-fragmented family and is not itself the collapse/audit repair.

## Module Ownership

- `nimi-coding/**` is the formal execution system module with its own `AGENTS.md` defining ownership, script tiers, and workflow rules.
- `nimi-coding/.local/**` is the topic workspace. Topics there are validated by this module's scripts but are not part of the module.
- Promotion from `nimi-coding/.local/**` into `nimi-coding/**` follows `gates/promotion-policy.yaml`.

## Explicit Non-Goals

- `nimi-coding/**` does not own repo-wide collaboration hygiene (e.g., `AGENTS.md` freshness, legacy doc alias policing).
- Those checks remain in root `scripts/` even when they are adjacent to `nimi-coding` practice.
- `nimi-coding/**` does not own or modify topic workspace content in `nimi-coding/.local/**`.
