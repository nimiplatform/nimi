# ShiJi App Shell Contract

> Rule namespace: SJ-SHELL-*
> Scope: Tauri shell, SDK bootstrap, auth, layout, error boundary

## SJ-SHELL-001 — Bootstrap Sequence

App bootstrap follows the standard nimi Tauri app sequence:

1. Tauri shell starts, renderer loads `main.tsx`
2. `runShiJiBootstrap()` obtains runtime defaults from Tauri bridge
3. `createPlatformClient({ appId: 'nimi.shiji' })` initializes SDK
4. Auth session bootstrap via `bootstrapAuthSession()`
5. Runtime readiness check (non-blocking — cloud-only mode is valid)
6. App store sets `bootstrapReady = true`, routes render

Runtime readiness failure must not block app startup. ShiJi can operate with cloud-only AI providers.

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
2. A learner profile includes child-facing identity and guardian-entered learning context: age, grade band, strengths, interests, communication style, guidance notes, and learning goals
3. Dialogue sessions bind to the active learner profile version at session start for reproducible prompt behavior
4. Learner profile data is local-only and must not be written back into Realm truth
