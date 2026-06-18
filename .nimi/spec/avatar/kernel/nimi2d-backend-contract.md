# Nimi2D Backend Contract

> **App**: `@nimiplatform/avatar`
> **Authority**: Avatar kernel contract
> **Status**: Active `kind: 'nimi2d'` BackendBranch admission boundary;
>   PixiJS renderer foundation and tier-1 scheduler/composer proof admitted for
>   valid package/profile input. Deterministic offscreen carrier pixel proof
>   remains render-plan based. Default generated asset admission remains
>   Generation Bench-gated.
> **Sibling contracts**:
> - [Backend branch contract](backend-branch-contract.md)
> - [Embodiment projection contract](embodiment-projection-contract.md)
> - [Generated motion provider contract](generated-motion-provider-contract.md)
> - [Carrier visual acceptance contract](carrier-visual-acceptance-contract.md)
> - [Nimi2D Live Action Bench contract](nimi2d-live-action-bench-contract.md)
> - [Nimi2D package authority](../../nimi2d/kernel/index.md)

---

## 0. Reading Guide

This contract admits the Avatar-side Nimi2D backend branch as a runtime
consumer of admitted Nimi2D packages. It does not admit Nimi2D as the default
generated avatar layer.

Implementation maturity note: the current implementation is a pre-release proof
scaffold. It proves package/profile loading, PixiJS Application/Sprite layer
rendering from package `render_layers` geometry, local composer scheduling for
expression fade, motion fade/recovery, idle-life clock, tier-1 amplitude mouth
behavior, package alpha-mask asset binding, and deterministic offscreen
default-outfit pixel proof. It does not admit mesh deformation, slot-following
deformation, clip-path/deformation/mesh masks, a release-grade
stream-live-action blend tree, gesture queue, conflict arbitration,
mounted-surface release evidence, or default generated Nimi2D viability.

The current Nimi2D Generation Bench result remains the gate for default
generated tier-1 asset viability. A `nimi2d` Avatar backend can consume
hand-authored, semi-automatic, or otherwise admitted Nimi2D packages, but it
must not treat runtime playback success, visual smoke success, or Live Action
Bench success as Generation Bench closure.

Canonical teaching model:

`Nimi2D package evidence -> Avatar Nimi2D capability profile -> Avatar backend live-action lanes`

## 1. Authority Boundary

Nimi2D owns:

- layer input contract
- package manifest contract
- base body / wardrobe / slot topology
- package capability tier claims
- package validator and Generation Bench result

Avatar owns:

- `BackendKind = 'nimi2d'` launch branch
- Nimi2D backend capability profile
- mapping from runtime typed projection to Nimi2D live-action lanes
- backend-local composer, lane arbitration, hit region, audio consumer, and
  visual proof
- fail-closed evidence when a package lacks required capability

Avatar-owned runtime helpers may be implemented in
`@nimiplatform/nimi2d/runtime` when they are renderer-agnostic and consumed by
the Avatar backend adapter. This is code reuse only; authority remains this
Avatar contract, not `.nimi/spec/nimi2d/**`.

Runtime owns:

- public APML / presentation wire truth
- typed `runtime.agent.*` projection
- PresentationTimeline and voice playback state

Forbidden ownership:

- Avatar must not parse raw APML for Nimi2D.
- Avatar must not infer package capability from requested tier.
- Avatar must not promote package-local layer ids, anchors, or slots into
  runtime semantic truth.
- Avatar must not count Nimi2D runtime playback as Generation Bench success.

## 2. Backend Kind Admission

The launched Avatar carrier backend union admits:

```ts
export type BackendKind = 'live2d' | 'vrm' | 'nimi2d';
```

`kind: 'nimi2d'` is an Avatar-local backend branch. It is not a Runtime/SDK
public backend enum expansion in this wave. Runtime/SDK public admission
requires a separate Runtime/SDK authority packet.

Implementation status for this wave:

