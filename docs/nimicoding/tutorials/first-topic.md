# Tutorial: First Topic Bootstrap

This tutorial walks you through bootstrapping Nimi Coding into a
new project and getting `.nimi/**` set up. By the end you will
have:

- `@nimiplatform/nimi-coding` installed
- `.nimi/**` populated with package-owned bootstrap source
- A managed `AGENTS.md` / `CLAUDE.md` block confirming the
  bootstrap
- An authoritative JSON handoff payload for `spec_reconstruction`

## Prerequisites

| Requirement | Why |
| --- | --- |
| Node.js 24 or newer | Package runs on Node |
| Project root with version control | Bootstrap will create new files; you'll want to review them |
| An admitted external AI host | Required for the next step (`spec_reconstruction`) |

The tutorial does not require the spec to be reconstructed yet —
that's the next step after bootstrap.

## Step 1: Install The Package

Install `@nimiplatform/nimi-coding` as a dev dependency:

```bash
npm install --save-dev @nimiplatform/nimi-coding
```

or:

```bash
pnpm add -D @nimiplatform/nimi-coding
```

The command can vary by package manager, but the result should be the
same: `nimicoding` is available as a project CLI.

After installation, `npx nimicoding --help` should print help text.

## Step 2: Run `nimicoding start`

`nimicoding start` is the bootstrap entry. It is **interactive**:
it explains each step, asks for confirmation, applies the step.

The CLI walks through:

1. Detect project state.
2. Confirm or accept managed AI entrypoints (`AGENTS.md`,
   `CLAUDE.md` blocks).
3. Project package source into project paths.
4. Seed `.nimi/spec/_meta` and bootstrap files.
5. Update `.gitignore` for local runtime state.
6. Prepare a JSON handoff payload for `spec_reconstruction`.
7. Print a paste-ready prompt directly in the terminal.

After this step, the project root has:

| Path | Contents |
| --- | --- |
| `.nimi/methodology/` | Methodology source (policies) |
| `.nimi/contracts/` | Schema source |
| `.nimi/config/` | Bootstrap config |
| `.nimi/spec/_meta/` | Spec generation metadata seed |
| `AGENTS.md` (or block within) | Managed Nimi Coding block |
| `CLAUDE.md` (or block within) | Managed Nimi Coding block |
| `.gitignore` | Updated with local-state ignore patterns |

## Step 3: Verify With `nimicoding doctor`

`nimicoding doctor` validates that the bootstrap is in a healthy
state.

It checks:

- `.nimi/**` bootstrap seed presence
- `.nimi/local/` and `.nimi/cache/` exist and remain ignored
- Bootstrap contract compatibility metadata
- Cross-contract reference alignment
- Host-adapter boundary truth
- Skill result-contract alignment
- Handoff context-order readiness

A healthy doctor output confirms you can hand off skills to an
external AI host.

If something is yellow / red, the report names the area; address
the named issue and re-run.

## Step 4: Examine The Generated Handoff Payload

`nimicoding start` produced a JSON handoff payload for
`spec_reconstruction`. The file lives under
`.nimi/local/handoff/` (or wherever the CLI placed it; the CLI
output names the path).

Open the JSON. Notice:

- `skill: "spec_reconstruction"`
- A typed payload with required context order
- Source basis paths the host should read

The payload is the contract between the package and the host.

## Step 5: Stop Here

You have completed the bootstrap. The project is now Nimi
Coding-adopting. The next step (in
[First Wave End-To-End](/nimicoding/tutorials/first-wave-end-to-end))
is to actually run a wave.

For this tutorial, **stop here**. Do not yet hand the payload
to a host; do not yet run reconstruction. Bootstrap is
complete; that is your outcome.

## Common Issues

| Symptom | Resolution |
| --- | --- |
| `nimicoding start` complains about existing files | Review the conflict; the CLI preserves project-owned truth and refuses to overwrite |
| `nimicoding doctor` reports lifecycle drift | Run `start` again; the CLI is idempotent for bootstrap |
| AGENTS.md changes not applied | The CLI shows confirmation; if you declined, re-run and confirm |

## What You Have Now

After this tutorial, your project has:

- A complete `.nimi/**` bootstrap.
- Managed AI entrypoints in `AGENTS.md` and `CLAUDE.md`.
- A `spec_reconstruction` handoff payload ready to hand off.

What you do **not** yet have:

- A reconstructed canonical spec tree (next step).
- Any topic / wave / packet artifacts (created later as needed).
- AI-coding work governed yet (you have the discipline available
  but no work in progress).

## Next Step

If you want to actually use the methodology on a sample task,
continue to
[First Wave End-To-End](/nimicoding/tutorials/first-wave-end-to-end).

## What This Tutorial Does Not Cover

This tutorial does not cover host-specific configuration for
specific AI hosts. The package is host-agnostic; you can pick
any admitted host.

## Source Basis

- [`nimi-coding/README.md`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/README.md)
- [`nimi-coding/cli/`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/cli/) (CLI implementation)
- [`nimi-coding/methodology/spec-reconstruction.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/methodology/spec-reconstruction.yaml)
- [`nimi-coding/methodology/skill-handoff.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/methodology/skill-handoff.yaml)
