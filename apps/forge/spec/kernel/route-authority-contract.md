# Route Authority Contract — FG-ROUTE-*

> Forge route option authority, route selection persistence, capability-first
> route resolution, and speech/voice workflow alignment.

## FG-ROUTE-001: Route Authority Source

Forge route option truth is provided by `runtime.route.listOptions(...)` from the mod runtime host, accessed via `createModRuntimeClient('core:runtime').route.listOptions({ capability })`.

This is the same authority source as Desktop (per S-RUNTIME-074). Forge does not invent an alternative route truth.

| Property | Value |
|----------|-------|
| Authority API | `runtime.route.listOptions(...)` |
| Host access path | `createModRuntimeClient('core:runtime')` via mod SDK host |
| Snapshot type | `RuntimeRouteOptionsSnapshot` from `@nimiplatform/sdk/mod` |
| Prerequisite | Mod SDK host must be registered at bootstrap (see FG-ROUTE-003) |

Forge must NOT use `platformClient.runtime.connector.listConnectors` or `platformClient.runtime.local.listLocalAssets` as app-facing route option truth. These are inventory APIs, not capability-first route authority.

## FG-ROUTE-002: Supported Capabilities

Forge exposes route selection for the following capabilities:

| Forge UI label | Runtime canonical capability | Route authority | Status |
|----------------|------------------------------|-----------------|--------|
| Chat Model | `text.generate` | `runtime.route.listOptions({ capability: 'text.generate' })` | Stable |
| Image Model | `image.generate` | `runtime.route.listOptions({ capability: 'image.generate' })` | Stable |
| Music Model | `music.generate` | `runtime.route.listOptions({ capability: 'music.generate' })` | Stable |
| Speech Model | `audio.synthesize` | `runtime.route.listOptions({ capability: 'audio.synthesize' })` | Stable |
| Voice Design Model | `voice_workflow.tts_t2v` | `runtime.route.listOptions({ capability: 'voice_workflow.tts_t2v' })` | Optional when admitted by Forge asset ops |

All admitted capability tokens in this table use canonical runtime capability
strings and pass through the full route authority chain:
`listOptions` returns a capability-scoped `RuntimeRouteOptionsSnapshot`, and
the shared picker consumes it via `createSnapshotRouteDataProvider`.

Route-authority admission is consumption-only:

- it admits capability selection, not provider/model truth
- it does not by itself admit a product surface
- it does not permit hardcoded provider or model assumptions in Forge

## FG-ROUTE-003: Mod SDK Host Registration

Forge must register a mod SDK host during bootstrap to enable `createModRuntimeClient(...)`.

The bootstrap sequence (FG-SHELL-003) is extended with a new step between Step 2 (Platform Client) and Step 5 (Runtime SDK Readiness):

```
Step 2.5: Runtime Host Capabilities
  -> Build trimmed host capabilities (route + local + media namespaces)
  -> Register via setModSdkHost(host)
  -> createModRuntimeClient('core:runtime') becomes available
```

### Host capabilities scope

Forge's mod SDK host is a **strict subset** of Desktop's. Required namespaces:

| Namespace | Required | Reason |
|-----------|----------|--------|
| `runtime.route` | Yes | Route option authority for picker |
| `runtime.local` | Yes | Local asset/profile listing |
| `runtime.ai` | Yes | Text generation for advisors |
| `runtime.media` | Yes | Image/video/music generation |
| `runtime.voice` | No | Not used by Forge |
| `ui` | No | No mod UI slots in Forge |
| `shell` | No | No shell hooks exposed to mods |
| `settings` | No | No mod settings in Forge |
| `logging` | Yes | Telemetry |
| `lifecycle` | No | No mod lifecycle in Forge |

Namespaces marked "No" may be stubbed or omitted depending on SDK host interface validation behavior.

Speech alignment boundary:

- this contract does not create a separate Forge-owned route authority line for
  speech or voice workflows
- `audio.synthesize` and `voice_workflow.tts_t2v` continue to resolve through
  `runtime.route.listOptions(...)`
- any later execution-layer use must consume the admitted runtime host surface
  for that capability rather than inventing app-local provider truth

### Reuse boundary

The host registration mechanism (`setModSdkHost` from `@nimiplatform/sdk/mod`) is shared. The host capabilities builder must be Forge-specific because Desktop's `buildRuntimeHostCapabilities` includes mod lifecycle, UI slots, shell hooks, and conversation-specific execution that Forge does not need.

## FG-ROUTE-004: Route Selection Persistence

Forge route selection is persisted as `AIConfig` (from `@nimiplatform/sdk/mod`), keyed by `AIScopeRef`.

| Property | Value |
|----------|-------|
| Scope ref | `{ kind: 'app', ownerId: 'forge', surfaceId: 'settings' }` |
| Store field | `aiConfig: AIConfig` in Forge app store |
| Persistence key | `nimi.ai-config.v1` (or Forge-namespaced variant with same schema) |
| Selection type | `AIConfig.capabilities.selectedBindings` — keyed by canonical capability string, values are `RuntimeRouteBinding \| null` |

