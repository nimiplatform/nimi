# Superseded Projection Pointer

Realm no longer treats projection packages as the current world/persona
consumption authority. Apps and Runtime consume admitted core/source shapes:

- world reads expose `WorldCore` and admitted world aggregates;
- character reads expose `WorldCharacterCore`;
- persona reads expose `RealmPersona`;
- Runtime materialization uses `RuntimeSourceSnapshot` by value.

Projection is not a write path, not a prompt builder, and not a parallel source
of truth. If a downstream surface needs a specialized view, it is derived from
the core objects for that request and does not replace them.

Source basis:

- [`.nimi/spec/realm/core.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/core.md)
- [`.nimi/spec/realm/kernel/core-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/core-contract.md)
