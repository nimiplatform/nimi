---
name: nimi-app-lifecycle
description: Create, adapt, maintain and prepare releases of Nimi App repositories with app-tools and the standard SDK/Kit carrier. Use for App development, not for carrying out the App's own creative or research tasks.
---

# Nimi App lifecycle

Start with the repository's package manifest, actual product entry and nearest instructions. Preserve the user's current product scope and stage. Read only the scenario needed now:

| Task | Guide |
| --- | --- |
| Create a new App | [Create](references/create.md) |
| Adapt an existing project | [Adapt](references/adapt.md) |
| Upgrade app-tools, SDK or Kit | [Platform upgrade](references/upgrade-platform.md) |
| Bring in upstream changes | [Upstream sync](references/sync-upstream.md) |
| Prepare a Release or Registry submission | [Release](references/release.md) |
| Verify real App behavior or installation | [Acceptance](references/acceptance.md) |

For an ordinary product edit, follow its existing code and tests. Do not reinitialize or run the entire release journey unless affected inputs or behavior require it.

## Boundaries that matter

- App-owned workflows, tool handlers, business accounts, non-AI services and product presentation stay with the App. Nimi AI, configuration, managed storage and protected sessions use public SDK/Kit Local App surfaces. Display identity is not a business login ticket.
- For an existing App's first Nimi integration or foundation wiring change, follow the adaptation guide's same-package generated reference first. Reuse its Host, preload, renderer, session, App Access, AIConfig and AI call wiring; documentation complements that implementation. Preserve the original product journeys and settings rather than treating the reference workbench as the finished App. Reuse passing baseline results for ordinary business edits.
- Fresh Apps use pnpm, Vite and Desktop-supervised Electron. Existing Apps may use another renderer framework with an App-owned development command and the `electron-pnpm` build profile. A Next/server or Python project still needs real Host and backend lifecycle/build work. Preserve its original user tasks and framework where they fit; initialization does not convert the product.
- Read the selected app-tools package's `nimiScaffoldVersions` and the SDK/Kit migration notes. Development can consume complete local npm tarballs through explicit pnpm-workspace overrides; keep the selected matrix and lockfile, follow the package README, and do not require publication before iteration. Public release preflight requires registry resolutions; local package acceptance is not public installation evidence.
- App Tools maintains its fixed lifecycle skill, AGENTS block and declared engineering projections. Existing Apps have no fresh scaffold intent/lock. Preserve their Host, product source and license; report unknown file collisions rather than inventing ownership.
- GitHub owns publisher builds and Releases; Registry owns candidate validation and human admission; Runtime owns packages and App access; Desktop owns exact processes. These are separate facts. The external AI host owns the development task.
- Continue authorized work through verification. Missing prerequisites pause dependent steps only. Never infer publication or human approval from a passing command. Mark relevant unrun product paths NOT-VERIFIED.

The package's README and `nimi-app --help` expose this same guide before init. Explicit init/sync projects it into the App; dependency installation does not activate repository instructions.