- Avatar may parse and recognize a Nimi2D model manifest.
- `createBackendBranch` may admit `kind: 'nimi2d'` only when both the Nimi2D
  package manifest and Avatar Nimi2D capability profile validate.
- The admitted implementation is a PixiJS renderer foundation plus local
  composer proof for static layer, idle, expression, motion state, and tier-1
  amplitude mouth lanes.
- The admitted PixiJS renderer consumes package `canvas` and `render_layers`
  placement/bounds geometry, including rectangular `texture_bounds_px`
  cropping and optional `render_layers[].mask` alpha-mask asset binding. It
  must not recover geometry or masks by reading upstream layer-input manifests
  or renderer-local mask tables.
- The admitted PixiJS renderer may consume Avatar capability profile
  `renderer.bindings.motion_routes.<route_id>` bindings for route-specific
  sprite translate/scale/opacity transforms. Route ids come from the profile;
  the renderer must not hardcode a route such as `lean_in`.
- The admitted Nimi2D surface may expose a BackendHitRegion alpha query backed
  by decoded package render-layer alpha and optional package alpha-mask assets.
  It must return `null` until the alpha probe is ready or when the selected
  default outfit layer is absent, allowing bbox fallback.
- The admitted Nimi2D BackendHitRegion `body` / `drag` bbox is computed from
  the package render plan's visible layer geometry: union of
  `render_layers[].visible_bounds_px` mapped through `texture_bounds_px` and
  `placement_px` into package canvas coordinates, normalized against
  `sourceCanvas`. A full-window bbox is allowed only as conservative fail-closed
  fallback when no valid layer geometry is available.
- Nimi2D renderer readiness and alpha-hit-probe readiness are admitted shell
  evidence via existing `avatar.carrier.visual` records. They must not create a
  new OS window-shape authority and must not be treated as unadmitted lifecycle
  violations by `EmbodimentStage`.
- Nimi2D mounted Pixi canvas visual capture may write a human-visible artifact
  through Avatar evidence storage when the mounted canvas is readable and has
  non-zero visible pixels. Capture failure or blank frames must record
  `avatar.carrier.visual { status: 'error' }`; canvas existence, Pixi
  readiness, and offscreen package proof must not masquerade as mounted visual
  artifact success.
- The admitted composer scheduler may advance renderer-agnostic frame time,
  expression fade weight, motion fade-in/fade-out, queued motion handoff,
  interrupt replacement, motion recovery to idle, and idle-life clock snapshots.
- Renderer-agnostic package loading, render-plan validation, composer state, and
  bounded bench scoring may be imported from `@nimiplatform/nimi2d/runtime`;
  Avatar remains responsible for BackendBranch, PixiJS surface, Tauri file
  reads, audio consumer, hit region, lifecycle evidence, and acceptance
  integration.
- Missing package, missing profile, missing default outfit, invalid layer asset,
  or invalid renderer binding fails closed.
- Placeholder surfaces, blank canvases, static screenshots, tier-0-only packages,
  or runtime playback success must not be reported as Generation Bench closure.

## 3. Package Intake

A Nimi2D Avatar model manifest must carry an opaque ref to an admitted Nimi2D
package manifest:

```ts
type Nimi2DAvatarModelManifest = {
  kind: 'nimi2d';
  modelId: string;
  runtimeDir: string;
  nimiDir: string | null;
  posterPath: string | null;
  nimi2d: {
    packageManifestPath: string;
    packageDigestSha256: string | null;
    capabilityProfileRef: string | null;
  };
};
```

Runtime rendering is admitted only when all of the following are true:

- package manifest validates against `.nimi/spec/nimi2d/**`
- Avatar model manifest provides `nimi2d.packageDigestSha256`
- raw package manifest bytes match `nimi2d.packageDigestSha256`
- package manifest carries a validator evidence ref and content admission ref
- package governance requires `base_body_renderable: false`
- package has a default outfit
- package `proven_tier` is sufficient for the requested lane
- Avatar Nimi2D capability profile validates against
  `tables/nimi2d-backend-capability-profile.schema.yaml`
