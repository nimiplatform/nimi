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
| `.nimi/contracts/**` | Handoff, evidence, and acceptance shapes |
| Project scripts | Deterministic validation |
| `.nimi/local/**` | Non-semantic local evidence |

## Host-Owned

Each host owns task creation, planning, subagents, context management,
retry, resume, and completion. An adapter translates handoff inputs and
typed outputs; it does not move execution ownership into Nimi Coding.

## Admitting A Host

A host is suitable when it can:

- read required repository authority in the declared order;
- preserve fail-closed errors and blockers;
- return contract-shaped results without fabricated evidence;
- run project checks and real runtime/app acceptance where required;
- keep secrets and provider credentials within their admitted custody;
- avoid writing task progress into semantic project truth.

Switching hosts therefore requires validating the adapter and starting
the task in the new host. No repository-side execution state needs to be
transferred.

## Source Basis

- [`.nimi/contracts/external-host-compatibility.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/external-host-compatibility.yaml)
- [`.nimi/config/host-adapter.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/config/host-adapter.yaml)
- [`.nimi/spec/platform/kernel/package-authority-admission-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/package-authority-admission-contract.md)
