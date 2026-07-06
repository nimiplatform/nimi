# Zhiyu Avatar And Voice Surface Contract

## Z-AV-001 Avatar Config And Launch

Zhiyu provides Avatar config and launch affordances for the current partner,
including Live2D/VRM import and selection through admitted owner facades.
Avatar config truth, resource truth, carrier lifecycle, and runtime rendering
belong to Avatar/Runtime/Kit.

## Z-AV-002 Launch-Only Carrier Posture

Zhiyu v1 uses launch handoff to Avatar app or independent surface. Zhiyu does
not embed Avatar carrier runtime unless Avatar owner admits an embedded facade.

## Z-AV-003 Runtime Voice Playback Surface

Runtime voice playback is admitted for Zhiyu only through the Runtime/SDK voice
projection surface. Zhiyu may consume
`runtime.agent.presentation.voice_playback_requested` and
`runtime.agent.presentation.voice_stream_chunk_available` when those events
carry positive Runtime voice truth.

Zhiyu is a playback surface only. Zhiyu must:

- consume Runtime/SDK voice projection truth (`voice_output_mode`,
  `voice_playback_state`, chunk ordering, final replay artifact) and never select
  provider/model or run app-local TTS
- never own durable voice cache truth; final replay bytes are read from the
  Runtime artifact service
- fail closed when Runtime voice truth is absent rather than fabricating a
  ready-looking playback state

## Z-AV-004 Voice Drift Handoff

Runtime/SDK native voice truth (positive `voice_output_mode`, separate
`voice_playback_state`, non-final-before-final chunk ordering, Runtime interrupt
truth, durable final replay artifact) is the authority for Zhiyu voice playback.
Zhiyu must fail closed when that Runtime truth is absent, simulated, or
incomplete; it must not revive deferred-looking success states or app-local
speech fallbacks.

The eventual Zhiyu Electron live-runtime gate
(`test:e2e:electron:live-runtime`) is a `fixture-green` wiring proof only: it
proves Runtime/SDK/Zhiyu plumbing against the admitted live-runtime fixture.
`product-green` is a strictly stronger bar that additionally requires a named
real-provider route proving native custom-`VoiceAsset` streaming with the same
final acceptance semantics. Fixture-green must never be reported as
`product-green` real-provider readiness.

## Z-AV-005 Avatar Launch Parity Gate

If Zhiyu enables Desktop Agent Chat equivalent avatar launch behavior, the
`start_with_chat` gate, live instance policy, and public handoff evidence must
be admitted here for Zhiyu. Desktop avatar rules are provenance for migration,
not direct Zhiyu authority. Without admitted public handoff, Zhiyu must present
avatar launch as disabled/deferred with a reason code and no ready-looking local
instance fabrication.
