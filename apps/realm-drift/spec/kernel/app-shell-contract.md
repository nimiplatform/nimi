# App Shell Contract — RD-SHELL-*

> Tauri configuration, bootstrap sequence, auth, layout, provider stack, and store shape.

## RD-SHELL-001: Tauri Configuration

Realm Drift runs as a standalone Tauri 2.10 application.

| Property | Value |
|----------|-------|
| `identifier` | `app.nimi.realm-drift` |
| `productName` | `Realm Drift` |
| `devUrl` | `http://127.0.0.1:1424` |
| Window default | 1440 x 900 |
| Window minimum | 1120 x 780 |
| `titleBarStyle` | `Overlay` (macOS native traffic lights) |
| `withGlobalTauri` | `false` |

CSP policy extends the forge baseline with iframe embedding for the Marble viewer:

```
default-src 'self' ipc:;
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: file: https:;
media-src 'self' data: blob: file:;
font-src 'self' data:;
connect-src 'self' https: http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*;
frame-src https://marble.worldlabs.ai;
```

The `frame-src https://marble.worldlabs.ai;` directive is the key addition enabling Marble viewer embedding. The `img-src` adds `https:` to allow loading remote world thumbnails and Marble-hosted images. Broad `ws:` / `wss:` origins are not allowed.

## RD-SHELL-002: Rust Shell (Trimmed)

Realm Drift Rust shell is a **copy of the forge Rust shell**. The following subsystems are retained:

| Retained | Purpose |
|----------|---------|
| Tauri window management | Single main window |
| IPC bridge for runtime defaults | `getRuntimeDefaults` command |
| Marble server capability bridge | `realm_drift_marble_generate` / `realm_drift_marble_poll` commands own Marble key custody and upstream HTTP execution |
| Runtime bridge (`runtime_bridge/`) | gRPC transport for Runtime SDK `tauri-ipc` transport |
| Exit handler | Process cleanup |

The following subsystems from the desktop app are **excluded**:

| Excluded | Reason |
|----------|--------|
| Mod system (`mod-loader`, `mod-registry`) | No mods in demo app |
| External agent gateway | Consumer feature, not relevant |
| Data sync pipeline | Uses lighter query-based access |

## RD-SHELL-003: Bootstrap Sequence

5-step bootstrap (RD-SHELL-009 / RD-SHELL-010):

```
Step 1: i18n
  → initI18n() — minimal English-only setup

Step 2: Runtime Defaults
  → getRuntimeDefaults()
  → Store realm base URL, JWT validation defaults, and runtime execution defaults

Step 3: Platform Client (RD-SHELL-009 / RD-SHELL-010)
  → createLocalFirstPartyRuntimePlatformClient({ appId, realmBaseUrl, runtimeTransport })
  → SDK helper type-rejects accessToken / accessTokenProvider /
    refreshTokenProvider / subjectUserIdProvider / sessionStore inputs.
  → Produces { runtime, realm } SDK clients with runtime-owned token custody.

Step 4: Account Projection (RD-SHELL-004)
  → runtime.account.getAccountSessionStatus({ caller: driftRuntimeAccountCaller })
  → AUTHENTICATED → setAuthSession(projection)
  → ANONYMOUS / UNAVAILABLE / RPC error → clearAuthSession()
    Anonymous and runtime-unavailable states MUST NOT fail bootstrap; the
    shell opens unauthenticated and the user signs in via the broker login.

Step 5: Ready
  → setBootstrapReady(true)
  → Render app
```

Differences from forge (FG-SHELL-003):
- **Removed Step 6 (Runtime SDK Readiness)**: Non-blocking for demo — runtime readiness checked lazily when user initiates agent chat
- **Removed Step 7 (Exit Handler)**: Simplified — no daemon management for demo

Errors at any step (other than the runtime account RPC at Step 4, which is
non-blocking per the rule above) → `setBootstrapError(message)` + show error
state.

Runtime execution defaults are the only admitted Realm Drift renderer source for agent-chat model selection. Agent chat may pass a concrete model projected by `runtimeDefaults.runtime.localProviderModel`; it must fail closed when the runtime defaults do not provide one, and it must not install renderer-owned `model: "auto"` or `route: "cloud"` demo literals.

