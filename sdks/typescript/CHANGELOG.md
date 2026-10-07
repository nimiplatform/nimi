# SDK migration notes

## SDK 0.21.0 / Kit and native 0.18.0 — Owned World image inputs (development)

The compatible input widening belongs to this unpublished minor development set. Use the newly built matching Runtime, SDK, Kit/native and Rust carrier 0.10.0 packages; a matching version label alone does not identify their contents. `world-generate` now accepts `image: { artifactId, projection }`, where projection is `ordinary` or `equirectangular-360`. Upload image bytes through the existing protected artifact upload first; prompt may be omitted when an image is present. Text-only requests still require a prompt. App paths, data URLs, provider IDs and implicit panorama detection are not inputs. Runtime captures the owned bytes before publishing the Job and performs provider upload privately. PNG/JPEG/WebP are bounded to 20 MB and 16 MP with upright orientation; panorama intent additionally requires 2:1 geometry.

World results remain portable ZIP artifacts. Persist the original App source, prompt, configuration and creation time for recovery, observe an existing Job instead of submitting again, and retain unknown submission receipts without automatic replay.

## Next minor — explicit Agent reference voice (development)

The current bound sound sample, including an opening line, can be cloned once through the existing App `voice.create` job and bound through Agent presentation CAS. No producer voice handle is imported and no shared route changes implicitly. Covered Apps pass the same canonical client to the Agent Center factory to enable the journey. The retained `clientSubmissionId` carrier and recovery-expiry projection now also admit provider-persistent Cloud `voice-create`; use matching Runtime, SDK and Kit/native builds. This is an additive next-minor capability, staged without a package publication.

## SDK 0.21.0 / Kit and native 0.18.0 — Estimated music notes (development)

Use the complete matching Runtime, SDK 0.21.0, Kit/native 0.18.0 and Rust carrier 0.10.0 package set. `music.transcribe` adds `note-events` without changing the existing three part meanings. The public input/profile/result parsers admit its typed value; older clients cannot project this new closed-set part. Basic Pitch's exact Windows CPU profile supports MIDI, timeline or both and reports unknown completeness unless the engine supplies stronger evidence.

The timeline uses original source frames with the captured range offset once. MIDI times are relative to that selected interval, using the declared 1 ms SMPTE encoding clock; its fixed note-on value and channels are encoding conventions, not measured dynamics or instrument identity. Preserve the original audio and both artifact references. Unsupported parts and ABC fail before publication; do not silently convert or omit outputs.

## 0.20.0 — Common Reasoning and protected App summaries (development)

Use SDK 0.20.0 with Kit and native package 0.17.0, Rust carrier 0.9.0 and the matching Runtime. Omitted reasoning now preserves the selected implementation default. Callers that require reasoning off must explicitly request `activation: disabled` and handle typed refusal when the selected target has no off mapping. Required effort includes `xhigh`; the protected App model accepts the common typed controls through `parameters.reasoning`.

The protected text contract carries authorized summary deltas and separate ordered summary items, plus Runtime-owned input support projections. Persist summaries separately from final text together with the unchanged opaque continuity. Replay returned items in order; do not edit summaries or opaque bytes. HIDDEN never exposes summary text. These are 0.x public type changes: upgrade the complete package set together.

## Next pre-1.0 hard cut — Image seeds

Image requests admit `-1` for randomness and `0..2147483647` for fixed seeds. Omission retains the committed default; zero stays fixed. Other negative values and overflowing batches fail before dispatch. Successful typed image artifacts carry nonnegative concrete seeds. The local stable-diffusion.cpp image dialect is v4; old Loadouts require explicit owner preparation and commitment of their bindings and options, with no automatic migration or legacy dialect.

Use matching Runtime, SDK, Kit and native packages. This narrows an input contract and is a pre-1.0 breaking change, not a compatible type widening; the development package versions have not been publicly released by this delivery.

## Next minor (compatible additions)

The matching SDK adds `validateNimiLocalAppSpeechAlignment`; Kit re-exports it only through its SDK contract seam for the Electron Host. This new public validator is a compatible next-minor export. It validates the closed product-text structure before permitting spoken `token` fields; raw token/credential projections remain forbidden.

