# Zhiyu Local Partner Surface

Zhiyu is a bundled, developer-only first-party consumer of a selected
LocalAgent. Runtime remains the owner of LocalAgent identity, execution,
conversation continuity, operational Memory, and AI configuration. Zhiyu
projects typed owner state and keeps only non-authoritative UI state and cache.

Partner selection is explicit and local to the Zhiyu surface. Authorization is
derived from the current protected app session and requested operation; Zhiyu
does not mint or persist reusable authorization or binding proof. Missing owner
capability or session evidence fails closed.

Zhiyu consumes the public Runtime SDK and demand-driven Kit compositions. Local
adapters may translate presentation state but cannot duplicate Runtime turn
reduction, conversation truth, AI routing, Memory ownership, or Avatar
configuration.

Avatar remains an independent consumer. Zhiyu may request the admitted
LocalAgent capability that opens Avatar, but it does not control Avatar
directly.

The current product surface has no scoped-binding entity and no
diary-reflection route, fixture, compatibility layer, or generated entry.

## Source Basis

- [`.nimi/spec/zhiyu/local-partner-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/zhiyu/local-partner-surface.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
