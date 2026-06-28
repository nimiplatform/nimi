# Visual Acceptance

## Status: Admitted Contract; Release-Gated Surface

The Avatar carrier visual acceptance contract is admitted at the
kernel level. The evidence taxonomy, fail-closed boundary, and
multi-backend evidence shape are fixed. Automated acceptance
harnesses are Avatar-owned test surfaces; not every evidence class is
available as a public app API.

## What "Visual Acceptance" Means

The Avatar app's carrier — the canvas / WebGL surface owned by
`apps/avatar` — must produce visible non-placeholder pixels for the
admitted backend, with deterministic, auditable evidence. Visual
acceptance is the contract that says **what evidence is allowed to
close that proof**.

It is deliberately strict because the Avatar carrier path is the only
real product path; Desktop chat's separate Live2D renderer is not the
Avatar carrier.

## Evidence Classes

| Class | Meaning | Can close carrier visual proof |
| --- | --- | --- |
| Real runtime path | Desktop launch context + local Agent Center package + runtime IPC bridge + SDK driver + Avatar carrier | Yes |
| Deterministic harness | Controlled Avatar app harness exercising the real carrier draw path with stable inputs | Yes, if it exercises the Avatar carrier canvas / WebGL path |
| Fixture / mock | Explicit `VITE_AVATAR_DRIVER=mock` or mock scenario data source | Regression evidence only — does not close carrier proof |
| Desktop renderer evidence | Desktop chat Live2D renderer smoke or pixel evidence | No |
| Closed-topic evidence | Historical artifacts from older topics | No |

The first two close proof. The last three do not.

## Required Visual Proof

Carrier visual proof must include current executable evidence for:

- a canvas (or equivalent WebGL host) owned by `apps/avatar`, not
  Desktop chat
- model load success through the Avatar app backend branch
- at least one frame where the carrier path produces non-placeholder
  visible pixels after model load
- resilience evidence for resize or host-bound changes when the
  implementation claims responsive surface behavior
- failure evidence showing missing / invalid model input does not
  render a success state without evidence

The proof may be automated through unit / integration tests, a
deterministic headless harness, or a Playwright-style acceptance
harness. Whichever method is used must record enough artifact detail
for later audit.

## Forbidden Closure

The following evidence MUST NOT close Avatar carrier visual proof:

- Desktop chat Live2D pixel tests, even if they exercise Cubism
  WebGL through the Desktop renderer
- static `<canvas>` existence without non-placeholder pixel evidence
- fixture-only scenario playback reported as the real runtime carrier
  path
- closed-topic demo screenshots, checklists, or worker results
- command-state-only tests that do not exercise draw / pixel output

The fail-closed posture is intentional. A success claim without
admitted evidence is a `placeholder_success` shortcut and is rejected.

## Multi-Backend Visual Proof

`recordCarrierVisualProof` is extended with `modelKind: BackendKind`
so the carrier accepts evidence per backend:

```ts
recordCarrierVisualProof(input: {
  modelKind: 'live2d' | 'vrm';
  // ... existing fields (canvas ref / sample grid / frame index / ...)
}): CarrierVisualProof;
```

Per-backend rules apply. Live2D evidence proves only the Live2D
branch. VRM evidence proves only the VRM branch. Cross-backend reuse
of evidence is forbidden.

## Reader Scenario: Closing Live2D Carrier Proof

1. **Run the deterministic harness.** Avatar harness mounts the
   Live2D backend, loads a fixture-tier model, drives a canonical
   activity sequence.
2. **Capture sample grid.** Pixel sample at deterministic frame
   indexes; assert non-placeholder pixels in body region.
3. **Record proof.** `recordCarrierVisualProof({ modelKind: 'live2d',
   ...})` with sample grid + canvas ref + frame index + harness id.
4. **Audit.** Auditor replays the harness from the recorded artifact;
   replay must reproduce the same evidence.

The proof is admitted because it exercises the carrier draw path with
deterministic input and produces auditable artifact detail.

## Reader Scenario: A Forbidden Closure Attempt

A contributor proposes closing carrier proof using Desktop chat's
Live2D pixel test.

1. **Reject.** Desktop chat Live2D renderer is a separate
   implementation. It does not exercise the Avatar carrier canvas.
2. **Reason code.** "Desktop renderer evidence cannot close carrier
   visual proof per `carrier-visual-acceptance-contract.md` §3."
3. **Re-route.** Contributor builds an Avatar-carrier deterministic
   harness instead.

The contract is closed under this rule because mixing renderer proofs
hides which path actually works.

## Boundary Summary

| Concern | Owner |
| --- | --- |
| Evidence taxonomy + fail-closed boundary | Avatar (this contract) |
| Backend-specific pixel write paths | Backend branch contract + per-backend (Live2D / VRM) |
| Asset tier requirements driving acceptance | `live2d-asset-compatibility-contract.md` |
| Desktop chat Live2D renderer | Desktop (separate; never Avatar carrier proof) |

## Source Basis

- [`.nimi/spec/avatar/kernel/carrier-visual-acceptance-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/carrier-visual-acceptance-contract.md)
- [`.nimi/spec/avatar/kernel/live2d-render-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/live2d-render-contract.md)
- [`.nimi/spec/avatar/kernel/live2d-asset-compatibility-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/live2d-asset-compatibility-contract.md)
- [`.nimi/spec/avatar/kernel/backend-branch-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/backend-branch-contract.md)
- [`.nimi/spec/avatar/kernel/app-shell-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/app-shell-contract.md)
- [`.nimi/spec/avatar/kernel/mock-fixture-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/mock-fixture-contract.md)
