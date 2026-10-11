# Carrier Visual Acceptance

A **carrier** is the host surface responsible for rendering an embodiment — such as a viewport, canvas, or window widget where the character actually appears. The carrier visual acceptance contract determines whether a given embodiment package can be hosted and displayed on a specific carrier target.

## Acceptance Decisions

| Scenario | Evaluation Result |
| --- | --- |
| Embodiment matches carrier capabilities and requirements | Accepted: initialize and render |
| Embodiment exceeds carrier limits (e.g., complexity tier) | Rejected or degraded: fallback to an authorized simplified projection |
| Embodiment definition is malformed | Rejected: returns typed schema/contract error |
| Embodiment violates carrier security or policy rules | Rejected: returns typed policy error |

Carriers do not perform partial, unverified, or silent half-rendering. Every acceptance decision is evaluated through typed capability checks, deterministically producing an accepted, degraded, or rejected outcome.

## Why Carrier-Level Evaluation Matters

If embodiments could render unconditionally across any host surface, high-fidelity 3D assets designed for high-performance desktop carriers could overwhelm constrained mobile or embedded devices. Similarly, assets tailored for a specific backend (like Live2D) might be incorrectly mounted onto an incompatible 3D engine (like three-vrm).

The carrier acceptance contract formalizes what each carrier can host. Embodiments declare their requirements, carriers declare their supported profiles, and the platform verifies compatibility before invoking any rendering pipeline.

## Developer Scenarios

### 1. High-Detail Embodiment on a Constrained Carrier

A user installs an embodiment package with complex skeletal animations and high-resolution textures on a low-power device:

1. **Carrier declares capabilities:** The carrier declares supported backends, motion complexity tiers, and memory/asset bounds.
2. **Package inspection:** The carrier inspects the package manifest and resource descriptors.
3. **Acceptance evaluation:** The acceptance contract evaluates whether the package fits within the host profile.
4. **Fallback decision:** The full embodiment exceeds device limits; the contract transitions to an authorized degraded projection (such as a 2D snapshot or simplified animation tier).
5. **Typed notification:** The host surfaces a clear, actionable reason (e.g., `"Device profile does not meet minimum requirements for full motion tier"`).

The fallback is explicit and predictable, preventing silent crashes or incomplete visual artifacts.

### 2. Backend Mismatch Rejection

An embodiment requires a Live2D Cubism runtime, but the current carrier only supports VRM 3D:

1. **Acceptance check:** The carrier compares the package's backend kind against its supported engines.
2. **Rejection:** Detects backend mismatch (`live2d` requested, `vrm` available).
3. **Typed error:** Returns a structured error indicating unsupported backend.
4. **Clean boundary:** The carrier aborts before initializing renderer state or allocating WebGL contexts.

Discriminated unions ensure that backend mismatches are identified and handled prior to any render execution.

### 3. Hot-Reloading Updates During an Active Session

A creator publishes an updated embodiment package while an agent is currently active:

1. **Update signal:** A new package descriptor is received via the update channel.
2. **Re-evaluation:** The carrier evaluates the updated package against the active carrier contract.
3. **Compatible update:** If accepted, the carrier performs a smooth asset transition within defined transition bounds.
4. **Incompatible update:** If the new version exceeds capabilities, the carrier retains the existing working version or cleanly transitions to `degraded:embodiment-incompatible`.
5. **Session stability:** Active conversations and agent state are preserved without abrupt failures.

## Scope and Non-Goals

| Concern | Responsibility Boundary |
| --- | --- |
| Character identity | Managed by Realm; carrier only handles presentation |
| Execution context | Managed by Runtime and LocalAgent; carrier handles viewport rendering |
| Package authoring & mutation | Packages are read-only artifacts created by creators |
| Unbounded rendering | Carriers strictly adhere to declared resource and complexity limits |

## Source Basis

- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
