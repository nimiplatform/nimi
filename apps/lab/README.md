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
  remote writes stream within bounded owner-issued input credits; existing Runtime storage limits apply, without upload resumption.
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
| **Image Generation and Control Maps** | `image.generate` | Text or ordinary owned reference-image input for compatible models; a separate typed control-image field for SDXL ControlNet Union, with explicit type and optional strength. The selected recipe decides which modes can be used together. |
| **Image Super-resolution** | `image.upscale` | Uploads one PNG/JPEG of at most 32 MiB, submits a 2×/4× Job with optional seed, and retains the complete PNG in App-private assets and history. |
| **Video Super-resolution** | `video.upscale` | Uploads one complete MP4 of at most 32 MiB, submits a 2×/4× Job, and retains the validated MP4 with source frame timing and AAC audio. Runtime enforces duration, frame-count, codec and decoded-size limits. |
| **Decision Logic** | `text.decide` | Synchronous Scenario calls via Local or Cloud routes. Evaluates choice and yes/no prompts, returning candidate probabilities and execution traces. Stop requests cancellation; late responses are discarded. |
| **Multi-turn Conversation** | `text.generate` | Multi-turn text dialogue using Kit's `simple-ai` provider and `createModelConversationRuntimeAdapter`. Replays compatible turns on model switch, while incompatible routes establish a clean context boundary. Oversized history is safely rejected without corrupting earlier turns. |
| **Session Hook** | `text.generate` | Multi-turn dialogue using Kit's `useAppAiChatSession({ model })` hook. The App builds request history directly from completed exchanges and respects Runtime compatibility boundaries. |
| **Image Face Swap** | `image.face_swap` | Uploads reference and target images as App-owned artifacts; validates output PNG and records file metadata (name, MIME, size, digest) per role. |
| **Video Face Swap** | `video.face_swap` | Finite MP4 job with an explicit no-face policy, plus a real-time frame session test (fixed 1280×720 RGB8 frames). |
| **Realtime Interaction** | `realtime.interact` | Direct App session with explicit owner-controlled or continuous mode. Uses the negotiated 16/24 kHz mono PCM tuple, microphone or paced recording input, typed lifecycle events and bounded continuous transcript fragments. Continuous context requests require caller-prepared context/results; no backend calls run automatically. |

The Conversation and Session Hook entries preserve original records and native continuity. Native replay may contain plaintext reasoning; preserve its bytes without interpreting or displaying them, and do not treat the carrier as an encryption guarantee. Model switching waits for the active turn to settle, saves a context boundary, and uses the current Runtime compatibility facts; media or capacity mismatches fail explicitly rather than silently dropping history.

### Local media setup and observed model coverage

Use Home's AI Capabilities workspace to download missing components, reuse compatible installed files and prepare the current model for each capability. Lab consumes that model through its Local AI intent. Image and video upscaling have separate configurations. In Parameters, select the source file and 2×/4× multiplier; RelayVSR must match its recipe's multiplier and VAE. An omitted upscale seed uses 42; zero is valid. SeedVR2 remains experimental.

For ordinary H3 editing, use Reference image file. For ControlNet, use Control image file, select a type and match the output canvas to the prepared map. There is no implicit control-map preprocessor. Strength defaults to 1 and accepts 0 through 2. Reset parameters when switching input modes; ControlNet rejects ordinary references and masks, while H3 Image rejects control maps, masks and negative prompts. Sol-H3-VAE is selected in the video VAE slot in Home, not as a separate Lab capability.

The [English walkthrough](../../docs/start/use-nimi-lab.md) and [中文操作指南](../../docs/zh/start/use-nimi-lab.md) cover the UI journey. [Multimodal contracts and SDK examples](../../docs/runtime/multimodal.md) document source limits, typed inputs, explicit cancellation and retaining complete results. Native source-built SDK, Kit, Runtime and Lab must match. The new recipes are Windows amd64 NVIDIA only; Windows uses sd.cpp `master-1088-32d516c`, while macOS retains its independent 1050 package.

