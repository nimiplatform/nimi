# App Shell Contract — FG-SHELL-*

> Tauri configuration, bootstrap sequence, auth, layout, and provider stack.

## FG-SHELL-001: Tauri Configuration

Forge runs as a standalone Tauri 2.10 application.

| Property | Value |
|----------|-------|
| `identifier` | `app.nimi.forge` |
| `productName` | `Nimi Forge` |
| `devUrl` | `http://127.0.0.1:1422` |
| Window default | 1440 × 900 |
| Window minimum | 1120 × 780 |
| `titleBarStyle` | `Overlay` (macOS native traffic lights) |
| `withGlobalTauri` | `false` |

CSP policy mirrors desktop app but scoped to Forge needs:

```
default-src 'self' ipc:;
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: file:;
media-src 'self' data: blob: file:;
font-src 'self' data:;
connect-src 'self' https: http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*;
```

## FG-SHELL-002: Rust Shell (Trimmed)

Forge Rust shell is a **subset** of the desktop app shell. The following desktop subsystems are **excluded**:

| Excluded | Reason |
|----------|--------|
| Mod system (`mod-loader`, `mod-registry`) | Features are native pages, not runtime mods |
| External agent gateway | Consumer-facing feature, not creator-relevant |
| Data sync full pipeline | Forge uses lighter query-based data access |

Retained subsystems:
- Tauri window management
- IPC bridge for runtime defaults, runtime bridge status
- JWT config sync
- Exit handler
- SDK runtime bootstrap (`Runtime` over `tauri-ipc`) for creator capabilities

## FG-SHELL-003: Bootstrap Sequence

8-step bootstrap, simplified from desktop's full bootstrap:

```
Step 1: Runtime Defaults
  → desktopBridge.getRuntimeDefaults()
  → Store realm base URL + JWT validation defaults

Step 2: Platform Client (FG-SHELL-011 / FG-SHELL-012)
  → createLocalFirstPartyRuntimePlatformClient({ appId, realmBaseUrl, runtimeTransport })
  → SDK helper type-rejects accessToken / accessTokenProvider /
    refreshTokenProvider / subjectUserIdProvider / sessionStore inputs.
  → Produces { runtime, realm } SDK clients with runtime-owned token custody.

Step 3: Runtime Host Capabilities (per FG-ROUTE-003)
  → Build trimmed host capabilities (route + local + ai + media + logging)
  → Register via setModSdkHost(host)
  → createModRuntimeClient('core:runtime') becomes available

Step 4: Account Projection (FG-SHELL-004)
  → runtime.account.getAccountSessionStatus({ caller: forgeRuntimeAccountCaller })
  → AUTHENTICATED → setAuthSession(projection)
  → ANONYMOUS / UNAVAILABLE / RPC error → clearAuthSession()
    Anonymous and runtime-unavailable states MUST NOT fail bootstrap; the
    shell opens in unauthenticated state and the user signs in via
    FG-SHELL-004 broker login.

Step 5: Query Client
  → Initialize TanStack QueryClient with default options
  → Configure auth-aware fetch wrapper

Step 6: Runtime SDK Readiness
  → runtime.ready()
  → No mod registration, no external agent bridge

Step 7: Exit Handler
  → registerExitHandler({ managed: daemonStatus.managed })

Step 8: Ready
  → setBootstrapReady(true)
  → Render app shell
```

Errors at any step (other than the runtime account RPC at Step 4, which is
non-blocking per the rule above) → `setBootstrapError(message)` + show error
state.

## FG-SHELL-004: Auth Flow

Auth is owned by RuntimeAccountService (FG-SHELL-011 / FG-SHELL-012, spec
K-ACCSVC-008). Forge does not own access-token, refresh-token, or
session-store custody at any layer.

