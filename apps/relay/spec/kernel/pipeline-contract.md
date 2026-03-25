# Relay Pipeline Contract

> Rule namespace: RL-PIPE-*
> Adapted from: local-chat LC-PIPE-001 ~ 014
> Architecture: Business logic in Electron main process, structured beat messages via IPC to renderer

## RL-PIPE-001 — Text Turn Pipeline

Text turn pipeline is beat-first, deterministic, and auditable from input to persistence:

1. resolve a local fast turn hint before first-beat generation
2. compile a lightweight `first-beat` `ContextPacket` for first-beat generation and a full `ContextPacket` for deep perception / tail planning
3. persist user turn immediately after session resolution, before assistant generation
4. start `firstBeat` before turn perception blocks the user-visible path; turn perception may run in parallel or after first-beat seal, but tail planning must still consume its result
5. deliver assistant `firstBeat` as a finalized message before tail beats are planned or scheduled
6. schedule later beats through a single delivery director within the same assistant turn
7. emit structured beat messages to renderer via IPC (`relay:chat:beat`)

## RL-PIPE-002 — Session Lifecycle

Session lifecycle is single-thread per viewer-target relation:

1. each viewer-target pair may persist at most one recoverable session
2. target entry must auto-create or recover that sole session
3. history clear resets the active thread without introducing a second session
4. session data persists to Electron `userData` via `RelayChatStorage`

## RL-PIPE-003 — Context Compile Pipeline

Send path must compile prompt context by profile:

1. `viewerId` must be passed explicitly from main process state
2. target identity must be normalized before prompt rendering
3. `interactionProfile` must be derived locally from target DNA / metadata / world context
4. recent exact history must be selected by bundle, not by flat message count
5. `first-beat` context must stay lightweight: it keeps identity / interaction profile / compact recent turns / compact interaction snapshot, and must not depend on `recallIndex`, `sessionRecall`, or platform warm-start data
6. full-turn context must expose `interactionSnapshot`, `relationMemorySlots`, `recallIndex`, and platform warm-start data when available
7. unresolved `openLoops / assistantCommitments / stable userPrefs` must receive continuity-aware priority during relation-memory selection for full-turn context
8. prompt-injected `sessionRecall` must be a continuity-aware top-K subset, not a full dump of the stored recall index
9. if the current user turn has already been persisted before prompt compile, `recentTurns` must not repeat that same input when `userInput` already carries it explicitly
10. `turn-perception` must consume a budgeted compact continuity view; it must not inject raw media generation prompts back into perception context
11. perception-side `recentTurns / relationMemory / snapshot` lanes must enforce stable per-lane budgets and a final hard ceiling before provider invocation

## RL-PIPE-004 — First Beat and Turn Plan Pipeline

Successful text turns may use multiple model calls on the critical path:

1. `FirstBeatReactor` must build a dedicated `first-beat` prompt from the lightweight `first-beat` `ContextPacket` without waiting for turn perception to finish
2. `FirstBeatReactor` may use a streaming text call, but it must seal to one complete finalized sentence before persistence
3. `TurnComposer` must receive `sealedFirstBeatText` and only plan later tail beats
4. `TurnComposer` must not repeat, revise, or explain the already sealed first beat
5. planner failure must degrade to `firstBeat`-only success
6. the successful path MUST NOT depend on full-text generation followed by forced post-splitting

## RL-PIPE-005 — Delivery Director Pipeline

Delivery director owns beat persistence and cancellation:

1. generic pending UI may appear only while awaiting the first visible `firstBeat` text
2. transient `streaming` kind is allowed only for first-beat UI preview and must never persist in session store
3. once `firstBeat` seals, the transient preview must be replaced in place by the finalized text beat and the generic pending card must disappear
4. new user input, thread reset, target switch, or route invalidation must cancel both in-flight `firstBeat` streaming and all undispatched tail beats

## RL-PIPE-006 — Modality Orchestration Pipeline

Image/video/voice generation must follow one beat-level orchestration policy:

1. each beat independently selects `text | voice | image | video`
2. explicit user requests outrank automatic modality choices
3. `voiceAutonomy` and `mediaAutonomy` both use `off | explicit-only | natural` trigger semantics
4. `voiceConversationMode=on` forces non-explicit-media assistant beats to voice, but must not override explicit image/video beats
5. automatic media still passes explicit gate, cooldown, route readiness, dependency readiness, derived relationship boundary, and NSFW policy
6. text beat success must not be blocked by media failure
7. explicit visual beats carry `mediaRequest` planner input; Relay must keep that planner envelope separate from persisted artifact records

## RL-PIPE-007 — Proactive Heartbeat Pipeline

Proactive contact uses deterministic heartbeat -> policy -> beat-first turn planning -> persist pipeline with auditable outcomes.

After policy allow:

1. proactive contact must use the same turn mode / first beat / turn composer / modality orchestration chain as user-initiated turns
2. proactive persistence must update interaction snapshot and relation memory using the same continuity compiler
3. proactive audit must retain deterministic policy reason codes
4. proactive lifecycle triggers from Electron `BrowserWindow` focus/blur events (replaces mod lifecycle hooks)

## RL-PIPE-008 — Interaction Snapshot Pipeline

Conversation continuity is compiled after delivery:

1. interaction snapshot update must be asynchronous and must not block first-beat persistence
2. snapshot must track at least `relationshipState / activeScene / emotionalTemperature / assistantCommitments / userPrefs / openLoops / topicThreads / lastResolvedTurnId`
3. snapshot compiler input is exact turns/beats/media plus previous local snapshot, not realm-side hidden memory payloads
4. neutral follow-up turns must not regress `relationshipState` within the same session
5. `assistantCommitments` and `openLoops` must merge incrementally and only clear when completion cues resolve the prior item

## RL-PIPE-009 — Relation Memory Pipeline

Target-viewer relation memory is a slot compiler, not the old typed durable-memory path:

1. relation memory writes must be asynchronous and non-blocking
2. slot types are at least `preference / boundary / rapport / promise / recurringCue / taboo`
3. recall index must refresh from exact turns/beats after snapshot compilation
4. later turns must read relation memory slots and recall index from local Electron storage, not realm-side memory endpoints

## RL-PIPE-010 — Turn Bundle Persistence Pipeline

Session truth source must persist logical conversation bundles:

1. conversation truth source is `ConversationLedger` persisted via `RelayChatStorage`
2. each user input persists as a `user` bundle
3. each assistant turn persists as a single `assistant` bundle with ordered beats/segments
4. assistant `text / voice / image / video` all attach to the same bundle when they belong to the same turn
5. `pending` media must not enter continuity; `ready / blocked / failed` media must attach back to the assistant bundle
6. persisted `ready / blocked / failed` image/video beats must write concise continuity summary into `contextText / semanticSummary`
7. Relay local persistence stores generated/cached visuals as session-scoped `artifact` records, not realm assets

## RL-PIPE-011 — NSFW Media Guardrail Pipeline

NSFW media policy is settings + route-source gated:

1. `visualComfortLevel=natural-visuals` on `local` allows NSFW media generation
2. `visualComfortLevel=restrained-visuals | text-only` disables NSFW media generation
3. non-local routes must downgrade to `local-only` policy state
4. there must be no direct user-facing NSFW toggle in Relay
