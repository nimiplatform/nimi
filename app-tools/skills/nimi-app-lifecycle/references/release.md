# Release and Registry

## Hosted Web

Keep the product's existing `app_id`. Set its permanent `public_slug`, run `pnpm exec nimi-app sync` and commit the managed Web workflow. A Web-only scaffold supplies `build:release`. A desktop App adding Web supplies its own browser entry and `build:web:release`, using `nimiWebViteConfig` with `release: true`. Exercise that exact build with `NIMI_WEB_VERSION` and `NIMI_WEB_ARCHIVE` before tagging. Check the ZIP's root entry, source identity and versioned assets.

Protect `web-v*` against updates/deletion and enable immutable Releases in the publisher repository. Push an authorized `web-vX.Y.Z` tag for the tested commit. With the published rc.9 workflow, if GitHub reports “no attestations found for tag” immediately after publication, rerun the failed job for the same release. Follow the [Registry's hosted Web instructions](https://github.com/nimiplatform/nimi-app-registry#remote-application-sources) to submit the version and its source in one PR. The platform operates the wildcard host and deploys after admission. A separate development origin still needs its own qualification for live Runtime use.

Verify the launch button at `https://nimi.ai/apps/<slug>`, sign in, confirm the source once in Home and exercise an actual business operation. For an App that saves results, disconnect, reconnect to the same account and primary PC, and read the saved result. Content-only updates keep the source revision. A material source change requires review and renewed consent. Before rolling back an App with persistent data, check that the older version can read data written by the newer one.

## Native desktop

Before public release, use public dependencies and frozen locks, complete portable App information and existing notices, and build/pack on the declared OS/architecture. Reuse `nimi-app check --production`, `test`, `build --target <target> --production`, and `pack --target <target> --production`. Local check does not establish GitHub settings or a release. Local installed-App acceptance can precede this with complete local npm tarballs and `pack --production`; follow the acceptance guide without requiring publication first.

The root `LICENSE` is App-owned: a new scaffold starts it as MIT naming the author or App title, sync never rewrites it, and the App sets its own terms plus the matching `package.json` `license` identifier. Keep the scaffold-managed `licenses/nimi-app-template.txt` notice for template-derived code. The packaged root `LICENSE` must match the reviewed source file byte for byte. New scaffolds include `LICENSE -text` in `.gitattributes`; for an existing repository, retain its other attributes and add that rule before tagging. It preserves the Git blob's original bytes when Windows would otherwise convert LF to CRLF. Registry checks the exact published package against the tagged source.

Electron packages must unpack native add-ons and their companion shared libraries with their relative layout intact. The scaffold uses `asar: { unpack: '**/*.{node,dylib,dll}' }` for the supported Mac/Windows targets. Existing App-owned packagers need the equivalent rule: unpacking only `.node` leaves libraries such as Sharp's libvips inside ASAR, where the OS loader cannot find them. Verify native loading from the packaged layout; a successful source launch or build alone does not prove that layout works.

Follow the [publisher setup guide](https://github.com/nimiplatform/nimi/blob/main/app-tools/README.md#publishing-on-github) before the first tag. Its `NIMI_REPOSITORY_ADMIN_TOKEN` needs only **Administration: Read-only** to check tag protection and Release immutability; actual Release uploads use GitHub's built-in token, which lacks that administration permission. A secret configured in another App repository is not inherited. Check real settings when publication is in scope. Keep App package/manifest versions equal and the annotated `v<version>` tag on a commit in the actual canonical default-branch history. Publish only with the user's existing authorization; fixing a local check does not authorize a new release.

The managed tag workflow owns production tests, target artifacts, attestations and immutable Release execution. Manual dispatch is a development build. Reuse its final Release/asset verification; a code change needs a new version, not a moved tag. Do not add local publish or another App production workflow.

For catalog admission, use the Registry owner's `scripts/prepare-submission.mjs` with the exact repository/tag and its documented App-owned inputs. Read the Registry README before using this script and confirm it exists in the selected Registry revision. It prepares only `{schema_version:1,candidate}` from actual release facts. Do not copy admission or review fields from an approved descriptor. Candidate validation and base-owned PR transition checks differ from `pnpm check`, which validates the Registry main tree.

An external publisher submits from its own fork; an authorized publisher sharing the Registry namespace can use a same-repository branch. Use one publisher-owned branch/PR for the exact version and release, including retries. Human maintainers own admission; the agent must not invent their decision. Registry main stores metadata, while bytes remain with the publisher Release.

Real matching unsigned or unnotarized posture is not automatically a blocker. Do not require KYC, non-null SBOM or purchased signing as a generic prerequisite. State proof strength according to what the existing verifier actually checks.

First publication and admission can precede installed acceptance. Verify first Catalog installation and business use afterward. Test an update only once a second, higher version is separately admitted; a future N+1 is not a prerequisite for the first release.

Maintain the App-owned root `NIMI_APP.md` as the user introduction under the lifecycle guide. Remove `metadata.readme`; check and pack use only the fixed file, and sync never supplies missing product prose. Keep engineering setup and verification records in repository/developer documentation.
