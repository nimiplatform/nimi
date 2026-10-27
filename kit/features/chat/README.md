# Kit Feature: Chat

Reusable chat capability module for unified conversation shells, target-first chat surfaces, input composition, AI session UX, and default chat views.

## Canonical Parity Matrix

Kit owns the common rendering and interaction of its named chat primitives. Apps may compose those primitives into their own pages, navigation, partner selection, and admitted layout; sharing Conversation consumption does not require identical App screens.

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

Regression fixtures live in `kit/features/chat/test/conversation-shell-ui.test.tsx`. They check the shared shell contract; product authority remains in `.nimi/spec/**`, and fixture success does not replace consumer acceptance.

## Public Surfaces

- **`@nimiplatform/kit/features/chat`**: Root feature entry (stays adapter-driven).
- **`@nimiplatform/kit/features/chat/headless`**: Unified `AI / Human / Agent` conversation contracts, target-first shell adapters, LocalAgent conversation observers/persistence helpers, `createBrowserAppConversationHostPort()`, and shared composer helpers.
- **`@nimiplatform/kit/features/chat/ui`**: Shared UI components and shells, including `AppConversationEntry` and LocalAgent playback/stop/follow-up controls.
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

### 2. Protected App Conversation Entry & LocalAgent Controls

The new shared LocalAgent observation and recovery APIs require matching Runtime, SDK, native carrier, and Kit source builds for the next 0.x minor release.

