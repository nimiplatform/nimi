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
pnpm check:nimicoding-host-hardcut
pnpm check:nimi-coding-seed-sync
pnpm nimicoding:doctor
```

All three checks must pass. The hardcut rejects removed execution surfaces;
`sync --check` then verifies package-canonical files and required host-owned
seed files without treating host-specific content as package drift.

## Verify Product Authority

```bash
pnpm exec nimicoding validate-spec-tree .nimi/spec
```

This validator inspects the canonical tree. When spec construction changes
canonical files, also run `pnpm exec nimicoding validate-spec-audit` against
`.nimi/local/state/spec-generation/spec-generation-audit.yaml`; a missing or
incomplete audit fails closed. Neither command creates or updates host task
state.

## Projection Ownership

Most `.nimi/{config,contracts,methodology}/**` files are package-canonical.
Nimi owns the host-specific content of
`.nimi/config/spec-generation-inputs.yaml`,
`.nimi/contracts/domain-admission.schema.yaml`, and
`.nimi/methodology/spec-reconstruction.yaml`; sync preserves those admitted
overrides.

## Source Basis

- [`package.json`](https://github.com/nimiplatform/nimi/blob/main/package.json)
- [`config/nimicoding-host-hardcut.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/nimicoding-host-hardcut.yaml)
- [`.nimi/config/bootstrap.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/config/bootstrap.yaml)
- [`.nimi/config/spec-generation-inputs.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/config/spec-generation-inputs.yaml)
- [`.nimi/spec/platform/kernel/package-authority-admission-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/package-authority-admission-contract.md)
