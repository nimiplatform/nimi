# Carrier Visual Acceptance

A **carrier** is the host surface—currently the standalone desktop Avatar window and viewport—where an embodied character is rendered. Carrier visual acceptance defines how Avatar validates rendering backends, checks model integrity, manages renderer states, and gates user interaction.

## Backend Selection and Validation

Avatar currently supports two rendering backends: **`live2d`** and **`vrm`**. A single Avatar factory validates the backend kind before initializing any graphics pipeline:

| Input Condition | Acceptance Outcome |
| --- | --- |
| Validated `live2d` or `vrm` kind with complete assets | Accepted: initializes the matching backend branch |
| Unknown, ambiguous, or unvalidated backend kind | Rejected: aborts without substituting a placeholder branch |
| Missing, invalid, or unparseable model resources | Unavailable: fails cleanly without reporting success via placeholder or fallback materials |

## Asset Integrity Requirements

Carriers do not perform silent half-rendering or mask broken packages with substitute assets:

- **Strict Live2D validation**: A Live2D package must provide a single `model3` definition along with all required `MOC3` data, textures, and declared resources. If any required file is missing, invalid, or fails to parse, the carrier cannot render the character and never reports success using placeholder or fallback materials.
- **Product readiness gating**: Product interaction is closed whenever no model is loaded or the rendering backend is not yet ready. Rendering a development fixture does not count as product `ready`.

## Renderer States and Bounded Fallbacks

During execution, the carrier branch (`backend-branch.ts`) tracks presentation through four states:

- `loading`: Validating and loading the backend and model resources.
- `ready`: Backend presentation is ready. Product interaction also requires a valid App session, Runtime binding, driver, and model conditions.
- `recovering`: The backend is internally recovering from a transient rendering fault.
- `unavailable`: Validation failed, required assets are missing, or the backend cannot render.

**What fallback means in practice:**
- **Geometry bounds (`surfaceBounds`)**: When viewport or window geometry needs adjustment, the carrier can fall back to configured, bounded `surfaceBounds`. It does **not** automatically convert a high-complexity 3D VRM model into a low-poly mesh or a 2D snapshot.
- **Transient fault recovery**: Temporary rendering glitches are handled internally by the active backend (`recovering`), rather than hot-swapping incompatible packages or mutating model definitions.

## Responsibility Boundaries

Avatar is an ordinary governed application without special privileges. Semantic identity, dialogue, and presentation truths remain with their respective upstream owners:

| Concern | Responsibility Boundary |
| --- | --- |
| Character identity & relationships | Owned by Realm |
| Agent execution & dialogue sessions | Owned by Runtime |
| Long-term memory | Owned by Cognition |
| Visual rendering & viewport bounds | Handled locally by the Avatar carrier |

A carrier rendering failure only indicates that visual presentation is unavailable—it neither proves the underlying Agent is offline nor proves the Agent is online. Carrier unavailability never rewrites Agent identity, memory, or session state.

## Source Basis

- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [`apps/avatar/src/shell/renderer/carrier/backend-branch.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/carrier/backend-branch.ts)
