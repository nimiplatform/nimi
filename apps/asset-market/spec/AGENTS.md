# Asset Market Spec — AGENTS.md

> Editing rules for all AI agents working on Asset Market spec documents.

## Authoritative Structure

```text
spec/
├── AGENTS.md                              # This file — editing rules
├── asset-market.md                        # App-level product overview
├── kernel/
│   ├── app-shell-contract.md              # AM-SHELL-*: shell, bootstrap, navigation
│   ├── package-contract.md                # AM-PKG-*: Bundle / Package model and lifecycle split
│   ├── discovery-contract.md              # AM-DISCOVER-*: discover, search, detail
│   ├── publish-contract.md                # AM-PUBLISH-*: package composition and publish flow
│   ├── library-contract.md                # AM-LIB-*: available and saved library views
│   ├── account-contract.md                # AM-ACCOUNT-*: account-facing records
│   ├── api-contract.md                    # AM-API-*: backend API surface inventory rules
│   └── tables/
│       ├── routes.yaml                    # Route table — authoritative
│       ├── feature-matrix.yaml            # Feature matrix — authoritative
│       ├── package-model.yaml             # Bundle / Package fields, readiness, reserved concepts
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
| API Surface Inventory | AM-API | `api-contract.md` |
| Moderation / Review | AM-MOD | reserved; no active contract until UGC admission |
| Preview / Import Diagnostics | AM-PREVIEW | reserved; no active contract until preview admission |

## Fact Sources

YAML tables in `kernel/tables/` are the authoritative fact sources. Prose in contract `.md` files references but does not duplicate table data.

| File | Content |
|------|---------|
| `routes.yaml` | App routes and route-feature bindings |
| `feature-matrix.yaml` | Feature phasing, priority, dependencies |
| `package-model.yaml` | Bundle / Package field model, readiness, reserved concepts |
| `api-surface.yaml` | New package-market backend proposals only; governed by `AM-API-*` |

## Editing Rules

1. **No contract may contradict a YAML table.** If prose and a table disagree, the table wins.
2. **Rule IDs are append-only.** Never renumber or reuse a retired rule ID.
3. **Cross-references use rule IDs**, not section headings.
4. **Tables are the single source for enumerations.** Do not inline route lists, package field lists, or readiness enumerations in prose.
5. **Realm truth boundary is inherited, not redefined.** Asset Market consumes existing Realm `Asset` and `Bundle` semantics and must not overwrite `spec/realm/**` contracts.
6. **Scene-Atlas remains upstream only.** `SceneCard` / `ScenePack` are not Asset Market objects; any market flow starts from admitted Realm `Asset` and `Bundle` objects.
7. **Future reservation stays thin.** `PackageListing` may be mentioned only as a reserved future projection and must not become a current active object in this spec.
8. **No parallel Asset Market root.** Do not create or target `.nimi/spec/asset-market/**`; the admitted Asset Market authority root is `apps/asset-market/spec/**`.
9. **Package kind values live in one table.** `Package.package_kind` values must be admitted in `kernel/tables/package-model.yaml`; app code, docs, and proposal text must not invent extra active kind values.
10. **Reserved rule families are inert.** `AM-MOD-*` and `AM-PREVIEW-*` are reserved coordination points only until a later admitted topic adds active contracts and table rows.

## Relation to Existing Specs

Asset Market builds on existing contracts rather than replacing them:

- Realm asset boundary: `spec/realm/kernel/asset-contract.md` (`R-ASSET-*`)
- Forge shell pattern: `apps/forge/spec/kernel/app-shell-contract.md` (`FG-SHELL-*`)
- Scene-Atlas upstream working-state vocabulary: `nimi-mods/runtime/scene-atlas/spec/kernel/domain-contract.md`

Asset Market extends the ecosystem above Realm truth objects with package-market business semantics while keeping `Resource / Asset / Bundle` truth inside Realm.
