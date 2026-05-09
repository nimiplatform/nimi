# Overtone — Architecture

## Architectural Principles

1. Renderer owns product logic.
2. Rust owns transport/bootstrap only.
3. No Overtone-specific backend is introduced for generation or publishing.
4. Runtime is the source of truth for AI execution; realm is the source of truth for published social objects.

## System Architecture

```
┌─────────────────────────────────────────────────────┐
│                Overtone (Tauri 2)                  │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │               React 19 renderer               │  │
│  │                                               │  │
│  │  project workspace                            │  │
│  │  ├─ brief + lyrics                            │  │
│  │  ├─ music create / compare                    │  │
│  │  ├─ reference extend / remix                  │  │
│  │  ├─ playback + metadata                       │  │
│  │  └─ publish                                   │  │
│  │                                               │  │
│  │  sdk facade                                   │  │
│  │  ├─ @nimiplatform/sdk/runtime                 │  │
│  │  └─ @nimiplatform/sdk/realm                   │  │
│  └────────────────┬──────────────────────────────┘  │
│                   │                                 │
│        Tauri IPC  │                                 │  HTTPS
│                   │                                 │
│  ┌────────────────┴──────────────┐                  │
│  │   minimal Rust runtime bridge │                  │
│  │   daemon, channel, codec      │                  │
│  └────────────────┬──────────────┘                  │
└───────────────────┼─────────────────────────────────┘
                    │ gRPC
           ┌────────┴────────┐      ┌───────────────┐
           │  nimi runtime   │      │  nimi realm   │
           │  local Go       │      │  cloud HTTP   │
           └─────────────────┘      └───────────────┘
```

## Runtime and Realm Boundary

### Runtime responsibilities

- Generate text for song brief and lyrics.
- Run `MUSIC_GENERATE` jobs.
- Expose async job status and artifacts.
- Optionally generate cover art or guide vocals.
- Enforce connector, capability, and reason-code behavior.
- Own all access / refresh-token custody for Overtone's realm session.

### Realm responsibilities

- Upload publishable media.
- Persist post metadata and social publication state.
- Issue OAuth authorization codes and exchange them for session tokens via
  the realm OAuth authority endpoints (`/api/auth/oauth/authorize` and
  `/api/auth/oauth/token`, see upstream realm spec R-OAUTH-*).

### Overtone responsibilities

- Assemble prompts and UI state.
- Manage takes, compare flow, and provenance prompts.
- Convert runtime artifacts into browser-playable audio.
- Decide what gets published to realm and with what metadata.

## Auth & Runtime Account

Overtone is admitted as an active local-first-party Runtime account / session
consumer. The caller is fixed and authoritative; concrete identifiers live in
`tables/runtime-account-caller.yaml`:

| Field | Value |
|-------|-------|
| `appId` | `app.nimi.overtone` |
| `appInstanceId` | `app.nimi.overtone.local-first-party` |
| `deviceId` | `local-first-party-device` |
| `mode` | `ACCOUNT_CALLER_MODE_LOCAL_FIRST_PARTY_APP` |

### Implementation rules

- The renderer constructs the platform client via the SDK helper
  `createLocalFirstPartyRuntimePlatformClient`. Calling `createPlatformClient`
  directly from the Overtone bootstrap is forbidden.
- Every `runtime.account.*` call from Overtone MUST pass the caller exactly
  as declared in the table. Diverging fields (any other `mode`, missing
  `appInstanceId`) MUST fail-close at the call site, not be coerced.
- Mode `ACCOUNT_CALLER_MODE_DESKTOP_LAUNCHED_AVATAR` is not admitted for
  Overtone; runtime rejects it as `AVATAR_BINDING_ONLY`.
- Runtime admission gates on the (`appId`, `appInstanceId`) pair. Overtone
  MUST NOT introduce a parallel `RegisterApp` flow; admission is reached by
  letting the SDK helper register the FULL-mode manifest.

### App-owned token custody forbidden

App-owned access-token, refresh-token, subject-user-id, and session-store
custody are forbidden in the Overtone renderer and bridge layers. Runtime
(`runtime/internal/services/account`) is the sole owner of token material.
This rule is enforced at four layers:

1. **SDK type level.** `createLocalFirstPartyRuntimePlatformClient` rejects
   `accessToken`, `accessTokenProvider`, `refreshTokenProvider`,
   `subjectUserIdProvider`, and `sessionStore` inputs at compile time
   (upstream spec K-ACCSVC-008). Overtone MUST consume that helper, not
   bypass it.
2. **Auth adapter.** The Overtone `AuthPlatformAdapter` exposed to the kit
   `<DesktopShellAuthPage>` MUST fail-close on `applyToken`,
   `persistSession`, and any oauth/password embedded login path.
3. **Renderer state.** The Zustand store MUST NOT carry `authToken` or
   `authRefreshToken` fields (they are removed from `AppState`).
   `setAuthSession` MUST accept only the `AccountProjection`-derived user
   and MUST NOT take a token argument.
4. **Dev shortcut env.** Reading `VITE_NIMI_REALM_ACCESS_TOKEN` (or any
   bearer-token env shortcut) from the renderer is forbidden. Static
   source-text locks in the renderer test suite enforce this — no
   "development-only" path may bypass the runtime broker login.

Wire-level rule for `runtime.account.completeLogin`: the `refreshToken`
field of the proof envelope MUST be the empty string. Runtime rejects any
non-empty value with `PROOF_UNSUPPORTED` (R-OAUTH-008).

Logout MUST go through `runtime.account.logout({ caller })`. Overtone MUST
NOT call any kit shared desktop auth-session bridge
(`auth_session_load/save/clear`, `persistSharedDesktopAuthSession`,
`resolveDesktopBootstrapAuthSession`); none is admitted on the Overtone
surface, and the Rust shell MUST NOT register the `auth_session_*` Tauri
IPC handlers.