Protected synthesized audio artifacts now retain the existing Runtime SpeechAlignment as a dedicated typed optional field. Matching Runtime, SDK, Kit and native builds are required; WORD results cannot silently lose timing. Zero milliseconds remain present, unknown units and malformed tokens fail closed, and raw credentials remain forbidden. This is a compatible public type widening staged for the next minor; this local development delivery does not publish a new package version.

Embedding requests add optional positive integer `dimensions` in the core AI client and protected `text-embed` spec. Use matching Runtime, SDK, Kit and native builds. The selected Runtime implementation admits the requested width; the first shortening group is OpenAI `text-embedding-3-small` and `text-embedding-3-large`. Omit the field for the captured native default. Unsupported compositions and out-of-range widths fail before execution. Returned vectors must match the input count and requested width, remain finite and include their Runtime-owned `spaceId`. Missing provider usage remains unspecified.

Protected music generation adds owned videoReference, and speech synthesis adds separate identityAudio/performanceAudio with exact transcript. Consume matching Runtime, Kit and native builds. Resource input profiles explicitly declare video mode and Driver speech limits; missing declarations fail closed. Reference-conditioned VoxCPM is currently supported by the Windows standard backend, without creating a reusable VoiceAsset.

Protected text steps accept nonempty App-owned initiation/continuation context
without a user-role message. Roles and content are unchanged; no filler turn is
inserted. Empty and opaque-only input, malformed tools, media placement and
capacity violations still fail. The narrow candidate API keeps its own contract.
Use matching SDK, native and Runtime builds; exact Driver support still applies.

The protected Local App text model and Vercel factory accept an explicit
`executionMode: 'sync'`. This uses the existing cancellable Scenario execute
carrier for tasks whose tools or strict schema are admitted only in SYNC. The
default remains STREAM. In SYNC, model events carry the complete ordered result
only after execution finishes; no automatic retry or mode switching occurs.
Tool loops, request controls and continuity storage remain caller-owned.

The Local App text binding accepts ordered system messages beyond the initial
prefix and preserves their role and position. It requires matching Runtime and
Kit native carrier builds. Exact Driver admission still decides support; an
unsupported ordered-system combination fails before dispatch. Message counts,
byte limits and the requirement for a user message are unchanged.

Ready text.generate effective selections may carry `textReplay` with exact accepted carrier kind/version/execution modes. Missing facts remain unconfirmed; an empty acceptedCarriers list means no acceptance. It is informational, and each inference still validates the captured request.

These package-local notes cover the App-facing changes relevant to the current
published baseline. They are not a complete reconstruction of older releases.

## 0.19.0: upgrading from 0.15.0

0.15.0 is the last SDK published before 0.19.0. SDK 0.16.0, 0.17.0, 0.18.0 and
0.18.1 were development numbers that never reached npm, so every section above
"0.15.0" applies when upgrading from 0.15.0, including those marked "next
minor". Use SDK 0.19.0 with Kit and its native package 0.16.0, Vercel adapter
0.3.0, Rust shell crates 0.8.0 and the matching Runtime. The Conversation work
fields and `conversation.listToolCalls` / `submitToolResult` described under
0.17.0 were replaced before 0.19.0 and need no migration from 0.15.0.

Account and Connector mutation replies can carry `auditDiagnostic` while the effect remains committed. Preserve that result and do not retry the mutation because its audit record failed. Connector inventory consumers can receive these diagnostics through `onAuditDiagnostic`. Local environment plans additionally accept `{ mediaCodec: true }` for the shared audio/video component; this selector excludes capability and candidate selectors and still requires explicit plan confirmation.

Required changes from 0.15.0:

- A custom standard-shell carrier implements the exact `activity` namespace,
  `agentWork`, `integration` and `agents.getIntroduction`, carries Integration
  call `targetDisplayName` and `accountLabel`, and carries Local-App media bytes
  as `Uint8Array` (0.16.0, 0.19.0 and next-minor sections). Kit 0.16.0 is the
  carrier that does this.
- Pass and read Local-App media bytes as `Uint8Array`; JSON `number[]`,
  `Float64Array` and `DataView` are rejected (Local-App media bytes).
