# `@nimiplatform/app-tools`

`app-tools` is the public full-stack developer toolkit for third-party Nimi Apps. It owns repository scaffolding, dependency and managed-file synchronization, local validation, Desktop-supervised development, App-declared test/build orchestration, deterministic packaging, and managed GitHub workflow setup.

It does not own GitHub publisher or repository truth, registry review/main, Runtime installed state, Desktop process state, or Nimi Access. Nimi Account and the private Nimi backend are not publisher credentials or App-release infrastructure.

For your first public release, start with [Publishing on GitHub](#publishing-on-github), including the read-only repository-settings credential.

Simulator integration is retired. Remove `nimi-app check --conformance simulator`
and imports of `@nimiplatform/app-tools/simulator-conformance` or
`@nimiplatform/app-tools/simulator-css-profile` from active projects. Use the
normal App lifecycle checks and Desktop-supervised development for current
Apps; the archived preview implementation is no longer a release prerequisite.

## AI development and existing projects

The package includes one `skills/nimi-app-lifecycle/SKILL.md` with on-demand
guides for adaptation audits, creating, adapting, platform gaps and upgrades, upstream sync, releases and
acceptance. Read it inside the installed package before initializing an existing
repository. `nimi-app --help` prints its resolved location. Installation does
not activate instructions; explicit init/sync maintains the project skill under
`.agents/skills/nimi-app-lifecycle/` and an independent AGENTS.md block.

For a feasibility, capability-fit or cost decision, start with [Audit](skills/nimi-app-lifecycle/references/audit.md). It uses existing public consumption paths and the target's actual workflows without requiring adoption or a running reference App. When implementation follows a report, preserve its evidence and uncertainty boundaries through the guide's handoff.

Install the selected app-tools and the exact nimi-coding version declared in
its `nimiScaffoldVersions`. For first integration, generate a minimal reference
App under `.nimi/local/` with its own identity and the needed admitted features,
using this same SDK/Kit/native package combination. Run its generated foundation
and reuse or align its Host, preload, renderer bridge, session, App Access,
AIConfig and AI call wiring in the existing App. SDK/Kit documentation explains
the contracts; it does not replace working generated code.

When the task includes installation, establish the reference's local installed
Access baseline as described in the packaged acceptance guide. Compare under
the same conditions to separate toolchain failures from App wiring differences.
Reuse passing results for ordinary business changes; no extra evidence ledger
or repeated full reference run is needed.

Preserve the original product's workflows and business settings while preparing
its actual renderer and build/test scripts. A reference workbench or passing
sample is not the complete App. Init does not convert a server framework,
invent tests or replace product UI. Preview adoption after this preparation:

```bash
pnpm exec nimi-app init --adopt --dry-run --json
pnpm exec nimi-app init --adopt
pnpm install
pnpm exec nimi-app check
```

Existing nimi.app.yaml and `.nimi/config/build-profile.yaml` supply the inputs.
If either is missing, pass `--input .nimi/local/adopt-input.json`. This temporary
JSON accepts only `manifest` and `build_profile`, using those same schemas.
For an App whose named scripts are already implemented, an input is:

```json
{
  "manifest": {
    "app_id": "example.editor", "display_name": "Example Editor", "version": "0.1.0",
    "profile": "standalone", "manifest_role": "submitted-input",
    "app_access": ["runtime.consume"], "capability_contract_refs": ["text.generate"],
    "required_standardized_feature_refs": [], "storage_policy": { "kind": "nimi-mediated-default" },
    "local_development": { "electron": { "renderer_origin": "http://127.0.0.1:1466" } }
  },
  "build_profile": {
      "build_profile_ref": "electron-packager-pnpm-vite", "profile_role": "developer-workflow-input",
    "test_command": "pnpm run test:app", "build_command": "pnpm run build:electron:production",
    "targets": {
      "windows-x86_64": {
        "os": "windows", "arch": "x86_64",
        "payload_path": "dist-electron-package/example-editor-shell-win32-x64",
        "runtime_entry": "payload/example-editor-shell.exe"
      }
    }
  }
}
```

Use actual identity, version, declarations and target outputs. Complete portable
App information before packaging. Supplied input must agree with an existing
file. Unknown managed-file collisions and broken markers fail before writes;
existing Host, business code, README and license remain App-owned. Adoption
creates no fresh scaffold intent/lock. Init validates output declarations;
build/pack later verify actual payloads.

An existing Next.js or other renderer can use `build_profile_ref: electron-pnpm`
with its real test/build commands and target outputs. Declare `dev:renderer` in
`package.json`, for example `next dev --hostname 127.0.0.1 --port 1466`, matching
the manifest's loopback origin. Init/sync preserve the command for this profile. The App
owns the renderer and any required local backend; `build:electron` produces the
supervised Host at `dist-electron/main.js`. Fresh scaffolds keep their generated
Vite recipe and existing `electron-packager-pnpm-vite` profiles remain supported.
When Host sources are outside `src-electron`, declare their existing relative
directory as `local_development.electron.host_source_directory` in `nimi.app.yaml`
(for example `electron`). Desktop validates that directory before launch and
watches it for Host rebuilds; init/sync preserve this App-owned declaration.
Real development requires a Desktop version that accepts App-owned renderer
commands; older Desktop versions enforcing Vite reject this project even after
app-tools validation passes. Do not introduce a Vite placeholder to bypass it.

Use the selected package's `nimiScaffoldVersions` declarations in `package.json`
and commit the matching lockfile to pin resolved versions. Fresh `create` uses
the tool default SDK/Kit combination. An existing App keeps its current SDK/Kit
combination when it is one of the supported combinations app-tools declares:
`sync` preserves it, `check` verifies the same combination in the manifest,
lockfile and Cargo inputs, and only the app-tools and nimi-coding tool
dependencies follow the selected tool version. An unlisted SDK x Kit pairing is
rejected rather than normalized. A matrix range in the manifest does not
require an automatic upgrade; install with the frozen lockfile until
deliberately selecting and synchronizing a new component combination.

App Tools 0.9 requires SDK `^0.16.0` with Kit `^0.13.0`. Kit 0.13 supplies the
mandatory Electron Host-profile entrypoint; earlier combinations are rejected
before sync writes files. Select both dependency ranges in `package.json`, run
`nimi-app sync`, install the normalized dependencies and update the lockfile,
then run `nimi-app check` and the App's build. Sync does not upgrade these
business dependencies on your behalf or generate an older Host fallback.

### Music reference flow

The admitted `studio-media` feature includes the music workflow maintained in
Nimi Lab. Its source is read from Lab during development and materialized into
the existing packaged App source during build; it is not a separate sample copy.
It consumes the protected SDK/Kit interfaces, reads `musicInput` from the current
AIConfig resource, imports ABC into App assets, and preserves every returned
artifact and the reported generation ending. A missing input projection is not
inferred from a model name.

A music action saves its `clientSubmissionId` before submission. The recovery
view looks up the original Job and observes or saves it without generating
again. Runtime recovery has a 24-hour lifetime; adopted App assets and the
saved result are used for later reopening. Generation budgets and generated
plan scores must not be presented as proof of a complete song, accurate
transcription, original melody or a requested singer.

This source requires the matching candidate Runtime, SDK 0.16, Kit/native 0.12
and App Tools 0.8 cohort. These version declarations are not a publication claim;
use complete local archives until that cohort is published. Real model and
Desktop-supervised acceptance are recorded for the exact tested combination,
separately from generator tests and subjective listening.

### Local development packages

Development does not require publishing every SDK/Kit or app-tools change.
Keep the selected version matrix in `package.json`, and use explicit npm tarball
overrides in the App's own `pnpm-workspace.yaml`:

```yaml
packages:
  - .
overrides:
  '@nimiplatform/app-tools': file:D:/nimi-packages/nimiplatform-app-tools-0.7.0.tgz
  '@nimiplatform/sdk': file:D:/nimi-packages/nimiplatform-sdk-0.14.0.tgz
  '@nimiplatform/kit': file:D:/nimi-packages/nimiplatform-kit-0.10.0.tgz
```

These are example artifact locations; use the complete packages you were given.
Override Kit's matching native optional package too when that component changes;
keep the native carrier Kit-owned rather than adding it as an App dependency.
Local archives may also use paths relative to the App. Install, run sync and
check, then use the normal dev/test/build/pack loop. Sync retains these choices;
check verifies matrix compatibility and compares the selected tarball version,
source and integrity with pnpm's installed dependency lock and package manifest.
Workspace members declare their own SDK/Kit dependencies and share the root
tarball overrides. pnpm writes each member's `specifier` relative to that member,
while resolved versions and package records remain workspace-relative; check
compares the resulting archive identities and installed importer bindings.
Do not rewrite member lock entries to look identical to the root importer.
Updating only the lockfile does not update installed packages: run `pnpm install`
after selecting another local package combination. Directory links and
source-workspace overrides stay invalid.
The generated Electron packager rebases archive paths for its isolated dependency
staging so a local build uses the same packages.

`check --production` is the final public-release preflight and requires registry
resolutions. It is not a prerequisite for development or local build/pack;
the normal build still executes the actual declared production payload command.

For local installed-App acceptance, keep these tarball overrides and run:

```bash
pnpm exec nimi-app check
pnpm exec nimi-app build --target windows-x86_64
pnpm exec nimi-app pack --target windows-x86_64 --production
```

Use the actual target on its matching host. `pack --production` observes the
payload's native signature and execution permissions; it does not run registry
dependency preflight or publish anything. Plain `pack` writes a development
archive that Runtime local import rejects. Import the resulting package through
Desktop's Apps → Add App → Import local package, then verify its installed launch
and business use. This exercises the `user_imported` source independently of
Catalog admission and download.

When preparing a public release after development acceptance, remove local
overrides, install the published matched versions and complete release preflight.
Local import creates no GitHub Release or Registry approval and does not verify
Catalog download or installation on a machine without the development environment.

`init --dry-run --json` and `sync --dry-run --json` show app-tools file/field
changes without writes, installation or owner mutation. The separate
nimi-coding step and expected version are listed without simulating its internals.
For an upgrade, install the target app-tools and exact nimi-coding before apply.
Sync recomputes fresh scaffold derived projections while retaining immutable
identity/direct features and App-owned code; then install the normalized
dependencies, refresh package-manager locks, check and verify the affected task.
The checkout directory is reported in command output, not persisted as App
identity; syncing an upgraded project after relocating it does not dirty its
intent/lock merely because the absolute path changed.
An installed nimi-coding version that differs from the selected tool matrix is
rejected before its projection command runs.

## Command family

The public CLI has exactly eight commands:

```text
create -> dependency install -> init -> sync -> check
       -> dev / test / build -> pack
```

- `create` writes a standalone private App project with a dotted App ID, exact version, public dependency declarations, developer build/submission inputs and one managed workflow. It does not install dependencies or create admission truth.
- `init` materializes package-owned projections and lifecycle guidance after dependencies are installed. Fresh scaffolds also receive their scaffold lock; `init --adopt` preserves an existing App without creating scaffold intent or lock.
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

Standalone output keeps public npm and Cargo dependency version declarations. Complete local npm tarballs are supported development resolutions through the documented overrides; public-release preflight requires registry resolutions. Source-workspace paths, parent-source aliases and App-owned direct native-carrier dependencies remain outside the standalone dependency boundary.

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

Use `nimi-app dev --list-registrations` and `--resume <selector>` to continue an existing development registration and its App data. Refresh the list after Desktop restarts: selectors belong to that Desktop session. A plain `dev` launch creates a separate registration and storage audience, even when the App ID and project path match an older registration.

Every `build`, including non-production builds, requires the selected target's
declared payload and exact Runtime entry to exist after its owner command exits
successfully. Building a macOS payload cannot report success for a missing
Windows target. The default recipes build for their host platform; use the
matching build host or provide a real App-owned build command. This file check
does not prove executable architecture or signing: production App information
is checked with `--production`, and native package facts are verified by
`pack --production`.

To continue an existing development App and its data, select a registration explicitly:

```bash
pnpm dev -- --list-registrations
pnpm dev -- --resume <selector>
```

The list shows the current project's registrations and creation times. Copy the desired selector from that list; Desktop resolves it to the exact existing Runtime-owned registration. Selectors last for the current Desktop session, so list again after restarting Desktop. No selector is stored in the App repository, and no App ID or path automatically reopens a subject. Plain `pnpm dev` keeps its fresh-registration behavior when no matching run is active. These options require a Desktop build that supports explicit launcher selection.

The default `windows-x86_64` build profile runs `build:electron:production`. It rebuilds the renderer and Electron main/preload, then creates a fresh, non-installer `dist-electron-package/<app>-shell-win32-x64/` directory with ASAR packaging, native `.node` addons unpacked, and an App-specific `<app>-shell.exe`. The production main bundle has a compile-time production marker and rejects every `--nimi-dev-renderer-url` argument; packaged renderer assets stay relative under `dist/`. The protected native binding is resolved from Kit's optional dependency and is never declared directly by the App.

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
is available for configured pilot repositories. Protected Registry admission and
installed App lifecycle use their separate Platform, Runtime and Desktop owners;
each App's declared target still needs its own acceptance.

```text
public App repository
  -> reviewed canonical default-branch commit
  -> immutable protected version tag
  -> tag-triggered publisher GitHub Actions
  -> immutable GitHub Release assets
  -> publisher-owned registry pull request
  -> human-reviewed static registry main
  -> Runtime download/install
  -> Desktop exact Host launch
```

External publishers submit from their own fork. An authorized publisher sharing
the Registry namespace can use a same-repository branch. Both paths use one
publisher-owned branch and pull request for the exact App version and Release;
human maintainers own admission.

The registry references publisher Release assets and never mirrors bytes. GitHub Release is not catalog admission; catalog admission is not installed; installed is not running; running is not Nimi Access ready.

Repository administration must enable a protected `v*` tag ruleset and GitHub immutable releases before production. The managed tag workflow fetches the repository's canonical default branch and rejects a tag commit outside that history before production preflight, build, attestation, or Release. A fine-grained `NIMI_REPOSITORY_ADMIN_TOKEN` secret with repository Administration read permission lets the workflow verify protected-tag and immutable-release settings; it cannot enable or change them. Manual workflow dispatch runs only the non-production build/package path. On Windows, the tag-only production build invokes the App-declared production build with no certificate-secret mapping or app-tools-owned signing step. Optional native signing remains publisher-owned and must already be reflected in the final exact Runtime entry before production pack observes and records its native-trust posture; a present invalid or unresolved signature still fails closed. A successful tag workflow creates the immutable publisher GitHub Release and no registry, installed, running, or Nimi Access truth. Protected Registry submission and approved Windows x86_64 and macOS arm64 installation, update, launch/focus/stop, current-session Nimi Access and uninstall are available through their Platform, Runtime and Desktop owners. Other-platform installed lifecycle and ordinary repair remain unavailable. Explicit immutable local-package import has source-qualified Desktop and Runtime implementations on Windows x86_64 and macOS arm64; combined product acceptance and public release readiness remain unverified.

Registry projects must be open source with an explicit license and reviewable release source. Consistently observed unsigned packages are eligible; invalid signatures cannot be downgraded to unsigned. These Registry admission requirements do not apply to user-imported packages or Developer Mode projects. Registry approval is not a guarantee that third-party code is harmless.

## Publishing on GitHub

Before the first release, configure `NIMI_REPOSITORY_ADMIN_TOKEN` as an Actions
secret in the App repository. It needs only **Administration: Read-only**, to
check tag protection and Release immutability. Local App development does not
need this credential.

The built-in `GITHUB_TOKEN` has no Administration permission for the
[repository immutability-settings API](https://docs.github.com/en/rest/repos/repos#check-if-immutable-releases-are-enabled-for-a-repository).
That is why the current release preflight needs a separate credential. Actual
Release uploads use GitHub's built-in token, and build attestations use OIDC.
This secret is neither a Nimi login token nor Registry approval, and needs no
repository write permission.

Repository secrets are scoped to their repository: configuring another App,
even under the same organization, does not configure this one. If you do not
administer the repository, ask its maintainer to complete the setup below.

`nimi-app check --production` checks local inputs; it does not inspect remote
settings or secrets. Complete the following setup before pushing a release tag.

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

Keep the packaged `LICENSE` identical to the reviewed Git source. New scaffolds
include `LICENSE -text` in `.gitattributes`. Add the same rule to an existing
repository while preserving its other attributes, and commit it before tagging.
This prevents Windows checkout conversion from changing the license bytes that
Registry verifies against the exact source tag.

Electron packages keep native add-ons and their companion libraries outside ASAR
with their relative layout intact. The scaffold uses
`asar: { unpack: '**/*.{node,dylib,dll}' }` on Mac/Windows. Apply the equivalent rule
to existing App-owned packagers and verify native loading from the packaged layout;
unpacking only `.node` can leave Sharp's libvips unavailable to the OS loader.

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
summary, available usage guide and version notes, license, portable requirements
and, when declared, the publisher safety declaration from `nimi.app.yaml`
`safety_profile` (see the lifecycle skill's safety-declaration reference). An
undeclared `safety_profile` stays absent and blocks nothing locally; new public
Registry admission requires the complete declaration.
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

Existing Apps follow the [platform upgrade guide](skills/nimi-app-lifecycle/references/upgrade-platform.md).
Select a published app-tools version and the exact nimi-coding version in that
release's `nimiScaffoldVersions`. Install both in the App's `devDependencies`
before invoking the target tool. Read the SDK/Kit migration notes and update the
affected App-owned API uses, then preview and apply:

```bash
pnpm exec nimi-app sync --dry-run --json
pnpm exec nimi-app sync
pnpm install
pnpm exec nimi-app check
pnpm exec nimi-app test
pnpm exec nimi-app build --target windows-x86_64
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
