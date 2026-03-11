# Nimi App Template

This directory is the tracked output shape for `pnpm dlx @nimiplatform/dev-tools nimi-app create --template basic`.

Outside this repo:

```bash
pnpm dlx @nimiplatform/dev-tools nimi-app create --dir my-nimi-app --template basic
cd my-nimi-app
pnpm install
pnpm start
```

Inside this repo, use it as a reference template for app scaffolding and SDK-first runtime integration.

Current limitation: this template uses published-package semver (`@nimiplatform/sdk`), so a standalone `pnpm install` only works after the SDK package is published. Before publication, treat this directory as a tracked scaffold reference, not a self-installed workspace package.