- Adopt the typed `musicGeneration` result; the old prior-audio extension is
  rejected (0.16.0).
- LocalAgent references carry the required `agentBinding` and
  `activityAgentRef`. Persist a binding only to match a fresh
  `agents.listReferences()` result and use its fresh `agentHandle` (0.17.0,
  0.19.0).
- Declare `app.activity` before using `client.activity`, and register the
  `agent.work` declaration before using `agentWork` (0.16.0, 0.19.0).
- A host that signed in the retired Codex Connector implements the new
  connector auth acquisition host, and `deleteConnector()` callers or
  implementations use its result (ChatGPT plan sign-in).

## Typed text failures (next minor, development)

- `runNimiTextTurn`, `runNimiTextGenerate` and `streamNimiTextResponse` report
  a failure under the owner's typed `reasonCode`. Before, an error from the
  standard-shell carrier was reported under the carrier's transport category
  in `code`, so a Runtime refusal such as `ai-text-behavior-unsupported` read
  as `runtime-permission-denied`.
- `streamNimiTextResponse` rethrows an owner `NimiError` unchanged, keeping
  its `traceId`, `retryable`, `actionHint` and interruption. It creates a new
  `NimiError` only for other failures, and then keeps their `actionHint` and
  Runtime or Realm source.

## ChatGPT plan sign-in (next minor, development)

- The only browser-managed Connector profile is `openai_chatgpt_plan`, signed
  in with Sign in with ChatGPT: dynamic client registration, a loopback
  callback on `127.0.0.1`, PKCE with state and nonce, and ID-token
  verification against OpenAI's published keys. The Codex device-code profile
  and the `openai_codex` provider are removed; an existing `openai_codex`
  Connector stays listed only so it can be deleted, and every other use fails
  typed.
- `NimiConnectorAuthAcquisitionNativeHost` changes shape. `proxyHttp`
  carries only the `authorization_code_exchange` POST to the profile token URL
  and the `jwks` GET to the profile key URL, and never follows a redirect.
  `oauthTokenExchange` and `sleep` are removed, with the
  `NimiConnectorAuthAcquisitionTokenExchangeInput` and `...Result` types.
  Hosts add `startAuthorizationCallback(request, signal)`,
  `hostIdentifier()` and optional `crypto`, and keep `openExternalUrl`,
  `now` and `log`.
- `NimiManagedConnectorCredentialRuntime` also needs `getConnector`. It reads
  only the issued client ID and account label for an explicit sign-in again.
- The acquisition request is `{ profileId, connectorId?, label? }`; omit
  `connectorId` to create the Connector on the first sign-in. The pending state
  is `{ authorizationUrl, expiresInSeconds }`, and the result adds
  `accountLabel`. Failures throw `NimiConnectorAuthAcquisitionError` with a
  typed `code`: `AUTHORIZATION_DENIED`, `PLAN_USAGE_NOT_GRANTED`,
  `AUTHORIZATION_INVALID`, `REGISTRATION_UNAVAILABLE` or
  `BROWSER_UNAVAILABLE`.
- Connector projections add `accountLabel` from the Runtime
  `oauth_registration` projection. No token material crosses.
- Runtime renews the plan credential itself, and the SDK never refreshes it.
  An ended sign-in fails with `AI_CONNECTOR_CREDENTIAL_MISSING` and action hint
  `NIMI_CHATGPT_PLAN_REAUTHORIZE_ACTION_HINT`; a plan usage limit fails with
  `AI_PROVIDER_RATE_LIMITED` and `NIMI_CHATGPT_PLAN_MANAGE_USAGE_ACTION_HINT`.
  Use `nimiProviderUsesChatGPTPlan(provider)` to say near model choice that
  usage counts toward the plan, and link people to
  `NIMI_CHATGPT_PLAN_USAGE_URL`.
- `connectorInventory.deleteConnector()` resolves to `{ actionHint }` instead
  of `void`. `NIMI_CHATGPT_PLAN_REVOCATION_UNCONFIRMED_ACTION_HINT` means the
  Connector and its saved sign-in were deleted but OpenAI did not confirm the
  sign-out. Implementations of `NimiRuntimeConnectorInventoryClient` return the
  new result.

