# Nimi protected-local macOS arm64 binding

This host-only Node-API package carries the fixed macOS filesystem-UDS Desktop and local-app transports. It has no renderer export, endpoint selector, portable token, or arbitrary RPC surface.

## Signing and Runtime Admission

- **Production build:** Requires the compile-time Developer ID team.
- **Local-development build:** Mutually exclusive with production; requires an ad-hoc signature and does not consume a Team ID.
- **Local-development Runtime admission:** Uses the live audit-token peer, root-owned fixed executable path, exact signing identifier, strict SecCode identity, ad-hoc signature class, hardened-runtime validation, and process exit-or-exec liveness. It does not consume release-trust records or pre-recorded artifact hashes.