Marble provider-key custody is server-side only. The renderer must not read `VITE_MARBLE_API_KEY` or inject `WLT-Api-Key`; Marble generation and polling must cross the Tauri command boundary admitted by RD-MARBLE-009.

Daemon lifecycle and raw runtime config mutation commands are not admitted for the trimmed Realm Drift demo shell. The Tauri invoke handler MUST NOT register `runtime_bridge_start`, `runtime_bridge_stop`, `runtime_bridge_restart`, `runtime_bridge_config_get`, or `runtime_bridge_config_set`.

## RD-SHELL-004: Auth Flow

Auth identity is owned by RuntimeAccountService (RD-SHELL-009 / RD-SHELL-010,
spec K-ACCSVC-008). Realm Drift does not own access-token, refresh-token, or
session-store custody at any layer.

1. Rust `runtime_defaults` does not project raw access tokens into renderer state.
2. On bootstrap, the renderer queries `runtime.account.getAccountSessionStatus`
   with the fixed Realm Drift caller (per `tables/runtime-account-caller.yaml`).
   AUTHENTICATED projects to `auth.user`; ANONYMOUS / UNAVAILABLE / RPC error
   transitions to `unauthenticated` without failing bootstrap.
3. Login goes through the kit `<DesktopShellAuthPage>` desktop-browser flow
   wired to a Realm Drift `runtimeAccountBroker`:
   - `broker.begin` → `runtime.account.beginLogin`. The realm OAuth authorize
     URL returned by runtime carries a PKCE S256 challenge bound to a
     runtime-held verifier. Realm Drift never observes the verifier.
   - User authorizes in the system browser; the realm authorization endpoint
     302-redirects to the Realm Drift desktop loopback redirect_uri with a raw
     OAuth `code`.
   - `broker.complete` → `runtime.account.completeLogin` with the raw `code`,
     `state`, `nonce`, and `redirectUri`. `refreshToken` MUST be the empty
     string at the wire level (R-OAUTH-008 / spec K-ACCSVC-008); any non-empty
     value is rejected by runtime as `PROOF_UNSUPPORTED`.
4. Embedded `realm.services.AuthService.passwordLogin` and `verifyTwoFactor`
   flows are forbidden in the renderer. They install app-owned token custody
   and would bypass runtime as the source of truth.
5. Direct mutation of `realm.config.auth = { accessToken }` is forbidden.
   Realm SDK auth state is owned by the platform client constructed via
   `createLocalFirstPartyRuntimePlatformClient`.
6. Token refresh is owned entirely by runtime. Realm Drift code MUST NOT
   install `accessTokenProvider`, `refreshTokenProvider`,
   `subjectUserIdProvider`, or `sessionStore`.
7. `useAppStore.auth` holds only `{ status, user }`. Token fields are not
   admitted on the renderer state truth.
8. Logout calls `runtime.account.logout({ caller })` and then
   `clearAuthSession()`.

Where a one-shot short-lived access token is needed (e.g. RD-HCHAT human-chat
Socket.IO connection auth), the renderer MUST call
`runtime.account.getAccessToken({ caller })` at connect time and pass the
projected token directly. The token MUST NOT be cached on the app store or
in module-level state.

Auth states: `bootstrapping` → `authenticated` | `unauthenticated`

Realm Drift does **not** gate on creator access (no `GET /api/world-control/access/me` check). Any authenticated user can browse worlds and explore.

## RD-SHELL-005: App Layout

Realm Drift uses a **minimal layout** — no sidebar navigation. Two distinct layout modes:

### Browser Mode (`/`)

```
┌────────────────────────────────────────────────┐
│  Title Bar (Overlay)                           │
├────────────────────────────────────────────────┤
│                                                │
│  ┌─── Header ───────────────────────────────┐  │
│  │  Realm Drift          [search] [quality] │  │
│  └──────────────────────────────────────────┘  │
│                                                │
│  ┌─── World Grid ───────────────────────────┐  │
│  │  [World 1]  [World 2]  [World 3]         │  │
│  │  [World 4]  [World 5]  [World 6]         │  │
│  │  ...                                     │  │
│  └──────────────────────────────────────────┘  │
│                                                │
└────────────────────────────────────────────────┘
```

### Viewer Mode (`/world/:worldId`)