## Runtime maintenance mode (next minor, development)

- `ReasonCode.RUNTIME_STORED_DATA_UNSUPPORTED` (767) is new. Runtime returns
  it when an owner refused the stored data in the selected data root. In that
  state Runtime serves only its maintenance surface and leaves that root
  unchanged.
- The host-only `RuntimeServiceControlService.GetRuntimeServiceState` is new.
  It reports `RUNTIME_SERVICE_MODE_ORDINARY` or
  `RUNTIME_SERVICE_MODE_MAINTENANCE` with that reason. Ordinary Apps never
  reach it.
- `NimiProductControlActivation` adds `reasonCode: 'DATA_ROOT_NOT_EMPTY'` and
  `actionHint: 'choose_new_empty_root'`. Only the maintenance replacement
  returns them, because it accepts only an absent or empty folder. Exhaustive
  switches over these unions need the new cases.

## Loadout recipe context fit (next minor, development)

- `NimiLoadoutRecipe.recommendedOptions` is new and always present. It holds
  the options of the device recommendation: `defaultOptions`, plus the
  Driver's explicit context size when the model's own context capacity does
  not fit this device's memory.
- Recipe slots add optional `recommendedContextFit` for the recommended
  model, and offers add optional `contextFit`
  (`authoredContextSize`, `recommendedContextSize`, `recommendedOptions`).
  They are absent when a model has no context evidence or does not fit.
  Write `recommendedOptions` as given; do not build Driver option keys.
- Omitted context size still means the model's automatic capacity, and saved
  Loadouts are unchanged. Recipe fixtures typed as `NimiLoadoutRecipe` need
  the new `recommendedOptions` field.

## Local-App media bytes (next minor, development)

- Local-App media bytes are exact `Uint8Array` views on the standard shell:
  inline Job audio (`speech-transcribe` and `audio-separate` `audioSource`,
  `voice-create` `referenceAudio`), `NimiLocalAppScenarioArtifact.bytes`,
  artifact upload and read, Conversation attachment upload, artifact read and
  voice transcription. JSON `number[]` bytes, `Float64Array`, `DataView` and
  other views are rejected; there is no compatibility path. Pass the audio
  you already hold as a `Uint8Array` and read artifact bytes as one.
- The SDK sends a detached copy of the view's own byte range, so a view into a
  larger buffer does not carry that buffer across IPC and later writes do not
  change a submitted request. Size limits are unchanged.
- Custom standard-shell carriers must accept and return these fields as
  `Uint8Array`. `isNimiLocalAppByteView`, `copyNimiLocalAppBytes` and
  `exactNimiLocalAppBytes` are exported for that check. Realtime audio frames
  (up to 64 KiB) and text continuity carriers keep their current shape.
- Rebuild SDK, Kit and the native carrier together.

## Embedding space identity (next minor, development)

- Direct `embedText` now returns the required Runtime-issued `spaceId` beside
  `embeddings` and rejects a result without a valid space ID. Indexing callers
  must keep this ID with each vector set and rebuild or isolate an index when
  the space changes; equal dimensions alone do not make vectors comparable.
- Typed result fixtures must add `spaceId`. The protected Local App carrier
  already included it; Kit's public result type now reflects that existing
  wire value.

## Shared Agent introduction (next minor, development)

- Add `agents.getIntroduction({ agentHandle })` under `agent.local` for every
  covered App, including Home. Rebuild Runtime, SDK, Kit and native carriers
  together; custom standard-shell implementations must supply this method.
- The result contains optional display facts and safe static media, without
  source identity. Source detail is not an App-side substitute for this call.
- Kit exports the shared introduction reader, display mapping and component.
  Home and Zhiyu now use the same projection; no Conversation is opened or
  generated to read the introduction.

## 0.19.0 — Integration and independent Agent work (development)

- Replace `conversation.send({ work })`, `conversation.listToolCalls` and
  `conversation.submitToolResult` with `agentWork.listReferences`, `start`,
  `get`, `status`, `listToolCalls`, `submitToolResult`, `cancel` and `subscribe`.
  Work uses an execution ID, never a Conversation anchor. The old fields and
  methods are rejected. Register the `agent.work` declaration and use fresh
  business Agent references after a real session change; work does not confer
  access to chat history.
