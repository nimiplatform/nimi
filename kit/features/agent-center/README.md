# Kit Agent Center

`@nimiplatform/kit/features/agent-center` is the reusable Runtime Local Agent Center surface.

## Ownership Boundary

- **Owns:** Generic Agent Center layout, sections, state assembly, typed Runtime adapter contracts, failure states, disabled states, and narrow layout behavior.
- **Does not own:** Runtime lifecycle, Runtime Agent model-settings persistence, memory truth, SDK transport, app shell chrome, provider secrets, or app-specific developer tools.

Runtime truth enters through a nominal `AgentCenterSession` created by the canonical covered-App factory. The React component accepts no state seed, carrier adapter, access posture, or raw Agent identity. Apps must not pass arbitrary feature panels or reconstruct Runtime execution truth inside Agent Center.

## Entry and Appearance Flows

### Bootstrap Entry (`AppAgentCenterEntry`)

`AppAgentCenterEntry` is the canonical formal-App bootstrap composition:

- A Host may supply the current non-authorizing Manager handle directly; otherwise, the entry lists minimal current-session Agent references and requires an exact handle choice.
- Each `LocalAgent` has a single persistent Conversation whose anchor (`conversationAnchorId`) provides continuity across Apps. `AppAgentCenterEntry` creates and disposes exactly one canonical Manager Session, pairs an optional `conversationAnchorId` only with the matching supplied handle, and never associates by display name, ordering, raw identity, or App-owned state.
- Its selector, loading, and failure copy is Kit-owned in English and Chinese.
- Hosts can retain the selected handle in their own navigation using `onSelectedAgentChange`. `resourcePackPlacementForAgent` binds an optional placement action to that exact handle; it must not reuse another partner's Conversation anchor. Listing or selecting a Manager does not open a chat.

### Appearance Replacement

Appearance replacement is a one-step auto-save flow. After an explicit warning, the Shell picker returns opaque references plus imported bytes, and the adapter sends those materials in one Runtime presentation commit. Validation or commit failure leaves the current appearance unchanged. A successful commit exposes the prior Runtime profile as a typed one-step restore target.

### LocalAgent Resource Pack

The Appearance section owns one shared `LocalAgent Resource Pack` card on every mount:

- Canonical selected/null state and selection-only Clear come from the same presentation snapshot/commit client.
- A non-Zhiyu mount exposes only the fixed `openZhiyuResourcePack` placement action and never selects candidate bytes.
- When the factory receives the specific `AgentCenterResourcePackTargetController` and identity-free Host picker, the Manager binds one copied `.nimipack` snapshot to the current Agent and presentation revision, exposes Preview/Cancel, and submits those exact Manager-owned bytes only after manual Apply.
- A successful commit is rendered from `presentation.readAsset`, not by promoting preview state. Clear never uses appearance restore-previous, and fallback keeps selected versus effective truth explicit without Pack history or automatic Apply.

### Committed Avatar Rendering

Avatar rendering is a committed-effect view, not a candidate preview gate. The optional Host mechanics preview projects only the newly committed opaque profile; renderer failure is reported distinctly from save failure and never rolls back or relabels Runtime truth.

## Avatar Preview Adapter

Hosts may implement `AgentCenterHostMechanics.resolveCommittedPreview` by relaying the already committed opaque avatar reference and presentation revision into the Avatar renderer. The mechanics adapter receives no Agent or account identity, does not decide structural compatibility, and cannot persist presentation state.

- A `ready` result must return the `avatar_preview_service` tier and an Avatar-controlled same-origin path or same-origin blob preview image for the matching committed backend, asset, and preview-material references.
- Non-ready results return a typed state and reason.
- Preview mechanics never add pixel checksums, placeholder claims, or Runtime commit authority.

Hosts can import the mechanics evidence types and `isAvatarControlledPreviewSurfaceRef` from `@nimiplatform/kit/features/agent-center/headless`. The controlled-surface predicate is owned by Avatar headless and shared by both features.

### 0.x hard cut (2026-08-30)

Committed-preview evidence no longer carries `visiblePixels`, `nonPlaceholder`, or `renderVisiblePixels`. There is no compatibility layer. Consumers must use the controlled `previewImageRef`, typed preview state, and the exact `backendKind`, `avatarAssetRef`, and `previewMaterialRef` binding.

## Bounded Source, Context, and Behavior

Agent Center accepts only the SDK-decoded, identity-free Manager snapshot. The headless mapper reduces its source and context projections to five product states: `ready`, `blocked`, `truncated`, `failed`, and `unknown`.

- Missing context before the first composed turn remains `unknown`; it does not become a false success and does not block the first turn.
- Passing `conversationAnchorId` selects the Manager context summary to read for that Agent's persistent Conversation without granting raw context-assembly or transcript-mutation authority to the host.
- **Overview** shows a human-readable, read-only status.
- **Advanced** shows only the canonical Manager snapshot's lifecycle/execution/status/emotion, source coverage and lorebook counts, and context lane/budget/truncation/count/status summaries.
- **Behavior** presents the current interaction, simulated history, retained intentions, and tentative future frames. Activity titles never imply external effects or user-task fulfillment, and current interaction has no invented end time or progress.

These read-only Manager source/context summaries do not expose raw Agent/account/source identity, source references, hashes, prompts or reasoning, internal generations, source/world content, transcripts, private Memory, provider/model/storage details, or tool arguments/results. Explicit Memory inspection and editing use their separate admitted management surface.

