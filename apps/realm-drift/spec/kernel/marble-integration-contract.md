# Marble Integration Contract — RD-MARBLE-*

> World Labs Marble API authentication, prompt composition, generation, polling, cost management, and security.

## RD-MARBLE-001: API Authentication

All Marble API requests MUST include the `WLT-Api-Key` header.

| Setting | Value |
|---------|-------|
| Header name | `WLT-Api-Key` |
| Environment variable | `VITE_MARBLE_API_KEY` |
| Base URL env | `VITE_MARBLE_API_URL` (default: `https://api.worldlabs.ai/marble/v1`) |

The API key is read from `import.meta.env.VITE_MARBLE_API_KEY` in the renderer process. See RD-MARBLE-009 for security considerations.

## RD-MARBLE-002: Prompt Composition

The prompt composer transforms nimi world data into a Marble-compatible text prompt. Inputs:

| Source | SDK Call | Data Used |
|--------|---------|-----------|
| World detail | `realm.services.WorldsService.worldControllerGetWorldDetailWithAgents(worldId, recommendedAgentLimit?)` | `name`, `description`, `genre`, `era`, `themes` |
| Worldview | `realm.services.WorldsService.worldControllerGetWorldview(worldId)` | `spaceTopology`, `coreSystem`, `causality`, `tone` |
| Scenes | `realm.worlds.worldControlControllerListWorldScenes(worldId)` | `name`, `description`, `setting` (up to 3) |
| Lorebooks | `realm.worlds.worldControlControllerListWorldLorebooks(worldId)` | `content` (up to 5, filtered for visual relevance) |

### Phase 1: Structural Assembly

First, assemble structured world data into a raw context block:

```
1. World identity: name, description, genre, era, themes
2. Worldview physics: spaceTopology (type, boundary), coreSystem (name, description), causality (type)
3. Scenes (up to 3): name, description, setting
4. Lorebooks (up to 5, filtered: enabled=true, constant=true): content text
```

### Phase 2: LLM Visual Translation

The raw context block is then passed to an LLM (via Runtime SDK `text.stream()`) with a specialized system prompt to produce a **visual scene description** optimized for 3D generation:

```
System prompt:
"You are a 3D environment description writer. Given structured world data,
produce a vivid, spatially-detailed visual description of this world as a
single explorable 3D environment. Focus on:
- Physical landscape and architecture
- Lighting, atmosphere, and weather
- Key visual landmarks and spatial relationships
- Materials, textures, and color palette
- Scale and perspective

Output a single paragraph (max 2000 characters) describing what this world
LOOKS like as a 3D scene. Do not include character names, plot points, or
abstract concepts — only visual, spatial, and atmospheric details."

User input: {raw context block from Phase 1}
```

### LLM Translation Parameters

| Parameter | Value |
|-----------|-------|
| Model | `auto` (Runtime routes to available provider) |
| Route | `cloud` |
| Max tokens | ~500 (enforces conciseness) |
| Temperature | 0.7 (creative but consistent) |
| surfaceId | `realm-drift-prompt-gen` |

### Fallback

If the LLM translation fails (Runtime unavailable, timeout, error), fall back to **direct concatenation**:

```
1. Start with: "A 3D environment for '{world.name}'"
2. Append: world.description (if present)
3. Append: "Genre: {genre}, Era: {era}" (if present)
4. Append: "Themes: {themes.join(', ')}" (if present)
5. Append scenes (up to 3): 'Location "{scene.name}": {scene.description}'
6. Join with ". ", truncate to 2000 characters
```

The composer MUST handle sparse data gracefully — a world with only `name` and `description` SHALL produce a valid prompt via either path.

## RD-MARBLE-003: Image-Guided Generation

When the world has visual assets bound to it (via `MediaBinding` with `targetType: WORLD` and `slot: WORLD_BANNER` or `WORLD_ICON`), the prompt composition MAY use the image URL as a Marble `image_url` input instead of or in addition to the text prompt.

Priority order:
1. `WORLD_BANNER` — preferred (larger, more scene-like)
2. `WORLD_ICON` — fallback

Image-guided generation produces 3D worlds that visually match the existing world branding. The text prompt is still included as `display_name` for the Marble world.

When no visual assets are available, text-only generation is used.

## RD-MARBLE-004: Generate Endpoint

Request to `POST /worlds:generate` — endpoint shape, input types, and output format defined in `external-api-surface.yaml`.

### Field Mapping

| Marble field | Realm Drift source |
|--------------|--------------------|
| `display_name` | `world.name` |
| `model` | User selection per RD-MARBLE-006 |
| `world_prompt.type` | `"text"` (default) or `"image"` (per RD-MARBLE-003) |
| `world_prompt.text_prompt` | Composed prompt per RD-MARBLE-002 |
| `world_prompt.image_url` | World banner/icon URL per RD-MARBLE-003 |

### Behavioral Rules

- The `operation_id` from the response MUST be persisted in the `marbleJobs` store (per RD-SHELL-008) for polling.
- If the request fails with HTTP 429 (rate limit), the UI MUST display the retry-after duration.
- If the request fails with HTTP 401/403, the UI MUST prompt for API key configuration.

