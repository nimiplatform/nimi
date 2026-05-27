# ShiJi App Shell Contract

> Rule namespace: SJ-SHELL-*
> Scope: Tauri shell, SDK bootstrap, auth, layout, error boundary

## SJ-SHELL-001 — Bootstrap Sequence

App bootstrap follows the standard nimi Tauri app sequence (SJ-SHELL-010 /
SJ-SHELL-011 / SJ-SHELL-012):

1. Tauri shell starts, renderer loads `main.tsx`
2. `runShiJiBootstrap()` obtains runtime defaults from Tauri bridge
3. `createLocalFirstPartyRuntimePlatformClient({ appId: 'app.nimi.shiji', realmBaseUrl, runtimeTransport })`
   initializes the SDK. The helper type-rejects `accessToken`,
   `accessTokenProvider`, `refreshTokenProvider`, `subjectUserIdProvider`,
   and `sessionStore` inputs (SJ-SHELL-011 / spec K-ACCSVC-008).
4. Account projection: `runtime.account.getAccountSessionStatus({ caller: shijiRuntimeAccountCaller })`.
   AUTHENTICATED projects to `auth.user`; ANONYMOUS / UNAVAILABLE / RPC error
   transitions to `unauthenticated` without failing bootstrap.
5. Runtime readiness check (blocking — 15 s timeout, fail-close on failure).
6. SQLite init (blocking — fail-close on failure).
7. App store sets `bootstrapReady = true`, routes render.

Runtime readiness and SQLite are hard requirements. If either fails,
`bootstrapError` is set and the app shows an error screen. There is no
cloud-only degradation mode. The blocking semantics in steps 5 and 6 are
intentional and MUST be preserved across migrations — ShiJi requires local
runtime + SQLite to be healthy before any content surface renders.

## SJ-SHELL-002 — Auth Flow

Auth identity is owned by RuntimeAccountService (SJ-SHELL-010 / SJ-SHELL-011,
spec K-ACCSVC-008). ShiJi does not own access-token, refresh-token, or
session-store custody at any layer.

1. Unauthenticated users see a login gate before any content.
2. Login goes through the kit `<DesktopShellAuthPage>` desktop-browser flow
   wired to a ShiJi `runtimeAccountBroker`:
   - `broker.begin` → `runtime.account.beginLogin`. The realm OAuth authorize
     URL returned by runtime carries a PKCE S256 challenge bound to a
     runtime-held verifier. ShiJi never observes the verifier.
   - User authorizes in the system browser; the realm authorization endpoint
     302-redirects to the ShiJi desktop loopback redirect_uri with a raw
     OAuth `code`.
   - `broker.complete` → `runtime.account.completeLogin` with the raw `code`,
     `state`, `nonce`, and `redirectUri`. `refreshToken` MUST be the empty
     string at the wire level (R-OAUTH-008 / spec K-ACCSVC-008); any
     non-empty value is rejected by runtime as `PROOF_UNSUPPORTED`.
3. Token refresh is owned entirely by runtime. ShiJi MUST NOT install
   `accessTokenProvider`, `refreshTokenProvider`, `subjectUserIdProvider`,
   or `sessionStore`, and MUST NOT call any kit shared desktop auth-session
   helpers.
4. `useAppStore.auth` holds only `{ status, user }`. Token fields are not
   admitted on the renderer state truth.
5. Logout calls `runtime.account.logout({ caller })` and then
   `clearAuthSession()`. ShiJi MUST NOT clear any persisted shared session
   bridge — none is admitted.

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

## SJ-SHELL-010 — RuntimeAccountService Admission

ShiJi is admitted as an active local-first-party Runtime account / session
consumer. The caller is fixed and authoritative; concrete identifiers live in
`tables/runtime-account-caller.yaml`:

| Field | Value |
|-------|-------|
| `appId` | `app.nimi.shiji` |
| `appInstanceId` | `app.nimi.shiji.local-first-party` |
| `deviceId` | `local-first-party-device` |
| `mode` | `ACCOUNT_CALLER_MODE_LOCAL_FIRST_PARTY_APP` |

Implementation rules:

- The renderer constructs the platform client via the SDK helper
  `createLocalFirstPartyRuntimePlatformClient`. Calling `createPlatformClient`
  directly from the ShiJi bootstrap is forbidden.
- Every `runtime.account.*` call from ShiJi MUST pass the caller exactly as
  declared in the table. Diverging fields (any other `mode`, missing
  `appInstanceId`) MUST fail-close at the call site, not be coerced.
- Mode `ACCOUNT_CALLER_MODE_DESKTOP_LAUNCHED_AVATAR` is not admitted for
  ShiJi; runtime rejects it as `AVATAR_BINDING_ONLY`.
- Runtime admission gates on the (`appId`, `appInstanceId`) pair. ShiJi MUST
  NOT introduce a parallel `RegisterApp` flow; admission is reached by
  letting the SDK helper register the FULL-mode manifest.

## SJ-SHELL-011 — App-Owned Token Custody Forbidden

App-owned access-token, refresh-token, subject-user-id, and session-store
custody are forbidden in the ShiJi renderer and bridge layers. Runtime
(`runtime/internal/services/account`) is the sole owner of token material.

This rule is enforced at three layers:

1. **SDK type level.** `createLocalFirstPartyRuntimePlatformClient` rejects
   `accessToken`, `accessTokenProvider`, `refreshTokenProvider`,
   `subjectUserIdProvider`, and `sessionStore` inputs at compile time
   (spec K-ACCSVC-008). ShiJi MUST consume that helper, not bypass it.
2. **Auth adapter.** The ShiJi `AuthPlatformAdapter` exposed to the kit
   `<DesktopShellAuthPage>` MUST fail-close on `applyToken`,
   `persistSession`, and any oauth/password embedded login path. Returning
   silently or proxying through the realm SDK is a contract violation.
3. **Renderer state.** `useAppStore.auth` MUST NOT carry `token` or
   `refreshToken` fields. `setAuthSession` MUST accept only the
   `AccountProjection`-derived `AuthUser` and MUST NOT take a token argument.

Wire-level rule for `runtime.account.completeLogin`: the `refreshToken` field
of the proof envelope MUST be the empty string. Runtime rejects any
non-empty value with `PROOF_UNSUPPORTED` (R-OAUTH-008).

Logout MUST go through `runtime.account.logout({ caller })`. ShiJi MUST NOT
call any kit shared desktop auth-session bridge (`auth_session_load/save/clear`,
`persistSharedDesktopAuthSession`, `resolveDesktopBootstrapAuthSession`); none
is admitted on the ShiJi surface.

Note: `learnerId` (the local-only learner profile identifier per SJ-SHELL-006)
is distinct from `accountId`. Learner profiles are local-only and bind to the
projected `accountId` for scoping; they are not Realm truth and do not
constitute auth identity.
