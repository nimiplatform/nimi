# Complete Nimi product release handoff

This is the concrete execution guide for `nimi/v<Desktop package version>`,
separate from SDK, Runtime-only and third-party App releases. Source preparation,
actual artifacts and real product acceptance are different results. A successful
build or publication does not establish installed-product acceptance.

## Inputs and custody

- Freeze an exact main ancestor SHA. `apps/desktop/package.json` supplies product
  version; all source checkouts and sidecars must match it and this SHA. Do not
  edit built/signed assets or version files on build runners.
- Platform admits the real raw Ed25519 public key in
  `config/product-update-policy.mjs` and retains its signing custody. Empty key
  refuses public production builders, manifests, release staging and product-feed deploy.
  Existing Mac local-acceptance Apple-signed candidates may still build without
  this updater key; their helper always seals empty update trust, installation
  stays disabled, and their local realmOrigin prevents public promotion.
  CLI consumes an existing private-key file via `--signing-key`; it never
  generates a replacement. The workflow's `NIMI_PRODUCT_UPDATE_SIGNING_KEY_PEM`
  secret is a custody reference; its name alone does not prove provisioning or
  a match to the admitted key. Platform must approve/provision that binding,
  and the workflow verifies the actual pair before signing work. Do not put
  private keys in chat, Git or artifacts.
- Mac reuses `NIMI_MACOS_SIGNING_P12_BASE64`,
  `NIMI_MACOS_SIGNING_P12_PASSWORD`, `NIMI_NOTARY_APPLE_ID` and
  `NIMI_NOTARY_APP_PASSWORD` from the existing temporary-Keychain workflow;
  Developer ID identities must be Team RMZJPQQR3X. Local-acceptance Realm builds
  remain non-publishable. Final release sidecar must say
  `realmOrigin=https://realm.nimi.ai`.
- Publisher uses the dedicated `NIMI_PRODUCT_RELEASES_TOKEN` reference. Its
  actual permissions are not assumed: publication needs release/tag write and
  immutable-settings administration read. Keep it scoped to nimiplatform/nimi
  and provision it only for the publishing workflow. It is never deployed to
  Gateway. Missing custody or permissions refuse publication.
  No script enables immutability or changes secrets/repository settings.
- Gateway reuses existing Cloudflare account/API token custody and the optional
  read-only `NIMI_GITHUB_RELEASES_TOKEN`. Refresh that reader separately from
  publishing custody. No publishing token or signing private key is deployed
  to Gateway.

The operator's ephemeral admission JSON is publishing input, not another
version or evidence ledger. Its exact keys are:

```json
{
  "releaseId": "nimi/v<package version>",
  "sourceRevision": "<40 lowercase hex SHA>",
  "channel": "beta",
  "publishedAt": "<UTC timestamp>",
  "expiresAt": "<later UTC timestamp>",
  "compatibility": {
    "macos-arm64": {
      "minimumProductVersion": "<owner approved version>",
      "minimumOsVersion": "13.0",
      "dataPolicy": "owner-approved-forward"
    },
    "windows-amd64": {
      "minimumProductVersion": "<owner approved version>",
      "minimumOsVersion": "10.0.19041",
      "dataPolicy": "owner-approved-forward"
    }
  }
}
```

Replace angle-bracket values with approved real inputs. Both targets use the
same publication/expiry window; allow the window to cover real builds and
validation. Expired input fails instead of being refreshed after signing.
Windows OS floor remains subject to Platform admission and real Windows
validation; the example is not a tested support promise.

## Build and prepare on each actual platform

Use locked workspace dependencies, Node 24, pnpm 10.34.5, the Runtime Go version
and Rust/native tools. Mac requires Apple Silicon, admitted signing identities
and notary credentials. Windows requires native x64, MSVC/native tools, Sharp
x64 dependencies and NSIS (workflow pins Chocolatey NSIS 3.11). Windows
Authenticode is unsigned for initial Beta; a development signer is not accepted
as formal product trust. Missing machine/tool/signing prerequisites block their
actual execution.

From the clean repository root on Mac, using existing signing environment:

```sh
pnpm build:macos:release
pnpm release:product:prepare-target -- --identity <Mac output>/release-build-identity.json --asset <Mac output>/Nimi-<version>-macos-arm64.pkg --admission <admission.json> --signing-key <custody key file> --source <SHA> --output .nimi/local/product-release/macos-arm64
```

The builder signs the app and roles, notarizes/staples, creates the signed PKG,
then notarizes/staples and validates the **final PKG bytes** before the sidecar
hash. Preparation rechecks Installer Team/notarized PKG, signs the timed update
envelope and copies those final bytes verbatim. Do not modify or repackage them.

On Windows, from the same clean source SHA:

```sh
pnpm build:windows:product --identity-signing-key <custody key file>
pnpm release:product:prepare-target -- --identity apps/desktop/dist/windows/product/Nimi-<version>-windows-amd64.exe.identity.json --asset apps/desktop/dist/windows/product/Nimi-<version>-windows-amd64.exe --inventory apps/desktop/dist/windows/product/nimi-installed-windows-amd64.json --admission <admission.json> --signing-key <custody key file> --source <SHA> --output .nimi/local/product-release/windows-amd64
```

