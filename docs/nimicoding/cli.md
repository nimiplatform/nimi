# Nimi Coding Command Surface

Nimi consumes `@nimiplatform/nimi-coding` 0.3.1 through a host boundary.
Project wrappers guard the installed package and its managed projections;
package commands inspect spec construction and governance. The AI host owns
planning and execution.

For exact syntax, see
[Reference → CLI Commands](/nimicoding/reference/cli-commands).

## Supported Categories

| Category | Nimi surface |
| --- | --- |
| Package projection check | `pnpm check:nimi-coding-seed-sync` |
| Package doctor | `pnpm nimicoding:doctor` |
| Spec validation | `validate-spec-tree`, `validate-spec-audit`, `validate-spec-governance` |
| Derived-doc validation | `generate-spec-derived-docs --check` |
| AI governance validation | `validate-ai-governance` |
| Spec structure | `classify-spec-tree`, `validate-placement`, `validate-table-family`, `validate-projection-edges`, `validate-guidance-bodies`, `validate-domain-admission`, `validate-tracked-output-admission`, `blueprint-audit` |

## Verify The Host Boundary

```bash
pnpm check:nimi-coding-seed-sync
pnpm nimicoding:doctor
```

The host boundary itself is declared by `P-PKG-011` in
`.nimi/spec/platform/authority-admission.authority.yaml`: topic lifecycle,
wave/packet execution DAGs, run ledgers, goal bridges, and nested host launches
stay unadmitted even when the installed package still contains them. The sync
and doctor wrappers verify the managed projections against the package's
current projection policy; they do not apply it.

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

## Construct And Audit A Spec Tree

`.nimi/methodology/spec-reconstruction.yaml` defines the construction model.
`.nimi/config/spec-generation-inputs.yaml` declares host inputs, while
`.nimi/contracts/spec-generation-audit.schema.yaml` defines the local evidence
validated by `validate-spec-audit`. These contracts constrain outputs; they do
not create a task, choose an executor, or run an audit process.

## High-Risk Work

High-risk work follows repository authority preflight, affected validators,
and real runtime acceptance. Nimi Coding does not own a high-risk task state or
an execution command family.

## Boundary Summary

| Concern | Owner |
| --- | --- |
| Task, plan, subagents, retry, resume, completion | Codex or another admitted host |
| Product authority | `.nimi/spec/**` |
| Methodology and evidence contracts | `.nimi/methodology/**` and `.nimi/contracts/**` |
| Deterministic validation | Project wrappers and admitted package validators |
| Runtime and UI acceptance | Real app/runtime checks initiated by the host |

## Source Basis

- [`.nimi/methodology/spec-reconstruction.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/spec-reconstruction.yaml)
- [`.nimi/contracts/spec-generation-audit.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/spec-generation-audit.schema.yaml)
- [`.nimi/spec/platform/authority-admission.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/authority-admission.authority.yaml)
