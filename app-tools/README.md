# `@nimiplatform/app-tools`

`app-tools` is the public full-stack developer toolkit for third-party Nimi Apps. It owns repository scaffolding, dependency and managed-file synchronization, local validation, Desktop-supervised development, App-declared test/build orchestration, deterministic packaging, and managed GitHub workflow setup.

It does not own GitHub publisher or repository truth, registry review/main, Runtime installed state, Desktop process state, or Nimi Access. Nimi Account and the private Nimi backend are not publisher credentials or App-release infrastructure.

## Command family

The public CLI has exactly eight commands:

```text
create -> dependency install -> init -> sync -> check
       -> dev / test / build -> pack
```

- `create` writes a standalone private App project with a dotted App ID, exact version, public dependency declarations, developer build/submission inputs and one managed workflow. It does not install dependencies or create admission truth.
- `init` materializes package-owned projections and the scaffold lock after dependencies are installed.
- `sync` refreshes only scaffold-managed dependencies, configuration, workflow and glue. App-owned product code is preserved.
- `check` is non-mutating and incorporates the former scaffold validation behavior.
- `dev` requests the official Desktop-supervised Electron development Host.
- `test` and `build` execute the real owner commands declared in `.nimi/config/build-profile.yaml`; there is no fallback success.
- `pack` is the sole local/CI `.nimiapp` packaging owner and never uploads.

`doctor`, `update`, and local `publish` are absent without aliases. Use `check`
and `sync`; production publication runs only from a protected version tag whose
commit is already contained in the publisher repository's canonical default
branch, through the managed GitHub workflow.

Run the checked-in CLI help for the admitted feature catalog and exact options:

```bash
node app-tools/bin/nimi-app.mjs --help
```

## Create

Interactive use validates every field, shows the resolved plan and asks for confirmation. The optional `author` names one person or team; include `--author` when creating a Windows release project because the standard packager uses it for executable metadata. Non-interactive use supplies the same inputs directly:

```bash
node app-tools/bin/nimi-app.mjs create \
  --dir path/to/app \
  --profile standalone \
  --app-id example.app \
  --version 0.1.0 \
  --title "Example App" \
  --package-name example-app \
  --author "Example Team"
```

The base is identity-neutral and combines only explicitly admitted `--features` plus their dependency closure. `--features all` means all currently admitted features, not all Nimi Lab source.

Standalone output uses public npm and Cargo dependency versions. Workspace paths, local tarballs, parent-source aliases and direct native-carrier dependencies are non-public validation topology, not a public profile or standalone release input.

## Development and build

After creation:

```bash
cd path/to/app
pnpm install
pnpm run init
pnpm run sync
pnpm run check
pnpm run test
pnpm run app:build -- --target windows-x86_64
pnpm dev
```

`dev` uses the Desktop supervisor. Direct Electron, Tauri or renderer launch cannot claim protected Nimi access. Process running and Nimi Access ready remain separate states.

To continue an existing development App and its data, select a registration explicitly:

```bash
pnpm dev -- --list-registrations
pnpm dev -- --resume <selector>
```

The list shows the current project's registrations and creation times. Copy the desired selector from that list; Desktop resolves it to the exact existing Runtime-owned registration. Selectors last for the current Desktop session, so list again after restarting Desktop. No selector is stored in the App repository, and no App ID or path automatically reopens a subject. Plain `pnpm dev` keeps its fresh-registration behavior when no matching run is active. These options require a Desktop build that supports explicit launcher selection.

The default `windows-x86_64` build profile runs `build:electron:production`. It rebuilds the renderer and Electron main/preload, then creates a fresh, non-installer `dist-electron-package/<app>-shell-win32-x64/` directory with `asar` disabled and an App-specific `<app>-shell.exe`. The production main bundle has a compile-time production marker and rejects every `--nimi-dev-renderer-url` argument; packaged renderer assets stay relative under `dist/`. The protected native binding is resolved from Kit's optional dependency and is never declared directly by the App.

App Tools 0.3 also prepares the `macos-aarch64` target on an Apple Silicon Mac.
The same owner command produces `dist-electron-package/<app>-shell-darwin-arm64/`
with a native `.app` bundle and a direct `Contents/MacOS` entry. The publisher's
build applies an ad-hoc integrity seal without a Developer ID identity or Apple
notarization; production pack observes that absence and rejects invalid seals.
Relative framework links are preserved inside the immutable payload. The App
continues to consume the macOS native binding through Kit's optional dependency.
Nimi installation never signs or repairs the publisher's code.

Existing `.nimi/config/build-profile.yaml` target choices are App-owned and are
preserved by sync. To add macOS, declare `macos-aarch64` with `os: macos`,
`arch: arm64`, the same production build command, the Darwin output directory
above as `payload_path`, and
`payload/<app>-shell.app/Contents/MacOS/<app>-shell` as `runtime_entry`.
The managed workflow resolves that declared target to `macos-15`; Windows keeps
its existing runner and profile. These authoring/build capabilities do not by
themselves establish Registry admission or a completed Desktop lifecycle.

