# Kit Protected Local Host Carrier

`kit/shell/protected-local` is the shared native Rust boundary for protected
Windows and macOS Runtime transports. Production retains its independently
admitted fixed-service topology; source D2 uses a per-user Runtime with thin
current-user pipe/socket and process adapters. Both expose the same two
connection-bound surfaces:

- Desktop control for fixed-service account, Developer Mode, exact product
  control, and exact Desktop runtime-consumer unary operations; and
- the common third-party Local App carrier.

The Local App carrier connects only to the active profile's native protected
endpoint, verifies the live Runtime process under that profile, performs
the request-empty `OpenLocalAppSession`, and retains the verified process,
channel, and Runtime boot epoch privately. On macOS the trust
boundary is the fixed root-owned Runtime path and socket, `LOCAL_PEERTOKEN` /
`LOCAL_PEERPID`, exact PID/EUID/start and exit/exec liveness, and strict
SecCode validation. The local-development build requires an ad-hoc signature,
exact signing identifiers, and hardened runtime without consuming a Team ID,
Apple certificate chain, or notarization result. The mutually exclusive
production build requires its compile-time Team ID, Apple trust anchor,
Developer ID, and notarization policy. Neither path consumes release, role,
compatibility, artifact-hash, or CDHash records.
Windows source D2 derives owner-only named-pipe endpoints from the current OS
user, binds the pipe server to Desktop's exact child Runtime process, and keeps
production service, installer, signing, and update trust unchanged outside that
feature. Native profile choice adds no App access or reason semantics.

Its complete admitted Local App operation surface is session status, three
protected principal-partitioned JSON storage operations, exact WorldCore
list/create, the selected RuntimeAgent conversation operations, bounded
Runtime-selected foreground text candidates, owner-free whole-object App
AIConfig get/overwrite, shared LocalAgent-subsystem AIConfig get/overwrite,
Agent autonomy snapshot/update, and Agent presentation snapshot/commit.
Runtime derives both AIConfig owners from the protected Local App session. The
shared Agent AIConfig surface carries no individual Agent handle; autonomy and
presentation accept only an opaque session-scoped handle and independent
revision CAS. Presentation commit projects the previous profile needed for
restore. AI profile mutation and Artifact operations are not exposed.

The crate never exposes a generic method-id/bytes proxy, endpoint, credential,
portable session proof, principal, record, grant, launch lease, process tuple,
account identity, or Runtime boot epoch. Immutable package admission remains
typed unavailable; only an already-bound `local_development` process can open a
positive Local App session at this checkpoint. Linux remains compile-only and
fails closed until its native trust carrier is admitted.