- Add `integration` typed discovery, calls, provider and management methods.
  `invoke` returns an accepted call; query that call until its actual outcome,
  and cancel it when the consumer stops. An unconfirmed write must not be
  resent. Management remains restricted to the trusted Home owner.
- Integration call projections include `targetDisplayName` and `accountLabel`
  alongside the captured consumer name, timestamps and call ID. Empty display
  fields mean the name was not recorded; consumers must not replace historical
  attribution with a currently selected connection. Custom carriers and test
  fixtures must include both string fields.
- Agent references add required `activityAgentRef`, an account-scoped display
  correlation for Activity filters. It is never an Agent selector or permission.
- Upgrade Runtime, SDK 0.19, Kit/native npm 0.16 and Rust carriers 0.8 together.
  These local candidate versions do not claim public publication or product acceptance.

## Unreleased (0.18.1)

- Keep observing the Runtime activity-open stream while Desktop launches the
  source App. Source confirmation or the Runtime deadline can now finish the
  operation even if the launch acknowledgement remains pending; a launch result
  alone still never proves the source object opened. No API change.

## Unreleased (0.18.0)

- Add optional `conversation.interruptTurn({ expectedTurnId })`. Runtime atomically
  refuses `AGENT_TURN_NOT_ACTIVE` when that turn is no longer active, preserving
  any newer work from another App. Work-item stop controls should pass their
  recorded turn ID and refresh the snapshot on rejection. Omitting the field
  retains explicit current-Conversation interruption. Upgrade SDK 0.18, Kit and
  matching native 0.15 together before using the field.

## 0.17.0 (development)

- Breaking (0.x minor): LocalAgent references add the required `agentBinding`.
  Persist it only to match a fresh `agents.listReferences()` result after reopen;
  continue to use its fresh `agentHandle` for every operation. Bindings differ
  between registered Apps and accounts and never grant access.
- `conversation.send` accepts optional `work: { workId, instructions, sources,
  tools }`. Sources contain `sourceId`, `title`, `content`; tools contain `name`,
  `description`, `inputSchemaJson`. Runtime owns the selected LocalAgent's
  bounded tool loop and final Conversation commit. Poll
  `conversation.listToolCalls({ agentHandle, conversationAnchorId, turnId })`
  while the turn runs; dispatch each returned `callId` once and submit
  `{ ...scope, callId, resultJson, isError }` with `submitToolResult`.
  Only the initiating current session may receive or complete these calls.
  Never replay effects after reconnect or an indeterminate submission.
- Custom standard-shell implementations must add both Conversation methods.
  Upgrade SDK, Kit 0.14 and its matching native carrier together. Work is
  bounded to 64 KiB, 16 sources/tools, eight rounds and 32 KiB per tool result;
  interruption, expired sessions and invalid or incomplete batches fail closed.

## 0.16.0 (development)

- Add the synchronous `text-decide` execute variant (`NimiLocalAppTextDecideSpec`,
  `NimiLocalAppTextDecideResult`) with exact validation of the submitted questions
  and returned probability distributions. `ai.scenario.execute(spec, options)` now
  accepts `{ signal, timeoutMs }` for every variant: an abort settles as
  `OPERATION_ABORTED`, an elapsed deadline as `OPERATION_TIMEOUT`, and neither
  projects a late result. Add `AI_INPUT_LIMIT_EXCEEDED` and carrier helpers
  (`validateNimiLocalAppTextDecideShellSpec`, `validateNimiLocalAppTextDecideOutput`,
  `nimiLocalAppTextDecideSpecFromShell`). Host shells receive the carrier spec, whose
  JSON content is the SDK's `JSON.stringify` text. New exports (minor); update
  Runtime, SDK, Kit and the native carrier as one cohort.

- Add typed `audio.voice.convert` Local App spec and conversion projection with
  exact source/target identity checks, nested target reference ranges, the
  reported length relation (`EXACT` or `MODEL_FRAME_ROUNDING`) and duration
  delta. Canonical audio preparation may now name an explicit channel mode
  (`PRESERVE`, `MONO_TO_STEREO`, `STEREO_TO_MONO`) alongside the target sample
  rate; this is the only sanctioned rate or channel change. New exports (minor).

