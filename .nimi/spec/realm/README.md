# Realm External Authority Pointer

This directory intentionally does not mirror Realm authority.

- External authority id: `<external-realm-authority>`
- Pointer role: external Realm authority
- Nimi role: Realm API consumer
- Canonical Nimi consumer contract:
  `.nimi/spec/canonical/sdks/realm-consumer.authority.yaml`
- Generated Realm SDK boundary:
  `.nimi/spec/canonical/sdks/realm-consumer.authority.yaml` (generated core plane)

Realm server/domain rules belong to `<external-realm-authority>`. This repository records
only the external dependency and Nimi consumer reading paths; it contains no
Realm server/domain rule declarations.
