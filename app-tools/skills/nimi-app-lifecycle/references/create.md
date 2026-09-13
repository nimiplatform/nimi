# New project

Use `nimi-app create` with an App ID, title and the admitted features the user's task needs. `--features all` means the tool's admitted catalog, not all Nimi Lab code. `nimi-app --help` lists the actual options and capability names.

After creation: install dependencies, run `pnpm exec nimi-app init`, then sync/check. Init can be previewed with `--dry-run --json`. The lifecycle skill becomes project-local at init; create's package content can already be read for guidance.

Build App-owned routes and workflows on the generated carrier. Preserve the selected App identity and direct feature selection. Use existing package test/build commands and exercise the affected real App task through the official launcher. Placeholder artwork or an empty feature list does not make a release-ready product: complete the App's portable information before production packaging.
