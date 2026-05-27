# AI Scope Identity

## Status: Admitted, in build-out

`AIScopeRef` is admitted at the kernel level
(`P-AISC-001..P-AISC-005`). App-owned scope identity is the active
product path; module and feature scopes are admitted only when those
entities are canonical AI owners.

## What `AIScopeRef` Is

`AIScopeRef` is the **canonical identity contract** for AI
configuration scope. It answers: "whose AI config is this?" with a
stable, unique key that does not depend on transient UI state.

```
AIScopeRef {
  kind: 'app' | 'module' | 'feature'
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
| `module` | Independent module identity | Only when the module itself is a canonical owner |
| `feature` | Cross-app reusable feature owner | Must not fragment what should be app-owned AI truth |

The kind enum is **closed**. Apps and consumers cannot invent another
kind.

## Canonical App-Scoped Shape

The canonical shape for app-owned AI configuration is fixed:

```
AIScopeRef {
  kind: 'app'
  ownerId: <stable app id>
  surfaceId: <stable surface id>
}
```

`surfaceId` is present only when one app owns multiple independent AI
configuration surfaces. It must be stable and product-defined; callers
must not derive it from transient tabs, sessions, prompts, or route ids.

## Why Scope Identity Matters

Without a canonical scope identity, the platform ends up with a mess
of ad-hoc keys: "this AI config belongs to tab 3 of app foo session
A" — keys that depend on UI state, that cannot survive app restart,
that cannot be consistently looked up across surfaces.

`AIScopeRef` rules eliminate these failure modes:

| Rule | What it prevents |
| --- | --- |
| Closed `kind` enum | Consumers cannot invent new scope kinds |
| Stable owner id required | UI-local keys cannot become AI scope identity |
| Stable app surface identity | Tab / session / thread proliferation cannot create silent scope explosion |
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

## Reader Scenario: An App Configures Its AI Surface

An app owns a workspace surface that uses AI.

1. **App identity.** The app has a stable app id
   (e.g., `nimi.example-app`).
2. **Scope identity.** The app applies AI configuration under
   `AIScopeRef{ kind: 'app', ownerId: 'nimi.example-app',
   surfaceId: 'workspace' }`.
3. **Profile apply.** User picks a profile in the AI config UI;
   profile applies (copy-on-write) into the workspace scope's
   `AIConfig`.
4. **Persistence.** Config is keyed by the canonical scope identity;
   it survives app restart.

## Reader Scenario: An App With Multiple AI Surfaces

Suppose an app genuinely hosts multiple first-class AI surfaces —
each with its own profile apply / probe / snapshot history.

1. **Explicit scope expansion.** The app admits multiple
   `AIScopeRef{ kind: 'app', ownerId: <app id>, surfaceId: <stable
   surface name> }` instances.
2. **Stable workspace names.** Surfaces must be human-recognizable;
   `surfaceId` is not a transient ui key.
3. **Not per-tab / per-session / per-document.** If the user is just
   switching the current document inside one workspace, that's domain
   state inside the one workspace scope — not a new `AIScopeRef`.

The contract guards against scope proliferation precisely because
proliferation breaks the stability that makes config reliable.

## Reader Scenario: Scope Lifecycle Bound To Owner

A user uninstalls an app.

1. **Owner entity destroyed.** The app package is removed.
2. **Scope destroyed.** All `AIScopeRef` instances tied to that app
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
| AIConfig intent keyed by `AIScopeRef` | Scope owner through SDK projection |
| Scope parameter on SDK config / profile / snapshot APIs | SDK kernel |
| Execution snapshot scope evidence | Runtime kernel |

## Source Basis

- [`.nimi/spec/platform/kernel/ai-scope-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/ai-scope-contract.md)
- [`.nimi/spec/platform/kernel/ai-last-mile-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/ai-last-mile-contract.md)
