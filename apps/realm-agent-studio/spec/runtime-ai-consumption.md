---
id: SPEC-REALM-AGENT-STUDIO-RUNTIME-AI-CONSUMPTION-001
title: Runtime AI Consumption
status: active
owner: "@team"
updated: 2026-05-22
---

# Runtime AI Consumption

Runtime is an AI consumption layer for Studio workflows. It does not own Realm
Agent truth, publish authority, moderation, permissions, lifecycle, metrics, or
product state.

## Allowed AI Assistance

AI may assist only inside concrete owner workflows:

- draft or rewrite setting text;
- convert natural-language edits into visible rule-shaped candidates;
- review consistency across personality, worldview, greeting, post voice, and
  public description;
- generate avatar, portrait, reference, and post image candidates through image
  generation when available;
- generate video candidates only after the required Realm media path is
  admitted;
- draft post copy and captions;
- generate voice-demo candidates;
- provide operation suggestions only from source-backed signals.

AI output remains candidate material until owner acceptance and the relevant
Realm write succeeds. Runtime output is never truth by default
(`.nimi/spec/realm/kernel/truth-contract.md:23` to `:25`).

## Voice Demo Path

The canonical Runtime capability token for voice-demo synthesis is
`audio.synthesize`. It is present in the runtime capability vocabulary and in
canonical tokens (`.nimi/spec/runtime/kernel/tables/capability-vocabulary-mapping.yaml:1`
to `:13`; `:67` to `:80`). Local manifest token `tts` maps to
`audio.synthesize` (`.nimi/spec/runtime/kernel/tables/capability-vocabulary-mapping.yaml:86`
to `:96`; `:149` to `:152`).

Runtime RPC authority keeps text/image/video/audio under AIService scenario/job
surfaces and does not add a top-level multimodal RPC
(`.nimi/spec/runtime/kernel/rpc-surface.md:32` to `:56`).

Current SDK media path evidence:

- `SpeechSynthesizeInput` includes `text`, optional `voiceRef`, audio options,
  route, connector, metadata, idempotency, and signal fields
  (`sdk/src/runtime/types-media.ts:231` to `:265`);
- `SpeechSynthesizeOutput` returns a job, artifacts, and trace
  (`sdk/src/runtime/types-media.ts:292` to `:308`);
- `ScenarioJobSubmitInput` includes `modal: 'tts'`
  (`sdk/src/runtime/types-media.ts:380` to `:386`);
- `RuntimeMediaModule.tts.synthesize(...)` is the current SDK method path
  (`sdk/src/runtime/types-media.ts:388` to `:400`).

## Truth Boundary

Runtime may receive only admitted public or owner-approved context:

- current public setting or owner draft text;
- selected world constraints and basic setting only from admitted Realm read
  surfaces;
- selected media candidates or active public media;
- source-backed signals when available.

Runtime must not receive private LocalAgent memory, emotion, cognition, local
chat transcript, or app-specific memory fragments for Studio workflows.

Runtime route failure is capability unavailable, not Realm failure. Malformed AI
output is draft/candidate failure and must not write through Realm.

Development builds may expose source preview for AI inputs. Launch visibility of
source preview remains a product decision and must be rechecked before release.

## Runtime Projection Summary

Studio's owner-facing Runtime projection helper is world-only. The request may
carry source-backed `worldId`, allowed world scopes, inherited-agent-rule
exclusion, and Studio focus keywords. It must not submit `agentId`,
`allowedAgentLayers`, `allowedAgentScopes`, owner settings writes, raw
`AgentRule` content, LocalAgent memory, or private transcript material.

The response may be normalized to checksum and aggregate world-rule/source counts
only. Agent rule counts and raw selected/suppressed rule material are not part of
the owner-facing summary.
