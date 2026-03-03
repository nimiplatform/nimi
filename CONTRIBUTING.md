# Contributing

Thanks for contributing to Nimi.

## Prerequisites

- Node.js `>=24`
- pnpm `>=10`
- Go `1.24+`
- Rust (for desktop/Tauri work)
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

- For desktop + mods local debugging, set both `NIMI_MODS_ROOT` and `NIMI_RUNTIME_MODS_DIR` as absolute paths.
- For proto changes, run `pnpm proto:generate` and ensure no generated drift is left.
- For runtime changes, run `cd runtime && go test ./...` and `go vet ./...`.
- For full onboarding flow and environment template details, follow [ONBOARDING.md](./ONBOARDING.md).
- For test strategy details, follow [TESTING.md](./TESTING.md).

Optional (recommended) pre-commit hook setup:

```bash
python3 -m pip install --user pre-commit
pre-commit install
```

## Development Workflow

1. Create a feature branch from `main`.
2. Keep scope focused and update docs when behavior changes.
3. Run relevant tests/lint/type checks before opening a PR.
4. Open a PR with clear change summary and verification steps.

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
