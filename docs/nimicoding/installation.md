# Nimi Coding Installation

Nimi Coding is distributed as the public npm package
`@nimiplatform/nimi-coding`. Install it in the project where you want
the `.nimi/**` governance layer and the `nimicoding` CLI.

## Requirements

| Requirement | Notes |
| --- | --- |
| Node.js | 24 or newer |
| Package manager | npm, pnpm, yarn, or another tool that can install npm packages |
| Project root | A version-controlled project is recommended because `start` creates files |

## Install

Use your project's package manager:

```bash
npm install --save-dev @nimiplatform/nimi-coding
```

or:

```bash
pnpm add -D @nimiplatform/nimi-coding
```

After installation, the project should have a `nimicoding` binary
available through the package manager:

```bash
npx nimicoding --version
npx nimicoding --help
```

## Bootstrap

Run `start` from the project root:

```bash
npx nimicoding start
```

If you want the first prompt shaped for a specific host, use:

```bash
npx nimicoding start --host codex
npx nimicoding start --host claude
npx nimicoding start --host oh-my-codex
```

For a non-interactive smoke test, use:

```bash
npx nimicoding start --yes
npx nimicoding doctor --json
```

`start` creates or updates the package-owned bootstrap layer under
`.nimi/**`, adds managed AI entrypoint blocks when you accept them, and
prepares the next handoff payload. It preserves project-owned truth:
`.nimi/spec/**`, `.nimi/local/**`, `.nimi/cache/**`, and locally
modified bootstrap files are not silently deleted or overwritten.

## First Checks

| Check | Expected result |
| --- | --- |
| `nimicoding --version` | Prints the installed package version |
| `nimicoding --help` | Lists bootstrap, sync, topic, sweep audit, sweep design, handoff, closeout, high-risk gates, and validators |
| `nimicoding doctor --json` | Reports the bootstrap health state in machine-readable form |

To check package-owned seed projection later:

```bash
npx nimicoding sync --check
```

## Remove Package-Managed Bootstrap

If you need to remove the package-managed bootstrap files from a test
project, run:

```bash
npx nimicoding clear --yes
```

`clear` removes managed AI blocks and package-owned bootstrap files
only when they still match the packaged seed. It preserves
project-owned truth and local operational evidence.

## Source Basis

- [`nimi-coding/package.json`](https://github.com/nimiplatform/nimi-coding/blob/main/package.json)
- [`nimi-coding/README.md`](https://github.com/nimiplatform/nimi-coding/blob/main/README.md)
- [`nimi-coding/cli/`](https://github.com/nimiplatform/nimi-coding/blob/main/cli/)
- [`nimi-coding/contracts/topic.schema.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/topic.schema.yaml)
