# Walkthrough: Governed Auth Migration

A team asks Codex to replace a desktop-only authentication path with
the shared SDK and Kit auth surfaces. This is high-risk because it
changes token custody, runtime connectivity, and the user-facing shell.

The example shows how Codex-owned execution combines with Nimi Coding
truth, methodology, gates, and evidence.

## 1. Establish Authority

Codex reads the active platform, SDK, Kit, and desktop spec surfaces.
The preflight records:

| Field | Decision |
| --- | --- |
| `Spec Status` | Active auth and shell authority is present |
| `Authority Owner` | Platform auth contract plus SDK and Kit public surfaces |
| `Work Type` | Alignment; no authority redesign |
| `Parallel Truth` | Forbidden: Desktop cannot retain app-local token custody |

If those sources disagreed, implementation would stop until authority
converged.

## 2. Plan In Codex

Codex keeps the task plan in the app. It may delegate independent SDK,
Desktop, and verification reads to subagents, but there is only one task
owner and one completion state. The repository receives no copy of the
plan or progress cursor.

The implementation boundary is concrete:

- reuse the shared SDK auth client;
- consume Kit shell and auth primitives;
- remove the Desktop-local token path;
- preserve fail-closed behavior when runtime or auth is unavailable;
- verify both desktop and narrow layouts in the real app shell.

## 3. Implement Against Public Surfaces

Codex changes the SDK or Kit owner first when a required public surface
is missing. Desktop consumes those surfaces and does not add an internal
REST bypass, token store, or duplicate UI primitive.

Tests are added at the owning layer. They protect the public boundary
and the negative case, not only the successful sign-in path.

## 4. Run Deterministic Gates

Codex runs the affected SDK and Desktop tests plus repository boundary
checks. A gate result is evidence only when the real command ran and
returned its actual status.

If a validator detects an app-level auth bypass, the task remains open.
Codex fixes the owner violation and reruns the check.

## 5. Verify The Real Application

Codex launches the real Desktop shell and checks:

- signed-out, sign-in, signed-in, and auth-failure behavior;
- runtime and SDK connectivity;
- disabled and pending controls;
- desktop and narrow-screen layouts;
- long English and Chinese text;
- keyboard and accessibility behavior;
- console errors and rejected network operations.

Screenshots support visual review. DOM and runtime inspection establish
structure and state. Neither substitutes for the other.

## 6. Record Evidence And Complete

Contract-required local evidence records the commands, results, runtime
observations, and unresolved risks. It remains under `.nimi/local/**`
and does not become product authority or task state.

Codex marks its task complete only when the requested migration, owner
alignment, deterministic gates, and real-app acceptance all hold. The
durable outcome is simple:

| Surface | Durable result |
| --- | --- |
| `.nimi/spec/**` | Canonical auth and shell truth |
| SDK / Kit / Desktop | Aligned implementation |
| Scripts and tests | Regression protection |
| `.nimi/local/**` | Review evidence |
| Codex | Task progress and completion |

## Source Basis

- [`.nimi/spec/platform/kernel/package-authority-admission-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/package-authority-admission-contract.md)
- [`.nimi/contracts/high-risk-admission.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/high-risk-admission.schema.yaml)
- [`.nimi/contracts/prompt.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/prompt.schema.yaml)
- [`.nimi/contracts/worker-output.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/worker-output.schema.yaml)
- [`.nimi/contracts/acceptance.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/acceptance.schema.yaml)
