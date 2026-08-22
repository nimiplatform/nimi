# Kit Agent Center

`@nimiplatform/kit/features/agent-center` is the reusable Runtime Local Agent
Center surface.

It owns generic Agent Center layout, sections, state assembly, typed Runtime
adapter contracts, failure states, disabled states, and narrow layout behavior.
It does not own Runtime lifecycle, Runtime Agent model-settings persistence, memory
truth, SDK transport, app shell chrome, provider secrets, or app-specific
developer tools.

Runtime truth enters through a nominal `AgentCenterSession` created by the
sealed first-party or covered-App factory. The React component accepts no
state seed, carrier adapter, access posture, or raw Agent identity. Apps
must not pass arbitrary feature panels or reconstruct Runtime execution truth
inside Agent Center.

Appearance replacement is a one-step auto-save flow. After an explicit warning,
the Shell picker returns opaque references plus imported bytes; the adapter sends
those materials in one Runtime presentation commit. Validation or commit failure
leaves the current appearance unchanged. A successful commit exposes the prior
Runtime profile as a typed one-step restore target.

Avatar rendering is a committed-effect view, not a candidate preview gate.
`AgentCenterAvatarPreviewAdapter` renders only the newly committed opaque profile;
renderer failure is reported distinctly from save failure and never rolls back or
relabels Runtime truth.

## Avatar preview adapter

Hosts implement `AgentCenterAvatarPreviewAdapter.resolvePreview` by relaying the
Runtime-materialized projection of the already committed opaque avatar and
material references into the Avatar renderer. The adapter does not decide
structural compatibility or persist presentation state.

A `ready` result must return the `avatar_preview_service` tier, the matching
`live2d` or `vrm` backend, the exact avatar and preview-material references,
an Avatar-controlled same-origin path or same-origin blob preview image,
positive finite `visiblePixels`, and `nonPlaceholder: true`. Non-ready results
must return `nonPlaceholder: false` and a reason. Visible-pixel and renderer
failure evidence is a client-side UX success gate only; it is never Runtime
commit authority.

Hosts can import the adapter types and
`isAvatarControlledPreviewSurfaceRef` from
`@nimiplatform/kit/features/agent-center/headless`. The controlled-surface
predicate is owned by Avatar headless and shared by both features.

## Bounded Source and Context Status

Agent Center accepts only the SDK-decoded `NimiRuntimeAgentSourceContextStatus`
and `NimiRuntimeAgentTurnContextSummary` types. The headless mapper reduces
those projections to five product states: `ready`, `blocked`, `truncated`,
`failed`, and `unknown`. Missing context before the first composed turn remains
`unknown`; it does not become a false success and does not block the first turn.

`createFirstPartyAgentCenterSession` can load the two bounded projections through
`loadSourceContextStatus` and `loadTurnContextSummary`. The optional
`conversationAnchorId` in its load input selects the turn summary to read; it
does not grant context assembly or mutation authority.

Overview shows a human-readable, read-only status. Advanced shows only the
admitted `CharacterSourceRefV3` identity (`worldCharacter | personaCharacter`),
source/snapshot hashes, coverage, and turn lane/count/budget/digest summaries. Raw
source or world content, prompt/lane text, transcript/private memory, packet or
proof material, provider payloads, and tool arguments/results are not Agent
Center props or state. The Behavior section remains exclusively Runtime
autonomy configuration.

## Manager Session

The AIConfig section mounts the public `model-config` owner surface in
`shared-local-agent-ai-config` mode. The optional first-party `cloudAIConfig`
seam supplies Runtime-catalog implementation/target choices and account-scoped
Connector inventory. `loadLocalSelections` supplies read-only
Machine owner context; Agent Center cannot mutate those selections. Cloud target
confirmation, off-machine data movement, provider cost, and the impact on every
LocalAgent and proactive task remain explicit.

Each mounted `AgentCenter` consumes exactly one `AgentCenterSession`. The
session owns its retryable snapshot, refresh, model/autonomy/appearance
mutations, mutation write-back, and independent model-settings,
autonomy, and presentation revisions. A shared AIConfig read returning
`AI_CONFIG_NOT_FOUND` is canonical not-configured state, not Runtime-offline;
the first explicit overwrite may create it atomically. Other read failures stay
degraded and fail closed. Sections call the session only and never branch on a
carrier kind.

`createFirstPartyAgentCenterSession` binds protected first-party dependencies.
Its action availability is projected from the dependencies actually connected;
missing autonomy, memory, or appearance modules are unavailable
rather than reported as successful.
`createAppAgentCenterSession({ handle, client })` binds the SDK-owned nominal
`NimiLocalAppAgentHandle` directly to the existing six-operation
`NimiLocalAppAgentConfigureClient`. Shared AIConfig reads and overwrites carry
no Agent handle; autonomy and presentation use the same current handle. Kit
does not revalidate SDK enum or numeric inputs, reconstruct raw LocalAgent or
account identity, or expose a permission-request lifecycle. Typed owner and
operation failures keep their exact Agent Center availability reason and route
recovery through retry or the host-provided Runtime owner-surface handoff.

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
