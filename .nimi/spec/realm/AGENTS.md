# External Realm Pointer Guidance

## Scope

- Applies to `.nimi/spec/realm/**`.

## Authority

- This subtree is not Realm product authority.
- It is only an external Realm authority pointer for Nimi consumers.
- Realm canonical authority lives in the external Realm authority root.
- Nimi consumes Realm through generated SDK/OpenAPI surfaces and SDK consumer
  contracts under `.nimi/spec/sdks/**`.

## Editing Route

- Do not add Realm kernel contracts, tables, generated docs, or domain authority
  mirrors here.
- Update `README.md` and `external-realm.md` only when the external pointer
  or SDK consumer route changes.
