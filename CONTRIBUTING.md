# Contributing

Thanks for contributing to Nimi.

## Prerequisites

- Node.js `>=24`
- pnpm `>=10`
- Go for Runtime, proto tooling, and Go SDK conformance (see `runtime/go.mod`)
- Rust for native packages and the Kit Tauri shell crate
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
- For App development, use the Desktop-supervised `pnpm dev:<app>` commands in [LOCAL_DEVELOPMENT.md](./LOCAL_DEVELOPMENT.md); first-party Apps run on the Electron host, not a Tauri development shell.
- For full onboarding flow and environment template details, follow [ONBOARDING.md](./ONBOARDING.md).
- For test strategy details, follow [TESTING.md](./TESTING.md).

Optional pre-commit hook setup:

```bash
python3 -m pip install --user pipx
pipx install pre-commit
pre-commit install
```

## Development Workflow

1. **Focused Scope:** Keep PRs and commits tightly focused on the target task. Update corresponding documentation whenever user-visible behavior or developer APIs change.
2. **Local Verification:** Run local tests and type checks on affected packages before submitting changes.
3. **Continuous Integration:** Direct changes on `main` must pass automated push CI. If CI fails, promptly repair or revert the offending commit.
4. **Pull Requests:** Use pull requests for changes involving shared contracts, native installers, sensitive security domains, or release workflows. Ensure all required remote checks pass before merging.
5. **Release Authorization:** Code merged to `main` undergoes automated integration testing. Formal releases to public channels require completing the release verification checklist specified in [RELEASE.md](./RELEASE.md).

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
- DCO sign-off included for PRs targeting branches other than `main` (`git commit -s`)

## DCO

Commit-signature and Developer Certificate of Origin (DCO) sign-off requirements
are temporarily suspended for `main`, including direct pushes and PRs targeting
`main`. Neither `git commit -S` nor `git commit -s` is required for that branch.

PRs targeting other branches still require DCO sign-off. DCO is a
`Signed-off-by` commit-message trailer, not a cryptographic Git signature.
To include it, use:

```bash
git commit -s -m "feat: your change"
```

The full DCO text is in [DCO](./DCO).

## Security

For vulnerabilities, do not file public issues. Follow [SECURITY.md](./SECURITY.md).
