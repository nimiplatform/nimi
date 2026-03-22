# Content Creation Contract — FG-CONTENT-*

> AI image generation, video upload, music generation, unified content library, and app-level publishing workflows.

## FG-CONTENT-001: Image Studio

Image Studio provides AI-powered image generation for world assets (covers, character portraits, scene illustrations).

### Generation Pipeline

```
Prompt Builder → runtime.media.image.generate → Gallery → Publish
```

### Prompt Builder

- Template-based prompts: cover art, character portrait, scene, item, environment
- Style presets: anime, realistic, painterly, pixel art
- Freeform prompt editing with template as starting point
- Negative prompt support
- Aspect ratio selection: 1:1, 16:9, 9:16, 4:3
- Quality/speed toggle (affects generation parameters)

### Generation

Uses runtime AI `image.generate` capability:

```typescript
const result = await runtime.media.image.generate({
  prompt: composedPrompt,
  negativePrompt: negativePrompt,
  aspectRatio: selectedRatio,
  style: selectedStyle,
});
```

- Shows generation progress indicator
- Supports batch generation (2/4 variants at once)
- Generated images appear in staging gallery before save

### Gallery

- Grid view of generated images (current session)
- Actions per image: save to library, set as world cover, set as agent portrait, download, delete
- Zoom/lightbox preview
- Image metadata display (prompt, model, dimensions, timestamp)

### Publishing to Assets

- Save generates a `POST /api/media/images/direct-upload` session
- Forge uploads the artifact, then finalizes the returned `assetId` through `POST /api/media/assets/{assetId}/finalize`
- Optional: attach to world/agent via media bindings API

## FG-CONTENT-002: Video Studio

Video Studio provides video upload and management (no AI generation in this phase).

### Upload Flow

```
File Select → Upload (direct-upload API) → Process → Preview
```

### Implementation

| Step | API |
|------|-----|
| Upload | `POST /api/media/videos/direct-upload` |
| Finalize asset | `POST /api/media/assets/{assetId}/finalize` |
| Resolve preview/detail | `GET /api/media/assets/{assetId}` |

### UI

- Drag-and-drop upload zone
- Upload progress bar with cancel
- Video preview player (resolved from media asset detail)
- Video metadata: title, description, tags, duration, resolution
- Upload history list

### Constraints

- File size limit: enforced by backend `direct-upload` endpoint
- Supported formats: MP4, MOV, WebM
- No video editing features in this phase

## FG-CONTENT-003: Content Library

Unified asset browser for all creator-owned media content.

### Asset Types

| Type | Source | Icon |
|------|--------|------|
| Image (generated) | Image Studio | Image icon |
| Image (uploaded) | Direct upload | Image icon |
| Video | Video Studio | Video icon |
| Song / audio | Music Studio | Audio icon |
| World cover | World publish | Cover icon |
| Character portrait | Agent creation | Portrait icon |

### Features

- **Grid/list view toggle** with thumbnail previews
- **Search** by filename, tags, description
- **Filter** by: asset type, creation date range, associated world/agent, tags
- **Sort** by: date created, name, size, type
- **Bulk operations**: select multiple → delete, add tags, download
- **Tag management**: add/remove tags, create new tags
- **Association view**: show which world/agent uses each asset

### Data Model

Content library reads from `MediaAsset` records and asset detail/list endpoints. Assets are correlated with worlds/agents via:
- `GET /api/media/assets`
- `GET /api/media/assets/{assetId}`
- `PATCH /api/media/assets/{assetId}`
- `POST /api/media/assets/{assetId}/finalize`
- `DELETE /api/media/assets/{assetId}`
- `GET /api/worlds/:worldId/media-bindings` — which assets are bound to which world entities
- Local metadata store for tags and custom labels (localStorage, keyed by userId)

`MediaAsset` is the single source of truth for image/video/audio state:
- upload/generation/import creates or reuses a `MediaAsset`
- post publishing references `assetId`
- world display uses `media-bindings`
- `media-bindings` are not a prerequisite for post publishing

Ownership and delivery are explicit asset semantics:
- `creatorAccountId` records who executed the upload/generation action
- `ownerKind + ownerId` records who owns the asset (`ACCOUNT` or `WORLD`)
- `deliveryAccess` records how the underlying file is served (`PUBLIC` vs `SIGNED`)
- post/feed visibility remains independent from `deliveryAccess`

## FG-CONTENT-004: Backend API Dependencies (Baseline)

| API | Endpoint | Method | Purpose |
|-----|----------|--------|---------|
| Media | `/api/media/images/direct-upload` | POST | Image upload |
| Media | `/api/media/videos/direct-upload` | POST | Video upload |
| Media | `/api/media/assets` | GET | List creator-owned assets |
| Media | `/api/media/assets/{assetId}` | GET | Asset detail and preview access |
| Media | `/api/media/assets/{assetId}` | PATCH | Update asset metadata |
| Media | `/api/media/assets/{assetId}/finalize` | POST | Finalize uploaded asset |
| Media | `/api/media/assets/{assetId}` | DELETE | Soft delete asset |
| Media Bindings | `/api/worlds/:worldId/media-bindings` | GET | Read-only world display asset mapping |

