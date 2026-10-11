# Avatar Visual Acceptance

The acceptance target is the Desktop-supervised Avatar window, its current protected App session, and actual output from the selected model. Fixture parsing, type checks, and local diagnostics prove their own covered behavior; none alone establishes this product path.

## Prepare the Real Path

1. Prepare matching Runtime, SDK/Kit, and a validated model with its capability profile.
2. Start Runtime and Home and complete Home sign-in.
3. Select the current Agent through a formal caller entry. Desktop and Runtime revalidate the launch intent and Conversation anchor.
4. Inspect the Desktop-supervised Avatar Electron window. The source development entry is `pnpm dev:avatar` at the repository root, but this command neither selects a default Agent nor proves session or presentation readiness.

Direct Vite, another product's renderer, or a fixture_not_verified preview cannot substitute for this target.

## Verify the Changed Behavior

- **Model presentation**: The selected Live2D or VRM model is visible in the real Avatar window, not an empty canvas or diagnostic placeholder.
- **Session and interaction**: The current Agent/Conversation binding is valid, and product interaction and backend presentation are ready.
- **Activity and expression**: Trigger the supported input changed by this work and observe that model's output; idle or another model does not prove it.
- **Window and hit regions**: When bounds, scale, or passthrough change, inspect the affected region and operation. Do not repeat unrelated checks for changes that do not affect them.
- **Failure and recovery**: Missing or unsupported input shows the applicable reason; recovery still requires valid session and presentation prerequisites.

A Live2D result covers the tested Live2D path, not VRM. Screenshots, logs, and automation explain what was actually observed. There is no current fixed pixel-grid/frame-count gate or recordCarrierVisualProof API.

## Existing Engineering Checks

Avatar typecheck and test cover types and the behavior actually exercised by their tests. The repository-root `pnpm smoke:avatar-live2d` checks the selected imported Live2D asset's structure, references, and file prerequisites. It does not launch an Avatar renderer or prove pixel output or voice interaction.

Record the session, model, backend, and actual result relevant to the check. Mark unrun cases as unverified instead of filling them with fixture success or another renderer's evidence.

## Source Basis

- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [`apps/avatar/src/shell/renderer/App.tsx`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/App.tsx)
- [`apps/avatar/src/shell/renderer/app-shell/composition-state.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/app-shell/composition-state.ts)
- [`apps/avatar/scripts/smoke-agent-center-live2d.mjs`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/scripts/smoke-agent-center-live2d.mjs)
- [`apps/avatar/package.json`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/package.json)
