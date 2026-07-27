# Nimi Command Reference

Field-level reference for the Nimi repository's admitted Nimi Coding
surface. For ownership concepts, see [Command Surface](/nimicoding/cli).

## Host Boundary Wrappers

| Command | Purpose |
| --- | --- |
| `pnpm check:nimi-coding-seed-sync` | Check managed projection presence and package-canonical drift |
| `pnpm nimicoding:doctor` | Inspect bootstrap, projection, and host spec configuration health |

## Spec And Governance Validators

| Command | Purpose |
| --- | --- |
| `pnpm exec nimicoding validate-spec-tree [.nimi/spec]` | Validate canonical tree structure |
| `pnpm exec nimicoding validate-spec-audit [audit-path]` | Validate source evidence, inference, and unresolved gaps |
| `pnpm exec nimicoding validate-spec-governance --profile nimi --scope {scope}` | Validate a configured governance scope |
| `pnpm exec nimicoding classify-spec-tree --profile nimi --root .nimi/spec [--json]` | Classify spec entries |
| `pnpm exec nimicoding generate-spec-migration-plan --profile nimi --root .nimi/spec [--emit {path}] [--json]` | Produce a non-mutating descriptive migration plan |
| `pnpm exec nimicoding validate-placement --profile nimi --root .nimi/spec [--json]` | Validate placement contracts |
| `pnpm exec nimicoding validate-table-family --profile nimi --root .nimi/spec [--json]` | Validate table-family contracts |
| `pnpm exec nimicoding validate-projection-edges --profile nimi --root .nimi/spec [--json]` | Validate projection edges |
| `pnpm exec nimicoding validate-guidance-bodies --profile nimi --root .nimi/spec [--json]` | Validate guidance bodies |
| `pnpm exec nimicoding validate-domain-admission --profile nimi --root .nimi/spec [--json]` | Validate domain admission records |
| `pnpm exec nimicoding validate-tracked-output-admission --profile nimi --root .nimi/spec [--json]` | Validate tracked-output admission |
| `pnpm exec nimicoding generate-spec-derived-docs --profile nimi --scope {scope} --check` | Check derived docs |
| `pnpm exec nimicoding validate-ai-governance --profile nimi --scope {scope}` | Validate AI governance constraints |
| `pnpm exec nimicoding blueprint-audit [--blueprint-root {path}] [--canonical-root {path}] [--json] [--write-local]` | Compare blueprint and canonical spec roots |

## Spec Construction Contracts

The host reads these inputs and contracts directly:

| Surface | Purpose |
| --- | --- |
| `.nimi/methodology/spec-reconstruction.yaml` | Construction goals, tree shape, and completion gates |
| `.nimi/contracts/spec-generation-audit.schema.yaml` | Local file-level source and gap evidence |
| `.nimi/contracts/spec-layout.schema.yaml` | Host-specific instruction and derived-output layout admission |

`classify-spec-tree` and `generate-spec-migration-plan` analyze the tree. Their
output is evidence, not a work queue, schedule, or task state.

## Execution Boundary

Planning, implementation, review, and completion remain host state. Nimi
Coding 0.3.x has no topic, sweep, handoff, closeout, or provider-runtime
command family.

## Source Basis

- [`.nimi/methodology/spec-reconstruction.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/spec-reconstruction.yaml)
- [`.nimi/contracts/spec-generation-audit.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/spec-generation-audit.schema.yaml)
- [`.nimi/contracts/spec-layout.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/spec-layout.schema.yaml)