Real acceptance on 2026-11-11 used Windows RTX 5090, guarded Desktop startup and Desktop-supervised native Lab through its exact CDP target. The Runtime was the modified `270ced7e7` source snapshot, before the subsequent pull; documentation checks do not turn that record into a new run of later revisions. The [model acceptance matrix](../../runtime/acceptance/model-matrix.yaml) retains exact model identities, Job IDs and limitations.

| Model/component | Actual exercised scenario |
| --- | --- |
| MiniMax-H3-Image | 1024×1024 text-to-image and one-reference blue-to-orange mug edit; final edit regression after integration |
| HyperFlow H3 Flash | FL2VA text-to-video with the original H3 VAE and Ref2VA reference-to-video with Sol; pinned combined BennyDaBall INT8 conversion, six steps, 512×288, 22 frames at nominal 24 FPS |
| Sol-H3-VAE | Actual decoder binding in the HyperFlow Ref2VA run; not an independent capability or a test of every H3/VAE combination |
| RelayVSR 2x / 4x | Both image and video variants; 256² images became 512²/1024², and 512×288 video became 1024×576/2048×1152 |
| SeedVR2 3B / 7B Sharp | 3B image at 4× and video at 2×; 7B Sharp image and video at 2×; experimental |
| SDXL ControlNet Union ProMax | 1024² Canny with explicit strength 1 and Tile with omitted strength, both producing actual PNGs |

All four upscale video outputs preserved the 22 source frame timestamps and AAC packet bytes; container duration differed by one microsecond. SeedVR2 3B cancellation was observed after native inference started, the process exited, and a new request completed. Visual checks concern the tested samples; HyperFlow audio quality was not assessed. Other ControlNet types, HyperFlow four/eight-step presets, unlisted scales or inputs, remote Web/Android, other platforms and installed distributions remain **NOT-VERIFIED**. Earlier failed runs remain recorded separately from the repaired successful runs.

### Execution Guarantees & Constraints

- **Job Tracking & Recovery**: Where the operation supports submission recovery, Lab saves a bounded client submission ID before Submit and the Job ID when returned. Recovery queries the original submission or Job. Unrecognized or expired actions are never automatically re-submitted.
- **History Storage**: Each complete run is an independent App-private asset document (at most 16 MiB), subject to Runtime asset quotas. Saving another run does not replace the history or silently truncate inputs; explicit clear/remove affects only the selected records. The former chunked development history requires a one-time operator conversion; the product does not automatically import it.
- **Private Drafts**: Prompt drafts use the captured App client's account/registered-subject JSON partition. Browser-local preferences remain separate. Unowned drafts from the earlier browser storage key are not imported into a logged-in user's private storage.
- **Session Lifecycles**: Realtime audio and video frames exist only for the duration of the active session; closed sessions are not restored and raw media streams are not retained.
- **Extending Capabilities**: When adding a new canonical AI capability or adapting a third-party workflow to Nimi, include a corresponding Lab testbed entry, regression tests, and Desktop-supervised acceptance verification. Lab entries validate runtime behavior under real execution; public SDK surfaces remain governed by their respective domain contracts.

### Web account access

The Web entry composes the shared `auth/app/web` factory and `auth/app` account control/gate. Identity remains separate from Runtime connectivity. Lab no longer owns a separate remote login controller. Native-only file actions stay outside the portable App operation type; browser results use the existing export/download port.

### Direct App file transfers

The Lab-only **App files** page under Image, video & files uses the same public `storage.assets.write/read` operations in native and Web entries. It streams the selected file into a new private Lab asset, waits for the owner commit, then compares every read-back byte with the original file. The visible upload counter is source bytes read, not a commit acknowledgement. Results and errors stay in the current page; binary content is not written to AI run history, and this entry adds no model capability or public scaffold feature.

For interrupted transfers, keep the displayed App-relative path, disconnect the Web connection, reconnect through the existing account flow, select the original file and choose **Verify existing file**. That action never re-uploads. A canceled upload must not leave a committed prefix. Test assets use `lab-transfer-tests/`; this is App-private Runtime storage, not a new persistence service or proof ledger.
