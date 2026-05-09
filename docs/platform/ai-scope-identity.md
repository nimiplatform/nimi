# AI Scope Identity

## Status: Admitted, in build-out

`AIScopeRef` is admitted at the kernel level
(`P-AISC-001..P-AISC-005`). Phase 1 mod-scoped AI configuration is
running today; remaining scope kinds (app, module, feature) are
admitted as direction with their consumer surfaces in active
build-out.

## What `AIScopeRef` Is

`AIScopeRef` is the **canonical identity contract** for AI
configuration scope. It answers: "whose AI config is this?" with a
stable, unique key that does not depend on transient UI state.

```
AIScopeRef {
  kind: 'app' | 'mod' | 'module' | 'feature'
  ownerId: string
  surfaceId?: string
}
```

The `kind + ownerId + surfaceId?` triple forms a stable unique key
across the entire system.

## Closed Kind Enum

| `kind` | Owner identity | Notes |
| --- | --- | --- |
| `app` | App identity | `surfaceId` may identify an independent AI feature surface inside the app |
| `mod` | Stable mod manifest id | Must NOT use route page id, tab key, conversation id, document id, project id, prompt config id, or profile id |
| `module` | Independent module identity | Only when the module itself is a canonical owner |
| `feature` | Cross-app/mod reusable feature owner | Must not fragment what should be mod-owned AI truth |

The kind enum is **closed**. Apps, mods, and consumers cannot invent
a fifth kind.

## Phase 1 Mod-Scoped Canonical Shape

The canonical shape for Phase 1 mod-scoped AI configuration is fixed:

```
AIScopeRef {
  kind: 'mod'
  ownerId: <stable mod manifest id>
  surfaceId: 'workspace'
}
```

`surfaceId: 'workspace'` represents the mod's single canonical AI
workspace. Until a later kernel rule explicitly defines alternatives,
mod-scoped AI configuration consumers must not omit `surfaceId` and
must not invent replacement values.

## Why Scope Identity Matters

Without a canonical scope identity, the platform ends up with a mess
of ad-hoc keys: "this AI config belongs to tab 3 of mod foo session
A" — keys that depend on UI state, that cannot survive app restart,
that cannot be consistently looked up across surfaces.

`AIScopeRef` rules eliminate these failure modes:

| Rule | What it prevents |
| --- | --- |
| Closed `kind` enum | Consumers cannot invent new scope kinds |
| Stable mod manifest id required | UI-local keys cannot become AI scope identity |
| Single canonical workspace per mod by default | Tab / session / thread proliferation cannot create silent scope explosion |
| No implicit inheritance | Scope A's config does not silently fall back to scope B |
| Owner-driven lifecycle | Scope creation / destruction binds to owner entity lifecycle |

## No Implicit Inheritance

There is no inheritance chain between scopes. Each scope's `AIConfig`
is fully materialized. If a product wants "inherit defaults from a
parent scope" UX, the implementation is **profile apply**
(copy-on-write) — never a runtime fallback chain.

## Cross-Surface Applicability

`AIScopeRef` applies uniformly to Desktop and Web. Surface-specific
behavior differences live in their own kernel contracts; this contract
does not introduce surface-specific rules.

## Allowed Consumers

`AIScopeRef` may be consumed by:

| Consumer | Purpose |
| --- | --- |
| Desktop Kernel | `AIConfig` keyed storage and UI scope selection |
| SDK Kernel | Typed `config / profile / snapshot` API scope parameter |
| Runtime Kernel | Execution snapshot scope evidence |

Consumers must not extend `AIScopeRef` schema with consumer-local
fields. Annotation needs go in independent consumer-local annotation
records — never by mutating `AIScopeRef`.

## Reader Scenario: A Mod Configures Its AI Workspace

A mod author writes a mod that uses AI in a workspace surface.

1. **Manifest identity.** The mod ships with a stable manifest id
   (e.g., `com.example.notes`).
2. **Scope identity.** Desktop bridges the mod's AI configuration
   under `AIScopeRef{ kind: 'mod', ownerId: 'com.example.notes',
   surfaceId: 'workspace' }`.
3. **Profile apply.** User picks a profile in the AI config UI;
   profile applies (copy-on-write) into the workspace scope's
   `AIConfig`.
4. **Persistence.** Config is keyed by the canonical scope identity;
   it survives app restart.

## Reader Scenario: A Mod With Multiple Workspaces (Rare)

Suppose a mod genuinely hosts multiple first-class AI workspaces —
each with its own profile apply / probe / snapshot history.

1. **Explicit scope expansion.** The mod admits multiple
   `AIScopeRef{ kind: 'mod', ownerId: <manifest>, surfaceId: <stable
   workspace name> }` instances.
2. **Stable workspace names.** Surfaces must be human-recognizable;
   `surfaceId` is not a transient ui key.
3. **Not per-tab / per-session / per-document.** If the user is just
   switching the current document inside one workspace, that's domain
   state inside the one workspace scope — not a new `AIScopeRef`.

The contract guards against scope proliferation precisely because
proliferation breaks the stability that makes config reliable.

## Reader Scenario: Scope Lifecycle Bound To Owner

A user uninstalls a mod.

1. **Owner entity destroyed.** The mod manifest is removed.
2. **Scope destroyed.** All `AIScopeRef` instances tied to that mod
   are destroyed in lockstep.
3. **Bound `AIConfig` cleaned.** Config tied to the destroyed scope
   is invalidated or cleaned. No dangling configs survive.

## What Scope Identity Does Not Do

- It does not transfer ownership across consumers.
- It does not allow runtime fallback between scopes.
- It does not let UI keys become scope identity.
- It does not allow `AIConfig` from scope A to reference scope B's
  config as fallback.
- It does not allow consumers to extend the schema with their own
  fields.

## Boundary Summary

| Concern | Owner |
| --- | --- |
| `AIScopeRef` schema + identity rules | Platform (`P-AISC-*`) |
| `AIConfig` storage keyed by `AIScopeRef` | Desktop kernel |
| Scope parameter on SDK config / profile / snapshot APIs | SDK kernel |
| Execution snapshot scope evidence | Runtime kernel |

## Source Basis

- [`.nimi/spec/platform/kernel/ai-scope-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/ai-scope-contract.md)
- [`.nimi/spec/platform/kernel/ai-last-mile-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/ai-last-mile-contract.md)
