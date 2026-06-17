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
- `realm-api-consumer-contract.md` owns Nimi's external `<nimi-realm>` API
  consumer boundary; it forbids mirroring Realm authority under
  `.nimi/spec/realm/**`.
- `runtime-agent-participation-contract.md` owns the vNext SDK-facing Runtime
  Agent Participation method projection gate.
