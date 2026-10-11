# Backend Branches

Avatar supports exactly two graphics backend kinds, and the list is strictly closed: `live2d | vrm`. A single Avatar-owned factory validates the asset manifest and initializes the matching graphics branch. Model packages or third-party applications cannot dynamically inject unadmitted renderers at runtime.

## Shared Branch Contract

Every graphics branch implements the identical engine-neutral interface:

| Member | Purpose & Lifecycle Role |
| --- | --- |
| `kind` | Validated branch discriminator: `'live2d' | 'vrm'` |
| `nominalBounds` | Positive logical dimensions and normalized body center coordinates |
| `projection` | Standard interface handling activities, emotions, motions, expressions, and resets |
| `surface` | React / WebGL rendering viewport component managed by Avatar |
| `metadata()` | Opaque branch diagnostics and telemetry indicators |
| `shutdown()` | Disposes GPU textures, WebGL contexts, audio buffers, and animation clocks |

The carrier shell program interacts exclusively with this shared contract. Engine-specific internals and raw GL handles never leak across the neutral projection boundary.

## Live2D Branch

The Live2D branch loads and validates Cubism models, renders them on a WebGL canvas, derives high-frequency alpha collision hit regions, and drives real-time lipsync from local audio streams. Live2D alone provides the low-level `setParameter` parameter write extension, which can only be called after explicit type narrowing within Avatar's projection layer.

## VRM 3D Branch

The VRM branch loads verified 3D humanoid models along with their typed Capability Profile. The profile records Humanoid bone mappings, blendshape expressions, LookAt gaze targets, joint rotational constraints, and supported deterministic motion routes. If a model lacks essential bones or blendshapes, unsupported routes fail closed immediately to prevent geometry distortion or synthetic success.

VRM is an active supported branch with robust rigging and material handling, not a theoretical placeholder.

## Standalone Layered Animation Specification (Nimi2D)

The Nimi2D package represents an independent layered animation specification. It is not an active Avatar product backend kind in the closed `live2d | vrm` union. Any future admission of additional backends remains governed by formal authority updates.

## Engine-Neutral Projection Pipeline

Authoritative presentation intents from Runtime arrive in Avatar as strongly-typed semantic inputs. Avatar preserves their meaning in neutral structures before the active branch translates them into engine-specific draw commands:

| Semantic Intent Input | Graphics Branch Translation Example |
| --- | --- |
| Activity or Motion | Live2D motion groups or VRM skeletal animation tracks |
| Emotion or Expression | Live2D expression stacks or VRM blendshape morph targets |
| Speech Audio (Speak) | Audio buffer analysis paired with real-time mouth-opening weights |
| Surface Viewport Bounds | Validated nominal bounds and bounded hit regions; opacity queries follow the selected backend |

Resetting or terminating a branch clears only local graphics buffers; it leaves Runtime conversation history, participation status, and cognitive state intact.

## Typical Scenario: Automated Branch Selection

1. **Authorize visual package**: Runtime authorizes a specific model package.
2. **Sandbox loading**: The native host loads the package within an isolated directory.
3. **Manifest inspection**: Avatar verifies asset hashes and model descriptor schemas.
4. **Factory dispatch**: The branch factory instantiates the appropriate `live2d` or `vrm` branch.
5. **Fail-closed handling**: If format signatures are unrecognized or dimensions invalid, the shell stays in a protected non-ready state with explicit diagnostic reporting.

Introducing additional graphics backends requires formal architectural review and complete typed pipeline implementations; loose plugin architectures are explicitly avoided.

## Source Basis

- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [`.nimi/spec/nimi2d/asset-package.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/nimi2d/asset-package.authority.yaml)
