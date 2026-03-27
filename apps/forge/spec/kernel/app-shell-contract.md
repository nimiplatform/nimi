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

7-step bootstrap, simplified from desktop's full bootstrap:

```
Step 1: Runtime Defaults
  → desktopBridge.getRuntimeDefaults()
  → Store realm base URL + JWT validation defaults

Step 2: Platform Client
  → createPlatformClient({ realmBaseUrl, accessToken: '', accessTokenProvider, subjectUserIdProvider })
  → Produces { runtime, realm } SDK clients

Step 3: Auth Session
  → bootstrapAuthSession({ accessToken })
  → On success: setAuthSession(user, token, refreshToken)
  → On failure: clearAuthSession() + show login

Step 4: Query Client
  → Initialize TanStack QueryClient with default options
  → Configure auth-aware fetch wrapper

Step 5: Runtime SDK Readiness
  → runtime.ready()
  → checkLocalLlmHealth() for text.stream / image.generate / music.generate route availability
  → No mod registration, no external agent bridge

Step 6: Exit Handler
  → registerExitHandler({ managed: daemonStatus.managed })

Step 7: Ready
  → setBootstrapReady(true)
  → Render app shell
```

Errors at any step → `setBootstrapError(message)` + show error state.

## FG-SHELL-004: Auth Flow

Auth reuses the desktop JWT auth pattern, with one hard cut for standalone shells:

1. Rust `runtime_defaults` does not project raw access tokens into renderer state
2. On bootstrap, Forge starts anonymous unless the current in-memory session has already applied a token
3. If a token is present in the current session → authenticated state → render app
4. If absent or invalid → show login view (OAuth redirect flow)
5. Token refresh uses the Realm SDK refresh flow; app code does not install its own raw REST interceptor
6. `useAppStore.auth` holds: `status`, `user`, `token`, `refreshToken`

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
      '@nimiplatform/nimi-kit/core': '../../kit/core/src',
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
  // Auth
  auth: {
    status: 'bootstrapping' | 'authenticated' | 'unauthenticated';
    user: AuthUser | null;
    token: string;
    refreshToken: string;
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
  // UI
  sidebarCollapsed: boolean;
  // Actions
  setAuthSession(user: AuthUser, token: string, refreshToken: string): void;
  clearAuthSession(): void;
  setBootstrapReady(ready: boolean): void;
  setBootstrapError(error: string | null): void;
  setCreatorAccess(hasAccess: boolean): void;
  toggleSidebar(): void;
}
```

## FG-SHELL-010: SDK Direct Connectivity

Forge invokes runtime and realm through SDK clients created by `createPlatformClient()`:

- `platformClient.runtime` is the only allowed entry for `text.stream`, `image.generate`, `music.generate`, and related runtime jobs
- `platformClient.realm` is the only allowed entry for creator/business REST data
- `desktopBridge` is limited to shell bootstrapping, window/runtime lifecycle, and external URL helpers

This keeps Forge aligned with the desktop app's SDK-first boundary while still running inside a Tauri shell.
