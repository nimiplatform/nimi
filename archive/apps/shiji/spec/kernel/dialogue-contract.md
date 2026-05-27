# ShiJi Dialogue Contract

> Rule namespace: SJ-DIAL-*
> Scope: Dialogue engine pipeline — prompt assembly, generation, output processing, pacing, multimodal

## SJ-DIAL-001 — Dialogue Pipeline Overview

The dialogue engine is a linear pipeline executing per user turn:

```
User Input → Intent → Assembly → Prompt Build → Generate → Post-Process → Render
```

1. Pipeline logic lives in `src/shell/renderer/engine/`
2. Pipeline must not scatter across feature components (per AGENTS.md)
3. Each step receives the output of the previous step as typed input
4. Pipeline failures surface to the user with actionable messages, never silent swallow

## SJ-DIAL-002 — Context Assembly

Context assembly gathers data from Realm and local state before prompt construction:

1. **Catalog metadata** — read from `world-catalog.yaml`: display name, era label, and classification pair
2. **Learner profile** — read from local SQLite: age, interests, strengths, communication style, guardian goals
3. **Learner adaptation notes** — read from local SQLite: approved interaction preferences and observed style notes
4. **WorldRules** — fetched via `GET /api/world/by-id/{worldId}/rules`, cached per session
5. **AgentRules** — fetched via `GET /api/world/by-id/{worldId}/agent-rules`, filtered by active agent
6. **Lorebook entries** — fetched via `GET /api/world/by-id/{worldId}/lorebooks`, keyword-matched against recent dialogue context
7. **Trunk events** — reserved for a future typed surface and omitted from the current stable dialogue assembly
8. **Agent memory** — fetched via `GET /api/agent/{agentId}/memory/recall`, DYADIC class
9. **Session state** — read from local SQLite: chapter index, scene type, rhythm counter, trunk event index, knowledge flags, and the session's snapshotted `contentType` / `truthMode`
10. **Dialogue history** — read from local SQLite: recent N turns for continuity window

Assembly sources 3 (learner adaptation notes) and 8 (agent memory) serve distinct roles:
- **Agent DYADIC memory** records what the agent character remembers about this student across sessions: past events discussed, promises made, relationship milestones. Written by the dialogue engine at session pause/complete based on session summary. Stored in Realm.
- **Learner adaptation notes** record what the app observes about the student's learning style: communication preferences, pacing sensitivity, analogy affinity. Stored in local SQLite only, never written to Realm.
The two may overlap in topic but differ in authority: memory is in-character relationship state, notes are pedagogical app state.

Assembly results are cached per session with TTL-based invalidation for Realm data. Default cache TTL: 15 minutes for WorldRules, AgentRules, and Lorebooks. Trunk event caching is not active in the stable path because the events surface is not yet approved. Local state (session, dialogue history, knowledge flags) is always read fresh. Classification used for stable dialogue comes from the session snapshot after session creation, not from live catalog re-reads.

## SJ-DIAL-003 — Prompt Builder

The prompt builder (`engine/prompt-builder.ts`) assembles an LLM system prompt dynamically from assembled context:

1. **Identity block** — from AgentRules: who the agent is, core philosophy, speech style
2. **Relationship block** — from AgentRules: relationship with Snow, interaction mode. The default framing positions the student as an advisor, confidant, or companion whom the character actively seeks out — not a passive audience receiving a lecture. The agent should ask for the student's opinion, share dilemmas, and treat the student's input as meaningful within the roleplay context
3. **World context block** — from WorldRules: era, setting, political system, key constraints
4. **Classification block** — from session snapshot: `contentType`, `truthMode`, and any resulting truth-boundary constraints
5. **Learner profile block** — from guardian-entered profile: age-appropriate framing, interests, strengths, support notes, communication preferences
6. **Adaptation block** — from approved local notes: preferred analogy systems, response brevity expectations, pacing sensitivities, verification preferences
7. **Narrative governance block** — from WorldRules: pacing rules, choice format, knowledge scaffolding rules, perspective rules
8. **Scene directive block** — from local state: current scene type (crisis/campfire/verification/metacognition), specific instructions per type
9. **Knowledge state block** — from local SQLite: concepts Snow has learned (depth >= 1) marked as "known", concepts at depth 0 flagged for potential explanation
10. **Trunk horizon block** — reserved for a future typed events surface and omitted from the current stable prompt
11. **Lorebook injection** — keyword-matched entries relevant to current context
12. **Memory snippets** — DYADIC memory entries for relationship continuity
13. **Recent dialogue** — last N turns as conversation history

