# Backend Branches

Avatar has a closed backend union with exactly three kinds:
`live2d | vrm | nimi2d`. One Avatar-owned factory validates the model and
selects the matching branch exhaustively. A package or third-party App cannot
register another renderer at runtime.

## Shared Branch Contract

Every branch exposes the same backend-neutral shape:

| Surface | Purpose |
| --- | --- |
| `kind` | The validated `live2d`, `vrm`, or `nimi2d` discriminator |
| `nominalBounds` | Positive logical size and normalized body center |
| `projection` | Activity, emotion, motion, expression, and reset operations |
| `surface` | The Avatar-owned render component |
| `metadata()` | Opaque branch diagnostics |
| `shutdown()` | Release render, audio, and projection resources |

The carrier uses only this shared shape. Backend metadata does not become
cross-backend product truth, and renderer identifiers do not escape through
the backend-neutral projection.

## Live2D

The Live2D branch loads and validates a Cubism model, renders it on the Avatar
surface, derives bounded hit regions, and consumes local audio for lipsync.
Live2D alone exposes the branch-local `setParameter` extension. Only
Avatar-owned projection translation may call that extension after narrowing
the branch kind.

## VRM

The VRM branch loads a validated VRM model and its typed capability profile.
The profile records humanoid bones, expressions, look-at support, pose limits,
and supported deterministic motion routes. Unsupported routes fail closed;
the branch does not pretend that missing bones or expressions succeeded.

VRM is a current admitted Avatar backend branch, not a future placeholder and
not a public third-party driver surface.

## Nimi2D

The Nimi2D branch loads a digest-validated Nimi2D package and its capability
profile, creates the Nimi2D composer, and renders the admitted layer plan. Its
profile determines whether expression, speech-mouth, idle-life, and gesture
motion lanes are available.

Nimi2D package internals remain owned by Nimi2D. Avatar consumes the validated
package and profile without redefining their schema or content-governance
meaning.

## Backend-Neutral Projection

A Runtime presentation result reaches Avatar as typed semantic input. Avatar
first preserves that meaning in backend-neutral cues, then the active branch
maps the cues to renderer-local operations:

| Cue | Example branch operation |
| --- | --- |
| activity or motion | Live2D motion group, VRM deterministic route, or Nimi2D motion lane |
| emotion or expression | Live2D parameter/expression stack, VRM expression manager, or Nimi2D expression lane |
| speak | Branch audio consumer and renderer-local mouth weights |
| surface bounds | Branch nominal bounds and hit-region protocol |

Reset and shutdown clear only Avatar-owned local state. They do not alter
Runtime presentation, continuity, participation, or provenance.

## Reader Scenario: Selecting a Branch

1. Runtime authorizes a visual package.
2. The verified native host materializes it under the protected data root.
3. Avatar validates the model manifest.
4. The single branch factory selects `live2d`, `vrm`, or `nimi2d`.
5. An unknown kind, an incomplete profile, or invalid bounds keeps the carrier
   non-ready.

Adding a fourth backend requires an explicit product decision and a complete
typed implementation; there is no placeholder or plugin fallback.

## Source Basis

- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [`.nimi/spec/nimi2d/asset-package.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/nimi2d/asset-package.authority.yaml)