- **`AppConversationEntry`**: An optional UI composition for a formal protected App client (used by Lab's registered `agent-conversation` workspace). It requires explicit bounded Agent-reference selection, opens one canonical Conversation, hydrates with subscribe-before-snapshot high-water fencing, and runs attachment upload, recorded transcription, committed image/voice artifact reads, send, and interrupt through canonical Conversation operations. It delegates only preview, picker, recorder, and playback mechanics to an identity-free Host port—do not add a second Runtime client, identity lookup, optimistic transcript, or App-local session owner. Internally it delegates to the same LocalAgent observer used by Desktop and Zhiyu; adopting `AppConversationEntry` is not required to share LocalAgent lifecycle behavior.
- **`createBrowserAppConversationHostPort()`**: Browser Host port factory for protected Apps. It performs no work at construction time; file picker and microphone access start only on explicit UI actions, while Blob preview URLs, recorded media tracks, and Audio playback URLs remain Host-owned and are released by the port.
- **Observation (`observeLocalAppConversation`)**: Binds to one explicit handle/anchor, subscribes before taking the snapshot, accepts increasing public sequence gaps, retains owner partial state, and replaces a retryable failed observation without sending anything. `state.textTurnId` governs text occupancy independently of active media tails. Close the observer when its scope changes.
- **Artifact preview cache (`createCanonicalConversationMediaReader`)**: Scoped nonblocking preview cache. A failed artifact read does not alter the Conversation result. `getReadError()` exposes failed or retrying reads, while explicit `retryFailed()` rereads only those stored artifacts, coalescing pending reads and keeping ready previews. It never generates an image or sends a turn.
- **Draft persistence & submission recovery**:
  - `useAgentComposerPersistence` receives protected App storage and caller draft mechanics; `reconcileAgentSubmission` acts on an explicit user choice: with `sendIfMissing: false`, it only reads the snapshot (absence in a bounded snapshot does not prove non-admission); with `sendIfMissing: true`, it sends the saved request ID so Runtime can return the admitted turn or accept that original request once. The latter may start model work and incur costs. Neither helper owns Runtime recovery or execution.
  - `LocalAppConversationSubmissionRecovery` exposes an optional `onAdmitted(submission)` callback for an App's draft owner to consume attachments tied to the original request. It runs only after admission is confirmed and before `acknowledge` removes the saved submission. `onResolved` remains a view-refresh callback. Neither callback authorizes clearing unrelated or newly selected attachments.
- **Turn & playback controls**:
  - `useLocalAppConversationPlayback` owns one renderer's playback outside menus and virtual message rows. `LocalAppConversationPlayer` projects the same state inline or beside the composer. Read/play failures reuse their confirmed artifact; read-only refresh and explicit same-request continuation are separate actions. Realtime blocks standalone message audio until closure is confirmed.
  - `CanonicalTranscriptView.messageActions` supplies shared message-ID actions, copy, quotation, and keyboard navigation. `getMessageInteractionCopy(locale)` provides shared English/Chinese action copy.
  - `useLocalAppConversationQuote` prepares a canonical quotation through public `readMessage`, preserves draft intent across asynchronous preparation, and exposes a non-authoritative draft reference for `useAgentComposerPersistence`. `LocalAppConversationQuotePreview` fits `CanonicalComposer.quoteSlot`; `submitDisabled` blocks sending while preserving typing.
  - `useLocalAppConversationHistory` holds one bounded navigation window apart from the live observer. Pass its `projection` only to view mapping and its `positionRequest` to the transcript; never hydrate the live reducer with it. `onPositionChange`/`onUserNavigate` preserve the user's reading position and cancel obsolete navigation.
  - `LocalAppConversationMediaStopButton` interrupts the named media turn and waits for owner state without disabling a newer text turn.
  - `LocalAppConversationFollowUpControl` shows a pending continuation with its revision-checked cancel action, or a status-read failure with refresh. It renders nothing when idle; persistent contact preferences remain in AgentCenter. Hosts place it near current conversation activity and route its optional management action to the behavior section.
  - None of these controls enable capabilities implicitly.

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

- Check `chat/ui` before creating a new composer shell, app AI chat panel, human chat timeline, LocalAgent conversation control, or shared stream status block.
- Check `chat/headless` before writing local input-state orchestration, submit wiring, cancel handling, LocalAgent observation/draft recovery, or shared session state.
- Check vNext `@nimiplatform/sdk/ai` model surfaces for ordinary app-AI generate/stream helpers, then check `chat/runtime` for reusable composer/session adapters and orchestration providers before wrapping runtime text APIs directly in app code.
- Check `chat/realm` for generated human chat send/list/read/sync-window and timeline helpers before rebuilding HTTP chat composition.

## What Stays Outside

- App-local system prompt policy.
- Runtime Agent Chat product-mode wiring and app shell persistence details (execution and projection truth remain Runtime-owned).
- Concrete socket client creation and app-owned notification/query side effects.
- App-owned transport and source data orchestration feeding canonical drawer sections, message/content slots, and capability hooks.
- App-specific navigation, persistence, and moderation shells.

## Current Consumers

- **`desktop` and `zhiyu` LocalAgent Chat**: Use the shared `observeLocalAppConversation`, canonical reducer, scoped draft/pending-request persistence, explicit same-request reconciliation, voice playback/retry, and follow-up controls. Runtime remains the only durable Conversation owner; App view mapping, navigation, partner selection, and host mechanics remain local.
- **`desktop`**: Uses `chat/headless`, `chat/realm`, and `chat/ui` for human chat composer wiring, confirmed-message cache projection, timeline rendering, stream status, and thread shell.
- **`lab`**: Uses `AppConversationEntry` in its registered `agent-conversation` workspace, along with `chat/headless` composer and attachment helpers and `chat/realm`. Its `chat.stream` capability page runs through Lab's own SDK capability host rather than `chat/runtime`.

## Verification

```bash
pnpm --filter @nimiplatform/kit test
pnpm check:nimi-kit
```


## Managed Realm media

Canonical image/video messages consume `metadata.mediaDelivery` and the containing business read's `metadata.refreshMedia` callback. Use the canonical bubble instead of replacing it with raw image/video tags: it owns responsive candidates, HLS, expiry recovery and original-image preview. Original downloads use `metadata.openMediaOriginal(url)` when the consumer supplies its admitted host opener; ordinary browsers retain their link behavior. Expired original grants are refreshed before opening, and refresh/open failures remain visible in the dialog. No new Electron window or navigation permission is required.
