# Platform upgrade

App Tools 0.14 defaults to SDK 0.22.2, Kit/native 0.22.1, Tauri 0.11.1 and
protected-local 0.11.2. Upgrade this combination together with a matching Runtime. Existing
0.21 SDK/Kit combinations remain explicit selections; sync does not upgrade
business dependencies. Every App must own a root `NIMI_APP.md`; remove the
retired `metadata.readme` field. Review the SDK and Kit 0.22 migration notes
for Realm media delivery, Desktop Open v2 and LocalAgent Conversation changes.

Fresh App Tools 0.13 scaffolds require Kit `^0.21.0` or a later admitted pair
with the standard navigation contract. The combination list also contains
existing-adoption pairs; those do not permit older Kit in a new scaffold.
Init verifies generated sources and immutable identity/direct features before
owner calls. Ordinary current-contract sync preserves a supported selection.

The `2026-10-13.standard-app-navigation-v1` contract is a hard cut. An older
managed scaffold fails init/sync/check before any file write or owner mutation,
even after only the tool or only Kit is upgraded. It has no automatic migration.
Prepare a fresh reference with the same App identity, version and direct features
using the complete target packages. Migrate the App-owned product to its own
catalog and one `createNimiNavigation` controller, remove Router/active-view/history
writers and persisted position, and preserve business data, drafts and leave rules.
Review and replace the managed Host/glue and complete reference intent/lock as
the same explicit migration; add the App-owned navigation seed and retain the
App-owned product and license. Do not graft new glue onto an old lock or mark an
old router as the new contract. Then run the target tool's check, sync dry-run,
normal sync, installed dependency checks, build/tests and real supervised journey.
This contract replacement is the bounded exception to ordinary immutable intent
editing; it is an author-performed migration, never a sync fallback.

Read the current and selected target app-tools version matrix plus SDK/Kit migration notes. App-side package consumption uses complete npm tarballs through explicit pnpm-workspace overrides, without depending on the Nimi source checkout or requiring publication. For an authorized platform repair or extension, follow [Platform gaps](platform-gaps.md). Sync preserves package selections; check validates installed identities/versions and lock resolutions. Use normal dev/test/build/pack during iteration. Public release preflight is a later step using registry resolutions, after development acceptance.

Install the target app-tools and its exact nimi-coding first. The App-local nimi-coding executable performs its own projections, so running an old installed executable is not a target-version sync. Use the target tool for `nimi-app sync --dry-run --json`; this previews app-tools files and lists the separate owner step without pretending to preview nimi-coding's internals.

Review App-owned instructions outside managed blocks when the upgrade changes an ownership boundary or command. Correct obsolete routing against the current owner; adding another conflicting paragraph is not a migration of those instructions.

Upgrading app-tools does not by itself move an existing App's SDK/Kit combination: sync preserves a supported combination and check rejects an unlisted SDK x Kit pairing rather than normalizing it. Selecting a new SDK/Kit combination is a deliberate App decision. When it is made, migrate the affected App-owned API uses, run sync, then install the full normalized dependency set and regenerate the package-manager lockfile. Run check and the relevant tests/build and real journey. Fresh scaffold identity and direct features remain fixed; the tool updates derived version/matrix projections. Existing Apps continue without a fresh lock.

A scaffold from an app-tools version that still managed `LICENSE` hands it to the App on the next sync: the file stays byte for byte, the lock records the App as owner, sync reports the handover and adds `licenses/nimi-app-template.txt`, and check asks for that sync first. Replace a license that still names the template holder with the App's own terms.

For existing Apps, sync preserves the exact `package.json` text when its managed values are already current. A project formatter's whitespace or key ordering alone is not drift; actual managed value changes are still synchronized.

Do not downgrade away required features, edit installed package code or disable checks to get a green result. A platform capability awaiting publication blocks public release reproducibility, not independent engineering work. Validate a representative actual old-to-new combination; do not build a general migration framework.

README.md and SECURITY.md belong to the App after creation. If an earlier lock lists them as managed, explicit sync transfers ownership without rewriting their contents or recreating missing documents. Run sync and commit the updated lock; subsequent sync and check preserve the App-authored documents.

Maintain the App-owned root `NIMI_APP.md` as the user introduction under the lifecycle guide. Remove `metadata.readme`; check and pack use only the fixed file, and sync never supplies missing product prose. Keep engineering setup and verification records in repository/developer documentation.