## FG-CONTENT-005: Acceptance Criteria

1. Image Studio generates images via runtime.media.image.generate with prompt builder
2. Generated images can be saved to library via direct-upload API
3. Generated images can be set as world cover or agent portrait
4. Video upload works with progress indication and cancel support
5. Video preview resolves through `MediaAsset` detail instead of a raw playback-token API
6. Content library displays all assets with search, filter, sort
7. Bulk tag management works across multiple selected assets
8. Asset association view correctly shows world/agent linkage

## FG-CONTENT-006: Music Studio

Music Studio provides AI song generation for world themes, character songs, trailers, and other post-attached audio assets.

### Generation Pipeline

```
Prompt + Lyrics Builder → runtime.media.music.generate → Audition Queue → Save to Library / Publish
```

### Composer Inputs

- Prompt template: opening theme, character song, battle track, ambient loop, trailer music
- Lyrics editor with optional auto-generated chorus
- Style selector: pop, orchestral, electronic, folk, cinematic, lo-fi
- Duration presets: 30s, 60s, 120s
- Toggle: instrumental / vocal
- Title and release label metadata

### Generation

Uses runtime AI `music.generate` capability:

```typescript
const result = await runtime.media.music.generate({
  model: resolvedRoute,
  prompt,
  lyrics,
  style,
  title,
  durationSeconds,
  instrumental,
});
```

- Each generation returns a job + artifacts pair
- Generated tracks enter an audition queue with waveform preview, metadata, and trace info
- Approved tracks can be saved into the content library or attached to a post draft

### Persistence

- Save generated audio via `POST /api/media/audio/direct-upload`
- Finalize audio metadata on `/api/media/assets/{assetId}/finalize`
- Persist metadata: title, lyrics source, style, duration, associated world/agent

## FG-CONTENT-007: Publishing Workflow

Forge publishing is an app-level workflow layered on top of existing post primitives. It does not introduce a dedicated backend publishing domain.

### Publishing Identities

- `user` publish: standard creator-authored post using the existing post API
- `agent` publish: publish under a selected agent identity through the platform's existing agent-post capability when that identity is exposed in the app flow
- Images, videos, and audio tracks are media assets attached to a post; Forge does not model them as release bundles

### App-Level Workflow

1. Select media from the content library or current generation session
2. Choose a publish identity (`user` or selected `agent`)
3. Compose caption, tags, and optional world context
4. Save local drafts in app state when the creator is not ready to publish
5. Publish immediately through existing post capabilities
6. View publish history via existing feed/post queries

`draft`, `history`, and `schedule` are Forge UI concerns in this phase:
- Drafts are local UI state
- History is derived from existing post/feed queries
- Scheduled publishing is out of scope for the current backend contract

Publishing flow is always asset-first:
- upload or select an existing `MediaAsset`
- optionally finalize/update asset metadata
- optionally bind the asset to world display slots
- create the post by referencing `Post.media[].assetId`

### Routes

- `/publish/releases` — Publish workspace for local drafts, publish history, and post composition
- `/publish/channels` — Publish identity and destination settings for internal app flows

### Channel Semantics

- `INTERNAL_FEED` means publish as a standard post into the platform feed
- `INTERNAL_AGENT_PROFILE` means publish under a selected agent-facing identity in app workflows
- External channel distribution is deferred and must not drive backend scope in Forge v1

No new backend API is required for these channel semantics. They are UI vocabulary for where a post appears and which identity authors it.

## FG-CONTENT-008: Backend API Dependencies (Extension)

| API | Endpoint | Status | Purpose |
|-----|----------|--------|---------|
| Media | `/api/media/audio/direct-upload` | NEW | Upload generated song/audio assets |
| Posts | `/api/world/posts` | EXISTING | Create creator-authored posts |
| Posts | `/api/world/posts/by-id/{id}` | EXISTING | Read/update/delete creator-authored posts |
| World Posts | `/api/world/by-id/{worldId}/posts` | EXISTING | Read published posts in world context |

Forge may add a thin adapter for agent-post publishing when that capability is surfaced through the app's platform client, but this is not a new publishing backend domain.

## FG-CONTENT-009: Extended Acceptance Criteria

1. Music Studio generates tracks via `runtime.media.music.generate`
2. Generated tracks can be auditioned, titled, and saved through `/api/media/audio/direct-upload`
3. Content library indexes audio assets alongside image/video assets
4. Publish workspace can compose app-level drafts around existing media assets
5. Publishing as a creator uses existing post primitives rather than a dedicated release backend
6. Publish history is derived from existing post/feed reads instead of a release ledger
