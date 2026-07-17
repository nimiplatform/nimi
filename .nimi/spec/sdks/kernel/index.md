# SDKS Kernel

Status: active product authority.

The SDKS kernel owns the new SDK family architecture, TypeScript-first
implementation, adapter capability contracts, feature modules, testing
contracts, and multi-language scope rules.

Current scope:

- `sdks/typescript/**` is the only full AI/Agent/Feature/Adapter implementation
  target.
- `sdks/python/**`, `sdks/go/**`, and `sdks/rust/**` remain generated
  Runtime/Realm core only until TypeScript stabilizes.
- Adapter public package names are not decided by source-root files.
- `realm-core-contract.md` owns Realm generated core authority for the SDK
  family.
- `realm-api-consumer-contract.md` owns Nimi's external Realm API
  consumer boundary; it forbids mirroring Realm authority under
  `.nimi/spec/realm/**`, binds generated Realm core to current Packet v3 and
  CharacterSourceRefV3 schemas, and keeps packet acquisition Runtime-private.
- `runtime-contract.md`, `surface-contract.md`, and `boundary-contract.md` own
  the closed SDK consumption boundary for Runtime-admitted
  `MaterializeRealmSource` through
  `materializeRealmSource({ sourceRef, requestId })`,
  `LocalAgentSourceContextStatus`, and `AgentTurnContextSummary`; SDK may
  submit intent and correlate/render bounded results but never acquire packets
  or assemble LocalAgent context.
- `runtime-agent-participation-contract.md` owns the vNext SDK-facing Runtime
  Agent Participation method projection gate.
- `nimi-proposal-intake-client-contract.md` owns the SDK typed consumer
  surface for Platform `P-PROP-*` proposal intake.
- `transport-contract.md` owns the host-injected common local-app carrier;
  it exposes no principal/grant/session material and cannot widen the exact
  artifact plus selected RuntimeAgent conversation operation set.
- `nimi-app-client-contract.md` owns the Nimi App catalog/local-record
  projection and final local-app SDK consumer boundary; it exposes no package
  mutation, app-id launch selector, principal selector, bearer, or session proof.
