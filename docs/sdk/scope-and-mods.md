# Scope And Mods

`@nimiplatform/sdk/scope` projects authorization and catalog
lifecycle for apps. `@nimiplatform/sdk/mod` is the host-injected
mod facade through which mods consume capabilities. Both are
distinct sub-paths because they answer different questions; both
are kept inside the SDK boundary.

## `sdk/scope` — Authorization Projection

The scope sub-path projects authorization state into typed app
surface.

| Concern | What scope covers |
| --- | --- |
| Catalog | Authorized scopes available to this app |
| Lifecycle | Scope acquisition, renewal, revocation |
| Token shape | Typed bearer / scoped token surface |
| Boundary | Apps consume scope; runtime owns token issuance |

Apps that need authorization do not invent token shapes. They
consume the scope sub-path; runtime decides what is admitted.

## `sdk/mod` — Host-Injected Mod Facade

The mod sub-path is **host-injected**. A mod does not import a
generic mod runtime; the host (Desktop) injects capabilities into
the mod's facade. This is what keeps mods bounded to their
admitted hook capabilities.

| Property | Value |
| --- | --- |
| Injection direction | Host → mod |
| Mod surface | `createHookClient(...)` style host injection |
| Storage | `createModKvStore(...)` — sqlite-backed |
| Renderer decoupling | Mods do not talk to the browser directly |
| Tab identity | `tabId` is the only stable runtime identity |
| UI slots | Mods render into admitted UI slots |

A mod that tries to import generic browser surfaces or generic
runtime modules bypasses the boundary; mods consume the host
injection.

## What `sdk/mod` Surfaces

| Surface | Purpose |
| --- | --- |
| Hooks | Admitted hook capability allowlist |
| UI slots | Admitted UI slot bindings (where the mod can render) |
| i18n | Mod-local internationalization helpers |
| Settings | Mod settings surface |
| KV storage | sqlite-backed key-value store |
| Lifecycle | `enable | disable | uninstall` |

Each is admitted under contract. New surfaces require kernel
admission.

## Reader Scenario: An App Reads Its Authorized Scopes

An app needs to know what it can do.

1. **Import scope.** `import { createScopeClient } from
   '@nimiplatform/sdk/scope';`.
2. **Read catalog.** The app queries the typed scope catalog;
   admitted scopes are listed.
3. **Lifecycle subscription.** The app subscribes to scope
   lifecycle events (acquired, revoked).
4. **Use.** When acting under a scope, the app references the
   scope id; runtime validates against the admitted token.

The app does not pretend to have a scope it does not have. The
scope sub-path is read-truth, not read-and-modify.

## Reader Scenario: A Mod Registers Hook Capabilities

A mod author writes a mod that wants to react to a chat turn.

1. **Import mod surface.** `import { createHookClient } from
   '@nimiplatform/sdk/mod';`.
2. **Host-injected client.** The host (Desktop) provides the hook
   client when the mod loads.
3. **Admitted hook point.** The mod registers against an admitted
   turn-hook point. Unadmitted hook points are rejected.
4. **Capability allowlist.** The mod's capabilities are the
   allowlisted hooks for its declared profile.
5. **Runtime event arrives.** When a turn happens, the mod
   receives a typed event under the admitted hook capability
   shape.
6. **Mod responds.** Within its allowlist; never bypassing into
   raw Runtime or Realm calls.

A mod that wants a hook the kernel has not admitted has only one
correct path: admit the hook into the allowlist. The mod cannot
side-step.

## Reader Scenario: A Mod Stores Settings

A mod needs to persist user-specific settings.

1. **Import storage.** `import { createModKvStore } from
   '@nimiplatform/sdk/mod';`.
2. **Open store.** The host injects an sqlite-backed kv store
   for this mod.
3. **Get / set.** Typed get / set / list operations against the
   store.
4. **Scope.** The store is mod-private; another mod cannot read
   it.

The mod did not build its own storage layer; it did not write a
file to disk; it did not abuse the browser localStorage. The
host-injected store is the admitted path.

## Why Two Sub-Paths

`sdk/scope` answers "what authorization does this app have."
`sdk/mod` answers "what capabilities does this mod have." They
overlap conceptually (both are about what's permitted), but they
solve different developer experiences:

- An app developer reads scope to plan UX flows.
- A mod developer registers against hook capabilities to extend
  Desktop.

Keeping the sub-paths distinct makes each one's contract crisp.

## Boundary Summary

| Concern | Owner |
| --- | --- |
| Scope catalog | Runtime + admitted scope contract |
| Token issuance | Runtime authority |
| Mod hook allowlist | Desktop kernel `hook-capability-contract` |
| Mod KV store implementation | Host (Desktop) injection |
| Mod UI slot bindings | Desktop kernel `ui-slots` table |

## Source Basis

- [`.nimi/spec/sdk/scope.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/scope.md)
- [`.nimi/spec/sdk/mod.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/mod.md)
- [`.nimi/spec/sdk/kernel/scope-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/scope-contract.md)
- [`.nimi/spec/sdk/kernel/mod-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/mod-contract.md)
- [`.nimi/spec/sdk/kernel/boundary-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/boundary-contract.md)
- [`.nimi/spec/sdk/kernel/surface-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/surface-contract.md)
- [`.nimi/spec/desktop/kernel/hook-capability-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/hook-capability-contract.md)
- [`.nimi/spec/desktop/kernel/mod-governance-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/mod-governance-contract.md)
- [`.nimi/spec/desktop/kernel/tables/hook-capability-allowlists.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/tables/hook-capability-allowlists.yaml)
- [`.nimi/spec/desktop/kernel/tables/ui-slots.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/tables/ui-slots.yaml)
- [`.nimi/spec/desktop/kernel/tables/turn-hook-points.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/tables/turn-hook-points.yaml)
- [`.nimi/spec/runtime/kernel/scoped-app-binding-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/scoped-app-binding-contract.md)
- [`.nimi/spec/platform/kernel/tables/app-authorization-presets.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/tables/app-authorization-presets.yaml)
