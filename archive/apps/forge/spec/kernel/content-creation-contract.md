# Content Creation Contract — FG-CONTENT-*

> World and agent asset-family operations, producer helpers, unified content library, and app-level publishing workflows.

## FG-CONTENT-001: World And Agent Asset Family Authority

Forge owns the creator-facing consume/ops grammar for multimodal world and
agent deliverables. Runtime/provider layers remain generation and workflow
truth only. They do not decide candidate review, operator confirmation, active
selection, or family completeness inside Forge.

### Admitted world families

| Family | Candidate kind | Canonical bind target | Completeness role |
|--------|----------------|-----------------------|-------------------|
| `world-icon` | `resource` | Existing world display binding for the world icon slot | Required |
| `world-cover` | `resource` | Existing world display binding for the world cover/banner slot | Required |
| `world-background` | `resource` | Existing world display binding for the world background presentation slot | Optional first-class family |
| `world-scene` | `resource` | Existing world display binding for the world scene presentation slot | Optional first-class family |

### Admitted agent families

| Family | Candidate kind | Canonical bind target | Completeness role |
|--------|----------------|-----------------------|-------------------|
| `agent-avatar` | `resource` | Admitted active avatar presentation slot for the agent owner type | Required |
| `agent-cover` | `resource` | Admitted active cover/card presentation slot for the agent owner type | Optional first-class family |
| `agent-greeting-primary` | `text` | Admitted primary greeting truth for the agent owner type | Required |
| `agent-voice-demo` | `resource` or `workflow-output` that resolves to a `resource` | Admitted active voice-demo presentation slot for the agent owner type | Required |

Family expansion beyond this set requires a new Forge spec admission. This
contract does not implicitly admit alternate greeting, secondary scene, teaser
card, or other future family rows.

### Family primitives

- `family`
  - product-owned deliverable category such as `world-cover` or
    `agent-voice-demo`
- `candidate`
  - one generated, uploaded, written, or workflow-derived option within a
    family
- `approval`
  - operator judgement that a candidate is acceptable quality/content for the
    family
- `confirmation`
  - operator selection of the single active winner for the family
- `binding`
  - write of the confirmed winner into admitted canonical presentation or truth
    state

### Candidate kinds

| Candidate kind | Meaning |
|----------------|---------|
| `resource` | Image or audio artifact referenced by `resourceId` |
| `text` | Greeting or opening-copy candidate referenced through an admitted app/agent candidate id |
| `workflow-output` | Runtime workflow handle or preview output that may later materialize into a `resource` or reusable voice identity |

### Lifecycle semantics

| State | Meaning |
|-------|---------|
| `generated` | Output exists but has not yet entered explicit operator review |
| `candidate` | Visible in the canonical review queue for the family |
| `approved` | Accepted as valid, but not selected as the active family winner |
| `rejected` | Explicitly not selected for activation |
| `confirmed` | Selected winner for the family from the operator point of view |
| `bound` | Confirmed winner has been written into admitted canonical presentation or truth state |
| `superseded` | Previously confirmed/bound winner that has been replaced by a later bound winner |

Additional lifecycle rules:

- `approved` does not activate a candidate.
- `confirmed` chooses the winner; it does not imply the write succeeded.
- `bound` is the only state that proves canonical presentation truth changed.
- if a family lacks an admitted bind path for the current owner type, the flow
  must fail closed at `confirmed`; Forge must not synthesize fake bind success
  or invent a backend write domain.

### Authority boundary

- runtime route resolution, generation, and workflow execution are
  consumption-only inputs to Forge asset ops
- resource presence, content-library visibility, or workbench
  `ENRICHMENT` output never implies `approved`, `confirmed`, or `bound`
- review records must point to `resourceId`, text candidate ids, or workflow
  handles rather than duplicating semantic payload as a second truth object
