# Avatar Backend Diagnostics

Local diagnostics inspect the selected model, capability profile, route, and presentation result without granting Runtime privileges. This is Avatar-internal tooling, not a separate third-party App diagnostic API.

## Current Result Shape

The internal factory returns `AvatarDebugSession`, not `DiagnosticSessionResult`:

| Field | Meaning |
| --- | --- |
| `debugSessionId` | Local diagnostic session ID |
| `probeId` and `probeKind` | Identity and kind of this evaluation |
| `avatarInstanceId` | Nullable instance reference |
| `avatarPackageRef` | Nullable package reference |
| `backendCapabilityProfileRef` | Nullable capability-profile reference |
| `backendKind` | `live2d` or `vrm` |
| `observedAt` | Observation timestamp |
| `evidence` | Single `AvatarDebugEvidence` object, not an array |

`evidence` contains `evidenceId`, `evidenceKind`, `status`, `source`, nullable `reasonCode`, and bounded `refs`. `status` is `passed`, `failed`, `unsupported`, or `invalid`. Read the single `evidence` object directly rather than calling `evidence.map`. The backend discriminator field is named `backendKind`, not `backend`.

## Interpreting a Result

An evaluation can check package descriptors, backend loading, profiles, route support, generated motion, expressions, lipsync, or carrier results. It proves only the object and conditions actually inspected. Structural or local diagnostic success does not establish a live App session, arbitrary model support, or acceptance by another backend.

Retain the returned `reasonCode` and `refs` on failure, then repair the implicated model or profile. Do not reinterpret `unsupported` as successful idle playback. The source references below define the actual return types and factory implementation.

## Source Basis

- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [`apps/avatar/src/shell/renderer/avatar-debug/avatar-debug-session.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/avatar-debug/avatar-debug-session.ts)
- [`apps/avatar/src/shell/renderer/avatar-debug/contract.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/avatar-debug/contract.ts)
