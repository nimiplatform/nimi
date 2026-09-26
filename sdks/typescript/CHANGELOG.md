# SDK migration notes

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

These package-local notes cover the App-facing changes relevant to the current
published baseline. They are not a complete reconstruction of older releases.

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

## 0.14.0 (development)

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
