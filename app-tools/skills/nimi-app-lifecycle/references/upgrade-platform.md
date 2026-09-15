# Platform upgrade

Read the current and selected target app-tools version matrix plus SDK/Kit migration notes. Local development uses complete npm tarballs through explicit pnpm-workspace overrides, without reading the Nimi source checkout or requiring publication. Sync preserves those selections; check validates installed identities/versions and lock resolutions. Use normal dev/test/build/pack during iteration. Public release preflight is a later step using registry resolutions, after development acceptance.

Install the target app-tools and its exact nimi-coding first. The App-local nimi-coding executable performs its own projections, so running an old installed executable is not a target-version sync. Use the target tool for `nimi-app sync --dry-run --json`; this previews app-tools files and lists the separate owner step without pretending to preview nimi-coding's internals.

Review App-owned instructions outside managed blocks when the upgrade changes an ownership boundary or command. Correct obsolete routing against the current owner; adding another conflicting paragraph is not a migration of those instructions.

Migrate the affected App-owned API uses, run sync, then install the full normalized dependency set and regenerate the package-manager lockfile. Run check and the relevant tests/build and real journey. Fresh scaffold identity and direct features remain fixed; the tool updates derived version/matrix projections. Existing Apps continue without a fresh lock.

For existing Apps, sync preserves the exact `package.json` text when its managed values are already current. A project formatter's whitespace or key ordering alone is not drift; actual managed value changes are still synchronized.

Do not downgrade away required features, edit installed package code or disable checks to get a green result. A platform capability awaiting publication blocks public release reproducibility, not independent engineering work. Validate a representative actual old-to-new combination; do not build a general migration framework.
