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

1. **Catalog metadata** — read from `world-catalog.yaml`: display name and grade band
2. **Learner profile** — read from local SQLite: age, grade band, interests, strengths, communication style, guardian goals
3. **Learner adaptation notes** — read from local SQLite: approved interaction preferences and observed style notes
4. **WorldRules** — fetched via `GET /api/world/by-id/{worldId}/rules`, cached per session
5. **AgentRules** — fetched via `GET /api/world/by-id/{worldId}/agent-rules`, filtered by active agent
6. **Lorebook entries** — fetched via `GET /api/world/by-id/{worldId}/lorebooks`, keyword-matched against recent dialogue context
7. **Trunk events** — fetched via `GET /api/world/by-id/{worldId}/events`, ordered chronologically
8. **Agent memory** — fetched via `GET /api/agent/{agentId}/memory/recall`, DYADIC class
9. **Session state** — read from local SQLite: chapter index, scene type, rhythm counter, trunk event index, knowledge flags, and the session's snapshotted `contentType` / `truthMode`
10. **Dialogue history** — read from local SQLite: recent N turns for continuity window

Assembly results are cached per session with TTL-based invalidation for Realm data. Local state is always read fresh. Classification used for stable dialogue comes from the session snapshot after session creation, not from live catalog re-reads.

## SJ-DIAL-003 — Prompt Builder

The prompt builder (`engine/prompt-builder.ts`) assembles an LLM system prompt dynamically from assembled context:

1. **Identity block** — from AgentRules: who the agent is, core philosophy, speech style
2. **Relationship block** — from AgentRules: relationship with Snow, interaction mode
3. **World context block** — from WorldRules: era, setting, political system, key constraints
4. **Classification block** — from session snapshot: `contentType`, `truthMode`, grade band, and any resulting truth-boundary constraints
5. **Learner profile block** — from guardian-entered profile: age-appropriate framing, interests, strengths, support notes, communication preferences
6. **Adaptation block** — from approved local notes: preferred analogy systems, response brevity expectations, pacing sensitivities, verification preferences
7. **Narrative governance block** — from WorldRules: pacing rules, choice format, knowledge scaffolding rules, perspective rules
8. **Scene directive block** — from local state: current scene type (crisis/campfire/verification/metacognition), specific instructions per type
9. **Knowledge state block** — from local SQLite: concepts Snow has learned (depth >= 1) marked as "known", concepts at depth 0 flagged for potential explanation
10. **Trunk horizon block** — from trunk events + local index: next locked event, proximity assessment, convergence/freedom directive
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
9. Trunk horizon block
10. Knowledge state block
11. Recent dialogue
12. Memory snippets
13. Lorebook injection

If assembled content exceeds budget, trim in this order:

1. Remove lorebook injection first
2. Remove memory snippets next
3. Compress recent dialogue, then knowledge state, then trunk horizon, then world context, then relationship
4. Blocks 1-6 above are the stable-dialogue minimum set and must not be deleted
5. If the model budget cannot fit the stable-dialogue minimum set, the turn must fail-close with an actionable error instead of silently degrading the prompt contract

## SJ-DIAL-004 — AI Generation

Text generation uses the SDK runtime client:

1. Call `runtime.ai.text.generate()` with streaming enabled
2. Messages: system prompt (from builder) + dialogue history + current user input
3. Stream tokens to the narrative display component as they arrive
4. Generation failure retries once (transient transport only), then surfaces error
5. User may cancel in-flight generation via UI button

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

Pacing state persists in SQLite `sessions` table and survives app restart.

## SJ-DIAL-007 — Trunk Convergence

Trunk convergence (`engine/trunk-convergence.ts`) manages the "locked trunk + free branches" mechanic:

1. **Trunk event list** — ordered historical events from `CreatorWorldEvent` entries
2. **Current index** — `trunk_event_index` in session state, points to next expected event
3. **Freedom mode** — when distance to next trunk event is large, prompt injects "free exploration permitted" directive
4. **Convergence mode** — when narrative proximity or turn count suggests approaching a trunk event, prompt shifts to "guide narrative toward [event]" directive
5. **Arrival detection** — when AI output references or describes the trunk event, index advances and chapter progress is recorded
6. **Never block user choice** — convergence guides, not forces. If user's choices diverge, the prompt explains structural constraints through character dialogue ("not that your idea was wrong, but the forces of the era...") per the roleplay design

## SJ-DIAL-008 — Session Lifecycle

Session management for dialogue continuity:

1. **Create** — new session on first dialogue with a world+agent pair; initialize chapter=1, scene=1, rhythm=0, and snapshot the current `contentType` / `truthMode` from `world-catalog.yaml`
2. **Resume** — existing session loads from SQLite; Realm data re-fetched, local state preserved
3. **Pause** — user navigates away; session state auto-saves to SQLite
4. **Complete** — final trunk event reached; session marked complete, summary generated
5. **Multiple sessions** — one active session per world+agent pair; starting a new session with same pair offers to continue or restart
6. **Catalog drift isolation** — later catalog reclassification does not retroactively alter the snapshotted classification of an existing session

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
2. Learner profile injection includes age, grade band, interest tags, strengths, communication style, guardian guidance notes, and learning goals
3. This block is used to tune explanation density, analogy choice, question framing, and emotional tone without changing world truth

## SJ-DIAL-016 — Adaptive Pedagogy and Style Memory

ShiJi adapts to the learner's established interaction style:

1. Approved local notes may encode patterns such as terse input being deliberate, strong response to structured A/B decisions, or affinity for specific analogy frames
2. Adaptive notes may come from guardian entry or post-session confirmed observations, but they remain local app data
3. The dialogue engine may use these notes to bias pacing, verification style, and metaphor selection
4. The engine must not invent unsupported diagnoses, psychometric claims, or personality assertions beyond explicit guardian input or approved notes