Tauri remains an explicit alternative through `pnpm run build:tauri:production`; selecting it requires an explicit Tauri build profile rather than changing the default Electron carrier.

## Canonical release boundary

The Registry publication chain uses the stages below. Publisher GitHub Release
is available for configured pilot repositories; protected Registry admission and
verified installation, update, launch and uninstall are available on Windows x86_64:

```text
public App repository
  -> reviewed canonical default-branch commit
  -> immutable protected version tag
  -> tag-triggered publisher GitHub Actions
  -> immutable GitHub Release assets
  -> publisher-fork registry pull request
  -> human-reviewed static registry main
  -> Runtime download/install
  -> Desktop exact Host launch
```

The registry references publisher Release assets and never mirrors bytes. GitHub Release is not catalog admission; catalog admission is not installed; installed is not running; running is not Nimi Access ready.

Repository administration must enable a protected `v*` tag ruleset and GitHub immutable releases before production. The managed tag workflow fetches the repository's canonical default branch and rejects a tag commit outside that history before production preflight, build, attestation, or Release. A fine-grained `NIMI_REPOSITORY_ADMIN_TOKEN` secret with repository Administration read permission lets the workflow verify protected-tag and immutable-release settings; it cannot enable or change them. Manual workflow dispatch runs only the non-production build/package path. On Windows, the tag-only production build invokes the App-declared production build with no certificate-secret mapping or app-tools-owned signing step. Optional native signing remains publisher-owned and must already be reflected in the final exact Runtime entry before production pack observes and records its native-trust posture; a present invalid or unresolved signature still fails closed. A successful tag workflow creates the immutable publisher GitHub Release and no registry, installed, running, or Nimi Access truth. Protected Registry submission and approved Windows x86_64 and macOS arm64 installation, update, launch/focus/stop, current-session Nimi Access and uninstall are available through their Platform, Runtime and Desktop owners. Other-platform installed lifecycle and ordinary repair remain unavailable. Explicit immutable local-package import has source-qualified Desktop and Runtime implementations on Windows x86_64 and macOS arm64; combined product acceptance and public release readiness remain unverified.

Registry projects must be open source with an explicit license and reviewable release source. Consistently observed unsigned packages are eligible; invalid signatures cannot be downgraded to unsigned. These Registry admission requirements do not apply to user-imported packages or Developer Mode projects. Registry approval is not a guarantee that third-party code is harmless.

## Publishing on GitHub

Local development does not need a GitHub token. Publishing an App Release does.
`nimi-app check --production` checks local inputs; the tag workflow checks the
GitHub repository settings. Complete the one-time setup below before pushing a
release tag.

### 1. Configure the publisher repository

Use a public repository owned by the publisher. You need administrator access
for this setup.

- In **Settings → General → Releases**, enable **Release immutability**.
- In **Settings → Rules → Rulesets**, create a **tag** ruleset, set enforcement
  to **Active**, and include tags matching `v*`. Enable **Restrict updates**
  and **Restrict deletions**. Tag creation must remain available to the publisher.

These settings protect published versions. The workflow only checks them; it
does not change repository settings.

### 2. Create the read-only settings token

