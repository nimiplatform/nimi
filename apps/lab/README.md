# Nimi Lab

Nimi Lab is a hand-authored, local-development-only workspace App.

Nimi Lab is the incubation and capability testing application within the Nimi ecosystem. It serves as a comprehensive testbed for developers to exercise, benchmark, and validate new SDK capabilities, AI models, and multimodal pipelines under the supervised Electron development environment.

## Development

Complete the repository's [local development setup](../../LOCAL_DEVELOPMENT.md),
start Runtime and Nimi Home, and sign in. Then run from the repository root:

```bash
pnpm dev:lab
```

Lab is maintained directly in this workspace and does not use scaffold `init` or `sync`.
From `apps/lab/`, use these engineering checks:

```bash
pnpm run typecheck
pnpm run check
pnpm run build
```

- `dev`: Launches the Electron development host and Vite dev server under Desktop supervision (equivalent to `pnpm dev:electron`).
- `check`: Runs the complete test and manifest validation suite.
- `build`: Type-checks and builds renderer assets for workspace validation. Lab has no public packaging or release workflow.

### App Permissions and Access Boundaries

The Lab manifest requests the standard App Access scopes: `realm.data`, `runtime.consume`, `agent.local`, `agent.configure`, `app.activity`, and `integration.consume`. Operations adhere strictly to protected channel security contracts:
- Sensitive runtime credentials, system registration tokens, and private session material are never exposed to renderer processes or command-line logs.
- Unimplemented or unauthorized operations return structured error codes rather than silently failing or bypassing security boundaries.

### World Tour Testing

The World Tour feature exercises end-to-end procedural world generation:
- Submits a `world.generate` Scenario Job using the App's active AIConfig.
- Adopts the returned world archive as an App asset.
- Writes a compact manifest (`world-tour/<jobId>/world.json`, mirrored to `world-tour/latest.json`) via public App JSON storage.
- Opens the Electron viewer. Window launch claims remain isolated within the Electron process and are bound to the specific viewer instance.
- Successful runs are recorded as completed Runtime executions. Canceled, failed, or timed-out jobs preserve their Job ID and failure reason.
- "Open saved world" reopens the latest saved manifest without re-triggering generation.

## AI Capability Coverage

Every canonical AI capability has a formal Lab entry that invokes the SDK Local App client under the App's own AIConfig. The Model Config inventory test fails if any canonical capability is missing. Public App Tools scaffold slices (`studio-create`, `studio-media`, `studio-voice`) cover standard capabilities; the remaining entries reside in `src/lab/lab-only/**` as dedicated testbed targets:

| Capability Entry | Contract | What It Exercises |
| --- | --- | --- |
| **Speaker Representation** | `audio.speaker.embed` | Short audio (WAV, MP3, FLAC) processed through a Local Scenario Job. The resulting vector and opaque `spaceId` persist across history and submission recovery. Inputs must be re-selected for new runs; only vectors sharing the same space are comparable (this represents feature space, not identity/authentication). |
| **Text Annotation** | `text.annotate` | Scenario Job outputting tokens with Unicode scalar offsets and sentence boundaries. Saved as an App JSON document linked to history. |
| **Tools & Structured Output** | `text.generate` | Exercises side-effect-free test tools with ordered items and matching `ToolResult`, or validates JSON Schema constraints. |
| **Decision Logic** | `text.decide` | Synchronous Scenario calls via Local or Cloud routes. Evaluates choice and yes/no prompts, returning candidate probabilities and execution traces. Stop requests cancellation; late responses are discarded. |
| **Multi-turn Conversation** | `text.generate` | Multi-turn text dialogue using Kit's `simple-ai` provider and `createModelConversationRuntimeAdapter`. Replays compatible turns on model switch, while incompatible routes establish a clean context boundary. Oversized history is safely rejected without corrupting earlier turns. |
| **Session Hook** | `text.generate` | Multi-turn dialogue using Kit's `useAppAiChatSession({ model })` hook. The App builds request history directly from completed exchanges and respects Runtime compatibility boundaries. |
| **Image Face Swap** | `image.face_swap` | Uploads reference and target images as App-owned artifacts; validates output PNG and records file metadata (name, MIME, size, digest) per role. |
| **Video Face Swap** | `video.face_swap` | Finite MP4 job with an explicit no-face policy, plus a real-time frame session test (fixed 1280×720 RGB8 frames). |
| **Realtime Interaction** | `realtime.interact` | Direct App session bypassing agent layers: validates 16 kHz mono PCM S16LE audio streaming, microphone input, and lifecycle events. |

The Conversation and Session Hook entries preserve original records and opaque continuity. Model switching waits for the active turn to settle, saves a context boundary, and uses the current Runtime compatibility facts; media or capacity mismatches fail explicitly rather than silently dropping history.

### Execution Guarantees & Constraints

- **Job Tracking & Recovery**: Where the operation supports submission recovery, Lab saves a bounded client submission ID before Submit and the Job ID when returned. Recovery queries the original submission or Job. Unrecognized or expired actions are never automatically re-submitted.
- **History Quotas**: Shared history retains at most 16 KiB of prompt and context per run to avoid history starvation. Larger inputs are preserved as marked previews for inspection, but cannot be reused as rerun drafts.
- **Session Lifecycles**: Realtime audio and video frames exist only for the duration of the active session; closed sessions are not restored and raw media streams are not retained.
- **Extending Capabilities**: When adding a new canonical AI capability or adapting a third-party workflow to Nimi, include a corresponding Lab testbed entry, regression tests, and Desktop-supervised acceptance verification. Lab entries validate runtime behavior under real execution; public SDK surfaces remain governed by their respective domain contracts.