```
┌────────────────────────────────────────────────────────┐
│  [← Back]  World Name                    [Regenerate]  │
├──────────────────────────────────┬─────────────────────┤
│                                  │ [Agents] | [People] │
│                                  │─────────────────────│
│  Marble 3D Viewer                │  Agent 1 / Friend 1 │
│  (iframe embed)                  │  Agent 2 / Friend 2 │
│                                  │  Agent 3 / Friend 3 │
│  70% width                       │─────────────────────│
│                                  │  Chat messages...    │
│                                  │  ┌─────────────┐    │
│                                  │  │ [input]     │    │
│                                  │  └─────────────┘    │
│                                  │  30% width          │
└──────────────────────────────────┴─────────────────────┘
```

Left pane (70%): Marble 3D viewer area with four visual states per RD-EXPLORE-005.
Right pane (30%): Tabbed panel — Agents tab (per RD-CHAT-*) / People tab (per RD-HCHAT-*).

## RD-SHELL-006: Provider Stack

```tsx
<QueryClientProvider client={queryClient}>
  <RouterProvider router={router} />
</QueryClientProvider>
```

Simplified from forge (FG-SHELL-006):
- No `StoreProvider` wrapper — Zustand store accessed via hooks directly
- No `AuthProvider` wrapper — auth state in Zustand store, checked in App.tsx
- No `CreatorAccessGate` — demo does not require creator access

## RD-SHELL-007: Vite Configuration

```typescript
{
  root: 'src/shell/renderer',
  envPrefix: ['VITE_', 'NIMI_'],
  define: {
    'import.meta.env.VITE_NIMI_SHELL_MODE': '"realm-drift"',
  },
  resolve: {
    alias: {
      '@renderer': './src/shell/renderer',
      '@runtime': './src/runtime',
      '@nimiplatform/sdk': '../../sdk/src',
      '@nimiplatform/nimi-kit/core': '../../kit/core/src',
    },
  },
  server: {
    host: '127.0.0.1',
    port: 1424,
    strictPort: true,
  },
}
```

No `@world-engine` alias — Realm Drift does not use the world creation engine.

## RD-SHELL-008: App Store Shape

```typescript
interface DriftAppStore {
  // Auth (RD-SHELL-004 / RD-SHELL-010). No app-owned token fields.
  auth: {
    status: 'bootstrapping' | 'authenticated' | 'unauthenticated';
    user: AuthUser | null;
  };

  // Bootstrap
  bootstrapReady: boolean;
  bootstrapError: string | null;
  runtimeDefaults: RuntimeDefaults | null;

  // Marble generation jobs (keyed by nimi world ID)
  marbleJobs: Record<string, {
    status: 'idle' | 'generating' | 'completed' | 'failed';
    operationId: string | null;
    marbleWorldId: string | null;
    viewerUrl: string | null;
    error: string | null;
    startedAt: number | null;
  }>;

  // Active chat session
  activeChat: {
    worldId: string;
    agentId: string;
    agentName: string;
    messages: ChatMessage[];
    streaming: boolean;
    partialText: string;
  } | null;

  // Right panel tab
  activeRightPanelTab: 'agents' | 'people';

  // Human chat (per RD-HCHAT-006)
  humanChats: ChatViewDto[];
  activeHumanChat: {
    chatId: string;
    friendName: string;
    messages: MessageViewDto[];
    loading: boolean;
  } | null;
  friendList: FriendDetailDto[];
  onlineUsers: Set<string>;

  // Actions
  setAuthSession(user: AuthUser): void;
  clearAuthSession(): void;
  setBootstrapReady(ready: boolean): void;
  setBootstrapError(error: string | null): void;
  setRuntimeDefaults(defaults: RuntimeDefaults): void;
  setMarbleJob(worldId: string, update: Partial<MarbleJob>): void;
  setActiveChat(chat: ActiveChat | null): void;
  appendChatMessage(message: ChatMessage): void;
  setStreamingText(text: string): void;
  setStreamingDone(): void;
  setActiveRightPanelTab(tab: 'agents' | 'people'): void;
  setHumanChats(chats: ChatViewDto[]): void;
  setActiveHumanChat(chat: ActiveHumanChat | null): void;
  setFriendList(friends: FriendDetailDto[]): void;
  addOnlineUser(userId: string): void;
  removeOnlineUser(userId: string): void;
  appendHumanMessage(message: MessageViewDto): void;
}
```