- capability profile supplies Avatar-owned renderer canvas and layer bindings
  for any claimed live-action lane

Missing, unreadable, digest-mismatched, evidence-missing, invalid, or
overclaiming packages fail closed. The backend must not fall back to a naked
base body, a placeholder body, a static poster, or another backend kind.

Runtime package hardening boundary:

- Avatar verifies it is consuming the expected raw package manifest via
  SHA-256 digest.
- Avatar requires package admission lineage refs that point back to offline
  Nimi2D validation and upstream content admission.
- Avatar runtime loading is still not a replacement for offline Nimi2D package
  validation. It must not duplicate or fork the full Node-side validator.

## 4. Live Action Lanes

Nimi2D backend live action is a local Avatar composer over package evidence and
runtime typed projection. It is not LLM frame control.

Admitted lanes:

| Lane | Input | Minimum package capability | Failure |
| --- | --- | --- | --- |
| static_layer | package draw order + selected outfit | `tier-0_static_layered` | fail closed if no outfit |
| idle_life | local clock / presence | `tier-1_agent_basic` | remain visually static; no success event |
| expression | runtime emotion / expression cue | `tier-1_agent_basic` | unsupported cue evidence |
| speech_mouth | BackendAudioConsumer amplitude snapshot | `tier-1_agent_basic` | silent mouth |
| gesture_motion | runtime activity / motion cue | `tier-1_agent_basic` | `avatar.motion.preset.fail_close` |
| true_viseme | audio viseme classifier | `tier-2_viseme_gesture` | unsupported; tier-1 cannot claim it |
| semantic_full_body | semantic full-body action | `tier-3_full_body_semantic` | unsupported |

Lane arbitration rules:

- Lanes read package `capability.proven_tier`, never `requested_tier`.
- A higher lane may be absent while lower lanes remain valid.
- Unsupported non-idle lanes fail closed and emit bounded evidence; they must
  not degrade into idle and count as success.
- Speech mouth at tier-1 is jaw/amplitude only. AEIOU true viseme is tier-2+.
- Outfit switching is atomic; there is no base-body-only intermediate frame.

Current scheduler maturity:

- The scheduler is a foundation over discrete activity, expression, motion, and
  mouth lanes.
- It admits local time advancement and fade/recovery semantics.
- It admits renderer-agnostic motion queue length, completed-motion count, and
  interrupted-motion count as observable scheduler state.
- It admits route-specific sprite transform foundation when the Avatar
  capability profile declares `motion_routes`.
- It does not admit release-grade route-specific gesture transform quality
  beyond profile-declared sprite transforms, release-grade gesture queue policy,
  a full priority conflict matrix, gaze, physics, or mesh deformation.

## 5. Projection Consumption

The Nimi2D backend consumes only Avatar `BackendProjection` and
`BackendAudioConsumer` surfaces:

- `applyActivity` routes to live-action route families admitted by
  `tables/nimi2d-live-action-routes.yaml`
- `applyEmotion` routes to expression lane if package capability allows
- `applyMotion` routes to motion primitive lane if package capability allows
- `applyExpression` routes to expression lane if package capability allows
- `reset` returns to package-defined neutral outfit-visible posture

It must not consume:

- raw APML
- LLM-streamed numeric transform params
- Runtime internal timeline structs
- Nimi2D Generation Bench result as a runtime control stream

## 6. Audio Consumer

Nimi2D backend implements the same `BackendAudioConsumer` surface as Live2D and
VRM:

- `attachAudioSource` remains async
- `detachAudioSource` disconnects source state
- `silent` immediately zeros speech mouth output
- `snapshot` feeds local mouth lane

Tier-1 packages may consume amplitude/jaw-open envelopes only. True viseme
weights from wLipSync or another classifier are ignored unless the package and
capability profile prove tier-2+ true viseme support.

## 7. Hit Region And Bounds

