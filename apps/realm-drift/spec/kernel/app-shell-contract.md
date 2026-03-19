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
| `withGlobalTauri` | `true` |

CSP policy extends the forge baseline with iframe embedding for the Marble viewer:

```
default-src 'self' ipc:;
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: file: https:;
media-src 'self' data: blob: file:;
font-src 'self' data:;
connect-src 'self' https: http://127.0.0.1:* http://localhost:* ws: wss: ws://127.0.0.1:* ws://localhost:*;
frame-src https://marble.worldlabs.ai;
```

The `frame-src https://marble.worldlabs.ai;` directive is the key addition enabling Marble viewer iframe embedding. The `img-src` adds `https:` to allow loading remote world thumbnails and Marble-hosted images.

## RD-SHELL-002: Rust Shell (Trimmed)

Realm Drift Rust shell is a **copy of the forge Rust shell**. The following subsystems are retained:

| Retained | Purpose |
|----------|---------|
| Tauri window management | Single main window |
| IPC bridge for runtime defaults | `getRuntimeDefaults` command |
| Runtime bridge (`runtime_bridge/`) | gRPC transport for Runtime SDK `tauri-ipc` transport |
| Exit handler | Process cleanup |

The following subsystems from the desktop app are **excluded**:

| Excluded | Reason |
|----------|--------|
| Mod system (`mod-loader`, `mod-registry`) | No mods in demo app |
| External agent gateway | Consumer feature, not relevant |
| Data sync pipeline | Uses lighter query-based access |

## RD-SHELL-003: Bootstrap Sequence

5-step bootstrap, simplified from forge's 7-step:

```
Step 1: i18n
  → initI18n() — minimal English-only setup

Step 2: Runtime Defaults
  → getRuntimeDefaults()
  → Store realm base URL + access token defaults

Step 3: Platform Client
  → initializePlatformClient({ realmBaseUrl, accessToken, accessTokenProvider, subjectUserIdProvider })
  → Produces { runtime, realm } SDK clients

Step 4: Auth Session
  → bootstrapAuthSession({ accessToken })
  → On success: setAuthSession(user, token, refreshToken)
  → On failure: clearAuthSession() + show login

Step 5: Ready
  → setBootstrapReady(true)
  → Render app
```

Differences from forge (FG-SHELL-003):
- **Removed Step 5 (Runtime SDK Readiness)**: Non-blocking for demo — runtime readiness checked lazily when user initiates agent chat
- **Removed Step 6 (Exit Handler)**: Simplified — no daemon management for demo

Errors at any step → `setBootstrapError(message)` + show error state.

## RD-SHELL-004: Auth Flow

Auth reuses the desktop JWT auth pattern:

1. On bootstrap, validate the stored access token by loading the current user through `MeService.getMe()`
2. If valid → authenticated state → render app
3. If invalid → show error state (demo does not implement full OAuth login flow)
4. Token refresh is owned by the Realm SDK configuration (`refreshToken`, `onTokenRefreshed`, `onRefreshFailed`), not by app-installed raw request interceptors
5. `useAppStore.auth` holds: `status`, `user`, `token`, `refreshToken`

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
      '@nimiplatform/shell-core': '../_libs/shell-core/src',
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
  setAuthSession(user: AuthUser, token: string, refreshToken: string): void;
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
