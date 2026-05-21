---
id: SPEC-REALM-AGENT-STUDIO-FAILURE-SEMANTICS-001
title: Failure Semantics
status: active
owner: "@team"
updated: 2026-05-21
---

# Failure Semantics

Failures are first-class product states. Studio must name the failed surface or
capability and preserve valid draft/candidate state without projecting success.

## Required Failure States

- Realm unavailable.
- Permission missing.
- Owner-created authority missing.
- World-list read surface unavailable.
- Selected world basic-setting read unavailable.
- Agent creation rejected.
- Setting read unavailable.
- Setting update rejected.
- Rule-shaped AI output invalid or malformed.
- Runtime capability unavailable.
- Image/video/audio generation failed.
- Local asset history unavailable.
- Resource upload/finalize failed.
- Public asset write failed.
- Binding validation failed.
- Attachment validation failed.
- Moderation pending.
- Moderation rejected.
- Publish failed.
- App-local schedule unavailable or failed.
- `friendCount` / 好友数 source unavailable.
- Metric source unavailable.

## Success Rules

- Local draft saved is not Realm creation success.
- AI generation complete is not public asset success.
- Candidate selected is not active public asset success.
- Local schedule created is not public post success.
- Attachment preview resolved is not attachment persistence success.
- Runtime output accepted is not Realm truth until the admitted Realm write
  succeeds.
- Unavailable count is not zero.

## Fail-Closed Requirements

Studio must fail closed when:

- owner authority cannot be proven;
- a field does not have an admitted write owner;
- an attachment target is missing, not READY, unreadable, or unauthorized;
- a binding combination is undeclared;
- AI output cannot be mapped to visible owner-reviewed fields;
- Runtime asks for private LocalAgent state;
- Realm rejects a create, update, publish, asset, or binding write.

No placeholder success, fake return, synthesized moderation success, or
renderer-local truth can satisfy these states.
