# Kit Agent Center

`@nimiplatform/kit/features/agent-center` is the reusable Runtime Local Agent
Center surface.

It owns generic Agent Center layout, sections, state assembly, typed Runtime
adapter contracts, failure states, disabled states, and narrow layout behavior.
It does not own Runtime lifecycle, Runtime Agent model-settings persistence, memory
truth, SDK transport, app shell chrome, provider secrets, or app-specific
developer tools.

Runtime truth enters through a nominal `AgentCenterSession` created by the
canonical covered-App factory. The React component accepts no
state seed, carrier adapter, access posture, or raw Agent identity. Apps
must not pass arbitrary feature panels or reconstruct Runtime execution truth
inside Agent Center.

Appearance replacement is a one-step auto-save flow. After an explicit warning,
the Shell picker returns opaque references plus imported bytes; the adapter sends
those materials in one Runtime presentation commit. Validation or commit failure
leaves the current appearance unchanged. A successful commit exposes the prior
Runtime profile as a typed one-step restore target.

Avatar rendering is a committed-effect view, not a candidate preview gate.
The optional Host mechanics preview projects only the newly committed opaque
profile; renderer failure is reported distinctly from save failure and never
rolls back or relabels Runtime truth.

## Avatar preview adapter

Hosts may implement `AgentCenterHostMechanics.resolveCommittedPreview` by
relaying the already committed opaque avatar reference and presentation
revision into the Avatar renderer. The mechanics adapter receives no Agent or
account identity, does not decide structural compatibility, and cannot persist
presentation state.

A `ready` result must return the `avatar_preview_service` tier, the matching
`live2d` or `vrm` backend, the exact avatar and preview-material references,
an Avatar-controlled same-origin path or same-origin blob preview image,
positive finite `visiblePixels`, and `nonPlaceholder: true`. Non-ready results
must return `nonPlaceholder: false` and a reason. Visible-pixel and renderer
failure evidence is a client-side UX success gate only; it is never Runtime
commit authority.

Hosts can import the mechanics evidence types and
`isAvatarControlledPreviewSurfaceRef` from
`@nimiplatform/kit/features/agent-center/headless`. The controlled-surface
predicate is owned by Avatar headless and shared by both features.

## Bounded Source and Context Status

Agent Center accepts only the SDK-decoded, identity-free Manager snapshot. The
headless mapper reduces its source and context projections to five product
states: `ready`, `blocked`, `truncated`, `failed`, and `unknown`. Missing
context before the first composed turn remains `unknown`; it does not become a
false success and does not block the first turn. The optional
`conversationAnchorId` selects the Manager context summary to read and grants
no context assembly or mutation authority.

Overview shows a human-readable, read-only status. Advanced shows only the
canonical Manager snapshot's lifecycle/execution/status/emotion, source
coverage and lorebook counts, and context lane/budget/truncation/count/status
summaries. Raw Agent/account/source identity, source references, hashes,
prompt or reasoning material, internal generations, source or world content,
transcript/private memory, provider/model/storage detail, and tool
arguments/results are not Agent Center props or state. The Behavior section
remains exclusively Runtime autonomy configuration.

## Manager Session

The AIConfig section mounts the public `model-config` owner surface in
`shared-local-agent-ai-config` mode. Its ordinary `listOptions` manager supplies
Local and Cloud candidates for every covered App. The same shared-owner snapshot supplies effective Local
resource state; machine-default selection is not an Agent Center input. Cloud
data movement and provider-cost information remain visible without adding a
second Save gate.

Each mounted `AgentCenter` consumes exactly one `AgentCenterSession`. The
session owns its retryable snapshot, refresh, model/autonomy/appearance
mutations, mutation write-back, and independent model-settings,
autonomy, and presentation revisions. A shared AIConfig read returning
`AI_CONFIG_NOT_FOUND` is canonical not-configured state, not Runtime-offline;
the first explicit overwrite may create it atomically. Other read failures stay
degraded and fail closed. Sections call the session only and never branch on a
carrier kind.

`createAppAgentCenterSession({ handle, client, conversationAnchorId,
hostMechanics })` binds the SDK-owned nominal `NimiLocalAppAgentHandle`
directly to the canonical `NimiLocalAppAgentConfigureClient`. Its first read
must successfully load the bounded `manager.snapshot` together with shared
AIConfig, autonomy, presentation, and Memory before product actions become
available. Shared AIConfig reads and overwrites carry no Agent handle; Manager,
autonomy, presentation, and Memory use the same current handle. Kit
does not revalidate SDK enum or numeric inputs, reconstruct raw LocalAgent or
account identity, or expose a permission-request lifecycle. Typed owner and
operation failures keep their exact Agent Center availability reason and route
recovery through retry or the host-provided Runtime owner-surface handoff.

`hostMechanics` is a non-authoritative native seam. It may select an Avatar or
background into temporary custody and may return bounded preview evidence for
an already committed appearance. It receives no Agent handle or owner identity
and never commits product state; the same factory sends its typed selection
through `client.presentation.commit`. Call `session.invalidate()` (or
`session.dispose()`) before replacing the account, protected session, or Agent
handle. Invalidation permanently fences mutations and ignores late async
results from the retired session.

Agent Center ships its typed `en` and `zh` catalogs through the headless surface.
Hosts may mount `agentCenterLocaleResources` in an existing locale runtime or use
`createAgentCenterI18n`. Resolution is host `t()` override, active Kit catalog,
then the Kit English base. The removed copy-object props have no compatibility
path; app-specific wording belongs only in the injected i18n seam.

## Before Building Locally

Read `DESIGN.md`, `kit/DESIGN.md`, and the nearest owner contract before
changing this feature. Runtime SDK consumption must stay
behind `@nimiplatform/kit/core/sdk-contract`; app-specific surfaces belong in
the host app placement outside Kit Agent Center.
