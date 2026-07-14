# Kit Protected Local Host Carrier

`kit/shell/protected-local` is the shared native Rust boundary for the fixed
Windows Runtime service. It exposes two connection-bound surfaces:

- Desktop control for fixed-service account and Developer Mode operations; and
- the common third-party Local App carrier.

The Local App carrier connects only to `\\.\pipe\nimi-runtime-local-app-v1`,
verifies the pipe server against two stable SCM observations and the admitted
Runtime signer, performs the request-empty `OpenLocalAppSession`, and retains
the verified process, executable, channel, and Runtime boot epoch privately.
Its complete 0K operation surface is session status, permission posture,
Runtime artifact bytes, and the four selected RuntimeAgent conversation
operations.

The crate never exposes a generic method-id/bytes proxy, endpoint, credential,
portable session proof, principal, record, grant, launch lease, process tuple,
account identity, or Runtime boot epoch. Immutable package admission remains
typed unavailable; only an already-bound `local_development` process can open a
positive Local App session at this checkpoint. Linux and macOS adapters remain
compile-only and fail closed until their native trust carriers are admitted.
