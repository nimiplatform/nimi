# Kit Feature: Chat

## What It Is
Reusable chat capability module for input composition, AI session UX, and default chat surfaces.

## Public Surfaces
- `@nimiplatform/nimi-kit/features/chat`
- `@nimiplatform/nimi-kit/features/chat/headless`
- `@nimiplatform/nimi-kit/features/chat/realm`
- `@nimiplatform/nimi-kit/features/chat/ui`
- `@nimiplatform/nimi-kit/features/chat/runtime`
- Current surfaces:
  - `headless`: active
  - `ui`: active
  - `runtime`: active for local AI/runtime engine text generation and streaming
  - `realm`: active for typed human chat send/list/read/sync-window integration, realtime event normalization/cache helpers, timeline composition/display modeling, and a socket-agnostic realtime controller; socket construction remains app-local

## When To Use It
- Reuse `ChatComposer` and session state for AI conversation.
- Bind runtime text generation through `chat/runtime`.
- Bind human chat send/list/read flows through `chat/realm`.
- Reuse realm chat realtime event parsing and cache merge helpers without copying desktop logic.
- Reuse `useRealmChatRealtimeController(...)` when an app already owns socket creation but should not reimplement session open/ack/sync orchestration.
- Reuse `useRealmMessageTimeline(...)` and `getRealmChatTimelineDisplayModel(...)` to avoid reimplementing timeline merge and message-kind display rules.
- Reuse `RealmChatTimeline` when an app only needs to inject avatars, gift/media overrides, and surrounding shell.
- Reuse `ChatStreamStatus` for shared streaming/interrupted message status blocks while keeping cancel wiring app-local.
- Reuse `ChatThreadHeader` and `ChatPanelState` for chat header, loading, error, and unselected-thread shells.
- Reuse `ChatComposerResizeHandle` and `ChatComposerShell` for shared composer layout without moving app-specific input behavior into kit.

## What Stays Outside
- App-local system prompt policy.
- Concrete socket client creation and app-owned notification/query side effects.
- Rich media upload orchestration, gift/media override rendering, and app-owned surrounding chat shells.
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
