# Generated Motion Provider

> Status: Running today. The provider contract is the runtime proof
> path for APML-driven motion; capability profiles and mapping
> sidecars define what each backend can do.

The generated motion provider turns the Runtime's typed motion,
expression, pose, lookat, and activity intent into executable backend
output — without depending on physical `.vrma` files or other
hand-authored artifacts. It is what makes the agent's motion feel
alive: motion is generated at runtime instead of replayed from a
fixed asset.

## Authority Boundary

| Layer | Owner | What it owns |
| --- | --- | --- |
| Public APML wire | Runtime | parsing, validation, public tag set |
| Typed projection | Runtime | `runtime.agent.presentation.*` and `runtime.agent.state.*` event surface |
| Activity ontology | Runtime | activity ids and categories in `tables/agent-activity-ontology.yaml` |
| Backend route ids | Avatar | `tables/generated-motion-routes.yaml` |
| Backend capability profile schema | Avatar | `tables/backend-capability-profile.schema.yaml` |
| Mapping sidecar schema + confidence | Avatar | `tables/mapping-sidecar.schema.yaml` |
| Provider execution semantics | Avatar | this contract |

Avatar route ids are backend projection ids. They are **not** public
APML tags and **not** runtime activity ontology ids. The split keeps
public model-facing wire stable even as backend routes evolve.

## Non-Admitted Public APML Tags

This contract does not admit direct public APML tags for `<motion>`,
`<expression>`, `<lookat>`, `<pose>`, or `<clear-pose>`. Those names
may appear only as typed runtime projection event families or
Avatar-local backend concepts after runtime validation. Public APML
continues to use only the syntax admitted by the runtime wire
contract — `<activity>`, `<emotion>`, etc.

## Provider Input

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

- `projection` must come from an admitted `runtime.agent.presentation.*`
  or `runtime.agent.state.*` event. Raw `apml.*` parser diagnostics
  are invalid input.
- `avatarRouteId` must resolve in `tables/generated-motion-routes.yaml`.
- `capabilityProfileRef` must validate against
  `tables/backend-capability-profile.schema.yaml`.
- `mappingSidecarRef`, when present, must validate against
  `tables/mapping-sidecar.schema.yaml`.

## Provider Output

The provider returns either executable backend output or fail-closed
evidence. The output is **deterministic** — for VRM, a typed
`THREE.AnimationClip`-shaped artifact; for Live2D, the equivalent
backend-native motion frames. There is no "best-effort with
placeholder" success path.

| Outcome | Meaning |
| --- | --- |
| executable backend output | Provider produced backend-specific motion / expression / pose / lookat output |
| fail-closed evidence | Provider could not produce executable output; typed reason code; backend does not silently substitute |

## Capability Profiles

A backend capability profile declares what motion / expression / pose
/ lookat capability the backend admits. Examples:

- A profile may declare lipsync support without expression interpolation.
- A profile may declare full motion + expression + lookat with a
  bounded pose scope.
- A profile may declare emotion → expression mapping with a confidence
  range admitted by the mapping sidecar.

The provider checks the profile **before** producing output. Asking
for an unsupported capability fails closed; it does not silently
fall back to idle, to a static image, or to a placeholder profile.

## Mapping Sidecar

A mapping sidecar describes the per-package mapping from runtime
semantic intent to backend route id. Confidence semantics are
admitted; a sidecar entry may declare:

| Field | Purpose |
| --- | --- |
| `route` | Avatar backend route id |
| `confidence` | Per-mapping confidence (admitted range) |
| `fallback` | Admitted fallback route id (or none — fail closed) |

Confidence is not a probability for the model to reason about; it is
how the provider chooses among admitted mapping entries when more
than one applies.

## Reader Scenario: APML Drives a Wave Activity

1. **Model emits APML.** Public wire: `<activity name="wave" />`.
2. **Runtime parses + validates.** Emits typed
   `runtime.agent.presentation.activity_requested` event.
3. **Avatar receives via SDK.** Provider input assembled with the
   typed projection, the `avatarRouteId` for "wave" on the active
   backend, the capability profile ref, and the mapping sidecar ref.
4. **Provider executes.** Validates capability profile + sidecar;
   produces deterministic backend output (Live2D motion sequence or
   VRM `AnimationClip`-shaped artifact).
5. **Backend renders.** Output plays in the embodiment.

The author of the package never wrote a `.vrma` file for "wave". The
provider generates the motion at runtime against the admitted
backend capability.

## Reader Scenario: A Capability Is Not Admitted

1. **Model emits.** `<expression name="wink" />`.
2. **Runtime emits.** Typed `presentation.expression_requested` event.
3. **Provider checks.** Capability profile says: this backend admits
   expression interpolation but does not admit "wink" in the
   admitted expression set.
4. **Fail closed.** Provider returns typed evidence
   (`unsupported_expression`, route id, profile ref). Backend does
   not silently substitute a "smile" or fall back to idle.
5. **Runtime probe surfaces it.** Debug workbench can see the
   evidence; product surfaces handle the typed reason without
   misrepresenting it as success.

The closed posture is what makes the workbench probes trustworthy.

## Reader Scenario: A `.vrma` File Exists

1. **Asset audit finds `.vrma` files in the package.**
2. **Position.** Per the contract, `.vrma` is interchange / authoring
   evidence only. It may appear in existing VRM loader or asset
   evidence, but it is **not** runtime support proof.
3. **Provider behavior.** Provider does not gate on `.vrma`
   existence. It gates on capability profile + sidecar + admitted
   route id.
4. **Audit posture.** `.vrma` presence does not satisfy the
   provider's runtime proof requirement.

The provider is the runtime proof path. Authoring artifacts are
authoring artifacts.

## Boundary Summary

| Concern | Owner |
| --- | --- |
| Public APML syntax (incl. what tags are admitted) | Runtime wire contract |
| Typed runtime projection events | Runtime presentation stream contract |
| Backend route ids | This contract + `tables/generated-motion-routes.yaml` |
| Backend capability profiles | This contract + `tables/backend-capability-profile.schema.yaml` |
| Mapping sidecars + confidence | This contract + `tables/mapping-sidecar.schema.yaml` |
| Backend execution | Per-backend contracts (Live2D / VRM) |

## Source Basis

- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
