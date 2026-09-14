# Release and Registry

Before production, use public dependencies and frozen locks, complete portable App information and existing notices, and build/pack on the declared OS/architecture. Reuse `nimi-app check --production`, `test`, `build --target <target> --production`, and `pack --target <target> --production`. Local check does not establish GitHub settings or a release.

Follow the [publisher setup guide](https://github.com/nimiplatform/nimi/blob/main/app-tools/README.md#publishing-on-github) before the first tag. Its `NIMI_REPOSITORY_ADMIN_TOKEN` needs only **Administration: Read-only** to check tag protection and Release immutability; actual Release uploads use GitHub's built-in token, which lacks that administration permission. A secret configured in another App repository is not inherited. Check real settings when publication is in scope. Keep App package/manifest versions equal and the annotated `v<version>` tag on a commit in the actual canonical default-branch history. Publish only with the user's existing authorization; fixing a local check does not authorize a new release.

The managed tag workflow owns production tests, target artifacts, attestations and immutable Release execution. Manual dispatch is a development build. Reuse its final Release/asset verification; a code change needs a new version, not a moved tag. Do not add local publish or another App production workflow.

For catalog admission, use the Registry owner's `scripts/prepare-submission.mjs` with the exact repository/tag and its documented App-owned inputs. Read the Registry README before using this script and confirm it exists in the selected Registry revision. It prepares only `{schema_version:1,candidate}` from actual release facts. Do not copy admission or review fields from an approved descriptor. Candidate validation and base-owned PR transition checks differ from `pnpm check`, which validates the Registry main tree.

An external publisher submits from its own fork; an authorized publisher sharing the Registry namespace can use a same-repository branch. Use one publisher-owned branch/PR for the exact version and release, including retries. Human maintainers own admission; the agent must not invent their decision. Registry main stores metadata, while bytes remain with the publisher Release.

Real matching unsigned or unnotarized posture is not automatically a blocker. Do not require KYC, non-null SBOM or purchased signing as a generic prerequisite. State proof strength according to what the existing verifier actually checks.

First publication and admission can precede installed acceptance. Verify first Catalog installation and business use afterward. Test an update only once a second, higher version is separately admitted; a future N+1 is not a prerequisite for the first release.
