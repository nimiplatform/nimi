[App introduction and usage](NIMI_APP.md)

# Nimi Lab

## Browser workbench

Lab now has a separate HTTPS browser entry. It reuses the existing workbench,
AIConfig editor, AI runners, Runtime-backed history, Agent Center and Agent
Conversation components. The native entry still runs through Desktop supervision.
Lab remains a development application; neither entry grants Registry admission.

The browser signs in directly through the official Nimi page. Lab needs no
separate website password or backend account database. The scoped session stays
in memory; session storage holds only the one-shot PKCE transaction. Returning
from login starts the connection once. Disconnect keeps the current sign-in for
an explicit reconnect; signing out ends this Lab context without globally logging
out other Nimi applications. No AI operation is automatically replayed.

### Configure and run

1. Copy `.env.web.example` to `.env.web.local` and fill the deployment values.
2. Use a browser-trusted certificate for the exact HTTPS origin. The default is
   `https://127.0.0.1:4468`, separate from official development login on `localhost`.
3. Have the Registry maintainer review the remote source for canonical App ID
   `nimi.lab`, the chosen client ID, exact origin and callback `<origin>/`.
   The browser entry needs `runtime.consume`, `agent.local`, and `agent.configure`;
   it is an ordinary `app`, never an `official_manager`. A source candidate or
   environment variable is not admission. Do not copy another application's grant.
4. Start with `pnpm --filter @nimiplatform/lab dev:web`. Enable remote access in
   the primary PC's Home, log in on the official site, and confirm the Lab source
   in Home once. Changing browsers or devices does not require another approval.
5. Configure this App's AIConfig and use the shared workbench or Agent pages.

`pnpm --filter @nimiplatform/lab build:web` builds `dist-web`; the ordinary
`build` command builds both native and Web renderer outputs so CI covers both. A static deployment
must serve the same scoped Realm coordination routes as the development server,
or provide an equivalent deployment-owned reverse proxy. The proxy is limited
to Runtime-client identity and connection coordination; it strips cookies and
does not expose account login, generic Realm APIs, AI, files or Agent traffic.
All business calls travel on the direct browser-to-PC DataChannel.
App files and history retain their existing registered-subject ownership; Web
and native sources do not automatically merge their files or workspaces.

### Current carrier scope

- AI text, embedding/Scenario/Job operations, App AIConfig, App-private JSON
  history and supported asset read/write/adoption use the existing typed SDK clients.
  Each model/operation still requires its actual Runtime configuration.
- Managed media previews use the same UI in both entries. Native Apps retain
  their Host media handles; Web reads authorized App assets into revocable Blob
  URLs. Leaving the view cancels its reader and releases the preview URL.
- LocalAgent references, introductions, conversations, embodiment observation
  and `agent.configure` use the same operation and resource permissions as native
  Apps. A fresh connection obtains fresh Agent handles. The browser cannot create
  a native Host witness or use Desktop management methods.
- Native App Access diagnostics, Integration/activity pages, realtime media
  sessions and World Tour remain unavailable in this first browser carrier.
  Uploaded inputs and text annotation documents use managed App asset storage;
  each remote write is a finite upload of at most 32 MiB, without upload resumption.
  Web exports text and existing owned assets through the
  browser's download flow; it does not open folders on the PC Runtime host.
  The native capability coverage below is unchanged.
- Web media inputs must use inline bytes or uploaded App-owned artifacts. Raw
  media URLs do not authorize the PC to fetch arbitrary network locations.
- Home must remain running. A network that cannot connect directly reports
  unavailable. No Relay, transparent stream recovery or background wake agent
  is provided.

Automated controller, codec, admission and build checks do not certify an AI
execution. The local development source has exercised Local/Cloud text, streaming
cancellation, saved history, LocalAgent conversation and a generated image Job
through the browser. This covers those concrete paths, not every model, modality,
network or platform. Remaining acceptance scope belongs in the local plan packet.

Nimi Lab is a hand-authored, local-development-only workspace App.

Nimi Lab is the incubation and capability testing application within the Nimi ecosystem. Developers use its supervised Electron entry and explicit browser entry to exercise SDK capabilities, AI models, and multimodal pipelines within each carrier's supported scope.

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
| **Tools & Structured Output** | `text.generate` | Exercises side-effect-free test tools with ordered items and matching `ToolResult`, JSON object output, or fixed JSON Schema constraints. The JSON modes are explicit choices and both validate the complete final result. |
| **Video Generation** | `video.generate` | Text, one first frame, ordered first/last frames, and ordered reference images through the existing protected Job carrier. Frames accept an uploaded App-owned artifact or an HTTPS URL; reference uploads retain their order. Runtime decides each exact target's admitted modes and limits. |
| **Decision Logic** | `text.decide` | Synchronous Scenario calls via Local or Cloud routes. Evaluates choice and yes/no prompts, returning candidate probabilities and execution traces. Stop requests cancellation; late responses are discarded. |
| **Multi-turn Conversation** | `text.generate` | Multi-turn text dialogue using Kit's `simple-ai` provider and `createModelConversationRuntimeAdapter`. Replays compatible turns on model switch, while incompatible routes establish a clean context boundary. Oversized history is safely rejected without corrupting earlier turns. |
| **Session Hook** | `text.generate` | Multi-turn dialogue using Kit's `useAppAiChatSession({ model })` hook. The App builds request history directly from completed exchanges and respects Runtime compatibility boundaries. |
| **Image Face Swap** | `image.face_swap` | Uploads reference and target images as App-owned artifacts; validates output PNG and records file metadata (name, MIME, size, digest) per role. |
| **Video Face Swap** | `video.face_swap` | Finite MP4 job with an explicit no-face policy, plus a real-time frame session test (fixed 1280×720 RGB8 frames). |
| **Realtime Interaction** | `realtime.interact` | Direct App session with explicit owner-controlled or continuous mode. Uses the negotiated 16/24 kHz mono PCM tuple, microphone or paced recording input, typed lifecycle events and bounded continuous transcript fragments. Continuous context requests require caller-prepared context/results; no backend calls run automatically. |

The Conversation and Session Hook entries preserve original records and native continuity. Native replay may contain plaintext reasoning; preserve its bytes without interpreting or displaying them, and do not treat the carrier as an encryption guarantee. Model switching waits for the active turn to settle, saves a context boundary, and uses the current Runtime compatibility facts; media or capacity mismatches fail explicitly rather than silently dropping history.

### Execution Guarantees & Constraints

- **Job Tracking & Recovery**: Where the operation supports submission recovery, Lab saves a bounded client submission ID before Submit and the Job ID when returned. Recovery queries the original submission or Job. Unrecognized or expired actions are never automatically re-submitted.
- **History Storage**: Each complete run is an independent App-private asset document (at most 16 MiB), subject to Runtime asset quotas. Saving another run does not replace the history or silently truncate inputs; explicit clear/remove affects only the selected records. The former chunked development history requires a one-time operator conversion; the product does not automatically import it.
- **Private Drafts**: Prompt drafts use the captured App client's account/registered-subject JSON partition. Browser-local preferences remain separate. Unowned drafts from the earlier browser storage key are not imported into a logged-in user's private storage.
- **Session Lifecycles**: Realtime audio and video frames exist only for the duration of the active session; closed sessions are not restored and raw media streams are not retained.
- **Extending Capabilities**: When adding a new canonical AI capability or adapting a third-party workflow to Nimi, include a corresponding Lab testbed entry, regression tests, and Desktop-supervised acceptance verification. Lab entries validate runtime behavior under real execution; public SDK surfaces remain governed by their respective domain contracts.
