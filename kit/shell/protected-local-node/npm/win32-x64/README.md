# @nimiplatform/kit-protected-local-win32-x64

Windows x64 Node-API binary used internally by
`@nimiplatform/kit/shell/electron/main`. It is not a renderer API and does not
expose Runtime credentials, session material, endpoint selection, or a generic
RPC proxy.

The binary exports only the bounded Desktop control and Local App operations
declared by the parent protected-local-node package. Protected App operations
remain fail-closed while App Access admission is unavailable.

This Kit release targets the existing Windows D2 Runtime. Desktop supplies the
explicit D2 launch environment and exact Runtime executable; the binary retains
the canonical-path, same-user, non-elevated session, and process checks. App
registration, the exact Desktop launch witness, and fresh App Access remain
Runtime-owned. The package is not a production Runtime service trust fallback.
