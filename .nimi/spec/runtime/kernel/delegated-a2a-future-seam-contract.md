# Delegated A2A Future Seam Contract

> Owner Domain: `K-DELEG-*`

A2A is admitted only as a future Runtime delegated provider adapter seam. This
contract does not admit production A2A execution, production A2A dependencies,
Desktop A2A configuration, app/Avatar direct A2A paths, or A2A protocol
wire schemas as Nimi semantic authority.

## K-DELEG-120 A2A Future Seam Authority

A2A may be modeled only as a future delegated provider adapter seam owned by
Runtime. Any production A2A implementation requires a new admitted packet before
code, dependency, runtime registration, UI claim, or integration fixture lands.

MCP remains the only production delegated protocol adapter admitted by this
contract.

## K-DELEG-121 A2A Adapter Non-Authority

A2A protocol wire schemas, task payloads, agent cards, and remote agent native
states are not Runtime semantic authority.

A future A2A adapter must normalize all protocol-native facts into
`K-DELEG-001` through `K-DELEG-099` before any firewall, approval, audit,
replay, model-context, projection, or action path may consume them.

## K-DELEG-122 A2A Gateway Boundary

A future A2A adapter must enter through the Runtime delegated capability gateway.

It must not be called directly by Desktop, Web, Avatar, apps, SDK public
convenience APIs, or product UI surfaces.

## K-DELEG-123 A2A Firewall Boundary

A2A output must remain untrusted delegated provider output until Runtime
delegated output firewall returns an admitted verdict.

No A2A task message, artifact, event, or remote-agent response may enter model
context, `runtime.agent.*` projection, UI state, audit replay view, or action
execution before the firewall verdict.

## K-DELEG-124 A2A Approval Boundary

A2A-suggested actions, tool calls, workflow mutations, or side effects require
Runtime-owned approval semantics whenever `K-DELEG-069` or delegated provider
policy requires human review.

Desktop may render only Runtime typed approval requests. Desktop must not infer
approval directly from A2A task state.

## K-DELEG-125 A2A Credential Custody

A2A credentials, authorization headers, bearer tokens, refresh tokens, API
keys, and OAuth artifacts must remain under Runtime connector/grant/authn/authz
custody.

Future A2A adapter code must not pass raw credentials through SDK, Desktop,
Avatar, or app surfaces.

## K-DELEG-126 A2A Audit And Replay Boundary

A2A delegated calls must extend Runtime delegation audit/replay with the same
trace chain required by `K-DELEG-085` through `K-DELEG-089`.

A2A native logs, task ids, or remote-agent receipts may be evidence refs, but
they must not become the canonical audit ledger.

## K-DELEG-127 A2A Product Claim Prohibition

Desktop, Web, Avatar, and apps must not claim production A2A availability,
configuration, health, or success. Production A2A support is not admitted.

Product surfaces may mention A2A only as an unsupported seam when they are
rendering spec/debug material, not as a configurable feature.

## K-DELEG-128 A2A Negative Gate

Validation must prove there is no:

- production A2A SDK import
- Runtime A2A adapter registration
- Desktop A2A configuration or availability claim
- app/Avatar direct A2A client path
- fake A2A server success fixture
- A2A task payload projected directly into `runtime.agent.*`

## K-DELEG-129 Future A2A Packet Requirements

A future production A2A packet must include:

- exact protocol revision and dependency source
- Runtime adapter normalization contract
- provider profile binding and credential custody
- gateway and firewall integration tests
- approval, audit, replay, and redaction tests
- no-direct-app/Avatar/Desktop/SDK bypass gates
- controlled non-fake integration fixture
- explicit migration posture from this future-seam-only contract