### Migration (completed)

Legacy `ForgeAiSelection` (`{ connectorId, model, route }`) has been migrated to `AIConfig`. On first load after upgrade, the store reads old `nimi:forge:ai-config` localStorage data, converts to `RuntimeRouteBinding` entries, writes as `AIConfig` to `nimi.forge.ai-config.v1`, and clears the old key. An intermediate format with `deferredSelections` is also migrated.

### Constraints

- Missing key = no explicit user choice (runtime decides)
- `null` value = explicitly disabled by user (no fallback)
- Object value = typed `RuntimeRouteBinding` with capability matching
- These semantics match Desktop's `D-LLM-016` selection store semantics

Speech storage constraints:

- `AIConfig.capabilities.selectedBindings['audio.synthesize']` is the only
  admitted plain-speech selection key
- `AIConfig.capabilities.selectedBindings['voice_workflow.tts_t2v']` is the
  optional custom-voice design selection key when that lane is admitted
- `tts.synthesize` may be read only as a migration alias and must not be
  written back as canonical selection truth

## FG-ROUTE-005: Route Picker Provider

Forge settings route picker must use `createSnapshotRouteDataProvider` from `@nimiplatform/nimi-kit/features/model-picker`.

| Property | Value |
|----------|-------|
| Provider factory | `createSnapshotRouteDataProvider(fetchSnapshot)` |
| Snapshot source | `createModRuntimeClient('core:runtime').route.listOptions({ capability })` |
| Picker hook | `useRouteModelPickerData({ provider, capability })` |

The deprecated `createSdkRouteDataProvider` (renamed `createInventoryRouteDataProvider`) must NOT be used on any stable Forge route selection path.

## FG-ROUTE-006: Music Capability — Resolved

> This rule was originally written when `music.generate` was not in `RuntimeCanonicalCapability` and the Forge music picker used a deferred inventory-based path. This has been resolved.

### Resolution

The runtime capability vocabulary (K-MCAT-024) already included `music.generate` as a canonical token. The SDK `RuntimeCanonicalCapability` type was aligned to include `'music.generate'`. The Forge-local token `audio.generate` was retired.

| Before | After |
|--------|-------|
| Forge used `audio.generate` (non-canonical) | Forge uses `music.generate` (canonical, per K-MCAT-024) |
| Music picker used inventory-based provider | Music picker uses `createSnapshotRouteDataProvider` via `runtime.route.listOptions({ capability: 'music.generate' })` |
| Music selection stored in `deferredSelections` | Music selection stored in `AIConfig.capabilities.selectedBindings['music.generate']` |
| "Preview" badge shown | No badge — music is a stable capability |

### Migration

Existing localStorage data is migrated on first load:
- Legacy `nimi:forge:ai-config` music entries → `AIConfig.selectedBindings['music.generate']`
- Intermediate `deferredSelections['audio.generate']` → `AIConfig.selectedBindings['music.generate']`

The `audio.generate` token is retained only in kit `CAPABILITY_ALIASES` for backward UI-side alias matching. It is not a canonical token and must not be used as a stored or route authority token.

## FG-ROUTE-006A: Speech Capability Alignment

Forge route authority distinguishes plain speech demo synthesis from optional
custom voice design.

| Product label | Canonical capability | Route-authority role |
|---------------|----------------------|----------------------|
| Speech Model | `audio.synthesize` | Required route selection lane for admitted speech-demo generation |
| Voice Design Model | `voice_workflow.tts_t2v` | Optional route selection lane for admitted custom voice design |

Rules:

- `audio.synthesize` is the canonical plain-speech capability for Forge
- `voice_workflow.tts_t2v` is a sibling workflow capability, not an alias of
  plain speech synthesis
- availability of `voice_workflow.tts_t2v` does not by itself unlock a product
  surface; Forge must also admit that lane in the relevant asset-ops contract
- if `voice_workflow.tts_t2v` is unavailable, Forge must fail closed on custom
  voice design while keeping plain speech demo generation available through
  `audio.synthesize`
- `tts.synthesize` must not remain a stored, displayed, or route-authority
  canonical token

## FG-ROUTE-007: No Projection System Required

Forge does NOT require a `ConversationCapabilityProjection` system (Desktop's D-LLM-015 Layer 2).

### Rationale

Desktop's projection system exists to support conversation-mode UX: the user selects a route, and the projection continuously validates that the selection is still viable (resolved, healthy, metadata available) before each message send. Desktop needs this because conversation has a persistent session with multiple turns.

Forge's AI usage is fire-and-forget content creation:
- Image generation: single request with immediate result
- Music generation: single request with job tracking
- AI advisors: ephemeral text stream sessions

Route validation happens at call time, not continuously. If a route is invalid, the generation call itself fails and the user sees the error.

### Constraint

If Forge adds persistent conversation-mode AI features in the future, this rule must be revisited. Conversation-mode features require projection-layer authority per Desktop's D-LLM-015.