Prompt priority is fixed from highest to lowest as:

1. Classification block
2. Identity block
3. Learner profile block
4. Narrative governance block
5. Scene directive block
6. Adaptation block
7. Relationship block
8. World context block
9. Trunk horizon block (only after the events surface is approved)
10. Knowledge state block
11. Recent dialogue
12. Memory snippets
13. Lorebook injection

If assembled content exceeds budget, trim in this order:

1. Remove lorebook injection first
2. Remove memory snippets next
3. Compress recent dialogue, then knowledge state, then world context, then relationship. If trunk horizon is re-enabled in a future phase, it trims before world context
4. Blocks 1-6 above are the stable-dialogue minimum set and must not be deleted
5. If the model budget cannot fit the stable-dialogue minimum set, the turn must fail-close with an actionable error instead of silently degrading the prompt contract

## SJ-DIAL-004 — AI Generation

Text generation uses the SDK runtime client:

1. Call `runtime.ai.text.generate()` with streaming enabled
2. Messages: system prompt (from builder) + dialogue history + current user input
3. Stream tokens to the narrative display component as they arrive
4. Generation failure retries once (transient transport only), then surfaces error
5. User may cancel in-flight generation via UI button
6. If streaming is interrupted mid-generation (network failure after partial tokens), partial output remains visible with a "generation interrupted" indicator; user may retry the turn

## SJ-DIAL-005 — Choice Parser

The choice parser (`engine/choice-parser.ts`) extracts structured A/B options from AI output:

1. Parse AI output for choice markers (configurable patterns, e.g., "A." / "B." or "选A" / "选B")
2. Extract choice label, description text, and consequence preview for each option
3. If parsing fails during a `crisis` scene, retry generation once with stronger choice-format instructions before accepting the turn
4. If parsing still fails after the retry during a `crisis` scene, fail-close with a retriable error rather than degrading to narrative-only output
5. If parsing fails in a non-`crisis` scene, render as narrative-only turn (valid for campfire and other lower-pressure scenes)
6. Parsed choices are rendered in the ChoicePanel component
7. User selection is recorded to `choices` SQLite table with turn reference

## SJ-DIAL-006 — Pacing Enforcer

The pacing enforcer (`engine/pacing-enforcer.ts`) maintains narrative rhythm:

1. **Rhythm counter** — increments on each crisis scene, resets on campfire scene
2. **Campfire trigger** — when rhythm counter reaches threshold (default 3), next turn's scene directive switches to campfire
3. **Scene type assignment** — each turn is classified as: `crisis | campfire | verification | metacognition | transition`
4. **Fast-forward detection** — post-process checks if AI output covers multiple distinct events/time periods; if detected, flag for retry or truncation
5. **Verification trigger** — after configurable turn interval (default 5), and at chapter boundaries, scene type switches to verification
6. **Metacognition trigger** — when trunk event is reached (chapter boundary), scene type switches to metacognition for "looking back" reflection
7. `campfire` and other non-`crisis` scene types may render without structured A/B choices

8. Scene types (`crisis | campfire | verification | metacognition | transition`) are ShiJi app-layer enums assigned by the pacing enforcer. They are not sourced from the Realm `Scene` entity's `sceneType` field. If a typed scene metadata surface is approved later, it may provide location and setting metadata, but ShiJi pacing scene types remain an orthogonal pedagogical rhythm concept.

Pacing state persists in SQLite `sessions` table and survives app restart.

## SJ-DIAL-007 — Trunk Convergence

Trunk convergence (`engine/trunk-convergence.ts`) manages the "locked trunk + free branches" mechanic:

