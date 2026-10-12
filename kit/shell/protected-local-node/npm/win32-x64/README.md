# @nimiplatform/kit-protected-local-win32-x64

Windows x64 Node-API binary used internally by
`@nimiplatform/kit/shell/electron/main`. It is not a renderer API and does not
expose Runtime credentials, session material, endpoint selection, or a generic
RPC proxy.

The binary exports only the bounded Desktop control and Local App operations
declared by the parent protected-local-node package. Protected App operations
remain fail-closed while App Access admission is unavailable.

This Kit release targets the formal Windows Nimi Runtime service. The compiled
Platform Ed25519 key authenticates the installed complete-product inventory,
fixed administrative paths and locked executable bytes. Runtime still owns App
registration, the exact Desktop launch witness and fresh App Access.

Kit 0.18.1 remains the separately published D2 source-development artifact;
production admission does not fall back to its trust boundary.
