# Asset Market Spec — AGENTS.md

> Editing rules for all AI agents working on Asset Market spec documents.

## Authoritative Structure

```text
spec/
├── AGENTS.md                              # This file — editing rules
├── asset-market.md                        # App-level product overview
├── kernel/
│   ├── app-shell-contract.md              # AM-SHELL-*: shell, bootstrap, navigation
│   ├── package-contract.md                # AM-PKG-*: AssetPackage model and lifecycle
│   ├── discovery-contract.md              # AM-DISCOVER-*: discover, search, detail
│   ├── publish-contract.md                # AM-PUBLISH-*: package composition and publish flow
│   ├── library-contract.md                # AM-LIB-*: available and saved library views
│   ├── account-contract.md                # AM-ACCOUNT-*: account-facing records
│   └── tables/
│       ├── routes.yaml                    # Route table — authoritative
│       ├── feature-matrix.yaml            # Feature matrix — authoritative
│       ├── package-model.yaml             # AssetPackage fields, readiness, reserved concepts
│       └── api-surface.yaml               # New package-market API proposals
```

## Rule ID Format

All rules use prefix `AM-<DOMAIN>-NNN`.

| Domain | Prefix | Contract |
|--------|--------|----------|
| Shell / Bootstrap / Navigation | AM-SHELL | `app-shell-contract.md` |
| Package Model / Lifecycle | AM-PKG | `package-contract.md` |
| Discover / Search / Detail | AM-DISCOVER | `discovery-contract.md` |
| Publish / Compose / Update | AM-PUBLISH | `publish-contract.md` |
| Library / Available / Saved | AM-LIB | `library-contract.md` |
| Account / Records | AM-ACCOUNT | `account-contract.md` |

## Fact Sources

YAML tables in `kernel/tables/` are the authoritative fact sources. Prose in contract `.md` files references but does not duplicate table data.

| File | Content |
|------|---------|
| `routes.yaml` | App routes and route-feature bindings |
| `feature-matrix.yaml` | Feature phasing, priority, dependencies |
| `package-model.yaml` | AssetPackage field model, readiness, reserved concepts |
| `api-surface.yaml` | New package-market backend proposals only |

## Editing Rules

1. **No contract may contradict a YAML table.** If prose and a table disagree, the table wins.
2. **Rule IDs are append-only.** Never renumber or reuse a retired rule ID.
3. **Cross-references use rule IDs**, not section headings.
4. **Tables are the single source for enumerations.** Do not inline route lists, package field lists, or readiness enumerations in prose.
5. **Realm asset boundary is inherited, not redefined.** Asset Market consumes existing Realm `Asset` semantics and must not overwrite `spec/realm/**` contracts.
6. **Scene-Atlas remains upstream only.** `SceneCard` / `ScenePack` are not Asset Market objects; any market flow starts from admitted Realm assets.
7. **Future reservation stays thin.** `AssetPackageListing` may be mentioned only as a reserved future projection and must not become a current active object in this spec.

## Relation to Existing Specs

Asset Market builds on existing contracts rather than replacing them:

- Realm asset boundary: `spec/realm/kernel/asset-contract.md` (`R-ASSET-*`)
- Forge shell pattern: `apps/forge/spec/kernel/app-shell-contract.md` (`FG-SHELL-*`)
- Scene-Atlas upstream working-state vocabulary: `nimi-mods/runtime/scene-atlas/spec/kernel/domain-contract.md`

Asset Market extends the ecosystem above Realm assets with package-market business semantics while keeping asset truth inside Realm.
