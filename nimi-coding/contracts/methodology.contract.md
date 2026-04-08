# Methodology Contract

`nimi-coding` is AI-first software delivery against a layered, enforceable source of truth.

Its base lifecycle is:

`Rule -> Table -> Generate -> Check -> Evidence`

Its execution-orchestration extension is:

`Preflight -> Converge -> Phase Freeze -> Dispatch -> Execute -> Verify -> Accept -> Close / Reject / Defer`

## Core Rules

1. `spec/**` is the only normative product authority.
2. `.local/**` is local-only and never committed.
3. `nimi-coding/**` is the promoted system layer for reusable `nimi-coding` components.
4. Any machine-checkable rule should be enforced by validators or gates.
5. Evidence is required for closeout; assertion is insufficient.

## Module Ownership

- `nimi-coding/**` is the formal execution system module with its own `AGENTS.md` defining ownership, script tiers, and workflow rules.
- `.local/coding/**` is the topic workspace. Topics there are validated by this module's scripts but are not part of the module.
- Promotion from `.local/coding/**` into `nimi-coding/**` follows `gates/promotion-policy.yaml`.

## Explicit Non-Goals

- `nimi-coding/**` does not own repo-wide collaboration hygiene (e.g., `AGENTS.md` freshness, legacy doc alias policing).
- Those checks remain in root `scripts/` even when they are adjacent to `nimi-coding` practice.
- `nimi-coding/**` does not own or modify topic workspace content in `.local/coding/**`.
