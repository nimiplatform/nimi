# Nimi Mod Catalog Template

This directory documents the static GitHub-first catalog layout that desktop v1 expects.

Expected tree:

```text
index/v1/
├── packages.json
├── packages/<packageId>.json
├── releases/<packageId>/<version>.json
├── revocations.json
└── advisories.json
```

Recommended authoring flow for an official catalog repo:

```bash
pnpm generate:mod-catalog-fixture --source-dir nimi-mods --out-dir ./catalog --signers-file ./signers.json
pnpm check:mod-catalog-signers -- --signers-file ./signers.json --catalog-dir ./catalog
```

If you create a standalone `nimiplatform/nimi-mod-catalog` repository, copy the following from this template:

- `index/v1/**`
- `scripts/validate-catalog.mjs`
- `.github/workflows/validate-catalog.yml`
- `.github/workflows/publish-pages.yml`
- `package.json`
- `signers.example.json` renamed to `signers.json`

Suggested bootstrap steps in the new repo:

```bash
cp signers.example.json signers.json
npm run check:catalog
```

Expected secret and branch policy for automated official releases:

- secret: `NIMI_MOD_CATALOG_REPO_TOKEN`
- source workflow pushes a `codex/catalog-<packageId>-<version>` branch
- PR base branch defaults to `main`
- the same token is used for catalog repo checkout and PR creation when the catalog repo is private
- workflow reruns force-update the same branch and edit the existing open PR instead of opening a duplicate
- if the catalog repo is the same repo as the source workflow, `github.token` is enough; cross-repo private catalogs should always configure `NIMI_MOD_CATALOG_REPO_TOKEN`

Recommended repository settings:

- default branch: `main`
- enable GitHub Pages from GitHub Actions
- protect `main` and require `validate-catalog`
- expose the static catalog either from raw GitHub URLs or the GitHub Pages URL

Desktop should point `NIMI_MOD_CATALOG_BASE_URL` at either:

- `https://raw.githubusercontent.com/<owner>/<repo>/main`
- `https://<owner>.github.io/<repo>`

This template also includes a minimal checked-in fixture under `index/v1/**`:

- one installable `desktop-mod`
- one forward-compatible `nimi-app`
- one sample revocation
- one sample advisory

That fixture is intentionally small but structurally complete, so it can be copied into a new `nimi-mod-catalog` repo as an initial scaffold.

Notes:

- `packages.json` is the browse/search summary list
- `packages/<id>.json` holds channel pointers, trust/risk state, signer registry, and release list
- `releases/<id>/<version>.json` is immutable release metadata derived from `release.manifest.json`
- `revocations.json` and `advisories.json` are policy overlays consumed before install/update
- desktop v1 only installs `packageType=desktop-mod`; `nimi-app` entries can still be listed for future compatibility
- `nimi-app` release records may additionally carry `appMode`, `scopeCatalogVersion`, and `minRuntimeVersion`
- official source-repo release automation is expected to call `scripts/update-mod-catalog.mjs` from the source repo, then push a PR into this catalog repo
- `.github/workflows/validate-catalog.yml` is the PR gate for structure/signers drift
- `.github/workflows/publish-pages.yml` publishes `index/**` as a static Pages site on every `main` push
