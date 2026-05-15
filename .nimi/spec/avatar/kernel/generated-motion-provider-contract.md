# Generated Motion Provider Contract

> **App**: `@nimiplatform/avatar`
> **Authority**: Avatar kernel contract
> **Status**: Wave 0 admit (topic
> `2026-05-01-avatar-apml-auto-adapter`)
> **Sibling contracts**:
> - [Backend branch contract](backend-branch-contract.md)
> - [Embodiment projection contract](embodiment-projection-contract.md)
> - [VRM backend contract](vrm-backend-contract.md)
> - [Avatar event contract](avatar-event-contract.md)

---

## 0. Purpose

This contract admits the Avatar-owned generated motion provider line downstream
of typed runtime projection. It replaces physical `.vrma` files as the runtime
proof path for APML-driven Avatar motion support.

The public APML wire remains runtime-owned. Avatar must consume only typed
`runtime.agent.*` projection delivered through the SDK/runtime app surface.
Avatar must not subscribe to raw `apml.*` parser events or define APML syntax.

## 1. Authority Boundary

Runtime owns:

- APML parsing and validation in
  `.nimi/spec/runtime/kernel/agent-output-wire-contract.md`
- typed presentation and state projection in
  `.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md`
- activity ids and categories in
  `.nimi/spec/runtime/kernel/tables/agent-activity-ontology.yaml`

Avatar owns:

- backend route ids in `tables/generated-motion-routes.yaml`
- backend capability profile schema in
  `tables/backend-capability-profile.schema.yaml`
- mapping sidecar schema and confidence semantics in
  `tables/mapping-sidecar.schema.yaml`
- provider execution semantics in this contract

Avatar-owned route ids are backend projection ids. They are not public APML tags
and are not runtime activity ontology ids.

## 2. Non-Admitted Public Syntax

This topic does not admit direct public APML tags for:

- `<motion>`
- `<expression>`
- `<lookat>`
- `<pose>`
- `<clear-pose>`

Those names may appear only as typed runtime projection event families or
Avatar-local backend concepts after runtime validation. Public model-facing APML
continues to use the syntax admitted by the runtime wire contract, including
`<activity>` and `<emotion>`.

## 3. Provider Input

The generated motion provider input is:

```ts
type GeneratedMotionProviderInput = {
  projection:
    | RuntimeAgentPresentationActivityRequested
    | RuntimeAgentPresentationMotionRequested
    | RuntimeAgentPresentationExpressionRequested
    | RuntimeAgentPresentationPoseRequested
    | RuntimeAgentPresentationLookatRequested
    | RuntimeAgentStateEmotionChanged
    | RuntimeAgentStatePostureChanged;
  avatarRouteId: string;
  backendKind: 'vrm' | 'live2d' | string;
  capabilityProfileRef: string;
  mappingSidecarRef: string | null;
};
```

Rules:

- `projection` must come from an admitted `runtime.agent.presentation.*` or
  `runtime.agent.state.*` event. Raw `apml.*` parser diagnostics are invalid
  provider input.
- `avatarRouteId` must resolve in `tables/generated-motion-routes.yaml`.
- `capabilityProfileRef` must validate against
  `tables/backend-capability-profile.schema.yaml`.
- `mappingSidecarRef`, when present, must validate against
  `tables/mapping-sidecar.schema.yaml`.

## 4. Provider Output

The provider returns either executable backend output or fail-closed evidence:

```ts
type GeneratedMotionProviderResult =
  | {
      status: 'ok';
      backendKind: 'vrm';
      clip: THREE.AnimationClip;
      routeId: string;
      evidence: GeneratedMotionEvidence;
    }
  | {
      status: 'fail_closed';
      routeId: string;
      reasonCode:
        | 'unsupported_capability'
        | 'unsafe_pose'
        | 'mapping_confidence_below_threshold'
        | 'mapping_unconfirmed'
        | 'missing_profile'
        | 'missing_route'
        | 'invalid_runtime_projection';
      evidence: GeneratedMotionEvidence;
    };
```

There is no neutral-success fallback. Returning idle output for an unsupported
non-idle route is a contract violation.

## 5. Capability Profile

Capability profiles describe what a loaded backend/model can safely execute.
They are model/backend facts, not semantic truth. The profile may name bones,
expressions, blendshapes, look-at support, pose limits, and route-level support,
but it must not introduce APML ids or runtime activity ids as owner truth.

The schema target is
`tables/backend-capability-profile.schema.yaml`. VRM is the first backend
implementation target; the envelope is backend-agnostic so Live2D and future
carriers can add backend sections without moving authority.

## 6. Mapping Confidence

LLM or heuristic mapping output is admitted only as sidecar evidence. It may
match model-specific names to Avatar backend routes, expressions, or bones. The
sidecar must carry `target_fields` for the backend/model-specific names it
claims. Avatar validates those fields against a matching capability profile
before they can support a route.

Avatar does not own direct LLM provider/model execution for mapping generation
in this topic. LLM-assisted mappings enter as mapping-only sidecar input through
an already-authorized external/runtime path; Avatar runtime code must not
hardcode a provider, model, prompt transport, or app-local REST call to produce
them.

The sidecar must not emit keyframe curves, rotations, durations, easing
functions, or other motion math.

Mapping confidence rules:

- `confidence` is a number from `0` to `1`.
- `threshold` is route-specific or defaults to the schema threshold.
- `confidence < threshold` fails closed.
- mappings produced by LLM require `manual_confirmation: confirmed` unless a
  later packet admits an automated evidence class for that backend.
- evidence must name the observed source fields used to justify the mapping.
- `target_fields` must match backend capability profile evidence; otherwise the
  route is unsupported for that model/profile and fails closed.

## 7. Deterministic Motion Math

Deterministic provider code owns all keyframe generation. A VRM provider must
apply route-specific duration bounds, easing, humanoid joint clamps, and blend
limits before returning an executable `THREE.AnimationClip`.

Generated clips must be reproducible from:

1. typed runtime projection
2. Avatar route id
3. validated capability profile
4. validated mapping sidecar
5. deterministic provider version

## 8. `.vrma` Position

`.vrma` is interchange/authoring evidence only. It is not required runtime
proof for APML auto-adapter support and must not be used as the closure gate for
generated motion support.

Avatar may later export generated clips to `.vrma` under a separate interchange
topic. That export path must not become a dual runtime dependency.

## 9. Initial Route Set

Wave 0 admits the following Avatar backend route ids as provider targets:

- `idle_subtle`
- `listen_lean`
- `nod_yes`
- `shake_no`
- `greet_wave`

Their source mapping is recorded in `tables/generated-motion-routes.yaml`.
These ids are Avatar backend route ids only.

## 10. Validation Gates

Wave implementation and closeout must include gates proving:

- no Avatar product path consumes APML raw parser diagnostics
- no retired app-local Avatar authority root exists
- no public APML motion/expression/lookat/pose/clear-pose syntax is admitted
- no Avatar-local ontology shadows runtime activity ids
- no `.vrma` file presence is required as APML runtime support proof
- generated provider failure states remain fail-closed

## 11. Supersession

This contract supersedes the `.vrma` runtime asset close gate recorded by
`2026-04-30-avatar-vrm-backend-branch` for APML auto-adapter support. Existing
`.vrma` assets may remain as interchange-only evidence until wave-2 hard-cuts
implementation, but they are not canonical runtime proof for this topic.
