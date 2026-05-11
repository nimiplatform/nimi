# Desktop Mods

Mods are bounded Desktop extensions. They are powerful because they run
near the user surface, so their capability model needs explicit
governance.

The kernel rules behind this page live under the Desktop mod governance
contract, the hook capability contract, and the related allowlist
tables.

## The Mod Boundary

Mods should use admitted hook capabilities. They should not bypass
Runtime, SDK, or Desktop contracts, and they should not create private
behavior that contradicts the host shell.

For a reader, the key idea is that a mod's power is supposed to come
from admitted hook surfaces, not from raw access. The host shell offers
typed hook points; a mod participates by registering against those
points within the allowlist.

## Reader Scenario: A Mod That Wants To Read Conversation Context

Suppose a mod author wants their mod to react when a turn happens in a
conversation surface:

1. The author looks up which turn-hook points are admitted in the
   Desktop hook capability table.
2. The mod registers against the admitted hook point. It doesn't
   subscribe to private conversation events.
3. When a turn happens, the mod receives a typed event under the
   admitted contract.
4. The mod's response is bounded by the admitted hook capability
   allowlist.

If the mod wanted a hook that does not yet exist, the right path is to
propose admitting a new hook point, not to invent a private one.

## Reader Scenario: A Mod That Tries To Read Sensitive Tokens

Suppose a mod tries to read sensitive credential material directly.
Desktop's mod governance contract does not admit raw access to that
material. The hook capability allowlist does not include "give me
arbitrary tokens." The expected behavior is:

- The mod cannot reach the sensitive surface.
- The mod's allowlist is enforced.
- If the mod's purpose genuinely requires bridging through a
  capability, that capability has to be admitted into the allowlist
  first.

This is what keeps mods safe to install. The user does not have to
audit every mod for direct credential access; the contract layer
already constrains that surface.

## Mod Lifecycle

A mod has a defined lifecycle in the Desktop mod governance contract:

- A mod is admitted into the system through governance.
- It can be installed, activated, suspended, or removed.
- Each transition follows the mod-lifecycle states table.

Public docs do not enumerate the full state machine here; the kernel
table is authoritative.

## What Public Docs Can Say

Public docs can describe the governance model: the mod lifecycle, the
allowlisted hook capabilities, and the host-injected surface. They
should not imply that all mod capabilities are generally available to
the public until the implementation and release evidence exists.

Specifically, the Avatar, Cognition, or Runtime surfaces that mods
might want to consume are still gated by their own admission. A mod
cannot use a capability that has not been admitted into the
hook-capability allowlist, even if the underlying domain has admitted
it elsewhere.

## Source Basis

- [`.nimi/spec/desktop/kernel/mod-governance-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/mod-governance-contract.md)
- [`.nimi/spec/desktop/kernel/hook-capability-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/hook-capability-contract.md)
- [`.nimi/spec/desktop/kernel/tables/mod-lifecycle-states.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/tables/mod-lifecycle-states.yaml)
- [`.nimi/spec/desktop/kernel/tables/hook-capability-allowlists.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/tables/hook-capability-allowlists.yaml)
- [`.nimi/spec/desktop/kernel/tables/turn-hook-points.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/tables/turn-hook-points.yaml)
- [`.nimi/spec/desktop/kernel/tables/ui-slots.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/tables/ui-slots.yaml)
- [`.nimi/spec/desktop/kernel/tables/mod-access-modes.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/tables/mod-access-modes.yaml)
- [`.nimi/spec/desktop/kernel/tables/mod-kernel-stages.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/tables/mod-kernel-stages.yaml)
