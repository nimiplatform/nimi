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

## Before Building Locally

Read `.nimi/spec/platform/kernel/agent-center-contract.md`,
`.nimi/spec/platform/kernel/tables/nimi-kit-registry.yaml`, `DESIGN.md`, and
`kit/DESIGN.md` before changing this feature. Runtime SDK consumption must stay
behind `@nimiplatform/kit/core/sdk-contract`; app-specific surfaces belong in
the host app placement outside Kit Agent Center.
