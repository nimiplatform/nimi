# Nimi Command Reference

Field-level reference for the Nimi repository's admitted Nimi Coding
surface. For ownership concepts, see [Command Surface](/nimicoding/cli).

## Host Compatibility Wrappers

| Command | Purpose |
| --- | --- |
| `pnpm check:nimicoding-host-hardcut` | Verify forbidden workflow projections are absent and host-owned projections are admitted |
| `pnpm check:nimi-coding-seed-sync` | Check package projection drift through the compatibility policy |
| `pnpm nimicoding:doctor` | Run doctor through the strict host compatibility wrapper |

## Spec And Governance Validators

| Command | Purpose |
| --- | --- |
| `pnpm exec nimicoding validate-spec-tree [.nimi/spec]` | Validate canonical tree structure |
| `pnpm exec nimicoding validate-spec-audit [audit-path]` | Validate source evidence, inference, and unresolved gaps |
| `pnpm exec nimicoding validate-spec-governance --profile nimi --scope {scope}` | Validate a configured governance scope |
| `pnpm exec nimicoding classify-spec-tree --profile nimi --root .nimi/spec [--json]` | Classify spec entries |
| `pnpm exec nimicoding validate-placement --profile nimi --root .nimi/spec [--json]` | Validate placement contracts |
| `pnpm exec nimicoding validate-table-family --profile nimi --root .nimi/spec [--json]` | Validate table-family contracts |
| `pnpm exec nimicoding validate-projection-edges --profile nimi --root .nimi/spec [--json]` | Validate projection edges |
| `pnpm exec nimicoding validate-guidance-bodies --profile nimi --root .nimi/spec [--json]` | Validate guidance bodies |
| `pnpm exec nimicoding validate-domain-admission --profile nimi --root .nimi/spec [--json]` | Validate domain admission records |
| `pnpm exec nimicoding validate-tracked-output-admission --profile nimi --root .nimi/spec [--json]` | Validate tracked-output admission |
| `pnpm exec nimicoding generate-spec-derived-docs --profile nimi --scope {scope} --check` | Check derived docs |
| `pnpm exec nimicoding validate-ai-governance --profile nimi --scope {scope}` | Validate AI governance constraints |
| `pnpm exec nimicoding blueprint-audit [--blueprint-root {path}] [--canonical-root {path}] [--json] [--write-local]` | Compare blueprint and canonical spec roots |

## Skill Contracts

The host reads these declarations directly:

| Skill | Result contract |
| --- | --- |
| `spec_reconstruction` | `.nimi/contracts/spec-reconstruction-result.yaml` |
| `doc_spec_audit` | `.nimi/contracts/doc-spec-audit-result.yaml` |
| `audit_sweep` | `.nimi/contracts/audit-sweep-result.yaml` |

## High-Risk Evidence

`.nimi/contracts/high-risk-admission.schema.yaml` defines local static
admission evidence. High-risk task execution and completion remain host
state and have no Nimi command family.

## Source Basis

- [`config/nimicoding-host-hardcut.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/nimicoding-host-hardcut.yaml)
- [`.nimi/config/skill-manifest.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/config/skill-manifest.yaml)
- [`.nimi/contracts/high-risk-admission.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/high-risk-admission.schema.yaml)
- [`.nimi/spec/platform/kernel/package-authority-admission-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/package-authority-admission-contract.md)
