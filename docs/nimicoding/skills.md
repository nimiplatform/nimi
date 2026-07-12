# Skills

Nimi Coding skills are typed handoff contracts. They tell an admitted
external host what authority to read, what result shape to return, and
which validators establish evidence. They do not create a second task
or execution engine inside the repository.

## Declared Skills

| Skill | Purpose | Durable result |
| --- | --- | --- |
| `spec_reconstruction` | Reconstruct canonical authority from repository evidence | `.nimi/spec/**` plus local reconstruction audit |
| `doc_spec_audit` | Compare documentation claims with active authority | Local drift findings |
| `audit_sweep` | Inspect a declared source scope against explicit criteria | Local findings and evidence |

## Host Boundary

The active Codex task selects a skill declaration directly from
`.nimi/config/skill-manifest.yaml`, reads its inputs in the required
context order, performs the work with native planning and subagents, and
returns the named result-contract shape.

## Result Boundary

Every skill in `.nimi/config/skill-manifest.yaml` names its result
contract. The external host returns that shape; project validators check
it, and any operational evidence remains local-only. A result artifact
does not mark the Codex task complete or convert itself into product
authority.

## Handoff Content

A handoff names the selected skill, result contract, ordered context,
hard constraints, expected results, and readiness state. Codex decides
the execution mechanics. Deterministic validators check structural
contract satisfaction; the authority owner retains semantic judgement.

## Source Basis

- [`.nimi/config/skills.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/config/skills.yaml)
- [`.nimi/methodology/skill-handoff.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/skill-handoff.yaml)
- [`.nimi/contracts/spec-reconstruction-result.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/spec-reconstruction-result.yaml)
- [`.nimi/contracts/doc-spec-audit-result.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/doc-spec-audit-result.yaml)
- [`.nimi/contracts/prompt.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/prompt.schema.yaml)
- [`.nimi/contracts/worker-output.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/worker-output.schema.yaml)
