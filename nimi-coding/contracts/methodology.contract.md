# Methodology Contract

`nimi-coding` is AI-first software delivery against a layered, enforceable source of truth.

Its base lifecycle is:

`Rule -> Table -> Generate -> Check -> Evidence`

Its execution-orchestration extension is:

`Preflight -> Converge -> Phase Freeze -> Dispatch -> Execute -> Verify -> Accept -> Close / Reject / Defer`

Its human-converged autonomous delivery posture is:

- human-heavy before freeze
- automation-heavy after freeze
- explicit escalation on bounded packet-declared conditions
- final human confirmation before terminal closeout

## Core Rules

1. `spec/**` is the only normative product authority.
2. `.local/**` is local-only and never committed.
3. `nimi-coding/**` is the promoted system layer for reusable `nimi-coding` components.
4. Any machine-checkable rule should be enforced by validators or gates.
5. Evidence is required for closeout; assertion is insufficient.
6. Post-freeze automation may continue only against a frozen execution packet; it must not replace human semantic acceptance or final confirmation.
7. Resumable autonomous mode may persist orchestration state, but that state remains packet-bound run position only; it does not become semantic authority.
8. Provider-backed worker invocation and worker runner signaling may be formalized as protocol-only operational surfaces, but they must not become product authority, semantic acceptance authority, or topic-state ownership.

## Module Ownership

- `nimi-coding/**` is the formal execution system module with its own `AGENTS.md` defining ownership, script tiers, and workflow rules.
- `.local/coding/**` is the topic workspace. Topics there are validated by this module's scripts but are not part of the module.
- Promotion from `.local/coding/**` into `nimi-coding/**` follows `gates/promotion-policy.yaml`.

## Explicit Non-Goals

- `nimi-coding/**` does not own repo-wide collaboration hygiene (e.g., `AGENTS.md` freshness, legacy doc alias policing).
- Those checks remain in root `scripts/` even when they are adjacent to `nimi-coding` practice.
- `nimi-coding/**` does not own or modify topic workspace content in `.local/coding/**`.
