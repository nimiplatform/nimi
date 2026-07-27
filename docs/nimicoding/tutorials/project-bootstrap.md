# Tutorial: Verify The Nimi Governance Setup

This tutorial verifies the Nimi repository's Codex + Nimi Coding
boundary. By the end, you will know that host execution ownership,
project truth, and package projections are aligned.

## Prerequisites

- A Nimi source checkout.
- Node.js 24 or newer and pnpm.
- An active Codex task or another admitted external host.

## 1. Install The Workspace

```bash
pnpm install
```

The repository already contains its admitted `.nimi/**` projections.
No package bootstrap command is required.

## 2. Review The Host Boundary

`P-PKG-011` in `.nimi/spec/platform/authority-admission.authority.yaml` declares
that Codex owns execution and that project-side execution projections — topic
lifecycles, wave/packet DAGs, run ledgers, goal bridges, nested host launches —
stay unadmitted. There is no separate boundary gate to run: the projection and
doctor checks in step 3 are what the repository enforces deterministically.

## 3. Verify Managed Projections

```bash
pnpm check:nimi-coding-seed-sync
pnpm nimicoding:doctor
```

Both commands fail on missing or drifted package-canonical projections without
restoring any execution state.

## 4. Inspect Spec Construction Contracts

Open the following files:

| Surface | Responsibility |
| --- | --- |
| `.nimi/config/spec-generation-inputs.yaml` | Host-specific classified inputs |
| `.nimi/methodology/spec-reconstruction.yaml` | Construction goals and gates |
| `.nimi/contracts/spec-generation-audit.schema.yaml` | File-level source basis and unresolved gaps |
| `.nimi/contracts/spec-layout.schema.yaml` | Host instruction and tracked projection layout |

The active Codex task reads these constraints directly. Its plan, subagents,
progress, and completion state remain in Codex.

## 5. Verify Canonical Authority

```bash
pnpm exec nimicoding validate-spec-tree .nimi/spec
```

A passing result confirms the declared structural contract. If canonical spec
construction changed files, also run `pnpm exec nimicoding
validate-spec-audit`; its local generation audit is then required. Product
judgement still follows the canonical owner in `.nimi/spec/**`.

## Final State

| Surface | State |
| --- | --- |
| Codex | Sole task executor |
| `.nimi/spec/**` | Canonical project truth |
| `.nimi/methodology/**` | Retained governance rules |
| `.nimi/contracts/**` | Retained validators and evidence shapes |
| Project wrappers | Boundary and projection drift checks |

Continue with
[Run A Governed Codex Project](/nimicoding/tutorials/project-to-governed-execution)
to apply the boundary to a real change.

## Source Basis

- [`.nimi/methodology/spec-reconstruction.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/spec-reconstruction.yaml)
- [`.nimi/contracts/spec-generation-audit.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/spec-generation-audit.schema.yaml)
- [`.nimi/spec/platform/authority-admission.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/authority-admission.authority.yaml)
