# Overtone — Feature Specification

## Tiering

| Tier | Meaning |
|------|---------|
| `P0` | required for the first credible demo |
| `P1` | valuable expansion after the core loop works |
| `P2` | experimental; do not block the demo |

## F-001 `P0`: Project Workspace and Readiness Gate

**Purpose**: Enter the app through a single workspace that confirms runtime, realm auth, and connector readiness before creation begins.

**User Flow**:
1. App boots and checks runtime availability.
2. App detects realm auth state.
3. App checks whether music and text generation connectors/models are usable.
4. User either fixes readiness issues or starts a new song project.

**Why it matters**:
- Music creation is connector-sensitive.
- A broken first generation experience will make the demo look like transport failure rather than product failure.

## F-002 `P0`: Song Brief and Lyrics Canvas

**Purpose**: Help the user turn a vague idea into a structured prompt package for music generation.

**User Flow**:
1. User enters a freeform idea.
2. AI proposes title, genre, mood, tempo, and section outline.
3. User edits or regenerates any field.
4. Lyrics are generated section by section or pasted manually.
5. Accepted text becomes the source of truth for later generations.

**Primary SDK surfaces**:
- `runtime.ai.text.stream`
- `runtime.ai.text.generate`

**Constraints**:
- Manual edits always win over regenerated text.
- The app must work even if the user skips the structured concept step and writes lyrics directly.

## F-003 `P0`: Music Generation

**Purpose**: Generate one or more song candidates from prompt, lyrics, and high-level controls.

**User Flow**:
1. User reviews prompt, lyrics, style tags, duration, and instrumental toggle.
2. User chooses a model/connector path.
3. User clicks `Generate`.
4. App submits an async music job and streams progress.
5. Completed artifacts are decoded into playable candidates.

**Primary SDK surfaces**:
- `runtime.media.music.generate`
- `runtime.media.jobs.subscribe`
- `runtime.media.jobs.getArtifacts`

**Canonical input shape today**:

```typescript
{
  model: 'music-model',
  prompt: 'melancholic indie folk about leaving home',
  lyrics: '...',
  style: 'indie, folk, acoustic guitar',
  title: 'Leaving',
  durationSeconds: 120,
  instrumental: false,
}
```

**Constraints**:
- Music generation is already a runtime scenario; Overtone should not spec new runtime transport just to make the app work.
- Job timeout, auth failure, rate limits, and provider capability mismatch must stay user-visible.

## F-004 `P0`: Candidate Stack and Compare

**Purpose**: Treat generation as a take system instead of a single output slot.

**User Flow**:
1. Each generation creates one or more candidate takes.
2. User can favorite, rename, compare, discard, and branch from a take.
3. Compare mode supports quick A/B switching and notes.
4. One take becomes the publish master.

**Rationale**:
- Current AI music UX is iteration-heavy. The demo should show that nimi can support takes and lineage, not only one-shot calls.

**Minimum state**:

```typescript
type SongTake = {
  takeId: string;
  parentTakeId?: string;
  origin: 'prompt' | 'extend' | 'remix' | 'reference';
  title: string;
  jobId: string;
  artifactId?: string;
  promptSnapshot: string;
  lyricsSnapshot?: string;
  createdAt: number;
};
```

## F-005 `P0`: Reference Audio, Extend, and Remix

**Purpose**: Let the user create from an uploaded audio fragment or an existing take, not only from text.

**User Flow**:
1. User uploads a short reference clip or picks an existing take.
2. User chooses an action: `extend`, `remix`, or `style/reference`.
3. App builds the music generation request with an internal extension payload.
4. New takes are produced and linked to their source.

**Primary SDK surfaces**:
- `runtime.media.music.generate`
- `runtime.media.jobs.*`

**Contract note**:
- The stable music input currently exposes top-level fields such as `prompt`, `lyrics`, `style`, `title`, `durationSeconds`, and `instrumental`.
- Reference-audio and edit-style semantics should stay behind `extensions` under `nimi.scenario.music_generate.request` until upstream kernel fields stabilize.

**Implementation gate**:
- This feature requires a runtime adapter validation step before implementation.
- Today, the music SDK/runtime surface accepts `extensions`, but the stable music proto does not expose first-class reference-audio fields.
- If the Suno path does not already interpret the required extension payload, Overtone must add a runtime adapter patch before Phase 3 can start.

**App rule**:
- Do not expose raw provider JSON to end users.
- Keep an app-owned extension builder so the UI contract stays stable even if provider-specific fields change.

## F-006 `P0`: Playback, Trim Preview, and Metadata

**Purpose**: Let users audition takes before publishing.

**User Flow**:
1. User opens a take.
2. App decodes the artifact into a playable buffer.
3. User plays, pauses, scrubs, and sets optional preview trim points.
4. User edits title, tags, and short description.

**Implementation**:
- Web Audio API
- lightweight waveform or progress visualization

**Non-goal**:
- full timeline editing for the MVP

## F-007 `P0`: Realm Publish and Provenance Confirmation

**Purpose**: Publish a chosen master take into realm with enough metadata to explain where it came from.

**User Flow**:
1. User selects the master take.
2. App asks for publish metadata and provenance confirmation.
3. Audio and optional artwork are uploaded to realm.
4. A realm post is created.
5. User receives the resulting post link or object summary.

**Primary SDK surfaces**:
- `realm.media.upload`
- `realm.posts.create`

**Required metadata**:
- title
- description
- tags
- source mode: prompt-only / uploaded-audio / derived-take
- user confirmation that uploaded material is owned or permitted

## F-008 `P1`: Cover Art Generator

**Purpose**: Generate album artwork from the song brief and final take metadata.

**Primary SDK surface**:
- `runtime.media.image.generate`

**Scope note**:
- Nice to have for demo quality.
- Must not block the core music flow.

## F-009 `P1`: Scratch Vocals / Guide Vocals

**Purpose**: Offer optional spoken or guide-vocal generation for ideation and preview.

**Primary SDK surfaces**:
- `runtime.media.tts.listVoices`
- `runtime.media.tts.synthesize`

**Important boundary**:
- This is not the core singing pipeline.
- The app should describe it as guide audio, not as production-grade vocal synthesis.

## F-010 `P2`: Voice Lab

**Purpose**: Experiment with custom voice assets for future vocal workflows.

**Primary SDK surfaces**:
- `runtime.ai.submitScenarioJob` with `VOICE_CLONE` / `VOICE_DESIGN`
- `runtime.ai.listVoiceAssets`
- `runtime.ai.deleteVoiceAsset`

**Boundary**:
- Useful for platform exploration.
- Not required for the first music-creation demo.

## Deferred Ideas

- Stem-aware export or reimport flow once provider/runtime artifacts support it well enough.
- Session/timeline editing once the app has more than single-take playback.
- Share permissions and derivative controls for realm-published songs.
