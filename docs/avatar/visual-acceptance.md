# Avatar Visual Acceptance

Visual acceptance targets the Desktop-supervised Avatar window, its active protected App session, and the actual rendering output from the selected model. Passing fixture parsing, type checks, or local diagnostics validates only those specific isolated layers; none of them alone confirms that the end-to-end product path is functional.

## Prepare the Real Path

1. Prepare a matching Runtime, SDK/Kit, and a validated model along with its capability profile.
2. Launch Runtime and Home, then complete sign-in within Home.
3. Select the target Agent through a formal caller entry point. Desktop and Runtime will revalidate the launch intent and Conversation anchor.
4. Inspect the resulting Desktop-supervised Avatar Electron window. While `pnpm dev:avatar` at the repository root serves as the source development entry, running this command neither selects a default Agent nor establishes session or presentation readiness.

Direct Vite previews, renderer windows from other products, or unverified fixture previews (`fixture_not_verified`) cannot substitute for this acceptance target.

## Verify the Changed Behavior

- **Model presentation**: The selected Live2D or VRM model must render visibly in the real Avatar window, rather than showing an empty canvas or a diagnostic placeholder.
- **Session and interaction**: The active Agent/Conversation binding must be valid, with interactive controls and backend presentation fully initialized.
- **Activity and expression**: Trigger the supported inputs affected by the current change and inspect that specific model's output; verifying idle postures or switching to another model does not validate the change.
- **Window and hit regions**: When adjusting bounds, scale, or click-through passthrough properties, verify the affected window regions and interactions directly. Do not repeat unrelated checks when changes do not touch them.
- **Failure and recovery**: Missing or unsupported inputs should present clear, applicable error reasons. Subsequent recovery still requires meeting valid session and presentation prerequisites.

Live2D verification results only validate the tested Live2D pipeline, not VRM. Use screenshots, logs, and automated test output to record what was genuinely observed. The system currently does not enforce fixed pixel-grid/frame-count gates or provide a `recordCarrierVisualProof` API.

## Existing Engineering Checks

Avatar's `typecheck` and `test` scripts verify static types and the specific execution paths exercised by those tests. Running `pnpm smoke:avatar-live2d` from the repository root checks the structure, asset references, and file prerequisites of the selected imported Live2D model; it does not launch an Avatar renderer, render actual pixels, or validate voice interaction.

Document the specific session, model, backend, and observed result relevant to each acceptance check. Mark unrun test cases as unverified rather than claiming product readiness based on mock fixture passes or evidence from other renderers.

## Source Basis

- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [`apps/avatar/src/shell/renderer/App.tsx`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/App.tsx)
- [`apps/avatar/src/shell/renderer/app-shell/composition-state.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/app-shell/composition-state.ts)
- [`apps/avatar/scripts/smoke-agent-center-live2d.mjs`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/scripts/smoke-agent-center-live2d.mjs)
- [`apps/avatar/package.json`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/package.json)
