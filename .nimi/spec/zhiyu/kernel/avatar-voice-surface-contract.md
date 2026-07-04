# Zhiyu Avatar And Voice Surface Contract

## Z-AV-001 Avatar Config And Launch

Zhiyu provides Avatar config and launch affordances for the current partner,
including Live2D/VRM import and selection through admitted owner facades.
Avatar config truth, resource truth, carrier lifecycle, and runtime rendering
belong to Avatar/Runtime/Kit.

## Z-AV-002 Launch-Only Carrier Posture

Zhiyu v1 uses launch handoff to Avatar app or independent surface. Zhiyu does
not embed Avatar carrier runtime unless Avatar owner admits an embedded facade.

## Z-AV-003 Voice Deferred

Voice/TTS/reading is deferred for Zhiyu v1. Zhiyu may show state and future
entry copy, but must not consume `runtime.agent.turn.voice_render` or app-local
TTS as a v1 journey.

## Z-AV-004 Voice Drift Handoff

SDK voice render surface exists, but current Runtime app-facing ingress
admission confirms only turn request and interrupt. Runtime/SDK/Avatar owners
must resolve that drift before Zhiyu can consume voice render.

## Z-AV-005 Avatar Launch Parity Gate

If Zhiyu enables Desktop Agent Chat equivalent avatar launch behavior, the
`start_with_chat` gate, live instance policy, and public handoff evidence must
be admitted here for Zhiyu. Desktop avatar rules are provenance for migration,
not direct Zhiyu authority. Without admitted public handoff, Zhiyu must present
avatar launch as disabled/deferred with a reason code and no ready-looking local
instance fabrication.