1. **Trunk event list** — ordered historical events from `CreatorWorldEvent` entries
2. **Current index** — `trunk_event_index` in session state, points to next expected event
3. **Freedom mode** — when distance to next trunk event is large, prompt injects "free exploration permitted" directive
4. **Convergence mode** — when narrative proximity or turn count suggests approaching a trunk event, prompt shifts to "guide narrative toward [event]" directive
5. **Arrival detection** — when AI output references or describes the trunk event, index advances and chapter progress is recorded
6. **Never block user choice** — convergence guides, not forces. If user's choices diverge, the prompt explains structural constraints through character dialogue ("not that your idea was wrong, but the forces of the era...") per the roleplay design

> **Blocked surface**: trunk events require `GET /api/world/by-id/{worldId}/events`, which remains `proposed` in `api-surface.yaml`. Stable dialogue must run without trunk convergence; the pipeline omits this rule until the typed endpoint is approved and shipped.

## SJ-DIAL-008 — Session Lifecycle

Session management for dialogue continuity:

1. **Create** — new session on first dialogue with a world+agent pair; initialize chapter=1, scene=1, rhythm=0, and snapshot the current `contentType` / `truthMode` from `world-catalog.yaml`
2. **Resume** — existing session loads from SQLite; Realm data re-fetched, local state preserved
3. **Pause** — user navigates away; session state auto-saves to SQLite
4. **Complete** — session may complete through app-defined end conditions; trunk-driven completion remains blocked until the events surface ships
5. **Multiple sessions** — one active session per world+agent pair; starting a new session with same pair offers to continue or restart
6. **Catalog drift isolation** — later catalog reclassification does not retroactively alter the snapshotted classification of an existing session
7. **Restart** — when user chooses restart for an existing world+agent pair:
   a. Old session is marked `sessionStatus = ABANDONED`
   b. Knowledge entries from the old session are retained (knowledge belongs to the learner, not the session)
   c. Chapter progress from the old session is retained for historical review
   d. A new session is created with fresh `chapterIndex=1`, `rhythmCounter=0`, `trunkEventIndex=0`

## SJ-DIAL-009 — Dialogue History Persistence

Local dialogue history for continuity and review:

1. Each turn persists to `dialogue_turns` SQLite table: seq, role (user/assistant), content, timestamp
2. User choice selections persist to `choices` table with turn reference
3. History window for prompt context: configurable (default last 20 turns)
4. Full history retained locally for session review / learning report

## SJ-DIAL-010 — TTS Voice Output (Phase 3)

Voice synthesis for character narration:

1. After AI generation completes, extract dialogue segments from output
2. Synthesize each segment via `runtime.media.tts.synthesize()` with agent's bound voice
3. Agent voice determined by `AGENT_VOICE_SAMPLE` binding
4. Audio plays inline with narrative display (user can pause/skip)
5. TTS is non-blocking — text renders immediately, audio plays alongside
6. Global toggle in settings (per SJ-SHELL-005)

## SJ-DIAL-011 — STT Voice Input (Phase 3)

Speech-to-text for student input:

1. Microphone button in input area triggers recording
2. Audio transcribed via `runtime.media.stt.transcribe()`
3. Transcription result populates text input field for review before send
4. User may edit transcription before submitting
5. Global toggle in settings (per SJ-SHELL-005)

## SJ-DIAL-012 — Scene Illustration (Phase 3)

AI-generated scene artwork at key narrative moments:

1. Post-process detects illustration-worthy moments: chapter openings, scene transitions, campfire scenes, dramatic turning points
2. Secondary prompt builder generates image prompt in historical illustration style
3. Image generated via `runtime.media.image.generate()`
4. Generated image displayed above narrative text in the dialogue view
5. Images cached locally via Tauri file storage for session review
6. Image generation is non-blocking — narrative continues while image generates

## SJ-DIAL-013 — Classification Injection

Prompt construction must preserve ShiJi content classification:

