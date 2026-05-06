# Mod Workspace

Mod Workspace is the place inside Desktop where mod-extension UI
renders. Each installed mod gets a tab; each tab can be marked
`fused` (circuit-breakered) when the mod is failing. Mod codegen
and the runtime mod panel live in the same workspace family.

## What Mod Workspace Provides

| Surface | Behavior |
| --- | --- |
| Mod-UI tab | Each installed mod renders in its own tab |
| Tab lifecycle | `enable | disable | uninstall` |
| Circuit breaker | Failing mods get `fused` flag; tab isolates the failure |
| Renderer | Renderer-agnostic; mods do not couple to the browser directly |

A workspace tab is a real isolation boundary. A mod that fails
in its tab does not crash Desktop; the circuit breaker fuses the
tab.

## Mod Lifecycle

| Transition | Behavior |
| --- | --- |
| `enable` | Mod tab becomes active; mod runs |
| `disable` | Mod tab is paused; mod is loaded but not running |
| `uninstall` | Mod tab is removed; mod is unregistered |
| Failure → `fused` | Circuit breaker fuses the tab; user can choose to retry or uninstall |

Failures circuit-break **the tab**, not the entire Desktop. This
is what makes installing experimental mods safe.

## Mod Codegen

Mod Codegen is a workspace surface for generating new mod scaffold
code under a controlled execution kernel.

| Property | Value |
| --- | --- |
| Execution kernel | Controlled |
| Capability tier whitelisting | Admitted |
| Hook capability validation | Admitted |
| Output | Mod scaffold under capability tier |

A developer who uses Codegen to scaffold a mod gets typed
boilerplate that already conforms to admitted capability tier and
hook capability allowlists. This is what keeps "writing a new
mod" from requiring deep platform knowledge.

## Runtime Mod Panel

When a mod has runtime-side concerns (AI dependency, runtime
capability allocation), the runtime mod panel surfaces those
concerns. This is the cross-domain bridge between Desktop mod
workspace and Runtime config.

## Reader Scenario: A Mod Tab Fails

A mod you installed crashes due to a bug.

1. **Mod tab runs.** Active until the failure.
2. **Failure detected.** The mod surfaces an unhandled exception
   or fails an admitted invariant.
3. **Circuit breaker fires.** The tab is marked `fused`.
4. **Desktop continues.** Desktop's other surfaces are
   unaffected. Other mods continue running.
5. **User options.** The user can attempt to reload the tab
   (clear the fuse), disable the mod, or uninstall.

A single buggy mod does not bring down the Desktop. The fuse is
the isolation boundary.

## Reader Scenario: A Developer Creates A New Mod With Codegen

A developer wants to scaffold a new mod that reacts to chat
turns.

1. **Open Mod Codegen.** In the workspace.
2. **Choose template.** A turn-hook reactive mod template.
3. **Capability tier.** The codegen offers admitted capability
   tiers; the developer chooses appropriate.
4. **Generate.** Codegen produces scaffold code with admitted
   hook capabilities pre-validated.
5. **Develop.** The developer extends the scaffold under the
   admitted contract.
6. **Register as dev source.** They add the path under
   Developer Mode.
7. **Mod runs in workspace.** The new mod appears as a tab.

The codegen scaffolding makes the admitted contract the default;
free-form deviation is structurally discouraged.

## Reader Scenario: A Mod That Talks To Runtime AI Dependencies

A mod needs an AI capability that requires a specific runtime
configuration.

1. **Mod declares dependency.** As part of its manifest, the mod
   declares the runtime AI capability it needs.
2. **Runtime mod panel surfaces.** The runtime mod panel shows
   the dependency state.
3. **Resolution.** Through admitted resolution flow (provider
   selection, model binding), the dependency becomes available.
4. **Mod runs.** The mod's capability is now reachable.

The mod did not invent its own runtime configuration path; the
runtime mod panel is the admitted bridge.

## What Workspace Does Not Do

| Concern | Why not |
| --- | --- |
| Allow mods to bypass into raw runtime | Mods consume host-injected capabilities only |
| Allow mods to talk to the browser directly | Renderer-agnostic shell; no direct browser access |
| Allow mods to mutate Realm truth without Realm contracts | Realm contracts are the only path to canonical mutation |

## Source Basis

- [`.nimi/spec/desktop/mod-workspace.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/mod-workspace.md)
- [`.nimi/spec/desktop/mod-codegen.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/mod-codegen.md)
- [`.nimi/spec/desktop/mod-development.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/mod-development.md)
- [`.nimi/spec/desktop/kernel/mod-governance-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/mod-governance-contract.md)
- [`.nimi/spec/desktop/kernel/hook-capability-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/hook-capability-contract.md)
- [`.nimi/spec/desktop/kernel/tables/hook-capability-allowlists.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/tables/hook-capability-allowlists.yaml)
- [`.nimi/spec/desktop/kernel/tables/ui-slots.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/tables/ui-slots.yaml)
- [`.nimi/spec/desktop/kernel/tables/mod-access-modes.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/tables/mod-access-modes.yaml)
