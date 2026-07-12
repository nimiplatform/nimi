# Tutorial: Verify The Nimi Governance Setup

This tutorial verifies the Nimi repository's Codex + Nimi Coding
boundary. By the end, you will know that host execution ownership,
project truth, package projections, and retained skills are aligned.

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

## 2. Verify The Hardcut

```bash
pnpm check:nimicoding-host-hardcut
```

This confirms that Codex owns execution and that forbidden project-side
execution projections remain absent.

## 3. Verify Projection Compatibility

```bash
pnpm check:nimi-coding-seed-sync
pnpm nimicoding:doctor
```

Both commands run through the Nimi compatibility policy. They fail on
unexpected drift instead of restoring package-owned execution state.

## 4. Inspect Retained Skills

Open `.nimi/config/skill-manifest.yaml`. It declares:

| Skill | Result contract |
| --- | --- |
| `spec_reconstruction` | `.nimi/contracts/spec-reconstruction-result.yaml` |
| `doc_spec_audit` | `.nimi/contracts/doc-spec-audit-result.yaml` |
| `audit_sweep` | `.nimi/contracts/audit-sweep-result.yaml` |

The active Codex task reads the selected skill inputs and result
contract directly. Its plan, subagents, progress, and completion state
remain in Codex.

## 5. Verify Canonical Authority

```bash
pnpm exec nimicoding validate-spec-tree .nimi/spec
```

A passing result confirms the declared structural contract. If the
active task executed `spec_reconstruction`, also run
`pnpm exec nimicoding validate-spec-audit`; its declared audit artifact
is then required. Product judgement still follows the canonical owner
in `.nimi/spec/**`.

## Final State

| Surface | State |
| --- | --- |
| Codex | Sole task executor |
| `.nimi/spec/**` | Canonical project truth |
| `.nimi/methodology/**` | Retained governance rules |
| `.nimi/contracts/**` | Retained validators and evidence shapes |
| Project wrappers | Compatibility and drift checks |

Continue with
[Run A Governed Codex Project](/nimicoding/tutorials/project-to-governed-execution)
to apply the boundary to a real change.

## Source Basis

- [`config/nimicoding-host-hardcut.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/nimicoding-host-hardcut.yaml)
- [`.nimi/config/skill-manifest.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/config/skill-manifest.yaml)
- [`.nimi/methodology/skill-handoff.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/skill-handoff.yaml)
- [`.nimi/spec/platform/kernel/package-authority-admission-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/package-authority-admission-contract.md)
