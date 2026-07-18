# Kit Agent Center

`@nimiplatform/kit/features/agent-center` is the reusable Runtime Local Agent
Center surface.

It owns generic Agent Center layout, sections, state assembly, typed Runtime
adapter contracts, failure states, disabled states, and narrow layout behavior.
It does not own Runtime lifecycle, Runtime Agent AI Config persistence, memory
truth, SDK transport, app shell chrome, provider secrets, or app-specific
developer tools.

Runtime truth must enter through `@nimiplatform/kit/core/sdk-contract` or the
typed adapters exported by this feature. Host-local appearance/avatar custody is
bounded to `AgentCenterAppearanceAdapter`; apps must not pass arbitrary feature
panels or reconstruct Runtime execution truth inside Agent Center.

The shell appearance bridge resolves validated preview material only. Rendered
preview readiness enters separately through `AgentCenterAvatarPreviewAdapter`;
Shell material refs must never be relabelled as Avatar preview artifacts.
Runtime presentation mutation is the selection commit boundary, and adapter
operations are serialized against its committed revision before any destructive
Shell cleanup runs.

## Bounded Source and Context Status

Agent Center accepts only the SDK-decoded `NimiRuntimeAgentSourceContextStatus`
and `NimiRuntimeAgentTurnContextSummary` types. The headless mapper reduces
those projections to five product states: `ready`, `blocked`, `truncated`,
`failed`, and `unknown`. Missing context before the first composed turn remains
`unknown`; it does not become a false success and does not block the first turn.

`createRuntimeAgentCenterAdapter` can load the two bounded projections through
`loadSourceContextStatus` and `loadTurnContextSummary`. The optional
`conversationAnchorId` on `AgentCenterRuntimeLoadInput` selects the turn summary
to read; it does not grant context assembly or mutation authority.

Overview shows a human-readable, read-only status. Advanced shows only the
admitted `CharacterSourceRefV3` identity (`worldCharacter | personaCharacter`),
source/snapshot hashes, coverage, and turn lane/count/budget/digest summaries. Raw
source or world content, prompt/lane text, transcript/private memory, packet or
proof material, provider payloads, and tool arguments/results are not Agent
Center props or state. The Behavior section remains exclusively Runtime
autonomy configuration.

## Before Building Locally

Read `.nimi/spec/platform/kernel/agent-center-contract.md`,
`.nimi/spec/platform/kernel/tables/nimi-kit-registry.yaml`, `DESIGN.md`, and
`kit/DESIGN.md` before changing this feature. Runtime SDK consumption must stay
behind `@nimiplatform/kit/core/sdk-contract`; app-specific surfaces belong in
the host app placement outside Kit Agent Center.