The signed installed inventory is formed from actual packaged Desktop,
Runtime, bundled Avatar/resources/updater and files, embedded in NSIS and
exported unchanged. Only after NSIS finishes do its final size/SHA and sidecar
feed the timed envelope. The producer authenticates the inventory and checks
version/source/channel/components against the sidecar/envelope.

`release:product-update:manifest` remains available for direct one-target
manifest preparation and now requires `--inventory` for Windows. It does not
assemble or publish a complete release.

## Cross-machine consumption and publication

Copy each target's prepared files into one new flat directory (e.g.
`.nimi/local/product-release/ready`). Transport exact binary bytes; artifact ZIP
wrapping is transport only. The complete set is seven files:

| File | Owner/use |
| --- | --- |
| Nimi-<version>-macos-arm64.pkg | Final signed/notarized installer |
| Nimi-<version>-windows-amd64.exe | Final unsigned NSIS installer |
| nimi-update-macos-arm64.json | Platform timed Ed25519 envelope |
| nimi-update-windows-amd64.json | Platform timed Ed25519 envelope |
| nimi-build-macos-arm64.json | Existing builder sidecar input |
| nimi-build-windows-amd64.json | Existing builder sidecar input |
| nimi-installed-windows-amd64.json | Same signed inventory embedded in EXE |

```sh
pnpm release:product:validate -- --directory .nimi/local/product-release/ready --source <SHA>
```

This authenticates metadata/inventory, exact source/version/channel/target and
component versions, both target windows, and every final SHA/size. Extra/missing
files fail. It does not prove payload usability or Windows full product/App Host
composition. Those remain explicit acceptance prerequisites.

`.github/workflows/release-product.yml` is manual. `publish=false` builds and
prepares both targets, validates the complete set and retains a ready artifact.
`publish=true` additionally runs the real publication entry.
Source/admission/key are checked before signing work.

To publish a previously prepared and approved set from GitHub, set
`prepared_run_id` and `prepared_run_attempt` to the run that produced its
`nimi-product-ready-<run>-<attempt>` artifact. Keep `source_sha` and admission
equal to that original set. The existing workflow downloads that exact artifact
from this repository with read-only Actions permission, verifies all seven
original files through the same source/key/cohort/final-byte validator, and
uses the same publisher. It does not rebuild, re-sign or refresh signed times.
Missing artifacts, source/trust mismatches and expired metadata still refuse
publication. The workflow definition can be newer than the frozen payload source;
the artifact's signed source remains the product tag's source. The publisher
runs clean, admitted main code and reads version from the frozen payload commit,
which must be its main-line ancestor; it never substitutes the operator's newer
package version. Dirty or unadmitted operator code refuses publication.

Only after owner approval of a concrete ready set may an authorized operator run:

```sh
pnpm release:product:publish -- --directory .nimi/local/product-release/ready --source <SHA> --notes <reviewed notes file>
```

The script uses only nimiplatform/nimi, checks immutable releases are enabled,
checks existing tag source, discovers drafts through authenticated paginated
List releases (not the published-only tag lookup), and binds creation/retry,
asset upload, validation and publish to the same numeric release ID. It uploads missing
assets without clobber, verifies **all remote asset SHA/size/identity**, then
rechecks both authenticated payloads' validity immediately before the draft
transition. Upload-time expiry leaves the draft unpublished; no signed times
or version are automatically refreshed. It then
publishes and verifies immutable=true plus the locked tag/source. Unknown or
different existing assets block. No asset is patched after publish. GitHub's
[draft-first immutable release behavior](https://cli.github.com/manual/gh_release_create)
is used; [immutable settings read](https://docs.github.com/en/rest/repos/repos#check-if-immutable-releases-are-enabled-for-a-repository)
requires owner-approved administration read permission. A failure after final
publication is an actual published state needing owner review, not a rollback.

Before publication GitHub may report draft-only `untagged-...` download URLs.
Those temporary URLs are not consumed or written into signed metadata. Draft
verification still binds the exact release ID, source, names, sizes and digests;
the publisher requires the exact final tag-bound URLs after publication.

## Gateway and real acceptance

Run `pnpm --filter @nimiplatform/install-gateway test` and `build` for the exact
key-containing source. After separate deployment approval, manually dispatch
`deploy-install-gateway.yml` with that exact main SHA and `product_feeds=true`.
The existing Cloudflare deployment source keeps endpoint install.nimi.ai and
the GitHub-only backend. Runtime-only deploy can retain product_feeds=false;
that does not approve product feeds. This task does not deploy or change token
custody.

After immutable publication and Gateway deployment, real feeds are:

- `https://install.nimi.ai/nimi/beta/macos-arm64/latest.json`
- `https://install.nimi.ai/nimi/beta/windows-amd64/latest.json`

Verify their publisher payload against the actual immutable Release, source,
final assets and key. Then use actual product N→N+1 installations on both
platforms: background/manual check, full download, native trust, Home prepared
or exact failure, Later, explicit interruption consent, OS authorization and
refusal/expiry, critical cleanup and service failure, ordinary-user reopen,
actual installed cohort/Runtime READY/Home-ready, and original-owner forward
repair. Include no-development-tool machines and Windows full payload/independent
Host/App paths. Signing/build/tests/feed alone do not close these gates; manager
owns checkpoint acceptance and overall release disposition.
