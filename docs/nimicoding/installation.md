# Nimi Host Integration

The Nimi repository pins `@nimiplatform/nimi-coding` as a development
dependency and consumes it through a guarded host boundary. A normal
workspace install provides the package; project wrappers verify the audited
package release and its managed projections.

## Prerequisites

| Requirement | Purpose |
| --- | --- |
| Node.js 24 or newer | Workspace runtime |
| pnpm | Repository package manager |
| Git checkout of Nimi | Provides the admitted host projections and wrappers |
| Codex or another admitted external host | Owns task execution |

## Install Workspace Dependencies

```bash
pnpm install
```

Do not run generic bootstrap or clear commands in this repository. Use the
declared project wrappers so the host boundary is checked before a managed
projection is refreshed.

## Verify The Integration

```bash
pnpm check:nimi-coding-seed-sync
pnpm nimicoding:doctor
```

Both checks must pass. `sync --check` verifies package-canonical files and required host-owned
seed files without treating host-specific content as package drift.

## Verify Product Authority

```bash
pnpm exec nimicoding validate-spec-tree .nimi/spec
```

For authority edits, use the repository-managed format command for each
changed container, then run `pnpm spec:authority:check` and
`pnpm spec:authority:compile`. These commands validate authority; they do not
create or update host task state.

## Projection Ownership

Most `.nimi/{config,contracts,methodology}/**` files are package-canonical.
Repository-specific methodology and contract files remain host configuration,
not product authority.

## Source Basis

- [`package.json`](https://github.com/nimiplatform/nimi/blob/main/package.json)
- [`.nimi/config/bootstrap.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/config/bootstrap.yaml)