Nimi2D hit region must be derived from rendered outfit-visible package layers,
not from hidden base body layers. Alpha-mask probing may use rendered layer
alpha; bbox fallback is allowed only with explicit `avatar.hit_region.degraded`
evidence.

Nominal bounds derive from package canvas and body anchors:

1. package canvas
2. selected outfit visible bounds
3. base body non-renderable anchors for framing only
4. fallback bounds only after fail-closed evidence

## 8. Visual Proof

The current admitted proof is minimal runtime proof:

- Avatar can load a valid Nimi2D package/profile pair.
- Avatar can instantiate a PixiJS Application, load package layer textures into
  Sprites in package render-layer draw order, apply package render-layer
  placement/bounds geometry and package alpha-mask asset bindings, and render
  package base-body visual layers only together with the selected default
  outfit.
- Avatar can wire `BackendProjection` into a local composer state.
- Avatar can advance a renderer-agnostic composer scheduler on the carrier frame
  loop, including bounded motion queue/interrupt state, without asking the LLM
  for numeric frame control.
- Avatar can apply route-specific sprite transforms declared by the Avatar
  Nimi2D capability profile.
- Avatar can wire `BackendAudioConsumer` amplitude into the tier-1 mouth lane.
- Avatar can compose the admitted render plan into an offscreen pixel sampler
  and verify default outfit visible pixels with the same package alpha masks
  consumed by the renderer and hit probe.
- Avatar can attempt mounted Pixi canvas capture and write a human-visible
  artifact only when readable mounted pixels are present.
- Invalid package/profile input fails closed.
- Package digest mismatch or missing admission/content evidence fails closed.

This proof closes deterministic offscreen pixel proof for the current render
plan and a bounded mounted Pixi canvas capture foundation. It does not close
release-grade mounted-surface recording acceptance or Generation Bench.

Nimi2D carrier visual proof requires:

- real Avatar carrier surface, not Desktop preview
- package validator evidence
- default outfit visible pixels
- no visible base-body-only frame
- non-placeholder pixel evidence
- fail-closed evidence for invalid package, missing outfit, unsupported lane,
  and context loss

`kind: 'nimi2d'` launch remains admitted only as
`pixi_renderer_foundation` proof with scheduler foundation and must not be used
as release-renderer or default generated avatar success.

## 9. Generation Bench Boundary

Avatar Nimi2D backend proof and Live Action Bench proof are value-ceiling
evidence. They do not admit default generated asset viability.

Default generated Nimi2D requires Nimi2D Generation Bench `go` or explicitly
accepted `conditional_go` on the certified-good tier-1 corpus.

## 10. Not Admitted

This contract does not admit:

- mesh/deformer renderer behavior beyond PixiJS sprite foundation
- slot-following deformation
- clip-path masks, deformation masks, mesh masks, or renderer-local mask tables
  beyond package `alpha_mask_asset` binding
- release-grade OS/window-shape acceptance beyond the existing
  EmbodimentStage click-through path
- release-grade blend tree, gesture queue policy, conflict arbitration, or gaze
  runtime
- release-grade route-specific motion transform quality beyond profile-declared
  sprite transforms
- Desktop launch UI for selecting Nimi2D packages
- Runtime/SDK public backend enum expansion
- default RealmPersona image-to-Nimi2D generation admission
- adult outfit distribution or age-gated asset loading
- raw APML, raw APML expansion, or LLM numeric frame control

## 11. Evolution

- Add implementation-maturity waves before release acceptance: package
  admission hardening, release-quality renderer, full scheduler/blend runtime,
  and mounted-surface visual evidence.
- Add release-grade recording acceptance only after those blockers close:
  human-visible artifact evidence and acceptance matrix row for a real launched
  Nimi2D package.
- Admit default generated Nimi2D: require Generation Bench `go` or accepted
  `conditional_go`.
- Admit public Runtime/SDK `nimi2d` backend enum: separate Runtime/SDK authority
  packet and generated client update.
