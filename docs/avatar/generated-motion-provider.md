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
| Activity ontology | Runtime | activity ids and categories in `config/runtime-local-agent-activity-catalog.yaml` |
| Backend route ids | Avatar | `config/avatar-generated-motion-routes.yaml` |
| Backend capability profile schema | Avatar | `config/avatar-backend-capability-profile.schema.yaml` |
| Mapping sidecar schema + confidence | Avatar | `config/avatar-mapping-sidecar.schema.yaml` |
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
- `avatarRouteId` must resolve in `config/avatar-generated-motion-routes.yaml`.
- `capabilityProfileRef` must validate against
  `config/avatar-backend-capability-profile.schema.yaml`.
- `mappingSidecarRef`, when present, must validate against
  `config/avatar-mapping-sidecar.schema.yaml`.

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

## Reader Scenario: Render an Admitted Activity

1. **Runtime provides a validated projection.** The authorized presentation
   stream requests the admitted `agree` activity. Avatar consumes that typed
   result; it does not accept raw model XML as a backend command.
2. **Avatar resolves its route.** The generated-motion configuration maps
   `agree` to `nod_yes` for the VRM backend. This is an Avatar route identity,
   not a public APML tag or a caller-selected Runtime activity namespace.
3. **Provider validates.** Check the active backend's capability profile and
   any required mapping sidecar. A missing or unsupported input fails with its
   typed reason.
4. **Provider executes and the backend renders.** If admitted, the deterministic
   provider produces the VRM animation output for that exact route and backend.

The route configuration and validated backend facts establish support; the
presence of a `.vrma` file does not. Other backends need their own admitted
route and disposition.

## Reader Scenario: A Backend Capability Is Unsupported

1. Avatar receives an authorized typed presentation input and resolves an
   admitted route for the active backend.
2. The backend capability profile does not support the requested output.
3. The provider returns `unsupported_capability`. The backend does not silently
   substitute a different expression or idle animation.
4. Avatar records the local diagnostic; the product displays the actual reason.
   That diagnostic creates no Runtime operation authority.

Public APML validation happens before this flow. An unsupported raw tag or an
illegal attribute is rejected by Runtime and produces no successful presentation
projection for Avatar to evaluate. Backend failure is not a way to admit invalid
model output.

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
| Backend route ids | This contract + `config/avatar-generated-motion-routes.yaml` |
| Backend capability profiles | This contract + `config/avatar-backend-capability-profile.schema.yaml` |
| Mapping sidecars + confidence | This contract + `config/avatar-mapping-sidecar.schema.yaml` |
| Backend execution | Per-backend contracts (Live2D / VRM) |

## Source Basis

- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`runtime/internal/services/runtimeagent/chat_structured_apml.go`](https://github.com/nimiplatform/nimi/blob/main/runtime/internal/services/runtimeagent/chat_structured_apml.go)
