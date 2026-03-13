# Overtone — Overview

> Status: Draft | Date: 2026-03-13

## Recommended Name

- Product name: `Overtone`
- Display variant: `Overtone Studio`
- Reason: the repo path already uses `apps/overtone`, and the name is more ownable than the generic `Audio Studio`.

## Product Positioning

Overtone is a Tauri desktop demo built on nimi for AI-native music creation. Its job is not to be a full DAW. Its job is to prove that a standalone app can connect directly to `nimi runtime` and `nimi realm` through the SDK and deliver a credible music creation workflow:

**Brief → Lyrics → Generate multiple candidates → Compare → Extend/Remix from references → Publish**

## Demo Goal

The demo should answer three platform questions:

1. Can a Tauri app use `@nimiplatform/sdk/runtime` as the primary path for AI music creation without adding an app-specific backend?
2. Can the same app publish finished outputs to realm with `@nimiplatform/sdk/realm`?
3. Can nimi support a modern AI music product shape, where iteration matters more than one-shot generation?

## Target Users

- Creators who want to go from idea to shareable song quickly.
- Developers evaluating nimi as a multimodal app platform.
- Content creators who need original music for videos, podcasts, games, or social content.

## Market-Informed Product Defaults

Current AI music products are converging on a few workflow expectations, and Overtone should reflect them in spec:

1. Prompt-only generation is not enough; users expect to start from uploaded audio, previous takes, or style references.
2. Users expect iteration primitives such as compare, remix, extend, trim, and section-level editing.
3. A project/session view matters more than a single linear wizard once multiple takes exist.
4. Export/publish needs provenance checks because reference audio and uploaded material can carry rights constraints.

## Core Scope

### P0 Demo Scope

- Song brief and lyrics assistance.
- Music generation with async job tracking.
- Multi-candidate compare and selection.
- Reference-audio-driven extend/remix via runtime-supported music extensions.
- Playback, metadata editing, and realm publish.

### P1 Expansion

- Cover art generation.
- Scratch vocals / guide vocals with TTS.

### P2 Experimental

- Voice clone / voice design.
- Stem-aware editing when runtime/provider outputs make it practical.

## Non-Goals

- Full multitrack DAW replacement.
- Precision audio editing down to bar/beat automation.
- Local audio mastering pipeline.
- Custom Overtone backend for music orchestration.
- Hardcoded provider/product assumptions in the app shell.

## Platform Relationship

Overtone is a nimi platform demo app that demonstrates:

1. `Tauri + SDK + runtime` direct connection for text, music, image, and optional voice flows.
2. `Tauri + SDK + realm` direct connection for media upload and post creation.
3. A renderer-owned product workflow, where Rust stays transport-focused and does not own business logic.
4. A modern AI music UX centered on takes, references, and iteration rather than a one-shot prompt form.

## Architecture Position

```
apps/overtone/          # Tauri 2 desktop app
├── renderer business logic
│   ├── song brief + lyrics
│   ├── candidate stack + compare
│   ├── reference remix/extend
│   ├── playback + publish
│   └── optional cover / guide vocal tools
├── SDK runtime ────→ nimi runtime (local gRPC through Tauri bridge)
│   ├── TEXT_GENERATE
│   ├── MUSIC_GENERATE
│   ├── IMAGE_GENERATE
│   ├── SPEECH_SYNTHESIZE (optional)
│   └── VOICE_CLONE / VOICE_DESIGN (experimental)
└── SDK realm ──────→ nimi realm (HTTP)
    └── media upload + post creation
```

## Differentiation

| Aspect | Existing Desktop App | Overtone |
|--------|---------------------|----------|
| Scope | Full platform shell | Single-purpose music creation demo |
| Primary UX | Chat / agent / platform shell | Project workspace with takes and publish flow |
| Runtime usage | Broad platform coverage | Narrow, opinionated multimodal composition |
| Rust surface | Full runtime bridge + local AI + mods | Minimal transport/bootstrap subset |
