<!-- nimi-docs: {"authority":["rule.nimi.runtime.remote-access.direct-transport","rule.nimi.runtime.remote-access.asset-write-stream","rule.nimi.runtime.remote-access.connection-lifetime"],"sources":["sdks/typescript/runtime/remote-data-channel.ts","runtime/internal/remoteaccess/peer.go"]} -->

# Transport and Error Handling

Local native Apps use their real Host's protected carrier; remote Web/Android Apps use a direct WebRTC data channel to the primary Runtime. Shared public types do not imply identical operation coverage or recovery behavior across carriers.

## Connection Lifetime

A remote connection needs current identity, primary binding, valid source confirmation and a reachable direct network. STUN provides candidate discovery; the current carrier has no TURN/Relay. Connection, source or identity loss ends the corresponding live calls with an actual error.

Kit may recheck identity and establish a new technical connection in its defined browser/Android resume paths. It does not continue an ended stream or resubmit messages, files or Jobs. Native technical-session maintenance likewise does not change a business operation's idempotency or permission contract.

## Errors and Uncertain Outcomes

Preserve Runtime reason codes, error source and diagnostics. Undecodable or schema-invalid responses fail explicitly; reconnecting cannot repair a contract error.

A disconnect does not prove the server rejected the request. Query durable Jobs with saved Job IDs; where submission lookup is supported, use the original submission ID with `lookupSubmission`. If the result is unknown, show that uncertainty rather than blindly replaying a side effect. Inspect the owner's actual state after cancellation as well.

## Media and Resource Boundaries

Remote typed media inputs use inline content or App-authorized asset references; raw URL/URI inputs are unavailable. Asset writes send incrementally within Runtime-issued bounded credits. Disconnect, cancellation and source loss are errors, not normal EOF, and cannot commit a partial file. There is no upload resumption. The existing storage owner retains file size, path, quota and final-commit decisions.

Use [Troubleshooting](/start/troubleshooting) to distinguish login, source confirmation, host connection and model execution.

## Source Basis

- [`.nimi/spec/sdks/client-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/client-core.authority.yaml)
- [`.nimi/spec/runtime/rpc-foundations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/rpc-foundations.authority.yaml)
- [`.nimi/spec/runtime/remote-access.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/remote-access.authority.yaml)
- [`kit/core/src/app-session.ts`](https://github.com/nimiplatform/nimi/blob/main/kit/core/src/app-session.ts)
- [`sdks/typescript/runtime/remote-data-channel.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/runtime/remote-data-channel.ts)
