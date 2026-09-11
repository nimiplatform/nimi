---
name: nimi-app-acceptance
description: Run Desktop-supervised Nimi App acceptance or debug an App renderer through its exact CDP target. Use when the task requires real App interaction or renderer observation.
---

# Nimi App acceptance

Verify the requested behavior in the real supported App. Start from the affected consumer and its direct contract; use the applicable AGENTS.md chain and the App's package manifest to choose the existing launch command.

## Launch and target

- Launch through the guarded package script with Desktop-supervised Electron. Attach to the exact App named by the task; do not open its Vite renderer directly or attach to Desktop or another App as a substitute.
- Generic `nimi-app dev` selects and prints an ephemeral loopback CDP port. When a stable port is needed, use `pnpm --filter <app-package> dev -- --cdp-port <free-port>` with the actual package and an available port.
- Root `pnpm dev:desktop`, `dev:zhiyu`, `dev:lab`, and `dev:avatar` own deterministic default ports. Generic dev may read the exact `NIMI_APP_DEV_CDP_PORT` override from the project `.env`; `--cdp-port` overrides either path and `--no-cdp` disables CDP.
- Keep CDP loopback-only, development-only, and ephemeral. Native and owner UI remain outside CDP; use their supported owner paths when the task requires them.

## Observe and complete

- Reproduce the reported behavior or exercise the newly requested interaction, repair failures within scope, and rerun the affected journey. A missing prerequisite blocks only dependent work.
- Use the existing browser/CDP tooling for observation. Do not add alternative CDP defaults, acceptance harnesses, Playwright projects, helper endpoints, recordings, fixtures, baselines, or evidence systems.
- Run checks that cover the changed behavior. CDP visibility, screenshots, and fixture output do not establish the full product result.
- Report the observed outcome and mark relevant unexecuted paths `NOT-VERIFIED`. Put any necessary local artifacts under `.nimi/local/**`.
