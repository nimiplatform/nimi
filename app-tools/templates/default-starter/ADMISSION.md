# Acme Widget Nimi Listing Request

This document is a developer-submitted listing request. It is not an approval, release descriptor, permission grant, or install truth.

## Developer Runbook

```bash
pnpm install
pnpm run init
pnpm dev
pnpm run check
pnpm run pack
```

## Submission Inputs

- `nimi.app.yaml` declares app identity and requested API scopes.
- `.nimi/admission/submission.yaml` records publish-readiness commands and review inputs.
- `.nimi/admission/build-profile.yaml` records install, init, build, and lockfile policy.
- `dist/nimi-app-submission.json` is produced by `pnpm run pack` after a successful renderer build.
- `dist/nimi-app-artifact-evidence.json` records sha256 and typed size evidence for `dist/index.html`.

Submission and artifact evidence remain developer-submitted inputs. They must keep public admission, release descriptor, ordinary visibility, signing, notarization, mirror/license clearance, and permission grant truth as `not-generated`.

## Reviewer Boundary

Nimi Platform review owns final admission, release descriptors, ordinary-user visibility, install availability, and permission grants.