- Wave 0 admits no new backend API for review state; Forge asset ops must
  consume existing resource, resource-binding, agent detail, and runtime
  capability surfaces already contracted elsewhere

## FG-CONTENT-001A: Image Studio Producer Lane

Image Studio is a producer surface for candidate generation. It is not the
canonical owner of world/agent family review, confirmation, or binding truth.

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
- Actions per image: save to library, hand off to the relevant world/agent
  asset family for review, download, delete
- Zoom/lightbox preview
- Image metadata display (prompt, model, dimensions, timestamp)

### Publishing to Resources

- Save generates a `POST /api/resources/images/direct-upload` session
- Forge uploads the artifact, then finalizes the returned `resourceId` through `POST /api/resources/{resourceId}/finalize`
- Optional: present the saved resource as a family candidate for later
  confirmation and binding through the admitted world/agent asset ops surface

## FG-CONTENT-002: Video Studio

Video Studio provides video upload and management (no AI generation in this phase).

### Upload Flow

```
File Select → Upload (direct-upload API) → Process → Preview
```

### Implementation

| Step | API |
|------|-----|
| Upload | `POST /api/resources/videos/direct-upload` |
| Finalize resource | `POST /api/resources/{resourceId}/finalize` |
| Resolve preview/detail | `GET /api/resources/{resourceId}` |

### UI

- Drag-and-drop upload zone
- Upload progress bar with cancel
- Video preview player (resolved from resource detail)
- Video metadata: title, description, tags, duration, resolution
- Upload history list

### Constraints

- File size limit: enforced by backend `direct-upload` endpoint
- Supported formats: MP4, MOV, WebM
- No video editing features in this phase

## FG-CONTENT-003: Content Library

Unified browser for all creator-owned image, video, audio, and text resources.
It is inventory truth, not family approval/bind truth.

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

Content library reads from `Resource` records and resource detail/list endpoints. Resources are correlated with worlds/agents via:
- `GET /api/resources`
- `GET /api/resources/{resourceId}`
- `PATCH /api/resources/{resourceId}`
- `POST /api/resources/{resourceId}/finalize`
- `DELETE /api/resources/{resourceId}`
- `GET /api/worlds/:worldId/resource-bindings` — which resources are bound to which world entities
- Local metadata store for tags and custom labels (localStorage, keyed by userId)

`Resource` is the single source of truth for image/video/audio/text state:
- upload/generation/import creates or reuses a `Resource`
- resource upload is one source of a post attachment target, but post publishing persists canonical `Attachment.targetType + targetId` references
- world display uses `resource-bindings`
- `resource-bindings` are not a prerequisite for post publishing

Content Library authority limits:

- it can prove that a `resource` exists and who controls it
- it cannot prove that a world/agent family candidate was approved, confirmed,
  or bound
- content-library visibility must not be used as a substitute for family
  completeness or active-selection truth

Control and delivery are explicit resource semantics:
- `uploaderAccountId` records who executed the upload/generation action
- `controllerKind + controllerId` records which controller governs the resource (`ACCOUNT` or `WORLD`)
- `deliveryAccess` records how the underlying file is served (`PUBLIC` vs `SIGNED`)
- post/feed visibility remains independent from `deliveryAccess`

## FG-CONTENT-004: Backend API Dependencies (Wave 0 Baseline)

| API | Endpoint | Method | Purpose |
|-----|----------|--------|---------|
| Resources | `/api/resources/images/direct-upload` | POST | Image upload |
| Resources | `/api/resources/videos/direct-upload` | POST | Video upload |
| Resources | `/api/resources` | GET | List creator-owned resources |
| Resources | `/api/resources/{resourceId}` | GET | Resource detail and preview access |
| Resources | `/api/resources/{resourceId}` | PATCH | Update resource metadata |
| Resources | `/api/resources/{resourceId}/finalize` | POST | Finalize uploaded resource |
| Resources | `/api/resources/{resourceId}` | DELETE | Soft delete resource |
| Resource Bindings | `/api/worlds/:worldId/resource-bindings` | GET, POST | World display resource mapping and write sync |
| Resource Bindings | `/api/worlds/:worldId/resource-bindings/{bindingId}` | DELETE | Delete world display resource binding |