## RD-MARBLE-005: Operation Polling

After generation request, poll `GET /operations/{operation_id}` until `done === true`.

| Parameter | Value |
|-----------|-------|
| Poll interval | 5 seconds |
| Timeout | 10 minutes |
| Retry on network error | 3 attempts with 2s backoff |

### State Transitions

```
generateMarbleWorld()
  → Store: status = 'generating', operationId = response.operation_id
  → Start polling loop

pollMarbleWorld()
  → GET /operations/{operation_id}
  → If done === false: continue polling
  → If done === true && response exists:
      → Store: status = 'completed', marbleWorldId = response.world_id
      → Store: viewerUrl = "https://marble.worldlabs.ai/world/{world_id}"
  → If done === true && error exists:
      → Store: status = 'failed', error = error.message
  → If timeout exceeded:
      → Store: status = 'failed', error = 'Generation timed out'
```

The polling loop MUST be cancellable — navigating away from the viewer page SHOULD cancel active polling.

## RD-MARBLE-006: Model Selection

Available models, their quality tiers, latency, and costs are enumerated in `external-api-surface.yaml` (`models` section). The `realm-drift-default` field in that table indicates the demo default.

### Behavioral Rules

- The default for demo purposes MUST be the model marked `realm-drift-default: true` in `external-api-surface.yaml`.
- Model selection MAY be overridden via `VITE_MARBLE_QUALITY` environment variable (`mini` or `standard`).
- The world viewer header SHOULD display a quality toggle allowing users to regenerate with the alternate model.

## RD-MARBLE-007: Generated Assets

The full asset inventory for a completed Marble world is defined in `external-api-surface.yaml` (`output-assets` section).

Realm Drift primarily consumes the **Web Viewer URL** (`https://marble.worldlabs.ai/world/{world_id}`), embedded as iframe per RD-EXPLORE-004. The raw 3D assets (SPZ, GLB) are rendered by the Marble viewer, not by Realm Drift directly.

The **Thumbnail** asset MAY be used to update the world card in the browser view after generation completes.

## RD-MARBLE-008: Cost Budget

Per-model generation costs are defined in `external-api-surface.yaml` (see `cost-standard` / `cost-mini` fields on the generate endpoint). Credit pricing is documented in the YAML file header.

### Behavioral Rules

- Operations (polling, retrieval, listing) are free. Only generation incurs credit charges.
- Credits are per-API-key, not per-user. A single API key is shared across all Realm Drift users in the demo.
- No cost throttling is implemented for the demo (per user requirement: "不考虑成本控制").

## RD-MARBLE-009: API Key Security

### Demo Phase

API key is read from `VITE_MARBLE_API_KEY` environment variable and accessible in the renderer process via `import.meta.env.VITE_MARBLE_API_KEY`. This is acceptable for:

- Internal demos with controlled audience
- Development and testing
- Hackathon presentations

### Production Upgrade Path

For production deployment, the API key MUST be moved to the Tauri Rust backend:

1. Add Tauri command: `marble_generate(prompt, model) → operation_id`
2. Add Tauri command: `marble_poll(operation_id) → MarbleWorldResult`
3. Store API key in Rust-side environment or secure config
4. Renderer calls Tauri commands instead of Marble API directly

This prevents API key exposure in the renderer's JavaScript context.

## RD-MARBLE-010: Provider Abstraction

Realm Drift defines a lightweight `WorldGenerator` interface to decouple the app from the Marble API specifically. This allows future replacement or addition of alternative 3D generation providers (e.g., Google Genie when API is available, or self-hosted solutions).

### Interface

```typescript
interface WorldGeneratorInput {
  displayName: string;
  textPrompt: string;
  imageUrl?: string;
  quality: 'draft' | 'standard';
}

interface WorldGeneratorResult {
  status: 'completed' | 'failed';
  viewerUrl: string | null;
  thumbnailUrl: string | null;
  error: string | null;
}

interface WorldGenerator {
  /** Start generation, return operation handle */
  generate(input: WorldGeneratorInput): Promise<{ operationId: string }>;

  /** Poll until complete or failed */
  poll(operationId: string, signal: AbortSignal): AsyncGenerator<
    { status: 'pending' } | WorldGeneratorResult
  >;

  /** Get viewer URL for a completed generation */
  getViewerUrl(operationId: string): string | null;

  /** Provider display name for UI */
  readonly providerName: string;
}
```

### Marble Implementation

`MarbleWorldGenerator implements WorldGenerator` — the sole implementation for the demo phase. Maps directly to RD-MARBLE-004 and RD-MARBLE-005.

### Usage Rule

All generation calls in the app MUST go through the `WorldGenerator` interface, not directly to Marble API functions. This ensures:

1. A new provider can be added by implementing `WorldGenerator`
2. The viewer embedding strategy (RD-EXPLORE-004) MAY vary by provider — `getViewerUrl()` returns the appropriate URL
3. Provider selection can be configured via environment variable or in-app setting in the future

### Non-Goals

- No runtime provider switching in the demo
- No provider registry or dynamic loading
- No multi-provider comparison view
