# Superseded Truth Pointer

Realm no longer defines world or persona authority through a separate truth
layer. The current authority is the core data layer:

- `WorldCore`
- `WorldCharacterCore`
- `RealmPersona`
- `RuntimeSourceSnapshot`
- `WorldCoreIngressPackage`
- `CorePatch`

Creator tooling and Forge must create or patch those core objects directly. Any
future rule/truth abstraction must be derived from the core data model; it must
not become a second source of world/persona truth.

Source basis:

- [`.nimi/spec/realm/core.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/core.md)
- [`.nimi/spec/realm/kernel/core-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/core-contract.md)
- [`.nimi/spec/forge/kernel/core-ingress-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/forge/kernel/core-ingress-contract.md)