Wave 0 boundary:

- these existing APIs are the only admitted backend surfaces for world/agent
  asset-family operations in this pack
- this contract does not admit a dedicated review-state API, asset-ops backend
  domain, or voice-design persistence API

## FG-CONTENT-005: Acceptance Criteria

1. Forge contracts admit `world-icon` and `world-cover` as the required world
   asset families for creator-facing consume/ops surfaces, and admit
   `world-background` plus `world-scene` as optional first-class world
   families.
2. Forge contracts admit `agent-avatar`, `agent-cover`,
   `agent-greeting-primary`, and `agent-voice-demo` as the agent asset/demo
   families.
3. Candidate lifecycle semantics distinguish `approved`, `confirmed`, and
   `bound`; approval alone never changes active presentation truth.
4. Resource presence or content-library visibility is not treated as proof of
   family completeness or active selection.
5. Image Studio generates image candidates via `runtime.media.image.generate`
   and saves them through existing resource APIs without becoming the review or
   bind authority.
6. Video upload works with progress indication and cancel support.
7. Content Library displays all assets with search, filter, sort, and
   association visibility while remaining inventory-only truth.
8. World/agent asset ops consume only the admitted existing backend/resource
   surfaces in this pack; no dedicated speculative review backend is required.

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

- Save generated audio via `POST /api/resources/audio/direct-upload`
- Finalize audio metadata on `/api/resources/{resourceId}/finalize`
- Persist metadata: title, lyrics source, style, duration, associated world/agent

## FG-CONTENT-007: Publishing Workflow

Forge publishing is an app-level workflow layered on top of existing post primitives. It does not introduce a dedicated backend publishing domain.

### Publishing Identities

- `user` publish: standard creator-authored post using the existing post API
- `agent` publish: publish under a selected agent identity through the platform's existing agent-post capability when that identity is exposed in the app flow
- Forge draft and publish payloads use the generic attachment envelope (`targetType + targetId`) and must preserve `RESOURCE`, `ASSET`, or `BUNDLE` targets without coercing everything to `RESOURCE`
- Images, videos, and audio tracks commonly enter the flow as `RESOURCE` attachments; Forge does not model post publishing as a separate release-bundle contract

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

Publishing flow preserves the canonical attachment envelope:
- upload or select an existing `Resource`, or choose an existing `Asset` / `Bundle`
- when the target is `RESOURCE`, optionally finalize/update resource metadata
- resource upload and world binding remain optional producer-side workflows and do not redefine the post attachment contract
- create the post by referencing `Post.attachments[]` with canonical `targetType + targetId`

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
| Resources | `/api/resources/audio/direct-upload` | EXISTING | Upload generated song/audio resources |
| Posts | `/api/world/posts` | EXISTING | Create creator-authored posts |
| Posts | `/api/world/posts/by-id/{id}` | EXISTING | Read/update/delete creator-authored posts |
| World Posts | `/api/world/by-id/{worldId}/posts` | EXISTING | Read published posts in world context |

Forge may add a thin adapter for agent-post publishing when that capability is surfaced through the app's platform client, but this is not a new publishing backend domain.

## FG-CONTENT-009: Extended Acceptance Criteria

1. Music Studio generates tracks via `runtime.media.music.generate`
2. Generated tracks can be auditioned, titled, and saved through `/api/resources/audio/direct-upload`
3. Content library indexes audio assets alongside image/video assets
4. Publish workspace can compose app-level drafts around existing resources
5. Publishing as a creator uses existing post primitives rather than a dedicated release backend
6. Publish history is derived from existing post/feed reads instead of a release ledger
