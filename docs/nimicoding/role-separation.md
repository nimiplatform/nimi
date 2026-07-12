# Role Separation

Role separation prevents the loop that produced a high-risk change from
being the only loop that judges it. The active AI host owns how roles are
assigned and coordinated; Nimi Coding defines the responsibilities and
evidence boundaries.

## Responsibilities

| Role | Owns | Must not do |
| --- | --- | --- |
| Host executor | Plan, implementation, tests, runtime verification | Invent authority or hide failed checks |
| Authority owner | Canonical product and architecture decisions | Treat local execution state as product truth |
| Independent reviewer | Challenge authority alignment, evidence, failures, and drift | Mutate the implementation while claiming independent review |
| Human decision owner | Product judgement where explicit acceptance is required | Convert missing evidence into approval |

One person or one Codex task can coordinate these responsibilities, but
the evidence must show when production and independent judgement came
from distinct passes. Codex may use a review subagent, a separate task,
or a different admitted host. Nimi Coding does not dispatch or schedule
those passes.

## Review Output

An independent review reports findings first, cites the authority and
evidence inspected, and gives an explicit disposition. It does not edit
code to make its own findings disappear.

If review uncovers a blocker, the Codex task remains open. The executor
fixes the issue, reruns the affected checks, and obtains fresh review
where required.

## Source Basis

- [`.nimi/methodology/role-separation-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/role-separation-policy.yaml)
- [`.nimi/contracts/worker-output.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/worker-output.schema.yaml)
- [`.nimi/contracts/acceptance.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/acceptance.schema.yaml)