Key difference from forge (FG-SHELL-009):
- **No `creatorAccess` state** — demo does not gate on creator role
- **No `sidebarCollapsed` state** — no sidebar
- **Added `marbleJobs`** — per-world Marble generation state tracking
- **Added `activeChat`** — in-world agent chat session state
- **Added `activeRightPanelTab`** — Agents / People tab selector
- **Added `humanChats` / `activeHumanChat` / `friendList` / `onlineUsers`** — cross-app human chat state (per RD-HCHAT-006)
- **Removed `token` / `refreshToken`** — RuntimeAccountService owns custody (RD-SHELL-010)

## RD-SHELL-009: RuntimeAccountService Admission

Realm Drift is admitted as an active local-first-party Runtime account /
session consumer. The caller is fixed and authoritative; concrete identifiers
live in `tables/runtime-account-caller.yaml`:

| Field | Value |
|-------|-------|
| `appId` | `app.nimi.realm-drift` |
| `appInstanceId` | `app.nimi.realm-drift.local-first-party` |
| `deviceId` | `local-first-party-device` |
| `mode` | `ACCOUNT_CALLER_MODE_LOCAL_FIRST_PARTY_APP` |

Implementation rules:

- The renderer constructs the platform client via the SDK helper
  `createLocalFirstPartyRuntimePlatformClient`. Calling `createPlatformClient`
  directly from the Realm Drift bootstrap is forbidden.
- Every `runtime.account.*` call from Realm Drift MUST pass the caller exactly
  as declared in the table. Diverging fields (any other `mode`, missing
  `appInstanceId`) MUST fail-close at the call site, not be coerced.
- Mode `ACCOUNT_CALLER_MODE_DESKTOP_LAUNCHED_AVATAR` is not admitted for
  Realm Drift; runtime rejects it as `AVATAR_BINDING_ONLY`.
- Runtime admission gates on the (`appId`, `appInstanceId`) pair. Realm Drift
  MUST NOT introduce a parallel `RegisterApp` flow; admission is reached by
  letting the SDK helper register the FULL-mode manifest.

## RD-SHELL-010: App-Owned Token Custody Forbidden

App-owned access-token, refresh-token, subject-user-id, and session-store
custody are forbidden in the Realm Drift renderer and bridge layers. Runtime
(`runtime/internal/services/account`) is the sole owner of token material.

This rule is enforced at four layers:

1. **SDK type level.** `createLocalFirstPartyRuntimePlatformClient` rejects
   `accessToken`, `accessTokenProvider`, `refreshTokenProvider`,
   `subjectUserIdProvider`, and `sessionStore` inputs at compile time
   (spec K-ACCSVC-008). Realm Drift MUST consume that helper, not bypass it.
2. **Auth adapter.** The Realm Drift `AuthPlatformAdapter` exposed to the kit
   `<DesktopShellAuthPage>` MUST fail-close on `applyToken`,
   `persistSession`, and any oauth/password embedded login path. Returning
   silently or proxying through the realm SDK is a contract violation.
3. **Renderer state.** `useAppStore.auth` MUST NOT carry `token` or
   `refreshToken` fields. `setAuthSession` MUST accept only the
   `AccountProjection`-derived `AuthUser` and MUST NOT take a token argument.
4. **Realm SDK config.** Direct mutation of `realm.config.auth = { accessToken }`
   is forbidden. The realm client's auth state is owned by the platform
   client constructed via `createLocalFirstPartyRuntimePlatformClient`.

Wire-level rule for `runtime.account.completeLogin`: the `refreshToken` field
of the proof envelope MUST be the empty string. Runtime rejects any
non-empty value with `PROOF_UNSUPPORTED` (R-OAUTH-008).

Logout MUST go through `runtime.account.logout({ caller })`. Realm Drift MUST
NOT call any kit shared desktop auth-session bridge (`auth_session_load/save/clear`,
`persistSharedDesktopAuthSession`, `resolveDesktopBootstrapAuthSession`); none
is admitted on the Realm Drift surface, and the Rust shell MUST NOT register
the `auth_session_*` Tauri IPC handlers.

For one-shot short-lived access tokens (e.g. RD-HCHAT human-chat Socket.IO
auth), the renderer MUST call `runtime.account.getAccessToken({ caller })`
at use time and pass the projected token directly to the consumer. The token
MUST NOT be cached on `useAppStore` or in module-level state.
