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
- The current authoring recipe uses pnpm, Vite and Desktop-supervised Electron. A Next/server or Python project needs real App-owned carrier/build work before adoption. Preserve the original user tasks; do not silently reduce the product to a scaffold example.
- Read the selected app-tools package's `nimiScaffoldVersions` and the SDK/Kit migration notes. Public Apps use published registry dependencies. Private platform experiments are not public installation evidence.
- App Tools maintains its fixed lifecycle skill, AGENTS block and declared engineering projections. Existing Apps have no fresh scaffold intent/lock. Preserve their Host, product source and license; report unknown file collisions rather than inventing ownership.
- GitHub owns publisher builds and Releases; Registry owns candidate validation and human admission; Runtime owns packages and App access; Desktop owns exact processes. These are separate facts. The external AI host owns the development task.
- Continue authorized work through verification. Missing prerequisites pause dependent steps only. Never infer publication or human approval from a passing command. Mark relevant unrun product paths NOT-VERIFIED.

The package's README and `nimi-app --help` expose this same guide before init. Explicit init/sync projects it into the App; dependency installation does not activate repository instructions.
