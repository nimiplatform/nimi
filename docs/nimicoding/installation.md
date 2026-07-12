# Nimi Host Integration

The Nimi repository pins `@nimiplatform/nimi-coding` as a development
dependency and consumes it through a host compatibility boundary. A
normal workspace install provides the package; project wrappers verify
that the Nimi-owned projection remains intact.

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

Do not bootstrap or mutate `.nimi/**` with generic package commands.
Nimi owns its host projections and fails closed when a forbidden package
projection appears.

## Verify The Integration

```bash
pnpm check:nimicoding-host-hardcut
pnpm check:nimi-coding-seed-sync
pnpm nimicoding:doctor
```

All three checks must pass. The compatibility wrapper enforces the
declared absent projection set and exact Nimi-owned overrides;
unexpected drift still fails.

## Verify Product Authority

```bash
pnpm exec nimicoding validate-spec-tree .nimi/spec
```

This validator inspects the canonical tree. When the active task
actually runs `spec_reconstruction`, also run
`pnpm exec nimicoding validate-spec-audit` against its declared local
audit artifact; a missing required audit fails closed. Neither command
creates or updates host task state.

## Skill Availability

`.nimi/config/skill-manifest.yaml` declares three external skills:
`spec_reconstruction`, `doc_spec_audit`, and `audit_sweep`. The active
host reads their inputs and result contracts directly.

## Source Basis

- [`package.json`](https://github.com/nimiplatform/nimi/blob/main/package.json)
- [`config/nimicoding-host-hardcut.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/nimicoding-host-hardcut.yaml)
- [`.nimi/config/skill-manifest.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/config/skill-manifest.yaml)
- [`.nimi/spec/platform/kernel/package-authority-admission-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/package-authority-admission-contract.md)