1. Rust `runtime_defaults` does not project raw access tokens into renderer state.
2. On bootstrap, the renderer queries `runtime.account.getAccountSessionStatus`
   with the fixed Forge caller (per `tables/runtime-account-caller.yaml`).
   AUTHENTICATED projects to `auth.user`; ANONYMOUS / UNAVAILABLE / RPC error
   transitions to `unauthenticated` without failing bootstrap.
3. Login goes through the kit `<DesktopShellAuthPage>` desktop-browser flow
   wired to a Forge `runtimeAccountBroker`:
   - `broker.begin` → `runtime.account.beginLogin`. The realm OAuth authorize
     URL returned by runtime carries a PKCE S256 challenge bound to a
     runtime-held verifier. Forge never observes the verifier.
   - User authorizes in the system browser; the realm authorization endpoint
     302-redirects to the Forge desktop loopback with a raw OAuth `code`.
   - `broker.complete` → `runtime.account.completeLogin` with the raw
     `code`, `state`, `nonce`, and `redirectUri`. `refreshToken` MUST be the
     empty string at the wire level (R-OAUTH-008 / spec K-ACCSVC-008); any
     non-empty value is rejected by runtime as PROOF_UNSUPPORTED.
   - On success, runtime mints account material in its own custody and
     emits an account projection containing only `accountId`, `displayName`,
     and `realmEnvironmentId`.
4. Token refresh is owned entirely by runtime. Forge code MUST NOT install
   `accessTokenProvider`, `refreshTokenProvider`, `subjectUserIdProvider`, or
   `sessionStore`, and MUST NOT call any kit shared desktop auth-session
   helpers (`persistSharedDesktopAuthSession`, `resolveDesktopBootstrapAuthSession`).
5. `useAppStore.auth` holds only `{ status, user }`. Token fields are not
   admitted on the renderer state truth (FG-SHELL-009 / FG-SHELL-012).
6. Logout calls `runtime.account.logout({ caller })` and then
   `clearAuthSession()`. Forge MUST NOT clear any persisted shared session
   bridge — none is admitted.

Auth states: `bootstrapping` → `authenticated` | `unauthenticated`

Forge additionally gates on **creator access**:
- After auth, call the typed world data client (`getMyWorldAccess()` backed by Realm SDK)
- The Forge adapter normalizes the backend response to `{ hasAccess: boolean }`
- If `hasAccess: false` → show a blocked state with re-check only
- Forge does not simulate an "apply for creator access" success path until a real backend contract exists
- If `hasAccess: true` → render full app

## FG-SHELL-005: Studio Layout

```
┌────────────────────────────────────────────────────────┐
│  Title Bar (Overlay)                                    │
├──────────┬─────────────────────────────────────────────┤
│          │                                             │
│  Sidebar │  Content Area                               │
│  (240px) │  (flex-1)                                   │
│          │                                             │
│  ┌─────┐ │  ┌───────────────────────────────────────┐  │
│  │ Nav │ │  │  Page Header                          │  │
│  │     │ │  ├───────────────────────────────────────┤  │
│  │ 创作 │ │  │                                       │  │
│  │ Worlds│ │  │  Page Content                        │  │
│  │ Agents│ │  │  (React Router Outlet)               │  │
│  │ Content│ │  │                                      │  │
│  │     │ │  │                                       │  │
│  │ 管理 │ │  │                                       │  │
│  │ Copy │ │  │                                       │  │
│  │ Rev  │ │  │                                       │  │
│  │     │ │  │                                       │  │
│  │ 分析 │ │  │                                       │  │
│  │ Tpl  │ │  │                                       │  │
│  │ Adv  │ │  │                                       │  │
│  │ Ana  │ │  │                                       │  │
│  │     │ │  │                                       │  │
│  │ 设置 │ │  │                                       │  │
│  │ Set  │ │  └───────────────────────────────────────┘  │
│  └─────┘ │                                             │
└──────────┴─────────────────────────────────────────────┘
```

