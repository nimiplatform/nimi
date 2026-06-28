# Backend Branches

> Status: Mixed. Per-section labels below: Live2D backend (running),
> VRM backend (admitted contract; not a public app API), Generated motion provider
> (running).

Avatar's rendering backend is a **closed discriminated union**:
`live2d | vrm`. Live2D runs today via Cubism SDK for Web; VRM is
admitted as a backend branch that is not public app API today. Generated
motion is admitted as a distinct provider concern under the same backend branch model
(see [Generated Motion Provider](/avatar/generated-motion-provider.md)).

## Closed Union, Not Open Plugin System

| Property | Value |
| --- | --- |
| Backends | `live2d`, `vrm` (future) |
| Closed | New backends require admitted contract |
| Discriminated union | Type narrowing surfaces backend-specific extensions |
| Live2D today | Running via Cubism SDK for Web |
| VRM branch | Admitted backend branch; not a public app API today |

A reader who hopes to "drop in another backend" cannot. The
backend list is admitted; new backends are admitted at the kernel
level, not by author convention.

## Live2D Backend (running)

| Property | Value |
| --- | --- |
| Tech | Cubism SDK for Web |
| Status | Running today |
| Asset compatibility | Per `live2d-asset-compatibility-contract.md` |
| Render contract | Per `live2d-render-contract.md` |
| Backend extensions | Live2D-specific API (e.g., `live2dExtension`) |

Live2D is the production backend. Embodiment packages today are
typically Live2D packages.

## VRM Backend (Admitted Contract; Release-Gated Surface)

| Property | Value |
| --- | --- |
| Tech | VRM 3D asset standard (three-vrm + R3F) |
| Status | Admitted backend branch; not a public app API today |
| Backend extensions | VRM-specific when that surface is exposed |

VRM is admitted as a future backend so that NAS handlers can
write portable code today without coupling to Live2D specifics
that VRM cannot honor. The backend branch model exists exactly
so future backends do not require rewriting handlers.

## Generated Motion Provider (running)

`generated-motion-provider-contract.md` describes how AI-generated
motion can drive an embodiment. It is admitted as a provider
under the same backend-branch model and is the runtime proof path
that replaces hand-authored `.vrma` files.

| Property | Value |
| --- | --- |
| Source | AI motion generation provider |
| Output | Backend-specific motion calls |
| Provider lifecycle | Admitted under the contract |

This is what makes "the agent's motion is alive" go beyond
hand-authored animation. Generated motion is a provider
capability admitted into Avatar.

## Live2D Asset Compatibility

| Concern | What the contract handles |
| --- | --- |
| Asset version compatibility | Which Cubism versions are admitted |
| Required parameters | Parameters the embodiment must declare |
| Optional parameters | Parameters that enable richer rendering |
| Failure mode | What happens when a required parameter is missing |

A Live2D model that lacks required parameters fails closed at
acceptance. Optional parameters enable richer rendering when
present.

## Reader Scenario: A NAS Handler Stays Portable

A NAS handler animates an idle pose.

1. **Use backend-agnostic API.** Handler calls embodiment
   projection's idle pose method.
2. **Live2D today.** Projection routes through Live2D
   extension; idle pose is rendered via Live2D parameters.
3. **VRM surface.** When VRM is exposed, the same handler routes
   through VRM extension; idle pose is rendered via VRM
   capabilities.
4. **Same handler shape applies across backends.**

Backend-agnostic handlers are portable across backends.

## Reader Scenario: Live2D Asset Compatibility Mismatch

A user installs a Live2D embodiment package built for an older
Cubism version.

1. **Asset compatibility check.** Per
   `live2d-asset-compatibility-contract.md`.
2. **Decision.** Either:
   - Admit as compatible (within admitted version range), or
   - Refuse with typed reason (out of admitted range).
3. **Typed result.** User sees the decision; the platform does
   not silently render an unsupported package.

Compatibility is contract, not heuristic.

## What Backend Branches Do Not Do

| Concern | Why not |
| --- | --- |
| Allow free-form backends | Closed union by design |
| Allow runtime-determined backend selection bypassing contract | Discriminated union enforces typed selection |
| Allow cross-backend asset reuse without admission | Each backend's compatibility is admitted |

## Source Basis

- [`.nimi/spec/avatar/kernel/backend-branch-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/backend-branch-contract.md)
- [`.nimi/spec/avatar/kernel/live2d-render-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/live2d-render-contract.md)
- [`.nimi/spec/avatar/kernel/live2d-asset-compatibility-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/live2d-asset-compatibility-contract.md)
- [`.nimi/spec/avatar/kernel/vrm-backend-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/vrm-backend-contract.md)
- [`.nimi/spec/avatar/kernel/generated-motion-provider-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/generated-motion-provider-contract.md)
- [`.nimi/spec/avatar/kernel/embodiment-projection-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/embodiment-projection-contract.md)
