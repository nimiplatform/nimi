# Kit Feature: Chat

Reusable chat capability module for unified conversation shells, target-first chat surfaces, input composition, AI session UX, and default chat views.

## Canonical Parity Matrix

The Kit canonical shell is the single UI source of truth for shared chat surfaces. Desktop chat may add source pills on the landing pane, but every other layer must remain structurally equivalent.

| Surface | Canonical contract | Canonical kit requirement |
| --- | --- | --- |
| Target pane | Minimal bubble field landing | Same bubble field and target-entry behavior; only `AI / Human / Agent` pills may be added |
| Character rail | Hero avatar, presence badge, relationship badge, profile anchor | Same layout, badge ordering, and avatar anchor semantics |
| Conversation pane | Right-aligned stage/history + settings actions, fixed stage/composer width | Same header control order and width constraints |
| Stage panel | Anchored stage card, first-beat-first, wheel-up intent to history | Same anchor, pending, and history-intent behavior |
| Transcript | Grouped bubbles, date dividers, focused assistant group, welcome/history intro | Same grouping landmarks and scroll behavior |
| Composer | Canonical shell with voice/media affordances and runtime hint | Same shell and placement; source-specific logic only through adapters/hooks |
| Settings drawer | Drawer header/body shell with independent scroll surface | Same drawer chrome; sections fed by canonical content |
| Profile drawer | Drawer shell for relationship/memory/target details | Same drawer chrome; sections fed by canonical content |
| Right sidebar | Prewarm, fixed width, boundary, overlay menu | Same shell and failure behavior |
| Voice menu | Overlay transcript toggle/context menu | Same overlay position contract and canonical hook path |

Authoritative parity fixtures live in `kit/features/chat/test/conversation-shell-ui.test.tsx`. Any shell change must update that fixture set or prove it does not affect the matrix above.

## Public Surfaces

- **`@nimiplatform/kit/features/chat`**: Root feature entry (stays adapter-driven).
- **`@nimiplatform/kit/features/chat/headless`**: Unified `AI / Human / Agent` conversation contracts, target-first shell adapters, and shared composer helpers.
- **`@nimiplatform/kit/features/chat/ui`**: Shared UI components and shells.
  - `AppConversationEntry`: Implementation candidate for an ordinary formal App client. It requires explicit bounded Agent-reference selection, opens one canonical Conversation, hydrates with subscribe-before-snapshot high-water fencing, reads committed image/voice artifacts through Conversation, and delegates only preview, picker, recorder, and playback mechanics to an identity-free Host port. It has no active consumer until the single hard cut.
- **`@nimiplatform/kit/features/chat/runtime`**: Runtime-client-backed app-AI composer/session adapters and orchestration provider integration (`simple-ai`, provider registry wiring, history budgeting, and stream normalization). Ordinary app-AI text generate/stream helpers consume vNext `@nimiplatform/sdk/ai` model surfaces; Runtime Agent Chat remains part of the Runtime Agent lifecycle, not this Kit surface.
- **`@nimiplatform/kit/features/chat/realm`**: Generated typed human chat send/list/read/sync-window integration, confirmed-message cache helpers, and timeline composition/display modeling. SDK-backed default realm bindings live only under `src/realm/**`. Realtime protocol, session, replay, token, and socket ownership remain outside Kit until Runtime authority admits them.

## When To Use It

### 1. Conversation Shell & UI Primitives
- **Full canonical shell**: Reuse `CanonicalConversationShell` when a product needs the canonical target landing, character rail, stage/chat switch, drawer, overlay, and message-surface interactions while swapping only the underlying source adapter.
- **Extracted layout primitives**: Reuse `CanonicalTargetPane`, `CanonicalCharacterRail`, `CanonicalConversationPane`, `CanonicalStagePanel`, `CanonicalTranscriptView`, `CanonicalMessageBubble`, `CanonicalTypingBubble`, `CanonicalRightSidebar`, `CanonicalDrawerShell`, `CanonicalDrawerSection`, and `CanonicalComposer` when you need individual canonical layout building blocks without mounting the full shell.
- **Shared thread & composer chrome**:
  - `ChatComposer` and session state for AI conversations.
  - `ChatComposerResizeHandle` and `ChatComposerShell` for shared composer layout while keeping app-specific input behavior outside Kit.
  - `ChatThreadHeader` and `ChatPanelState` for chat headers, loading, error, and unselected-thread shells.
  - `ChatStreamStatus` for shared streaming or interrupted message status blocks while keeping cancel wiring app-local.

