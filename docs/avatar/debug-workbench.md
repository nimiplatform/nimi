# Avatar Backend Diagnostics

Local diagnostics inspect the selected model, capability profile, route, and presentation result without granting Runtime privileges. This is Avatar-internal tooling, not a separate third-party App diagnostic API.

## Current Result Shape

The internal factory returns AvatarDebugSession, not DiagnosticSessionResult:

| Field | Meaning |
| --- | --- |
| `debugSessionId` | Local diagnostic session ID |
| `probeId` and `probeKind` | Identity and kind of this evaluation |
| `avatarInstanceId` | Nullable instance reference |
| `avatarPackageRef` | Nullable package reference |
| `backendCapabilityProfileRef` | Nullable capability-profile reference |
| `backendKind` | live2d or vrm |
| `observedAt` | Observation timestamp |
| `evidence` | One AvatarDebugEvidence object, not an array |

Evidence contains evidenceId, evidenceKind, status, source, nullable reasonCode, and bounded refs. Status is passed, failed, unsupported, or invalid. Read the single evidence object rather than calling evidence.map. The backend field is backendKind, not backend.

## Interpreting a Result

An evaluation can check package descriptors, backend loading, profiles, route support, generated motion, expressions, lipsync, or carrier results. It proves only the object and conditions actually inspected. Structural or local diagnostic success does not establish a live App session, arbitrary model support, or another backend's acceptance.

Keep the returned reasonCode and refs on failure, then repair the implicated model or profile. Do not reinterpret unsupported as successful idle playback. The source below defines the actual return type and factory.

## Source Basis

- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [`apps/avatar/src/shell/renderer/avatar-debug/avatar-debug-session.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/avatar-debug/avatar-debug-session.ts)
- [`apps/avatar/src/shell/renderer/avatar-debug/contract.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/avatar-debug/contract.ts)
