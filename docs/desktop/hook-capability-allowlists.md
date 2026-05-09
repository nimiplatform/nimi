# Hook Capability Allowlists

## Status: Admitted, in build-out

The Desktop hook capability contract
(`desktop/kernel/hook-capability-contract.md`) and the allowlist
tables (`tables/hook-capability-allowlists.yaml`,
`tables/hook-subsystems.yaml`) are admitted at the kernel level.
Mod-facing hook surface integration is in active build-out.

## What Hook Capability Allowlists Are

Mods reach Desktop subsystems through **typed hooks**. Each hook
admits a closed set of capabilities — the mod can do exactly what
the allowlist permits, no more. The allowlists are spec-admitted
**closed enums**, not user-configurable settings.

## Why Closed Enums

If allowlists were user-configurable:
- A misconfigured mod could be granted capabilities outside its
  declared need
- The audit boundary would shift from spec to per-installation state
- "what can mod X do" would depend on which user installed it on
  which day

Closed enums make the answer to "what can mod X do" derivable from
spec + the mod manifest, not from per-machine state.

## Authority Surface

| Concern | Authority |
| --- | --- |
| Hook capability contract | `desktop/kernel/hook-capability-contract.md` |
| Allowlist table | `tables/hook-capability-allowlists.yaml` |
| Subsystem table | `tables/hook-subsystems.yaml` |

The tables list per-hook capability sets and per-subsystem hook
surfaces. Both are closed; new capability or subsystem requires
admission.

## Reader Scenario: A Mod Declares Hook Capabilities

A mod author writes a mod that uses Desktop chat turn hooks.

1. **Mod manifest declares capabilities.** Per the closed allowlist
   for the chat turn hook surface.
2. **Mod loads.** Desktop validates manifest capabilities against
   admitted allowlist.
3. **Mod runs.** Hook calls succeed only for declared capabilities.
4. **Capability beyond allowlist.** Rejected at hook dispatch — not
   silently passed through.

## What Hook Capability Allowlists Do Not Do

- They are not user-configurable.
- They do not let mods invent new capabilities by convention.
- They do not silently grant beyond what the manifest declared.
- They do not let per-installation state override spec-admitted
  enum.

## Source Basis

- [`.nimi/spec/desktop/kernel/hook-capability-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/hook-capability-contract.md)
- [`.nimi/spec/desktop/kernel/tables/hook-capability-allowlists.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/tables/hook-capability-allowlists.yaml)
- [`.nimi/spec/desktop/kernel/tables/hook-subsystems.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/tables/hook-subsystems.yaml)