- Extend the protected `audio.separate` projection with owned-artifact sources
  and instrument parts (`DRUMS`, `BASS`, `OTHER`) beside vocals and background.
  Submission identity (`clientSubmissionId`) stays rejected for separation.

- Preserve asset-stream cancellation before the first chunk and during a pending
  read. Each returned body has one consumer; call its iterator's `return()` when
  abandoning an opened read, including after an App-level metadata mismatch.
  Update Kit with the corresponding native-stream close forwarding fix.

- AIConfig resource projections may carry `musicInput.generation` profiles for
  exact legal input combinations and bounds. Missing profiles mean unknown or
  inapplicable; Apps must not infer them from model labels. Submission remains
  authoritative, including combined context limits.

- Breaking (0.x minor): music generation now returns a typed `musicGeneration`
  with the mix reference, measured canonical PCM facts, seed when known,
  optional generated ABC score and explicit termination. Consumers must adopt
  the complete artifact set and distinguish a budget cutoff from a natural end.
  The old prior-audio extension is rejected. Use typed score, score conditioning,
  audio reference, seed and instrumental inputs; exact Drivers reject unsupported
  combinations. The common duration ceiling is 600 seconds, with stricter model
  limits retained. Inline ABC imports are at most 1 MiB and expire after 24 hours.
  Update Runtime, SDK, Kit and the native carrier as one cohort.

- Add `clientSubmissionId` to protected music Job submit options and
  `ai.scenarioJobs.lookupSubmission(id)` to recover a lost submission response
  without resubmitting. Runtime binds the full request to the current account
  and registered App, rejects conflicting reuse, and persists that binding
  with the Job. This minor widening requires matching Kit/native and Runtime;
  terminal music Jobs carrying this identity expose `recoveryExpiresAt` and
  retain the Job and actual outputs for 24 hours. Canonical audio uploads now
  require an `expiresAt` result from the matching Runtime. New work fails with
  `AI_MUSIC_RECOVERY_CAPACITY_EXCEEDED` when the 1024-record, 16-GiB temporary
  budget or disk headroom is exhausted; reads do not renew either lifetime.

- Add canonical audio preparation to the existing protected artifact upload.
  Apps may supply inline audio or an owned App asset / canonical artifact
  reference, receive measured sample-rate, channel, frame-count and duration
  facts, and use artifact adoption for results larger than the inline limit.
  Reference carriers require `audioPreparation: { profile: 'canonical-pcm-v1' }`;
  explicit resampling requires an already canonical WAV source. Basic inline
  uploads retain their existing size and MIME semantics.
- Export the finite upload carrier validators and audio input/result types.
  This compatible public API widening requires a minor release and matching
  Runtime plus Kit/native delivery. Source builds do not make older published
  packages support these inputs. Job retention and music model capabilities
  are separate changes, not implied by audio preparation.

- Breaking (0.x minor): the host-injected local-app `standardShell` now requires
  an exact `activity` namespace (`put`, `list`, `subscribe`, `markRead`, `open`,
  `openRequests.subscribe/complete`). Pair this SDK only with Kit 0.12.0 and the
  matching Runtime; custom carriers must implement the namespace and carry
  publisher `data` as opaque `dataJson` text.
- Add `client.activity` for the `app.activity` App Access domain: publish or
  update revisioned activity and todos in the App's own partition, list with
  baseline paging, subscribe to account changes, mark the displayed revision
  read, open a record's source object, and register `onOpenRequest` to confirm
  navigation in the source App. Only the handler's confirmation yields `opened`;
  a Host whose Desktop launch or focus fails still waits
  `NIMI_APP_ACTIVITY_LAUNCH_FAILURE_GRACE_MS` for a running source's confirmation.
- Add `createNimiAppActivityView` and `NimiAppActivityMergeState`: a filtered
  projection that merges pages and changes by the highest change sequence,
  keeps removed or filtered-out ids from resurrecting, and recovers every ended
  subscription with a fresh listing baseline, immediately clearing the prior
  session's records and rejecting its in-flight pages. It never marks anything read.
  Listing pauses after `maxRecords` records per step: the snapshot then reports
  `hasMore: true` and `complete: false`, and `loadMore()` continues the same
  baseline.