### Conversation Context Selection (State & Memory)

In **State & memory**, user-confirmed Conversation context selection adjusts where future history references begin and can optionally omit supplemental Memory and retrieval for that Conversation:

- **Scope and continuity:** Because each `LocalAgent` has one persistent Conversation, the selection affects subsequent turns with that Agent across all App surfaces while keeping existing messages readable on the same anchor. It preserves required character/App instructions and permissions.
- **Non-destructive boundaries:** It does not delete the original Conversation or stored Memory, turn Memory off, or send the current draft. It also does not cancel already accepted simulated life activities or control life planning's own Memory retrieval.
- **Guards:** Requires `agent.configure` access and must be rejected when the Agent is busy or the revision is stale.

### Autonomy, Extra Contact, and Token Budgets

Autonomous life (simulated lifecycle activity) and extra contact are controlled by independent switches:

- Ordinary replies and same-turn self-intentions remain available even when both switches are off.
- When extra contact is enabled, the Agent sends at most one unanswered follow-up message and then waits for the user's reply.

Background token limits distinguish between per-execution output caps and 24-hour total usage windows:

- **Per-execution output cap (`maxBackgroundOutputTokens`):** Caps the output tokens of each background generation. `0` uses the finite Runtime default; positive values set an explicit execution limit. An unsupported explicit limit fails that background execution without disabling user Conversation.
- **24-hour daily usage window:** Life planning, autonomous continuation, and new contact judgments share consecutive, fixed 24-hour usage windows anchored at `windowStartedAt`. Daily usage counts actual input plus output tokens (distinct from the single-call output cap and not a monetary cap). Setting an explicit `0` removes the daily limit.
- **Accounting and exhaustion:** Runtime refreshes usage before admission/accounting and during maintenance. Late results count when recorded, including canceled work, and configuration edits never reset usage. When the daily window is exhausted, Runtime prevents new background inference while already accepted simulated frames can still advance.

## Manager Session

### AIConfig and Voice Binding

The AIConfig section mounts the public `model-config` owner surface in `shared-local-agent-ai-config` mode:

- Its ordinary `listOptions` manager supplies Local and Cloud candidates for every covered App.
- The same Manager client supplies preset voice choices and bounded bindable custom VoiceAsset choices owned by the current protected session's account-plus-App tuple; VoiceAsset deletion remains outside Agent Center.
- An optional reference-voice journey receives the same canonical covered-App client, reads the exact Agent introduction sound sample (which may be a greeting or a dedicated demo), and on an explicit user action uses that App's configured `voice.create` ScenarioJob. It checks compatibility with shared speech settings, resumes retained submissions, and binds only a successful owner VoiceAsset through presentation CAS. Missing setup never changes a route or blocks text; no separate reference field, cloning registry, or raw provider handle is admitted.
- The shared-owner snapshot supplies effective Local resource state; machine-default selection is not an Agent Center input.
- Cloud data movement and provider-cost information remain visible without adding a second Save gate.

### Session Lifecycle and Mutation Rules

Each mounted `AgentCenter` consumes exactly one `AgentCenterSession`. The session owns its retryable snapshot, refresh, model/autonomy/appearance mutations, mutation write-back, and independent model-settings, autonomy, and presentation revisions.

- A shared AIConfig read returning `AI_CONFIG_NOT_FOUND` is canonical not-configured state, not Runtime-offline; the first explicit overwrite may create it atomically.
- Other read failures stay degraded and fail closed.
- Sections call the session only and never branch on a carrier kind.

`createAppAgentCenterSession({ handle, client, conversationAnchorId, hostMechanics, resourcePackTargetController })` binds the SDK-owned nominal `NimiLocalAppAgentHandle` directly to the canonical `NimiLocalAppAgentConfigureClient`:

- Its first read must successfully load the bounded `manager.snapshot` together with shared AIConfig, autonomy, presentation, and Memory before product actions become available.
- Shared AIConfig reads and overwrites carry no Agent handle; Manager, autonomy, presentation, and Memory use the same current handle.
- Kit does not revalidate SDK enum or numeric inputs, reconstruct raw LocalAgent or account identity, or expose a permission-request lifecycle.
- Typed owner and operation failures keep their exact Agent Center availability reason and route recovery through retry or the host-provided Runtime owner-surface handoff.

### Host Mechanics and Localization

`hostMechanics` is a non-authoritative native seam. It may select an Avatar, background, or Resource Pack immutable byte snapshot and may return bounded preview evidence for an already committed appearance. It receives no Agent handle or owner identity and never commits product state; the same factory sends its typed selection through `client.presentation.commit`.

Call `session.invalidate()` (or `session.dispose()`) before replacing the account, protected session, or Agent handle. Invalidation permanently fences mutations and ignores late async results from the retired session.

Agent Center ships its typed `en` and `zh` catalogs through the headless surface. Hosts may mount `agentCenterLocaleResources` in an existing locale runtime or use `createAgentCenterI18n`. Resolution order is host `t()` override, active Kit catalog, then the Kit English base. The removed copy-object props have no compatibility path; app-specific wording belongs only in the injected i18n seam.

## Before Building Locally

Read `DESIGN.md`, `kit/DESIGN.md`, and the nearest owner contract before changing this feature. Runtime SDK consumption must stay behind `@nimiplatform/kit/core/sdk-contract`; app-specific surfaces belong in the host app placement outside Kit Agent Center.