1. Stable dialogue paths require `contentType` and `truthMode`, snapshotted into the session at creation time
2. Prompt instructions must explicitly distinguish canonical history from literary dramatization and mythic storytelling
3. Verification and explanation prompts must inherit the same classification boundary as the active world

## SJ-DIAL-014 — Canonical Truth Boundary

Dialogue must not collapse literary or mythic material into canonical history:

1. Worlds whose classification pair is non-canonical per `content-classification.yaml` may be taught as retelling, viewpoint practice, legend, symbolism, or cultural context, but not as canonical history
2. Verification and explanatory turns must preserve the same truth boundary as the active world's classification pair
3. If a world is missing valid classification metadata, the app must block stable dialogue entry rather than guessing the truth boundary

## SJ-DIAL-015 — Learner Profile Injection

Prompt construction must incorporate guardian-entered learner context:

1. Stable dialogue paths require an active local learner profile bound to the session
2. Learner profile injection includes age, interest tags, strengths, communication style, guardian guidance notes, and learning goals
3. This block is used to tune explanation density, analogy choice, question framing, and emotional tone without changing world truth

## SJ-DIAL-016 — Adaptive Pedagogy and Style Memory

ShiJi adapts to the learner's established interaction style:

1. Approved local notes may encode patterns such as terse input being deliberate, strong response to structured A/B decisions, or affinity for specific analogy frames
2. Adaptive notes may come from guardian entry or post-session confirmed observations, but they remain local app data
3. The dialogue engine may use these notes to bias pacing, verification style, and metaphor selection
4. The engine must not invent unsupported diagnoses, psychometric claims, or personality assertions beyond explicit guardian input or approved notes

## SJ-DIAL-017 — Lorebook Injection Strategy

Lorebook injection is bounded by matching scope, context window, and entry limit:

1. **Matching method** — exact keyword match: each lorebook entry's `key` field is matched against tokens in the context window
2. **Context window** — last 10 dialogue turns (smaller than the 20-turn dialogue history window per SJ-DIAL-009) to keep matching focused on recent narrative
3. **Entry limit** — maximum 5 lorebook entries injected per turn; when more than 5 match, entries whose keywords appear in the most recent user input rank highest
4. **Concept limit interaction** — SJ-KNOW-002 clause 3 independently limits new concepts to 3 per turn; a single lorebook entry may introduce multiple concepts, so the entry limit (5) and concept limit (3) are enforced separately
5. **No-match behavior** — if no lorebook entries match the context window, the lorebook injection block in the prompt builder (SJ-DIAL-003 block 11) is omitted entirely

## SJ-DIAL-018 — Lightweight Interaction Points

Dialogue must maintain frequent interaction even outside high-stakes crisis scenes:

1. Non-crisis scenes (campfire, transition) should include lightweight interaction prompts — not structured A/B choices, but conversational forks such as: "你想听我继续说战争的事，还是先聊聊当时老百姓的生活？" or "你知道这是为什么吗？"
2. The prompt builder (per SJ-DIAL-003) includes a directive in the scene directive block (block 8) instructing the agent to offer at least one lightweight interaction prompt per non-crisis turn
3. Lightweight prompts do not require choice parsing (per SJ-DIAL-005); the student responds in free text and the agent continues naturally
4. The purpose is engagement rhythm: the student should never read more than 2 consecutive turns of pure narration without an opportunity to participate
5. Lightweight prompts are pedagogically valuable — they invite the student to think, predict, or express preference, even when the narrative outcome is not branching

## SJ-DIAL-019 — Temporal Immersion

Temporal immersion is currently blocked in the stable path because it depends on typed trunk-event data that has not shipped yet.

1. When the events surface is approved in a future phase, the dialogue view may include a persistent date display showing the current narrative date in both era notation and CE.
2. Date advancement must be driven by typed trunk-event metadata rather than guessed free-text cues alone.
3. The date display is decorative and immersive — it does not create gameplay pressure and has no mechanical consequence.
4. If precise typed date data is unavailable, the temporal display is omitted rather than showing imprecise data.

> **Blocked surface**: temporal display requires trunk event timestamps from the proposed events endpoint. Stable dialogue omits the date header until that typed surface ships.
