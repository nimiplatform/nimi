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

### Realm responsibilities

- Upload publishable media.
- Persist post metadata and social publication state.
- Reuse existing auth and SDK client isolation rules.

### Overtone responsibilities

- Assemble prompts and UI state.
- Manage takes, compare flow, and provenance prompts.
- Convert runtime artifacts into browser-playable audio.
- Decide what gets published to realm and with what metadata.

## Primary Data Flows

### Boot and readiness

```
app start
  → initialize Tauri shell
  → start/connect runtime daemon
  → construct Runtime + Realm SDK clients
  → detect auth + connector readiness
  → enter project workspace
```

Readiness should follow existing SDK semantics:

- `runtime.ready()` is the primary runtime liveness gate.
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
