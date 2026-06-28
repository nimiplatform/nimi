# Nimi App Template

This directory is the tracked output shape for `pnpm dlx --package @nimiplatform/app-tools nimi-app create --profile standalone`.

Outside this repo:

```bash
pnpm dlx --package @nimiplatform/app-tools nimi-app create --dir my-nimi-app --profile standalone
cd my-nimi-app
pnpm install
pnpm start
```

Inside this repo, use it as a reference template for app scaffolding and SDK-first runtime integration.

This template uses published-package semver for `@nimiplatform/sdk`, `@nimiplatform/kit`, and `@nimiplatform/app-tools`; generated projects install their own dependencies with `pnpm install`.
