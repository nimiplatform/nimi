# nimi-shell-protected-local-node

Host-only Node-API projection of the shared Nimi protected carrier for Electron
main processes. The addon exposes exact Local App operations, including:

- session status and renewal;
- read-only App AIConfig;
- text candidate generation;
- Realm world-core list and create;
- App storage read, write, and remove;
- session-scoped Agent reference listing; and
- typed text-only Conversation open, send, interrupt, snapshot, and stream lifecycle;
- shared LocalAgent-subsystem AIConfig read and overwrite; and
- Agent autonomy snapshot/update and presentation snapshot/commit with independent revision CAS.

Runtime derives the App AIConfig owner and every Agent authority input from the
authenticated Local App process binding. Agent operations accept only opaque
session-scoped handles and typed configuration inputs. The shared AIConfig
surface carries no Agent handle, while presentation commit returns the bounded
previous profile needed for restore. The addon exposes no AI profile mutation,
Artifact, or generic messaging surface.

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
