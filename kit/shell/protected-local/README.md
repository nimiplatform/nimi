# Kit Protected Local Host Carrier

`kit/shell/protected-local` is the shared native Rust host contract for
production Desktop-to-Runtime protected control. The crate is host-only and
has no npm or renderer export.

The carrier must consume Runtime `K-PLOCAL-*` and Platform signed executable
trust rows. It carries, but does not own:

- mutual OS principal, endpoint, live-process and same-open-file executable
  verification;
- the empty `OpenDesktopSession` request and two-field response;
- exact typed fixed-service `status`, `start`, and `restart`; and
- generated typed protected Runtime method calls after Runtime derives the
  origin.

Runtime and the OS remain endpoint, service lifecycle, custody, ledger,
credential, listener and origin authorities. This module has no renderer/npm
surface and must not expose stop, binary/service/path selection, env/argv
override, generic config JSON, bearer-based privilege, session ids, boot epochs,
process tuples, trust-record paths, or an installed-app child carrier.

A.1 owns any future installed/developer child carrier. Until then, no launch
metadata or ordinary gRPC proxy can provide protected app access.

The Windows carrier binds fixed-name SCM status/start with the minimum
query/start access. Opening Desktop control connects to the fixed named pipe,
requires its server PID to match two stable SCM observations, verifies the
same locked Runtime executable with WinVerifyTrust and the build-admitted Nimi
signer certificate identity, and performs `OpenDesktopSession` over that same
pipe. The verified process/executable handles and channel remain private and
live for the opaque control handle. A build without an admitted signer identity
fails closed; it is not production-carrier evidence. Restart also remains
closed until it can use the live protected connection rather than SCM stop
authority.

Linux filesystem-UDS and macOS privileged-XPC carrier types remain compile-only
and fail closed with `protected-carrier-required` until their mutually verified
native backends are admitted independently. No carrier reports synthetic
service or session success or exposes a generic method-id/byte proxy.
