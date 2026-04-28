# ShiJi App Shell Contract

> Rule namespace: SJ-SHELL-*
> Scope: Tauri shell, SDK bootstrap, auth, layout, error boundary

## SJ-SHELL-001 — Bootstrap Sequence

Authority fence: `ACCOUNT_HARDCUT_NON_ADMITTED_APP_SLICE_FENCE`.
ShiJi is not currently admitted as an active local first-party Runtime account/session authority for the `2026-04-28-runtime-core-account-session-broker-hardcut` topic. Existing app-local token/session bootstrap seams are fenced legacy slice behavior and must not be treated as hardcut-compliant local account truth until migrated to Runtime-issued short-lived token projection and admitted caller registration.

App bootstrap follows the standard nimi Tauri app sequence:

1. Tauri shell starts, renderer loads `main.tsx`
2. `runShiJiBootstrap()` obtains runtime defaults from Tauri bridge
3. `createPlatformClient({ appId: 'nimi.shiji' })` initializes SDK
4. Auth session bootstrap via `bootstrapAuthSession()`
5. Runtime readiness check (blocking — 15 s timeout, fail-close on failure)
6. SQLite init (blocking — fail-close on failure)
7. App store sets `bootstrapReady = true`, routes render

Runtime readiness and SQLite are hard requirements. If either fails, `bootstrapError` is set and the app shows an error screen. There is no cloud-only degradation mode.

## SJ-SHELL-002 — Auth Flow

Auth flow reuses `@nimiplatform/nimi-kit/core/oauth` and the Tauri `oauth_commands` bridge:

1. Unauthenticated users see a login gate before any content
2. Auth supports password login and OAuth (per nimi-kit)
3. Session tokens persist via Tauri secure storage
4. Token refresh uses SDK `sessionStore` callbacks
5. Auth failure redirects to login gate, preserving intended route

## SJ-SHELL-003 — App Shell Layout

The app shell provides a persistent navigation frame:

1. **Side navigation** — compact icon bar: Explore (home), Knowledge, Progress, Settings
2. **Content area** — fills remaining space, renders matched route
3. **Dialogue session** overrides the shell to full-screen immersive mode (no side nav)
4. Error boundary wraps content area with `ShellErrorBoundary` from nimi-kit

## SJ-SHELL-004 — Age-Appropriate Defaults

As an education app for K-12 students:

1. Content rating filter defaults to `G` (safe for all ages)
2. NSFW consent is permanently disabled (no opt-in path)
3. Session time reminders at configurable intervals (default 45 minutes)
4. Font size defaults to 16px body text (larger than standard nimi apps)

## SJ-SHELL-005 — Settings

Settings page provides:

1. **AI model selection** — route configuration for text generation model
2. **Voice toggle** — enable/disable TTS playback globally
3. **Voice input toggle** — enable/disable STT microphone
4. **Session timer** — configurable reminder interval (15/30/45/60 min or off)
5. **Parent mode** — PIN-protected access to learning report export and usage statistics

## SJ-SHELL-006 — Learner Profile Setup

ShiJi requires an active learner profile for targeted interaction:

1. Parent mode provides a protected learner-profile editor before stable long-form dialogue use
2. A learner profile includes child-facing identity and guardian-entered learning context: age, strengths, interests, communication style, guidance notes, and learning goals
3. Dialogue sessions bind to the active learner profile version at session start for reproducible prompt behavior
4. Learner profile data is local-only and must not be written back into Realm truth
5. One auth account may create multiple learner profiles (e.g., a parent managing siblings)
6. Parent mode provides a profile switcher to set the active profile; exactly one profile is active per account at any time
7. All sessions, knowledge entries, and progress bind to `learnerId`, not `authUserId`; switching profiles cleanly separates learning data

## SJ-SHELL-007 — Profile Versioning

Learner profile changes must not retroactively alter in-progress sessions:

1. `profileVersion` is an integer, auto-incremented on any guardian edit to the active profile
2. Session creation snapshots the current `profileVersion` into `learnerProfileVersion`
3. Mid-session profile edits create a new version that applies only to future sessions; the running session continues with its snapshotted version
4. Profile version history is not exposed in UI; versioning is a data integrity mechanism only

## SJ-SHELL-008 — Onboarding Gate

First-time learner setup gates dialogue entry, not Explore browsing:

1. Explore surfaces are freely accessible without an active learner profile
2. When the user clicks "Start Dialogue" (per SJ-EXPL-006) and no active learner profile exists for the current auth account, the app redirects to the profile creation flow in parent mode
3. Profile creation collects the minimum fields defined in SJ-SHELL-006 clause 2
4. After profile creation, the user is returned to the agent detail page to proceed with session creation
5. Subsequent dialogue entries skip the gate as long as an active profile exists

## SJ-SHELL-009 — First Visit: Character Encounter

The first-time Explore experience uses a "character comes to find you" mechanism instead of a static browsing interface:

1. The encounter overlay appears on the Explore surface when the current user has not previously completed it
2. A pre-authored historical character appears in first person, **opening line must be the dilemma or question itself, not a self-introduction** — e.g., "三拨人来请我出山了。你说，我该不该去？" rather than "你好，我叫诸葛亮，我住在隆中……"
3. Each encounter card displays 1-2 lightweight preview tags alongside the character (era + theme direction) — e.g., "三国 · 军事谋略" or "大唐 · 宫廷风云" — so the student can make an informed intuitive choice without reading a curriculum description
4. The student may choose "好" (accept) to proceed to that character's agent detail page, or "换一个人" (next) to see a different character with a different tone and dilemma
5. Maximum 3 character encounters are offered; after the third, a "还有更多人物在时间长河中等你" prompt transitions to the full timeline view
6. At any point the student may dismiss the overlay and browse the timeline freely
7. Character encounter scripts are pre-authored fixed content tied to `primaryAgentIds` in `world-catalog.yaml`, not AI-generated at runtime
8. **Trigger logic and persistence**:
   a. If no active learner profile exists for the current auth account, the encounter always triggers (the user is definitionally a first-time visitor)
   b. If an active learner profile exists and its `encounterCompletedAt` (per `local-storage.yaml` `learner_profiles` table) is non-null, the encounter does not trigger
   c. If an active learner profile exists but `encounterCompletedAt` is null, the encounter triggers
   d. On encounter completion (accept or dismiss or 3rd pass-through), write `encounterCompletedAt = now` to the active profile. If no profile exists yet, the timestamp is written when the profile is subsequently created via the onboarding gate (per SJ-SHELL-008)
9. The encounter interaction must have zero learning cost: only two visible actions (accept / next), no settings, no explanatory text, no tutorial overlay
