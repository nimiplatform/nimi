# Nimi Tester Nimi Listing Request

This document is a developer-submitted listing request. It is not an approval, release descriptor, permission grant, or install truth.

## Developer Runbook

```bash
pnpm install
pnpm run init
pnpm dev:shell
pnpm run check
pnpm run pack
```

## Submission Inputs

- `nimi.app.yaml` declares app identity and requested API scopes.
- `.nimi/admission/submission.yaml` records publish-readiness commands and review inputs.
- `.nimi/admission/build-profile.yaml` records install, init, build, and lockfile policy.
- `dist/nimi-app-submission.json` is produced by `pnpm run pack` after a successful renderer build.

## Reviewer Boundary

Nimi Platform review owns final admission, release descriptors, ordinary-user visibility, install availability, and permission grants.
