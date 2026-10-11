# Nimi Lab

Profile: `standalone`

Nimi Lab is the incubation and capability testing application within the Nimi ecosystem. It serves as a comprehensive testbed for developers to exercise, benchmark, and validate new SDK capabilities, AI models, and multimodal pipelines under the supervised Electron development environment.

## Development

```bash
pnpm install
pnpm run init
pnpm dev
pnpm run check
pnpm run build
```

- `init`: Runs project-local code generation and synchronizes app-scaffold lock state.
- `dev`: Launches the Electron development host and Vite dev server under Desktop supervision (equivalent to `pnpm dev:electron`).
- `check`: Runs the complete test and schema validation suite.
- `build`: Produces the standalone production build.

### App Permissions and Access Boundaries

The Lab manifest requests the standard App Access scopes: `realm.data`, `runtime.consume`, `agent.local`, `agent.configure`, and `app.activity`. Operations adhere strictly to protected channel security contracts:
- Sensitive runtime credentials, system registration tokens, and private session material are never exposed to renderer processes or command-line logs.
- Unimplemented or unauthorized operations return structured error codes rather than silently failing or bypassing security boundaries.

World Tour submits a `world.generate` Scenario Job through the current App
AIConfig, adopts the returned world archive as an App asset, writes its small
manifest (`world-tour/<jobId>/world.json`, mirrored to `world-tour/latest.json`)
through public App JSON storage, and opens the Electron viewer. A new successful
generation is recorded as a completed Runtime run; a Job that fails, is canceled
or times out keeps its Job ID and the owner's reason. Runs saved by earlier
builds under the old "local fixture" status keep that label; they are not
migrated. "Open saved world" reopens the latest saved manifest without
generating. Window launch claims stay in the Electron process and are bound to
the exact viewer. There is no Tauri host or private cache-root fallback.

## AI capability coverage

Every canonical AI capability has a formal Lab entry that calls the SDK Local
App client under the App's own AIConfig; the Model Config inventory test fails
when a canonical capability is missing. The public App Tools scaffold slices
(`studio-create`, `studio-media`, `studio-voice`) cover part of that list. The
rest are Lab-only development entries in `src/lab/lab-only/**` and are not
scaffold features:

| Entry | Contract | What it exercises |
| --- | --- | --- |
| Speaker representation | `audio.speaker.embed` | Short WAV, MP3 or FLAC through a Local Scenario Job; the complete vector and opaque `spaceId` survive history and submission recovery. Inputs must be chosen again for a new run. Only vectors from the same space can be compared; this is not identity or authentication. |
| Text annotation | `text.annotate` | Scenario Job; tokens with Unicode scalar offsets and sentences; the complete result is saved as an App JSON document referenced by history. |
| Tools & structured output | `text.generate` | One fixed, side-effect-free test tool with ordered items (including reasoning continuity) and a matching ToolResult, or one fixed JSON Schema checked by the App. |
| Decisions | `text.decide` | One synchronous Scenario call per run on the Local or Cloud route saved in the App's AIConfig: a text or JSON state with choice and yes/no questions; the selected candidate with every candidate's probability, or the true probability, in submitted order, with the trace. Stop aborts the call; a late result is discarded. |
| Conversation | `text.generate` | Multi-turn text through Kit's `simple-ai` provider and `createModelConversationRuntimeAdapter` over the protected App text model. Original records and ordered opaque continuity stay saved. On a model change, Kit uses the current Runtime-owned kind/version/mode compatibility facts: compatible items replay unchanged, while an incompatible route receives an App-owned new request context with a persisted boundary and the earlier visible text. Configuring during generation first stops and settles that turn. Failed or stopped replies remain readable but are not replayed. Oversized history or storage is explicitly refused without dropping earlier records. The complete document, including continuity and the context boundary, can be exported through managed App assets before an explicit new conversation. Runtime details count the actual request. |
| Session hook | `text.generate` | Multi-turn text through Kit's `useAppAiChatSession({ model })` over the protected App text model. The App builds each request's history from completed exchanges without Kit's history window. It uses the same Runtime compatibility facts, persisted context boundary, unchanged source records and managed export as Conversation, and waits for the hook's settled cancellation before changing a model. |
| Image face swap | `image.face_swap` | Uploads reference and target as App-owned artifacts; adopts the PNG; history records name, MIME, size and digest per input role. |
| Video face swap | `video.face_swap` | Finite MP4 Job with an explicit no-face policy and the typed frame summary, plus a separate Session test (App-owned reference upload, a few fixed 1280×720 RGB8 frames, correlated results, Close). |
| AI Realtime | `realtime.interact` | Direct App Session without an Agent: legal 16 kHz mono PCM S16LE input format, text and explicit microphone input, owner controls, events and terminal reason. |

Issued Jobs retain their Job ID on failure, cancellation or timeout. Every
supported async Job accepts a bounded client submission ID, saved with the App
business action before Submit. If the response is lost, recovery looks up that
original submission and then reads its Job; an unknown or expired action is never
automatically resubmitted. Runtime keeps Jobs for its own retention period;
saved App assets are the long-term record. Rerunning a face
swap needs the media chosen again. Session summaries are recorded, but a
closed Session is never restored and its frames and audio are not saved.
History keeps at most 16 KiB each of a run's prompt and context, so one long input
cannot push other records out of the shared history; a longer input is kept as
a marked preview that can be reviewed but not reused as a draft or rerun.
For text annotation, history keeps the first document as the prompt; add any
additional documents again before a new run. Decisions records the exact spec
it sent as its input under the same limit, and its answers; answers too large
for the shared history leave only their summary in the record.

When adding a new canonical AI capability or adapting a third-party App workflow to Nimi, the change must include a corresponding Lab entry, a focused regression test, and real Desktop-supervised Lab acceptance in the same task (or document the specific lifecycle or input reason if Lab cannot host it). Lab entries verify capability behavior under supervised execution; public SDK surfaces and App Tools scaffold admission remain governed by their respective domain owners.
