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
  `.nimi/spec/realm/**` and binds source materialization to generated packet-v2
  and challenge transport without handwritten audience/raw-payload DTOs.
- `runtime-contract.md`, `surface-contract.md`, and `boundary-contract.md` own
  the closed SDK consumption boundary for Runtime-admitted
  `LocalAgentSourceContextStatus` and `AgentTurnContextSummary`; SDK may
  correlate/render them but never assemble LocalAgent context.
- `runtime-agent-participation-contract.md` owns the vNext SDK-facing Runtime
  Agent Participation method projection gate.
- `nimi-proposal-intake-client-contract.md` owns the SDK typed consumer
  surface for Platform `P-PROP-*` proposal intake.
- `transport-contract.md` owns the host-injected local-development carrier
  projection; it exposes no session material and cannot widen the A.5
  artifact-only operation set.