Sidebar groups:
1. **创作** (Create): Worlds, Agents, Content, Publish
2. **管理** (Manage): Copyright, Revenue
3. **扩展** (Extend): Templates, AI Advisors, Analytics
4. **设置** (Settings): Preferences

Active route highlighted. Sidebar collapsible to icon-only mode (64px).

## FG-SHELL-006: Provider Stack

```tsx
<QueryClientProvider client={queryClient}>
  <StoreProvider>
    <AuthProvider>
      <CreatorAccessGate>
        <RouterProvider router={router} />
      </CreatorAccessGate>
    </AuthProvider>
  </StoreProvider>
</QueryClientProvider>
```

- `QueryClientProvider` — TanStack Query (shared query client)
- `StoreProvider` — Zustand app store
- `AuthProvider` — JWT session management
- `CreatorAccessGate` — Gates on the typed world access client backed by Realm SDK
- `RouterProvider` — React Router v7 with lazy-loaded routes

## FG-SHELL-007: Vite Configuration

```typescript
// Key configuration points
{
  root: 'src/shell/renderer',
  envPrefix: ['VITE_', 'NIMI_'],
  define: {
    'import.meta.env.VITE_NIMI_SHELL_MODE': '"forge"',
  },
  resolve: {
    alias: {
      '@renderer': './src/shell/renderer',
      '@runtime': './src/runtime',
      '@nimiplatform/sdk': '../../sdk/src',
      '@nimiplatform/kit/core': '../../kit/core/src',
      '@world-engine': '../../nimi-mods/runtime/world-studio/src/',
    },
  },
  server: {
    host: '127.0.0.1',
    port: 1422,
    strictPort: true,
  },
}
```

The `@world-engine` alias is the key differentiator: it provides direct access to World-Studio engine, services, and generation code without copying.

## FG-SHELL-008: Code Splitting Strategy

