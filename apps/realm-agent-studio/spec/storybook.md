---
id: SPEC-REALM-AGENT-STUDIO-STORYBOOK-001
title: Realm Agent Studio Storybook
status: active
owner: "@team"
updated: 2026-05-21
---

# Storybook

This storybook absorbs acceptance narratives from the detailed topic storybook
into the admitted app authority. It does not define UI layout or
implementation.

## Personas

- Single-Agent Creator: operates one public Realm Agent and needs coherent
  setting, visual identity, and posting.
- Multi-Agent Owner: operates many public Realm Agents and needs source status,
  filtering, sorting, and manual triage.
- World Creator Boundary Case: may also own worlds, but world ownership does
  not grant edit authority over owner-created Realm Agents.

## Acceptance Narratives

| Story | Required acceptance |
| --- | --- |
| Review Agent Portfolio | Owned creator-owned Realm Agents are visible with app-local draft or Realm-created status and source availability. Unavailable metrics are not zero. LocalAgent private state is never exposed. |
| Create Realm Agent | Creation defaults to `OASIS`, allows any Realm `listWorlds` result by product decision, shows selected-world basic setting from existing world detail before submit, submits owner create only through `AgentsService.agentControllerCreate` / `POST /api/agent`, and succeeds only when Realm returns the canonical created object with `id`. |
| Update Canonical Setting | Current canonical setting and visible rule content are shown. AI proposals remain editable. Save succeeds only through admitted Realm writes. Private LocalAgent memory is not overwritten. |
| Review Setting Consistency | Runtime review is advisory. Accepted edits return to normal owner-reviewed save. Runtime does not define Realm truth. |
| Build Visual Identity | Upload/generated media remains candidate material until owner selection and Realm resource/asset/binding/profile write success. Local preview is not public. |
| Create Voice Demo Candidate | Runtime routes through canonical `audio.synthesize`; current SDK call path is `media.tts.synthesize`. Voice demo is candidate/sample material, not direct chat or custom voice authority. |
| Publish As Agent | Agent identity authors the post. Creator does not select a world destination. Create Post rejects caller-owned `worldId`; Realm resolves world context server-side. Post truth remains world-attached. |
| Understand Friend Count | At most `friendCount` / 好友数 may appear, only after source-backed owner-visible read admission. Unavailable count is source unavailable, not zero. |
| Operate Many Agents | List/filter/sort support manual operation across many agents. Saved filters are local view preferences, not queue/campaign truth. |
| Handle Capability Failure | Failures name the exact unavailable capability or source and preserve valid draft/candidate state. |
| Owner-Only Operation | Owner-created agent edits require owner authority. World-created agents remain out of scope. |
| Use AI As Creative Assistance | AI is embedded in setting, visual, voice, post, and source-backed suggestion workflows. AI output never bypasses human review. |
| Preview Agent Voice And Behavior | Preview is advisory, cannot mutate LocalAgent state, cannot create posts, and cannot become truth without owner save. |
| Deferred Post Performance Review | Post performance, economic views, and causal attribution are deferred. |
| UX Consistency With Platform | Future implementation must use platform architecture and kit-first UI authority, but this spec does not begin UI design. |

## Storybook Gaps

- Portfolio read surfaces for creator-owned Realm Agent list/read are
  `GET /api/me/agents` and `GET /api/me/agents/{agentId}`; Studio consumes only
  current-user `MASTER_OWNED` Realm Agents and must not substitute
  world-owned/NPC lists. `GET /api/creator/agents` and
  `GET /api/agent/dev/my-agents` are not Studio canonical surfaces.
- Owner create surface is `POST /api/agent` through
  `AgentsService.agentControllerCreate`. `/api/creator/agents` is
  World Creator / Maintainer evidence only and is not an owner create path.
- `GET /api/world` / `listWorlds` exists as a Realm read surface. Product
  decision is that all returned worlds are selectable; admission needs citation
  to the existing SDK surface rather than a new selectable-world decision.
- `OASIS` is admitted as the canonical system main world. Studio defaulting
  resolves from `WorldsService.worldControllerListWorlds` and submits the
  selected source world id.
- `friendCount` read surface is source-backed by `UserLiteDto.friendCount` when
  present; Realm derives it from human-agent Friendship rows.
- Studio must not introduce a Realm Agent lifecycle state machine. App-local
  drafts may exist before Realm creation; after Realm creation the app supports
  update operations.
- Visual asset write paths are pinned for post image/video attachments and
  partial for avatar and voice-demo sample. Profile cover uses the Realm
  `profileCoverUrl` profile attribute.
- Single reviewed local draft scheduling is app-local. Local schedule success
  is not Realm publish success and is not a Realm scheduling gap.

Source: `.nimi/topics/ongoing/2026-05-21-realm-agent-studio-product-flow-storybook/user-storybook-detailed.md`.
