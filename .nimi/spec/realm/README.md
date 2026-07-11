# Realm External Authority Pointer

This directory intentionally does not mirror Realm authority.

- External authority id: `<nimi-realm>`
- Pointer role: external Realm authority
- Nimi role: Realm API consumer
- Canonical Nimi consumer contract:
  `.nimi/spec/sdks/kernel/realm-api-consumer-contract.md`
- Generated Realm SDK boundary:
  `.nimi/spec/sdks/kernel/realm-core-contract.md`

Realm server/domain rules belong to `<nimi-realm>`. This repository records
only the external dependency and Nimi consumer reading paths; it contains no
Realm server/domain rule declarations.
