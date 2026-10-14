# Backend Branches

Avatar supports a strictly closed set of graphics backends: `live2d | vrm`. A single Avatar-owned factory validates the asset manifest and initializes the matching graphics branch. Model packages and third-party apps cannot dynamically inject custom renderers at runtime.

## Shared Branch Contract

Every graphics branch implements the same engine-neutral interface:

| Member | Purpose & Lifecycle Role |
| --- | --- |
| `kind` | Validated branch discriminator: `'live2d' | 'vrm'` |
| `nominalBounds` | Positive logical dimensions and normalized body center coordinates |
| `projection` | Standard interface for applying activities, emotions, motions, expressions, and resets |
| `surface` | React / WebGL rendering viewport component managed by Avatar |
| `metadata()` | Opaque branch diagnostics and telemetry indicators |
| `shutdown()` | Releases GPU textures, WebGL contexts, audio buffers, and animation clocks |

The carrier shell interacts exclusively with this shared contract. Engine-specific internals and raw GL handles never cross the neutral projection boundary.

## Live2D Branch

The Live2D branch loads and validates Cubism models, renders them on a WebGL canvas, computes alpha hit regions, and drives real-time lipsync from local audio playback. Only the Live2D branch exposes the low-level `setParameter` write extension, which Avatar's internal translation layer can call only after explicit `kind` narrowing.

## VRM 3D Branch

The VRM branch loads verified 3D humanoid models together with their typed capability profile. The profile declares humanoid bone mappings, blendshape expressions, LookAt gaze targets, joint rotation limits, and supported deterministic motion routes. If a model lacks required bones or blendshapes, unsupported routes fail closed immediately rather than distorting geometry or reporting fake success.

## Standalone Layered Animation Specification (Nimi2D)

Nimi2D is a standalone layered animation package specification and is not part of Avatar's closed `live2d | vrm` backend union. Admitting any future backend kind requires a formal authority update and a complete typed pipeline implementation.

## Engine-Neutral Projection Pipeline

Admitted presentation updates from Runtime arrive in Avatar as typed semantic inputs. Avatar keeps them in engine-neutral structures before the active branch translates them into backend-specific rendering operations:

| Semantic Input | Graphics Branch Translation |
| --- | --- |
| Activity or Motion | Live2D motion groups or VRM skeletal animation tracks |
| Emotion or Expression | Live2D expression parameters or VRM blendshape weights |
| Speech Audio (Speak) | Local audio buffer analysis paired with real-time mouth-opening weights |
| Surface Viewport Bounds | Validated nominal bounds and bounded hit regions, with opacity queries handled by the active backend |

Resetting or shutting down a branch clears only local graphics and audio resources; Runtime conversation history, participation status, and cognitive state remain untouched.

## Typical Scenario: Automated Branch Selection

1. **Authorize visual package**: The session resolves an authorized model package.
2. **Isolated loading**: The host loads the package from its isolated asset directory.
3. **Manifest inspection**: Avatar verifies asset hashes and model descriptor schemas.
4. **Factory dispatch**: The branch factory instantiates the matching `live2d` or `vrm` branch.
5. **Fail-closed handling**: If format signatures are unrecognized or dimensions are invalid, the shell stays in a protected non-ready state and reports explicit diagnostics.

## Source Basis

- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [`.nimi/spec/nimi2d/asset-package.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/nimi2d/asset-package.authority.yaml)