| Chunk | Contents |
|-------|----------|
| `vendor-react` | react, react-dom, scheduler |
| `vendor-router` | react-router, @remix-run/router |
| `vendor-query` | @tanstack/react-query |
| `vendor-state` | zustand |
| `sdk-client` | @nimiplatform/sdk/runtime + @nimiplatform/sdk/realm |
| `world-engine` | @world-engine/* (extraction, synthesis) |
| `runtime-bridge` | Tauri bridge helpers for defaults and lifecycle only |
| `vendor-misc` | Other node_modules |

Feature pages use `React.lazy()` with route-level code splitting. The world engine chunk is the largest and loads only when World management pages are accessed.

## FG-SHELL-009: App Store Shape

```typescript
interface ForgeAppStore {
  // Auth (FG-SHELL-004 / FG-SHELL-012). No app-owned token fields.
  auth: {
    status: 'bootstrapping' | 'authenticated' | 'unauthenticated';
    user: AuthUser | null;
  };
  // Bootstrap
  bootstrapReady: boolean;
  bootstrapError: string | null;
  runtimeDefaults: RuntimeDefaults | null;
  // Creator access
  creatorAccess: {
    checked: boolean;
    hasAccess: boolean;
  };
  // AI configuration (per FG-ROUTE-004)
  aiConfig: AIConfig;
  // UI
  sidebarCollapsed: boolean;
  // Actions
  setAuthSession(user: AuthUser): void;
  clearAuthSession(): void;
  setBootstrapReady(ready: boolean): void;
  setBootstrapError(error: string | null): void;
  setCreatorAccess(hasAccess: boolean): void;
  setAIConfig(config: AIConfig): void;
  toggleSidebar(): void;
}
```

`AuthUser` is the shape projected from `runtime.account.getAccountSessionStatus`
(`{ id, displayName }`). Token / refresh-token / subject-id provider state is
forbidden on the renderer store (FG-SHELL-012).

`AIConfig` type is imported from `@nimiplatform/sdk/ai`. See FG-ROUTE-004 for persistence and migration rules.

## FG-SHELL-010: SDK Direct Connectivity

Forge invokes runtime and realm through SDK clients:

- **Route option authority**: `createModRuntimeClient('core:runtime').route.listOptions(...)` is the only allowed entry for app-facing route option truth (per FG-ROUTE-001). Requires mod SDK host registered at Step 3 of FG-SHELL-003.
- **Capability execution**: `platformClient.runtime` is the allowed entry for `text.stream`, `image.generate`, `music.generate`, and related runtime jobs.
- **Realm data**: `platformClient.realm` is the only allowed entry for creator/business REST data.
- **Desktop bridge**: `desktopBridge` is limited to shell bootstrapping, window/runtime lifecycle, and external URL helpers.

Forge must NOT use `platformClient.runtime.connector.listConnectors` or `platformClient.runtime.local.listLocalAssets` as app-facing route option truth. These are inventory APIs used internally by the host capabilities builder, not consumer-facing route authority.

## FG-SHELL-011: RuntimeAccountService Admission

Forge is admitted as an active local-first-party Runtime account / session
consumer. The caller is fixed and authoritative; concrete identifiers live
in `tables/runtime-account-caller.yaml`:

| Field | Value |
|-------|-------|
| `appId` | `app.nimi.forge` |
| `appInstanceId` | `app.nimi.forge.local-first-party` |
| `deviceId` | `local-first-party-device` |
| `mode` | `ACCOUNT_CALLER_MODE_LOCAL_FIRST_PARTY_APP` |

Implementation rules:

- The renderer constructs the platform client via the SDK helper
  `createLocalFirstPartyRuntimePlatformClient`. Calling `createPlatformClient`
  directly from the Forge bootstrap is forbidden.
- Every `runtime.account.*` call from Forge MUST pass the caller exactly as
  declared in the table. Diverging fields (any other `mode`, missing
  `appInstanceId`) MUST fail-close at the call site, not be coerced.
- Mode `ACCOUNT_CALLER_MODE_DESKTOP_LAUNCHED_AVATAR` is not admitted for
  Forge; runtime rejects it as `AVATAR_BINDING_ONLY`.
- Runtime admission gates on the (`appId`, `appInstanceId`) pair. Forge MUST
  NOT introduce a parallel `RegisterApp` flow; admission is reached by
  letting the SDK helper register the FULL-mode manifest.

## FG-SHELL-012: App-Owned Token Custody Forbidden

App-owned access-token, refresh-token, subject-user-id, and session-store
custody are forbidden in the Forge renderer and bridge layers. Runtime
(`runtime/internal/services/account`) is the sole owner of token material.

This rule is enforced at three layers:

1. **SDK type level.** `createLocalFirstPartyRuntimePlatformClient` rejects
   `accessToken`, `accessTokenProvider`, `refreshTokenProvider`,
   `subjectUserIdProvider`, and `sessionStore` inputs at compile time
   (spec K-ACCSVC-008). Forge MUST consume that helper, not bypass it.
2. **Auth adapter.** The Forge `AuthPlatformAdapter` exposed to the kit
   `<DesktopShellAuthPage>` MUST fail-close on `applyToken`,
   `persistSession`, and any oauth/password embedded login path. Returning
   silently or proxying through the realm SDK is a contract violation.
3. **Renderer state.** `useAppStore.auth` MUST NOT carry `token` or
   `refreshToken` fields. `setAuthSession` MUST accept only the
   `AccountProjection`-derived `AuthUser` and MUST NOT take a token argument.

Wire-level rule for `runtime.account.completeLogin`: the `refreshToken`
field of the proof envelope MUST be the empty string. Runtime rejects any
non-empty value with `PROOF_UNSUPPORTED` (R-OAUTH-008).

Logout MUST go through `runtime.account.logout({ caller })`. Forge MUST NOT
call any kit shared desktop auth-session bridge (`auth_session_load/save/clear`,
`persistSharedDesktopAuthSession`, `resolveDesktopBootstrapAuthSession`); none
is admitted on the Forge surface.
