# Nimi Coding Command Surface

Nimi consumes `@nimiplatform/nimi-coding` through a host hardcut. The
project wrappers expose health and projection checks; admitted package
validators inspect spec and governance. Codex owns task execution.

For exact syntax, see
[Reference → CLI Commands](/nimicoding/reference/cli-commands).

## Supported Categories

| Category | Nimi surface |
| --- | --- |
| Host hardcut | `pnpm check:nimicoding-host-hardcut` |
| Package projection check | `pnpm check:nimi-coding-seed-sync` |
| Compatibility doctor | `pnpm nimicoding:doctor` |
| Skill declarations | `.nimi/config/skill-manifest.yaml` |
| Spec validation | `validate-spec-tree`, `validate-spec-audit`, `validate-spec-governance` |
| Derived-doc validation | `generate-spec-derived-docs --check` |
| AI governance validation | `validate-ai-governance` |
| Spec structure | `classify-spec-tree`, `validate-placement`, `validate-table-family`, `validate-projection-edges`, `validate-guidance-bodies`, `validate-domain-admission`, `validate-tracked-output-admission`, `blueprint-audit` |

## Verify The Host Boundary

```bash
pnpm check:nimicoding-host-hardcut
pnpm check:nimi-coding-seed-sync
pnpm nimicoding:doctor
```

The wrappers enforce the forbidden projection set and the admitted
host-owned override set. A generic package mutation cannot make that
judgement.

## Validate Product Truth

```bash
pnpm exec nimicoding validate-spec-tree .nimi/spec
pnpm exec nimicoding validate-spec-audit
pnpm exec nimicoding validate-spec-governance --profile nimi --scope <scope>
pnpm exec nimicoding generate-spec-derived-docs --profile nimi --scope <scope> --check
pnpm exec nimicoding validate-ai-governance --profile nimi --scope <scope>
```

Use the affected scope declared by the repository. Broad validation is
required when a change crosses authority boundaries.

## Skills

The active host reads `.nimi/config/skill-manifest.yaml` and the
referenced context directly. The retained skills are
`spec_reconstruction`, `doc_spec_audit`, and `audit_sweep`. Their result
contracts remain project-local; the host decides how to plan and execute
the work.

## High-Risk Work

High-risk work uses authority preflight, the static/local evidence
contract at `.nimi/contracts/high-risk-admission.schema.yaml`, affected
validators, and real runtime acceptance. There is no Nimi-side execution
command family.

## Boundary Summary

| Concern | Owner |
| --- | --- |
| Task, plan, subagents, retry, resume, completion | Codex or another admitted host |
| Product authority | `.nimi/spec/**` |
| Methodology and evidence contracts | `.nimi/methodology/**` and `.nimi/contracts/**` |
| Deterministic validation | Project wrappers and admitted package validators |
| Runtime and UI acceptance | Real app/runtime checks initiated by the host |

## Source Basis

- [`config/nimicoding-host-hardcut.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/nimicoding-host-hardcut.yaml)
- [`.nimi/config/skill-manifest.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/config/skill-manifest.yaml)
- [`.nimi/methodology/skill-handoff.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/skill-handoff.yaml)
- [`.nimi/spec/platform/kernel/package-authority-admission-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/package-authority-admission-contract.md)
