# Nimi Spec Index

Nimi product authority is organized by active domain. Kernel markdown files and typed tables carry product semantics; top-level domain files are reading guides.

## Active Product Domains

- `avatar`
- `cognition`
- `desktop`
- `nimi2d`
- `platform`
- `runtime`
- `sdks`
- `zhiyu`

## External Authority Anchors

- `realm` is an external Realm authority projection anchor. Realm server/domain
  product rules are not redefined in this repository; Nimi consumes them through
  SDK and Runtime/Desktop consumer contracts.

## Reading Order

1. Start with the domain kernel index.
2. Read the referenced kernel contracts.
3. Use typed tables for enumerations, registries, protocol surfaces, catalogs, and support registries.
4. Use top-level domain guides only as navigation aids.

## Non Product Surfaces

- `.nimi/contracts/**`, `.nimi/methodology/**`, and `.nimi/config/**` are host-local nimicoding projections created by CLI initialization or synchronization.
- Per `P-PKG-010..P-PKG-011`, non-authoritative execution evidence and durable decision dossiers, when needed, belong to external-host-managed context, explicitly admitted local evidence surfaces, or Git history. No repository task-lifecycle directory is product authority.
- Generated views are rendered on demand by nimicoding commands and are not tracked as product authority.