## Primary Data Flows

### Boot and readiness

```
app start
  → initialize Tauri shell
  → runtimeDefaults from desktop bridge
  → createLocalFirstPartyRuntimePlatformClient({ appId, realmBaseUrl, runtimeTransport })
  → runtime.account.getAccountSessionStatus({ caller })
      → AUTHENTICATED → setAuthSession(projection)
      → ANONYMOUS / UNAVAILABLE / RPC error → clearAuthSession() (NOT a bootstrap failure)
  → bootstrapReady = true → enter project workspace
```

Login (when unauthenticated) drives the kit `<DesktopShellAuthPage>`
desktop-browser flow wired to an Overtone `runtimeAccountBroker`:

- `broker.begin` → `runtime.account.beginLogin`. The realm OAuth authorize
  URL returned by runtime carries a PKCE S256 challenge bound to a
  runtime-held verifier. Overtone never observes the verifier.
- User authorizes in the system browser; the realm authorize endpoint
  302-redirects to the Overtone desktop loopback `redirect_uri` with a raw
  OAuth `code`.
- `broker.complete` → `runtime.account.completeLogin` with the raw `code`,
  `state`, `nonce`, and `redirectUri`. `refreshToken` MUST be the empty
  string at the wire level (R-OAUTH-008); runtime fail-closes any non-empty
  value with `PROOF_UNSUPPORTED`.

Readiness should follow existing SDK semantics:

- `runtime.ready()` is the primary runtime liveness gate; non-blocking on
  Overtone bootstrap.
- realm availability should be validated through the first required business request, not by treating `realm.ready()` as a hard bootstrap gate.

### Brief and lyrics

```
user prompt
  → runtime.ai.text.stream(...)
  → stream deltas into editor state
  → accepted output becomes project brief / lyrics source of truth
```

### Music generation

```
user clicks Generate
  → runtime.media.music.generate(input)
  → SDK convenience submits MUSIC_GENERATE async job
  → runtime.media.jobs.subscribe(jobId)
  → terminal job
  → runtime.media.jobs.getArtifacts(jobId)
  → decode artifact for playback and save as candidate take
```

### Reference-driven extend / remix

```
selected take or uploaded audio
  → app-owned builder produces music extensions payload
  → runtime.media.music.generate({ ..., extensions })
  → provider-specific behavior stays behind runtime extension namespace
  → resulting artifact is saved as a derived take with lineage metadata
```

### Realm publish

```
chosen master take
  → user confirms title / tags / provenance
  → realm.media.upload(audio)
  → optional realm.media.upload(cover)
  → realm.posts.create(...)
```

## State Model

### Zustand slices

```typescript
interface ProjectSlice {
  projectId: string | null;
  brief: SongBrief | null;
  lyrics: LyricsDocument | null;
  selectedTakeId: string | null;
}

interface TakeSlice {
  takes: SongTake[];
  comparisons: TakeComparison[];
  addTake(take: SongTake): void;
  selectTake(takeId: string): void;
}

interface GenerationSlice {
  activeJobs: Map<string, GenerationJob>;
  lastError: NimiErrorLike | null;
}

interface PublishSlice {
  draftPost: PublishDraft | null;
  provenanceConfirmed: boolean;
}
```

### Key query domains

```typescript
const queryKeys = {
  runtimeReady: ['runtime', 'ready'],
  connectorReadiness: ['runtime', 'connectors'],
  scenarioJob: (jobId: string) => ['jobs', jobId],
  takeArtifacts: (jobId: string) => ['jobs', jobId, 'artifacts'],
  presetVoices: (model: string) => ['voices', model],
};
```

## Audio Pipeline

```
ScenarioArtifact (bytes or URI)
  → resolve bytes
  → AudioContext.decodeAudioData(...)
  → AudioBuffer
  → playback engine
```

Current runtime music flow materializes provider output into bytes before returning the artifact, even when the provider originally returns a URL. Overtone should therefore treat large-audio memory behavior as an explicit watchpoint, and prefer URI-based artifact resolution only after runtime preserves that path for music artifacts.

The MVP playback system only needs:

- single selected take playback
- basic compare switching
- local trim markers for preview

Layered vocal playback stays P1.

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | Tauri 2 |
| Frontend | React 19 + Vite 7 + Tailwind 4 |
| Local state | Zustand 5 |
| Server state | TanStack Query 5 |
| Audio | Web Audio API |
| SDK | `@nimiplatform/sdk` workspace package |
| Routing | React Router 7 |

## Tauri Rust Surface

Only the minimal desktop subset should be carried over from `apps/desktop/src-tauri/src/`:

| Module | Required | Why |
|--------|----------|-----|
| `runtime_bridge/unary.rs` | Yes | runtime unary RPC transport |
| `runtime_bridge/stream.rs` | Yes | runtime streaming transport |
| `runtime_bridge/codec.rs` | Yes | proto encoding/decoding |
| `runtime_bridge/metadata.rs` | Yes | metadata injection |
| `runtime_bridge/error_map.rs` | Yes | stable app-facing errors |
| `runtime_bridge/daemon_manager.rs` | Yes | runtime lifecycle |
| `runtime_bridge/channel_pool.rs` | Yes | channel reuse |
| `desktop_paths.rs` | Yes | data/config directory resolution |
| `local_runtime/**` | No | outside demo scope |
| `runtime_mod/**` | No | no mod system |
| `external_agent_gateway/**` | No | no agent gateway |
| `menu_bar_shell/**` | No | unnecessary shell complexity |