- Declare `app.activity` in `nimi.app.yaml` `app_access` before using the
  client; undeclared calls fail closed.

## 0.15.0

Published as SDK 0.15.0 with Kit and its native packages 0.11.0 and Rust shell
crates 0.6.0. These notes were drafted as 0.14.0; SDK 0.14.0, Kit/native 0.10.0
and Vercel adapter 0.2.0 named below were never published.

- Preserve multiline transcription text through Local App Job projections,
  including empty pending/no-speech content, without relaxing metadata or NUL
  validation.

- Raise annotation capacity to 512 KiB input, 65536 tokens and a 16 MiB result
  without splitting the caller's document. The matching Runtime also admits
  DeepSeek V4 JSON-object generation through the existing App text interface.

- Add the Local `text-annotate` Job and immutable `textAnnotation` result:
  batch source documents, Unicode scalar token offsets, POS/dependency labels,
  head indices and sentence spans. Requires the matching Runtime and Kit/native
  candidate; older 0.14.0 development tarballs do not contain this addition.

- Add the Local `audio-separate` Job and paired `audioSeparation` artifact
  identities. Large output uses the existing owned artifact adoption and App
  asset streams. The initial Runtime Driver is HTDemucs; read its documented
  duration/input limits before composing long media.

- Carry typed speech transcription through Local App jobs, Runtime scenario
  adapters and generation results. Preserve original text, detected language,
  actual alignment units and explicit no-speech results. See the package README
  for resource limits, supported controls and chunk offsets.
- Requires matching Runtime, Kit/native 0.10.0 and Rust shell crates 0.6.0.
  Custom carriers must preserve the optional `transcription` projection. Empty
  no-speech text is valid only with the explicit typed no-speech result; an
  empty inference response is not success. `transcriptionText` remains derived
  from the same result for existing text-only consumers.
- These are local development package versions. Publication is a separate step
  after consumer acceptance. Vercel adapter 0.2.0 updates its SDK peer to 0.14.0;
  its text model behavior is unchanged.

## 0.13.0

- Local App model turns accept ordered user text and image URL/artifact parts.
  Use `filePart` with HTTP(S) image URLs or upload local image bytes through
  `client.ai.artifacts.upload` and pass an `artifact-ref`. Inline data URLs,
  file paths, non-image media and media in assistant/system messages are not
  admitted by this binding. The narrow text-candidate API is unchanged.
- This widens the public Local App contract and requires Kit/native 0.9.0,
  Rust shell crates 0.5.0 and the matching Runtime. Custom carriers must retain
  optional user `parts`; older carriers cannot provide image support.
- The Vercel AI SDK 6 adapter uses the independent
  `@nimiplatform/sdk-adapter-vercel-ai` 0.1.0 package. Its Local App factory
  preserves tool loops and opaque continuity through framework message history.
- Include the public App integration guide and these migration notes in the
  npm package, so consumers can discover the supported surfaces without a
  Nimi source checkout.

## 0.12.0

- Add `createNimiLocalAppTextModel` from `@nimiplatform/sdk/ai` over the protected
  App text client. Requires Kit/native 0.8.0 and the matching Runtime contract.
- Support function tools, ordered output/ToolCall/ToolResult transcript, tool
  choice and structured response formats for this text-only Local App input.
- Preserve opaque reasoning continuity through stream events and later turns.
  Custom collectors must retain its order and bytes without exposing it as
  display reasoning; use the standard collector when no custom one is needed.
- `generateText` collects one cancellable stream. Neither it nor `streamText`
  executes App tools or owns a multi-step workflow. Update exhaustive event
  handling for complete tool calls, continuity and the required item indices.
- App AIConfig selects an eligible execution configuration. Unsupported input,
  interrupted streams and incomplete output remain explicit failures.

See the [0.12.0 source tag](https://github.com/nimiplatform/nimi/tree/sdk/v0.12.0)
and the installed declaration files for the exact versioned API.
