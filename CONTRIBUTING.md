# Contributing

Thanks for contributing to Nimi.

## Prerequisites

- Node.js `>=24`
- pnpm `>=10`
- Go for Runtime, proto tooling, and Go SDK conformance (see `runtime/go.mod`)
- Rust for native packages and Tauri apps
- Buf CLI (for proto work)

## Repository Setup

```bash
pnpm install
```

Runtime:

```bash
cd runtime
go test ./... -count=1
```

Workspace build:

```bash
pnpm build
```

## Development Setup Notes

- For desktop runtime debugging, use Desktop Runtime settings and app-specific dev docs.
- For proto changes, run `pnpm proto:generate` and ensure no generated drift is left.
- For Runtime changes, start with the affected Go package test. Use all Runtime tests for Runtime-wide changes; add vet/build when the changed boundary requires them.
- For kit changes, run `pnpm --filter @nimiplatform/kit build && pnpm --filter @nimiplatform/kit test`.
- For Tauri app development, use the app-specific script documented by that active app.
- For full onboarding flow and environment template details, follow [ONBOARDING.md](./ONBOARDING.md).
- For test strategy details, follow [TESTING.md](./TESTING.md).

Optional pre-commit hook setup:

```bash
python3 -m pip install --user pipx
pipx install pre-commit
pre-commit install
```

## Development Workflow

1. Keep scope focused and update docs when behavior changes. Use a branch or worktree when it helps isolate concurrent work.
2. Run the affected behavior and relevant local tests/type checks.
3. Ordinary changes may be pushed directly to `main`. Follow the push CI results and repair or revert failures; `main` is an integration branch, not a promise that every commit is releasable.
4. Use a PR for shared public contracts, native installation, data handling, and release workflow changes. Complete the relevant remote checks before merging; no independent human approval is required. Do not assume optional auto-merge waits for checks after branch rules change.
5. Publication needs explicit authorization for the version and channel, plus that version's required validation. A commit being on `main` does not authorize its release. Authorization to publish after successful validation need not be requested again; authorization only to prepare a candidate is not publication authorization.

## AI-Assisted Contributions

If you use AI coding tools, follow the AGENTS hierarchy as the single rule source:

1. [`AGENTS.md`](./AGENTS.md) for repo-wide rules
2. The nearest path-scoped `*/AGENTS.md` for component rules

For `.nimi/spec/**` changes, also follow
[`.nimi/methodology/authority-authoring.yaml`](./.nimi/methodology/authority-authoring.yaml).

Compatibility files such as `CLAUDE.md`, `.github/copilot-instructions.md`, and `*context.md` are navigation shims only. They must not be treated as independent rule definitions.

## Pull Request Checklist

- Code compiles
- Relevant tests pass
- Docs updated if API/behavior changed
- No unrelated file changes
- Commit messages are descriptive
- DCO sign-off included (`git commit -s`)

## DCO

This repository uses Developer Certificate of Origin sign-off.

By contributing, you certify your commits with:

```bash
git commit -s -m "feat: your change"
```

The full DCO text is in [DCO](./DCO).

## Security

For vulnerabilities, do not file public issues. Follow [SECURITY.md](./SECURITY.md).