Open [GitHub's fine-grained token page](https://github.com/settings/personal-access-tokens/new).

1. Name the token so you can recognize its purpose, and choose an expiration date.
2. Set **Resource owner** to the user or organization that owns the App repository.
3. Under **Repository access**, choose **Only select repositories** and select
   this App repository.
4. Under **Repository permissions**, set **Administration** to **Read-only**.
   GitHub includes read-only Metadata automatically. No Contents write,
   Actions write, Secrets write, or organization-wide access is needed.
5. Generate the token. If the organization requires approval, complete that
   approval before publishing.

This token reads tag-protection and release-immutability settings. The workflow
uses GitHub's separate built-in token to publish artifacts and its OIDC
permission to create build attestations.

### 3. Save it as an Actions secret

In the App repository, open **Settings → Secrets and variables → Actions →
New repository secret**.

- **Name:** `NIMI_REPOSITORY_ADMIN_TOKEN`
- **Secret:** the fine-grained token value from step 2

Save it and confirm the exact name appears in the repository's Actions secrets.
Use a **secret**, not an Actions variable. An organization secret is also
supported when its repository-access list includes this App. Keep the value
out of source files, `.env`, and release notes.

### 4. Check, build, and publish a version

Run the existing local path from the App repository:

```bash
pnpm run sync
pnpm exec nimi-app check --production
pnpm exec nimi-app test
pnpm exec nimi-app build --target windows-x86_64 --production
pnpm exec nimi-app pack --target windows-x86_64 --production
```

Commit the release changes and get that exact commit onto the repository's
canonical default branch. Keep `package.json` and `nimi.app.yaml` versions
equal. Use that version for the annotated tag; `0.1.0` below is an example:

```bash
git tag -a v0.1.0 -m "Release 0.1.0"
git push origin v0.1.0
```

Open **Actions → nimi-app-release**. A successful run produces the immutable
GitHub Release containing the `.nimiapp` package and aggregate candidate JSON.
Manual workflow dispatch checks the development path and does not publish.

If setup fails, the failed step points to the required setting. Add or replace
the secret, fix its repository selection/permissions, or enable the named
setting, then use **Re-run failed jobs** on the same run. A tag outside the
default branch requires merging its exact commit first. A code change requires
a new version and tag. Newly published release proofs can take a short time to
appear; the workflow waits for this specific delay and still requires successful
verification.

GitHub Release publication is followed by the separate
[Registry submission and human admission flow](https://github.com/nimiplatform/nimi-app-registry#ownership-boundary).
App Tools does not create an approval or install the App as a side effect.

## Acceptance status

Help output and focused tests prove only the inspected implementation contract. Any dependency install, build, target pack, GitHub workflow, Release, registry review, Runtime install or Desktop launch not actually run remains `NOT-VERIFIED`. Product acceptance remains user-owned.

Published CLI usage is:

```bash
pnpm dlx --package @nimiplatform/app-tools nimi-app --help
```

## Portable App information (package v2)

A distribution package includes `app-info.json`, containing its actual icon,
summary, available usage guide and version notes, license and portable requirements.
Every `pack`, including development-mode packaging and non-release CI, requires
valid App information. Complete `nimi.app.yaml` and its resources before packing;
production check/build validates them before the build starts:

```yaml
metadata:
  summary: A short description of what your App helps people do.
  icon: assets/app-icon.png
  readme: README.md
  release_notes: RELEASE_NOTES.md
  author: Your team
  homepage_url: https://example.com
  support_url: https://example.com/support
capability_contract_refs: []
required_standardized_feature_refs: []
storage_policy:
  kind: nimi-mediated-default
```

Use the canonical requirement references your App needs; an explicitly empty
list is valid. Apps with their own OS storage must declare
`kind: app-owned-os-storage` and `os_storage_disclosure` entries containing
`path_pattern`, `purpose` and `expected_size_band`. These paths are disclosures,
not instructions for Nimi to delete files. The author, homepage and support
links are optional claims for local/private imports; Registry admission keeps
its independent public-source, open-source license and support requirements.

The icon must be a complete static PNG, square, 128–1024 pixels, no larger than
512 KiB, and not fully transparent. Supply your App's real artwork: the old
1×1 scaffold native icon is not distribution artwork. `metadata` paths are
relative to the App repository. README and version notes are optional for local or
private packages; omit their metadata paths when not provided. Registry admission
requires both documents. Supplied README is limited to 96 KiB, version notes to
32 KiB, and the root LICENSE to 128 KiB. `package.json.license` supplies the
explicit license identifier; it does not turn a private license into an
open-source Registry license. Name and summary allow 120 and 280 characters.
Scaffold `sync` preserves these author-edited metadata, requirement and storage
fields while continuing to check the managed identity and carrier fields.
The scaffold does not supply finished artwork. Add the declared icon, a summary
and license information; provide any declared documents or omit optional document
paths for local/private packages. Until then, package-producing CI will fail.
Incomplete projects remain editable with `dev` and ordinary non-production builds.

Pack writes `nimi.app-package/v2` and emits the exact embedded information bytes
as `<app_id>-<version>-<target_id>.app-info.json` next to the `.nimiapp` and
`.target.json`. Aggregate verifies both files and their equality with the
embedded document. The managed Release workflow uploads this sidecar; a Registry
candidate must reference its actual immutable Release asset identity, URL, size
and digest. No App icon or document is copied into Registry storage.

App Tools releases independently of SDK, Kit and Tauri shell. Its `nimiScaffoldVersions`
declares the tested public SDK, Kit and Tauri shell versions used by new Apps and
explicit `sync`; workspace development version bumps do not change those ranges.
The release workflow requires those public versions before publishing App Tools.

App Tools 0.5.1 uses SDK `^0.11.0` and Kit `^0.7.0`. Existing Apps upgrade explicitly:

```bash
pnpm add -D @nimiplatform/app-tools@^0.5.1
pnpm run sync
pnpm install
pnpm run check
pnpm run test
pnpm run app:build -- --target windows-x86_64
```

Use the App's declared target for the final build. `sync` preserves App-owned
product code; update any affected SDK/Kit API usage in that code before release.

The v2 Runtime rejects v1 packages. Existing immutable publisher Releases and
approved descriptors must not be edited to invent the missing asset. Prepare a
new App version and real target builds, publish new immutable assets, and follow
normal Registry review. The coordinated pre-release Registry data cutover must
retire v1 entries/descriptors from the active dataset, retaining their history
in Git; adding v2 releases alone cannot make old descriptors satisfy the new
required-field schema. Do not deploy the v2 consumer before that reviewed
cutover is ready. Installed information is source-qualified and stored offline
by Runtime; metadata does not grant Registry verification or App Access.
