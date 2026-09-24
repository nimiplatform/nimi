# Nimi Lab

Profile: `standalone`

Nimi Lab is the full-capability local-development and incubation App. `nimi.app.yaml` carries App identity and a raw `app_access` declaration used by the supervised development path. Development commands do not constitute product acceptance.

## Development

```bash
pnpm install
pnpm run init
pnpm dev
pnpm run check
pnpm run build
```

`init` runs the pinned local `nimicoding sync --apply` projection and writes app-scaffold lock state. It is explicit after install; package installation does not mutate `.nimi/**` by itself.

`dev` uses the same official launcher as every generated local app and selects
Electron for the current local-development path. `pnpm dev:electron` is the
explicit equivalent. The Nimi desktop host owns project registration, the dev
server, and the native host. Renderer HMR and host-controlled native rebuilds reuse
an unchanged registration; source and declaration changes advance their own
independent generations.

The Lab manifest declares the raw App Access domains `realm.data`, `runtime.consume`, `agent.local`, `agent.configure`, and `app.activity`. Unknown valid declaration items remain preserved but inert. Registration, source generation, declaration generation, identity-session posture, account posture, and protected App Access availability are independent facts. During IMP1 every protected operation returns typed `SDK_LOCAL_APP_ACCESS_UNAVAILABLE` before touching a shell carrier; the App does not prompt, request, or fabricate access. No Runtime credential, registration handle, Registered App Subject, or protected session material enters the renderer or terminal. Paths not run in the current development environment remain `NOT-VERIFIED`.

Lab uses its repository-owned `check` (`test` plus `validate`) and `build`
commands for the non-public workspace validation topology. It does not retain
the retired public `doctor` or `update` commands and does not substitute public
standalone `nimi-app sync/check` for workspace validation.

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
| Text annotation | `text.annotate` | Scenario Job; tokens with Unicode scalar offsets and sentences; the complete result is saved as an App JSON document referenced by history. |
| Tools & structured output | `text.generate` | One fixed, side-effect-free test tool with ordered items (including reasoning continuity) and a matching ToolResult, or one fixed JSON Schema checked by the App. |
| Decisions | `text.decide` | One synchronous Scenario call per run on the Local or Cloud route saved in the App's AIConfig: a text or JSON state with choice and yes/no questions; the selected candidate with every candidate's probability, or the true probability, in submitted order, with the trace. Stop aborts the call; a late result is discarded. |
| Image face swap | `image.face_swap` | Uploads reference and target as App-owned artifacts; adopts the PNG; history records name, MIME, size and digest per input role. |
| Video face swap | `video.face_swap` | Finite MP4 Job with an explicit no-face policy and the typed frame summary, plus a separate Session test (App-owned reference upload, a few fixed 1280×720 RGB8 frames, correlated results, Close). |
| AI Realtime | `realtime.interact` | Direct App Session without an Agent: legal 16 kHz mono PCM S16LE input format, text and explicit microphone input, owner controls, events and terminal reason. |

Jobs keep a known Job ID with every failure, cancellation or timeout. Only
`music-generate`, `music-transcribe` and `audio-voice-convert` Jobs accept a
client submission ID; these new Jobs do not, so a Submit whose response was
lost is shown as unknown and never resubmitted. Runtime keeps Jobs for its own
retention period; saved App assets are the long-term record. Rerunning a face
swap needs the media chosen again. Session summaries are recorded, but a
closed Session is never restored and its frames and audio are not saved.
History keeps at most 16 KiB each of a run's prompt and context, so one long input
cannot push other records out of the shared history; a longer input is kept as
a marked preview that can be reviewed but not reused as a draft or rerun.
For text annotation, history keeps the first document as the prompt; add any
additional documents again before a new run. Decisions records the exact spec
it sent as its input under the same limit, and its answers; answers too large
for the shared history leave only their summary in the record.

When a third-party App adaptation adds a canonical capability or an important
behavior to an existing contract, the same task adds the Lab entry, a focused
regression for the new mechanism, and the real Desktop-supervised Lab
acceptance path, all through the existing composition, history and tests. If
Lab is not a suitable place for it, record the specific lifecycle or input
reason instead. Lab coverage never changes App Tools scaffold admission, which
stays a separate decision.

Public distribution, listing, release descriptors, ordinary visibility, install truth, and protected ingress are deferred platform contracts. Nimi Lab neither generates nor validates their inputs or outcomes.
