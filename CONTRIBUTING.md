# Contributing

Thanks for contributing to Nimi.

## Prerequisites

- Node.js `>=24`
- pnpm `>=10`
- Go `1.24+`

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
