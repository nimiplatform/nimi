# Runtime LocalAgent Participation

Runtime owns LocalAgent conversation continuity, turn execution, operational
Memory, AI configuration, presentation state, voice policy, and bounded source
and turn-context projections. Model or provider output becomes product truth
only after Runtime interprets and commits it.

Conversation open and recovery are explicit. A consumer selects a LocalAgent
and conversation; no platform-wide default LocalAgent or implicit global
session exists. Consumer UI state, transcripts, caches, and presentation
adapters remain projections.

## App And Projection Access

Apps use the standard, typed LocalAgent consume seam. Access is derived from
the current protected app session, LocalAgent, operation, and owner state.
Scaffolded apps receive bounded status and results without receiving reusable
account, Realm, provider, or authorization material.

Runtime projections preserve their owner namespaces and typed provenance.
Consumers cannot reconstruct raw source context, synthesize success, or turn a
projection into durable identity or authorization truth.

## Voice And Avatar

Runtime owns LocalAgent transcription, synthesis policy, voice output, and
event provenance. Avatar consumes bounded voice and embodiment projections and
keeps only renderer-local playback, placement, and diagnostic state. Avatar
availability is independent from core LocalAgent text readiness.

Advanced participation and optional continuation remain deferred and
non-blocking.

## Source Basis

- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
