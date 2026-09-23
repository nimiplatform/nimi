# nimi-shell-protected-local-node

Host-only Node-API projection of the shared Nimi protected carrier for Electron
main processes.

The current public Windows npm artifact is built for D2 Runtime using the
existing `windows-source-local-development` Cargo feature. It supports the
shared caller contract for separately admitted installed and Developer Mode
Apps, with their source/admission distinction preserved by Runtime. The formal
production Runtime carrier and its signer-SPKI verifier remain separately built
and fail closed; publishing a D2 artifact does not change that service boundary.

The addon exposes exact Local App operations, including:

- session status and renewal;
- App AIConfig reads and revision-checked configuration;
- narrow text candidate generation, and model turns with tools, structured
  output, ordered continuity and user image parts;
- Realm world-core list and create;
- App storage read, write, and remove;
- session-scoped Agent reference listing; and
- typed Conversation open, send, attachments, interrupt, snapshot, and stream lifecycle;
- App-owned Artifact upload and reads;
- bounded `agent.local` embodiment snapshot and ordered stream lifecycle;
- App activity put, list, change subscription, mark-read, source open, and the
  source App's open-request subscription and completion, with streams pulled
  through `localAppRealtimeStreamNext` / `Close` (the source-open stream's
  Host-private open request id stays in the Electron main process);
- shared LocalAgent-subsystem AIConfig read and overwrite; and
- Agent autonomy snapshot/update and presentation snapshot/commit with independent revision CAS.

Runtime derives the App AIConfig owner and every Agent authority input from the
authenticated Local App process binding. Agent operations accept only opaque
session-scoped handles and typed configuration inputs. The shared AIConfig
surface carries no Agent handle, while presentation commit returns the bounded
previous profile needed for restore. Image model inputs use HTTP(S) URLs or
owned Artifact references, not inline data URLs or local paths. Runtime checks
the current protected App owner before reading an Artifact. These are exact
purpose-specific methods, never a generic Runtime or messaging proxy.
Embodiment results carry only Runtime-owned activity, emotion, semantic
posture, provenance, and bounded voice-timing correlation; renderer motion,
lipsync, audio clock, replay, and backend diagnostics are not native exports.

For Nimi Desktop it additionally exposes the generated first-party product
families:

- `desktopMachineProductUnary` and `desktopMachineProductStreamOpen`;
- `desktopAccountProductUnary` and `desktopAccountProductStreamOpen`; and
- request-keyed `desktopFirstPartyProductUnaryCancel` for active machine, account, and bundled Avatar unary work; and
- internal `desktopFirstPartyProductUnaryRelease` cleanup after the Node promise has observed completion; and
- shared opaque `desktopFirstPartyProductStreamNext` / `Close` lifecycle calls.

Each method is converted to the generated profile-and-kind-specific native enum
before the verified channel opens. Machine and account profile markers are fixed
by the named native entrypoint; renderer input cannot select them. Unrelated,
wrong-profile, and wrong-kind Runtime methods fail closed.

Every call returns either `{ status: "ok", value }` or
`{ status: "error", reasonCode, retryable, reasonMetadata? }`. Error metadata is
a bounded allowlisted diagnostic projection; unclassified bare gRPC failures carry
the numeric `grpc_status_code` without exposing the status message. The addon has no arbitrary Runtime
proxy and never returns an endpoint, token, principal, record, permission decision, launch,
process, session proof, account identifier, or Runtime boot epoch.