### 2. Protected App Conversation Entry
- **`AppConversationEntry`**: Mount when an eligible protected App needs the canonical Agent-reference-to-Conversation entry. Supply one formal App client plus Host media mechanics. Attachment upload, recorded transcription, artifact reads, send, and interrupt remain canonical Conversation operations—do not add another Runtime client, identity lookup, optimistic transcript, or App-local session owner.
- **`createBrowserAppConversationHostPort()`**: Reuse for browser-backed protected Apps. It performs no work at construction time; picker and microphone access begin only on explicit UI actions, while Blob preview URLs, recorded media tracks, and Audio playback URLs remain Host-owned and are released by the port.

### 3. App-AI Orchestration & Model Replay
- **Text generation & orchestration**: Bind ordinary app-AI text generation through vNext `@nimiplatform/sdk/ai` model surfaces. Use `chat/headless` orchestration contracts/registry before writing app-local mode-specific submit loops, and use `chat/runtime` when you need reusable Kit composer/session adapters or the `simple-ai` conversation provider.
- **`simple-ai` provider & `outputItems` continuity**:
  - When a turn's `turn-completed` event carries `outputItems` (final text, authorized summary parts, and opaque reasoning continuity), store them on that assistant history message.
  - The provider replays them unmodified; summaries remain separate from final text, and opaque carriers are never displayed.
  - `useAppAiChatSession` records them on its assistant messages the same way.
  - A protected App without a Runtime client drives the provider via `createModelConversationRuntimeAdapter({ model: createNimiLocalAppTextModel(client.ai) })` and the session hook via `useAppAiChatSession({ model: createNimiLocalAppTextModel(client.ai), resolveRequest })`.
- **Model switching & replay**:
  1. Settle the active turn first (`cancelAndWait()` on the session hook).
  2. Run `planConversationTextReplay` with the current effective selection's `textReplay` facts.
  3. Save its `contextStart` alongside the unchanged source history before dispatching the new request (the returned history is a request projection, not the saved record).
  4. Explain any reset to the user and preserve that boundary across reloads and switch-backs.
  5. Treat compatibility strictly as kind/version/mode data—never as a provider/model name or opaque-payload parser.
  6. Set `preserveHistory: true` when truncation has not been explicitly chosen.
  7. Ordinary text paths own no tool executor; a Host with tools must settle its own effects and preserve their results before switching.
  8. Media must stay in the original records and fail explicitly when the chosen route cannot accept it; never convert missing media into a text-only success.

### 4. Human Chat (Realm)
- Bind human chat send/list/read flows through `chat/realm`.
- Reuse the neutral confirmed-message cache merge helpers without moving backend event vocabulary into Kit.
- Reuse `useRealmMessageTimeline(...)` and `getRealmChatTimelineDisplayModel(...)` instead of reimplementing timeline merge and message-kind display rules.
- Reuse `RealmChatTimeline` only when an app needs the raw realm timeline surface outside the canonical shell path.

## Shared Agent Introduction

Call `useAgentIntroduction` from the runtime entry with a stable callback to `client.agents.getIntroduction({ agentHandle })`, then render `AgentIntroduction` from the UI entry. The same read-only `agent.local` operation serves both Home and ordinary Apps. Never resolve a source ID in the App to populate this surface.

Pass the current reference name/avatar, locale, and controlled-draft prefill callback:
- `questionsEnabled` controls only the question buttons; introduction content stays visible even when the composer is unavailable.
- Key the component by the current handle so static audio stops when the partner or session changes.
- The reader discards late results from older handles or reader scopes, exposing loading and unavailable states separately from Conversation readiness.

## Before Building Locally

- Check `chat/ui` before creating a new composer shell, app AI chat panel, human chat timeline, or shared stream status block.
- Check `chat/headless` before writing local input-state orchestration, submit wiring, cancel handling, or shared session state.
- Check vNext `@nimiplatform/sdk/ai` model surfaces for ordinary app-AI generate/stream helpers, then check `chat/runtime` for reusable composer/session adapters and orchestration providers before wrapping runtime text APIs directly in app code.
- Check `chat/realm` for generated human chat send/list/read/sync-window and timeline helpers before rebuilding HTTP chat composition.

## What Stays Outside

- App-local system prompt policy.
- Runtime Agent Chat product-mode wiring and app shell persistence details (execution and projection truth remain Runtime-owned).
- Concrete socket client creation and app-owned notification/query side effects.
- App-owned transport and source data orchestration feeding canonical drawer sections, message/content slots, and capability hooks.
- App-specific navigation, persistence, and moderation shells.

## Current Consumers

- **`desktop`**: Uses `chat/headless`, `chat/realm`, and `chat/ui` for human chat composer wiring, confirmed-message cache projection, timeline rendering, stream status, and thread shell.
- **`lab`**: Uses `chat/headless` composer and attachment helpers, `chat/realm`, and the root chat surface for Agent conversation; its `chat.stream` capability page runs through Lab's own SDK capability host rather than `chat/runtime`.

## Verification

```bash
pnpm --filter @nimiplatform/kit test
pnpm check:nimi-kit
```
