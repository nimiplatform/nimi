# World Exploration Contract — RD-EXPLORE-*

> World browser, world data fetching, viewer layout, Marble embedding, and viewer state machine.

## RD-EXPLORE-001: World Browser

The browser page (`/`) displays a grid of nimi worlds available to the authenticated user.

### Data Source

Fetch world list via Realm SDK:

| Source | SDK Call | Returns |
|--------|---------|---------|
| All worlds (by status) | `realm.services.WorldsService.worldControllerListWorlds(status?)` | Worlds matching status filter |
| User's owned worlds | `realm.worlds.worldControlControllerListMyWorlds()` | Worlds owned by the authenticated user |

The browser SHOULD display the user's worlds by default via `worldControlControllerListMyWorlds()`. A secondary option MAY call `worldControllerListWorlds('ACTIVE')` for broader discovery if the backend permits.

> **Note**: No dedicated `listPublicWorlds()` method exists in the current SDK. Public world discovery depends on `worldControllerListWorlds()` with status filtering.

### World Card Content

Each world card displays:

| Field | Source | Required |
|-------|--------|----------|
| Name | `world.name` | Yes |
| Icon | `world.iconUrl` | No (show placeholder) |
| Banner | `world.bannerUrl` | No (show gradient) |
| Genre | `world.genre` | No |
| Era | `world.era` | No |
| Themes | `world.themes` | No (show if present) |
| Agent count | `world.agents.length` | No |
| Status | `world.status` | Yes |
| Marble status | From `marbleJobs[world.id]` store | Indicator if 3D was previously generated |

Clicking a world card navigates to `/world/:worldId`.

### Grid Layout

- Responsive grid: 3 columns on 1440px, 2 columns on 1120px
- Card aspect ratio: 16:9 banner area + metadata below
- Infinite scroll or pagination for large world lists

## RD-EXPLORE-002: World Data Fetching

When the viewer page loads (`/world/:worldId`), fetch world data in parallel via the Realm SDK:

```
Promise.all([
  realm.services.WorldsService.worldControllerGetWorldDetailWithAgents(worldId, 4),
  realm.services.WorldsService.worldControllerGetWorldview(worldId),
  realm.worlds.worldControlControllerListWorldLorebooks(worldId),
])
```

All queries run concurrently via TanStack Query. The viewer page renders progressively:

1. World name and metadata — available from `worldControllerGetWorldDetailWithAgents(worldId, recommendedAgentLimit?)` response (fastest)
2. Agent list — available from response `.agents`
3. Marble prompt preview — assembled once all four queries complete
4. "Generate 3D" button — enabled once prompt is ready

### Error Handling

- Individual query failures MUST NOT block the entire page
- If `worldControllerGetWorldDetailWithAgents` fails → show full error (world not accessible)
- If `worldControllerGetWorldview` / `worldControlControllerListWorldLorebooks` fail → proceed with degraded prompt (name + description only)

## RD-EXPLORE-003: World Viewer Layout

The viewer page (`/world/:worldId`) uses a horizontal split-pane layout per RD-SHELL-005 Viewer Mode.

| Pane | Width | Content |
|------|-------|---------|
| Left | 70% | Marble 3D viewer area (per RD-EXPLORE-004 + RD-EXPLORE-005) |
| Right | 30% | Tabbed panel: Agents tab (per RD-CHAT-*) / People tab (per RD-HCHAT-*) |

### Header Bar

- **Left**: Back button (navigate to `/`) + World name
- **Right**: Regenerate button (re-trigger Marble generation) + Quality toggle (mini/standard per RD-MARBLE-006)

The split-pane divider MAY be draggable for user preference, but a fixed 70/30 split is acceptable for the demo.

## RD-EXPLORE-004: Marble Viewer Embedding

### Primary Strategy: iframe

The Marble web viewer at `https://marble.worldlabs.ai/world/{marble_world_id}` is embedded as an iframe in the left pane:

```html
<iframe
  src="https://marble.worldlabs.ai/world/{marble_world_id}"
  title="Marble 3D Viewer"
  class="h-full w-full border-0"
  allow="autoplay; fullscreen"
  sandbox="allow-scripts allow-same-origin allow-popups"
/>
```

Requirements:
- CSP `frame-src https://marble.worldlabs.ai;` per RD-SHELL-001
- The iframe MUST fill the entire left pane
- The iframe MUST be loaded only after Marble generation completes (`status === 'completed'`)

