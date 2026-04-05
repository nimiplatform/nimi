# Kit Feature: Chat

## What It Is
Reusable chat capability module for unified conversation shell work, target-first chat surfaces, input composition, AI session UX, and default chat surfaces.

## Canonical Parity Matrix
`local-chat` is the only UI truth source for the canonical shell. Desktop chat may add source pills on the landing pane, but every other layer must stay structurally equivalent.

| Surface | Local-chat contract | Canonical kit requirement |
| --- | --- | --- |
| Target pane | Minimal bubble field landing | Same bubble field and target-entry behavior; only `AI / Human / Agent` pills may be added |
| Character rail | Hero avatar, presence badge, relationship badge, profile anchor | Same layout, badge ordering, and avatar anchor semantics |
| Conversation pane | Right-aligned stage/history + settings actions, fixed stage/composer width | Same header control order and width constraints |
| Stage panel | Anchored stage card, first-beat-first, wheel-up intent to history | Same anchor, pending, and history-intent behavior |
| Transcript | Grouped bubbles, date dividers, focused assistant group, welcome/history intro | Same grouping landmarks and scroll behavior |
| Composer | Local-chat shell with voice/media affordances and runtime hint | Same shell and placement; source-specific logic only through adapters/hooks |
| Settings drawer | Drawer header/body shell with independent scroll surface | Same drawer chrome; sections fed by canonical content |
| Profile drawer | Drawer shell for relationship/memory/target details | Same drawer chrome; sections fed by canonical content |
| Right sidebar | Prewarm, fixed width, boundary, overlay menu | Same shell and failure behavior |
| Voice menu | Overlay transcript toggle/context menu | Same overlay position contract and canonical hook path |

Authoritative parity fixtures live in `kit/features/chat/test/conversation-shell-ui.test.tsx`. Any shell change must update that fixture set or prove it does not affect the matrix above.

## Public Surfaces
- `@nimiplatform/nimi-kit/features/chat`
- `@nimiplatform/nimi-kit/features/chat/headless`
- `@nimiplatform/nimi-kit/features/chat/realm`
- `@nimiplatform/nimi-kit/features/chat/ui`
- `@nimiplatform/nimi-kit/features/chat/runtime`
- Current surfaces:
  - `headless`: active for unified `AI / Human / Agent` conversation contracts, target-first shell adapters, and shared composer helpers
  - `ui`: active
- `runtime`: active for local AI/runtime engine text generation and streaming
- `runtime`: active for orchestration provider runtime integration, including `simple-ai`, provider registry wiring, history budgeting, and runtime stream normalization
- `realm`: active for typed human chat send/list/read/sync-window integration, realtime event normalization/cache helpers, timeline composition/display modeling, and a socket-agnostic realtime controller; socket construction remains app-local
  - SDK-backed default realm bindings live only under `src/realm/**`; the feature root stays adapter-driven

## When To Use It
- Reuse `CanonicalConversationShell` when a product must match `local-chat` target landing, character rail, stage/chat switch, drawer, overlay, and message-surface interaction while swapping only the underlying source adapter.
- Reuse `CanonicalTargetPane`, `CanonicalCharacterRail`, `CanonicalConversationPane`, `CanonicalStagePanel`, `CanonicalTranscriptView`, `CanonicalMessageBubble`, `CanonicalTypingBubble`, `CanonicalRightSidebar`, `CanonicalDrawerShell`, `CanonicalDrawerSection`, and `CanonicalComposer` when the surrounding app needs extracted `local-chat`-equivalent layout primitives without taking the full shell.
- Reuse `ChatComposer` and session state for AI conversation.
- Bind runtime text generation through `chat/runtime`.
- Reuse the orchestration contracts/registry from `chat/headless` before adding app-local mode-specific submit loops.
- Reuse the `simple-ai` provider core from `chat/runtime` before rebuilding history-aware text-chat orchestration in app code.
- Bind human chat send/list/read flows through `chat/realm`.
- Reuse realm chat realtime event parsing and cache merge helpers without copying desktop logic.
- Reuse `useRealmChatRealtimeController(...)` when an app already owns socket creation but should not reimplement session open/ack/sync orchestration.
- Reuse `useRealmMessageTimeline(...)` and `getRealmChatTimelineDisplayModel(...)` to avoid reimplementing timeline merge and message-kind display rules.
- Reuse `RealmChatTimeline` only when an app needs the raw realm timeline surface outside the canonical shell path.
- Reuse `ChatStreamStatus` for shared streaming/interrupted message status blocks while keeping cancel wiring app-local.
- Reuse `ChatThreadHeader` and `ChatPanelState` for chat header, loading, error, and unselected-thread shells.
- Reuse `ChatComposerResizeHandle` and `ChatComposerShell` for shared composer layout without moving app-specific input behavior into kit.

## Before Building Locally
- Check `chat/ui` before creating a new composer shell, runtime chat panel, human chat timeline, or shared stream status block.
- Check `chat/headless` before writing local input-state orchestration, submit wiring, cancel handling, or shared session state.
- Check `chat/runtime` for AI generate/stream/session flows and orchestration providers before wrapping runtime text APIs directly in app code.
- Check `chat/realm` for human chat send/list/read/realtime/timeline helpers before rebuilding human chat cache and transport logic.

## What Stays Outside
- App-local system prompt policy.
- App-local `agent-local-chat-v1` product orchestration semantics.
- Concrete socket client creation and app-owned notification/query side effects.
- App-owned transport and source data orchestration that feeds canonical drawer sections, message/content slots, and capability hooks.
- App-specific navigation, persistence, and moderation shells.

## Current Consumers
- `relay`
  Uses `chat/ui` default `ChatComposer` for lightweight AI/hybrid chat input.
- `desktop`
  Uses `chat/headless`, `chat/realm`, and `chat/ui` surfaces for human chat composer wiring, realtime helpers, timeline rendering, stream status, and thread shell.
- `forge`
  Uses `chat/runtime` and `chat/ui` default `RuntimeChatPanel` for AI advisor and agent chat panels.
- `realm-drift`
  Uses `chat/realm`, `chat/headless`, and `chat/ui` for human chat thread shell, timeline, and send orchestration.

## Verification
- `pnpm --filter @nimiplatform/nimi-kit test`
- `pnpm check:nimi-kit`
