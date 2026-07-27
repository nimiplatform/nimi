# Host-Agnostic Boundary

Nimi Coding is host-agnostic because project truth and acceptance do not
depend on one AI vendor's task representation. Each admitted host keeps
its own plan and runtime state while consuming the same repository
authority, constraints, and gates.

## Stable Across Hosts

| Stable project surface | Meaning |
| --- | --- |
| `.nimi/spec/**` | Canonical product and architecture truth |
| `.nimi/methodology/**` | Change classification and governance rules |
| `.nimi/contracts/**` | Spec taxonomy, placement, generation evidence, and validation shapes |
| Project scripts | Deterministic validation |
| `.nimi/local/**` | Non-semantic local evidence |

## Host-Owned

Each host owns task creation, planning, subagents, context management,
retry, resume, review, and completion. Nimi Coding 0.3.x has no host-adapter
registry or typed handoff runtime. It only exposes repository context and
deterministic commands that a host may consume.

## Admitting A Host

A host is suitable when it can:

- read required repository authority in the declared order;
- preserve fail-closed errors and blockers;
- preserve the distinction between authority, generated views, and evidence;
- run project checks and real runtime/app acceptance where required;
- keep secrets and provider credentials within their admitted custody;
- avoid writing task progress into semantic project truth.

Switching hosts therefore means starting the task in the new host and
re-running the required repository checks. No Nimi Coding execution state or
adapter configuration needs to be transferred.

## Source Basis

- [`.nimi/methodology/core.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/core.yaml)
- [`.nimi/spec/platform/authority-admission.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/authority-admission.authority.yaml)