### Fallback Strategy: Tauri Dual WebView

If the Marble viewer page sets `X-Frame-Options: DENY` or `Content-Security-Policy: frame-ancestors 'none'`, the iframe approach will fail. The fallback uses **Tauri 2's native multi-WebView** capability to split the main window into two side-by-side webviews.

Detection: listen for iframe `load` error event or `onerror` callback within a 5-second timeout.

Fallback architecture:

```
┌─── Main Tauri Window ─────────────────────────────────────┐
│  [Header Bar — rendered by left webview]                   │
├──────────────────────────────┬─────────────────────────────┤
│                              │                             │
│  WebView "marble"            │  WebView "main"             │
│  url: marble.worldlabs.ai   │  url: localhost:1424         │
│       /world/{id}            │       /world/:id/chat       │
│                              │                             │
│  70% width                   │  30% width                  │
│                              │                             │
└──────────────────────────────┴─────────────────────────────┘
```

Implementation uses `Webview` (not `WebviewWindow`) to create a second webview within the existing window:

```typescript
import { Webview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';

// Create a second webview within the SAME window
const appWindow = getCurrentWindow();
const marbleWebview = new Webview(appWindow, 'marble-viewer', {
  url: `https://marble.worldlabs.ai/world/${marbleWorldId}`,
  x: 0,
  y: headerHeight,
  width: windowWidth * 0.7,
  height: windowHeight - headerHeight,
});
```

> **API distinction**: `Webview` creates a webview inside an existing window. `WebviewWindow` creates a new window with a webview — which is NOT what we want here. The Tauri v2 multi-webview feature requires `Webview` attached to a parent window.

Key behaviors:
- The marble webview fills the left 70% of the window, the main renderer webview resizes to the right 30%
- The header bar remains in the main webview (always above both panes)
- On world navigation change, the marble webview is destroyed and recreated
- The main webview handles agent chat independently — no cross-webview communication needed

### Embedding Decision Flow

```
Attempt iframe embed (5s timeout)
  → Success → interactive 3D in left pane (single webview)
  → Failure → activate Tauri dual WebView mode
      → Marble webview: left 70% (marble.worldlabs.ai)
      → Main webview: right 30% (local renderer — chat panel only)
```

### Dual WebView Lifecycle

| Event | Behavior |
|-------|----------|
| World loaded, iframe works | Single webview mode — iframe in left pane |
| World loaded, iframe blocked | Create marble webview, resize main webview |
| Navigate to different world | Destroy marble webview, recreate with new URL |
| Navigate back to browser (`/`) | Destroy marble webview, restore main webview to full width |
| Window resize | Recompute 70/30 split, update webview bounds |

## RD-EXPLORE-005: Viewer State Machine

The left pane (Marble viewer area) has four visual states:

### State: idle

Displayed when no Marble generation has been triggered for this world.

Content:
- World summary (name, description, genre, era, themes)
- Composed Marble prompt preview (per RD-MARBLE-002, read-only text)
- **"Generate 3D World"** button (primary action)
- Model selector (mini / standard per RD-MARBLE-006)

### State: generating

Displayed during Marble API generation and polling.

Content:
- Spinner / progress animation
- "Generating 3D environment..." message
- Estimated time remaining (based on model: ~30s for mini, ~5min for standard)
- Elapsed time counter
- Cancel button (stops polling, sets status to 'idle')

### State: ready

Displayed after Marble generation completes successfully.

Content:
- Embedded Marble viewer iframe (per RD-EXPLORE-004)
- Full-pane interactive 3D exploration

### State: error

Displayed when Marble generation fails or times out.

Content:
- Error message (from Marble API or timeout)
- **"Retry"** button (re-triggers generation with same prompt)
- **"Edit Prompt"** button (returns to idle state for prompt adjustment — future enhancement)

### Transitions

```
idle ──[Generate clicked]──→ generating
generating ──[poll done=true, response]──→ ready
generating ──[poll done=true, error]──→ error
generating ──[timeout 10min]──→ error
generating ──[Cancel clicked]──→ idle
error ──[Retry clicked]──→ generating
ready ──[Regenerate clicked]──→ generating
```

### State Persistence

Marble job state is stored in `marbleJobs[worldId]` per RD-SHELL-008. When the user navigates away and returns to the same world:

- If `status === 'completed'` and `viewerUrl` exists → skip directly to `ready` state
- If `status === 'generating'` and `operationId` exists → resume polling
- Otherwise → show `idle` state
