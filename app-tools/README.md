# @nimiplatform/app-tools

The official full-stack developer CLI and toolchain for building, testing, and packaging Nimi desktop applications.

`@nimiplatform/app-tools` manages the entire application lifecycle—from project scaffolding and dependency synchronization to Desktop-supervised development, test orchestration, and deterministic `.nimiapp` distribution packaging.

---

## 1. The Application Lifecycle

The CLI exposes an eight-command toolkit designed for rapid local iteration and secure production releases:

```text
create ➔ install ➔ init ➔ sync ➔ check ➔ dev / test / build ➔ pack
```

| Command | Role |
| :--- | :--- |
| **`create`** | Scaffolds a standalone project with reverse-domain App ID, manifest declarations, and build workflows. |
| **`init`** | Materializes managed files and lifecycle guidance after installation; fresh scaffolds also receive a scaffold lock. |
| **`sync`** | Refreshes managed build configs, CI workflows, and glue code without touching your business logic. |
| **`check`** | Validates scaffold, package constraints, and declared inputs. Run App-owned typechecks separately. |
| **`dev`** | Launches your app in the official Desktop-supervised Electron shell with a protected session bridge. |
| **`test`** | Executes the test suite declared in your `.nimi/config/build-profile.yaml`. |
| **`build`** | Compiles production binaries and assets for target platforms (macOS / Windows). |
| **`pack`** | Deterministically packages verified binaries and metadata into an immutable `.nimiapp` bundle. |

---

## 2. Quickstart: Creating a New App

Run the interactive creator or pass parameters directly:

```bash
# Using published App Tools (recommended)
pnpm dlx --package @nimiplatform/app-tools nimi-app create \
  --dir my-editor-app \
  --profile standalone \
  --features studio-create \
  --app-id com.example.editor \
  --version 0.1.0 \
  --title "Example Editor" \
  --package-name example-editor \
  --author "Your Team"

cd my-editor-app
pnpm install
pnpm run init
pnpm run sync
pnpm run check
pnpm dev
```

Set `--author` to the person or team responsible for the App and its license.

### Feature Profiles
- `--features studio-create`: Injects creative text and multimodal generation capabilities along with `runtime.consume` permissions.
- `--features studio-media`: Includes music, audio separation, and speech transcription capabilities.

<a id="local-development-packages"></a>

### Dependencies & Existing Projects

Standalone third-party Apps must declare public npm and Cargo dependency versions. Use published packages, or override them for local development with the complete archives described below—never point dependencies at a Nimi source checkout.

- **SDK and Kit Version Alignment**: Keep the SDK/Kit version combination declared by your selected App Tools release and its lockfile (`sync` preserves supported existing combinations and rejects unlisted ones). App Tools `0.13.0` defaults to SDK `0.21.0` and Kit/native `0.21.0`. When working from source, verify that the required versions are available on npm before installing them.
- **Testing Local Tarballs**: During local development, you can select complete `.tgz` archives via `pnpm-workspace.yaml` overrides, including Kit's matching optional native package. Re-run `pnpm install` whenever you change an archive. For local acceptance, run ordinary `check` and `build`, followed by `pack --production` to inspect the actual payload (`check --production` requires dependencies resolved from the public registry).
- **Adopting or Upgrading Projects**: Follow the [adoption guide](skills/nimi-app-lifecycle/SKILL.md) and [platform upgrade reference](skills/nimi-app-lifecycle/references/upgrade-platform.md). Preview managed changes before applying them with `init --adopt --dry-run --json` or `sync --dry-run --json`. Adoption preserves your App-owned product and Host code rather than converting an application framework; migrating from an older scaffold contract requires following the documented migration steps, not just bumping dependency versions.

---

## 3. Desktop-Supervised Development

Nimi Apps run inside a Desktop-supervised Electron shell. The host provides a protected session for SDK calls without exposing Nimi credentials to the App renderer (note that this session bridge does not create an OS-level sandbox for the entire application).

### Continuing an Existing Session
To keep your app data and registrations intact across restarts:

```bash
# List active registrations
pnpm dev -- --list-registrations

# Resume a specific registration
pnpm dev -- --resume <selector>
```

---

## 4. Production Packaging & Distribution

### Building for Targets
```bash
# macOS (Apple Silicon)
pnpm exec nimi-app build --target macos-aarch64 --production
pnpm exec nimi-app pack --target macos-aarch64 --production

# Windows (x86_64)
pnpm exec nimi-app build --target windows-x86_64 --production
pnpm exec nimi-app pack --target windows-x86_64 --production
```

`pack --production` verifies native signatures and unpacked native `.node` addons, producing a `.nimiapp` bundle alongside an `<app_id>-<version>-<target>.app-info.json` metadata sidecar.

### Local Import Testing
Before publishing publicly, verify the `.nimiapp` package on your own machine:
1. Open Nimi Home.
2. Go to **Apps → Add App → Import local package**.
3. Select your `.nimiapp` file and verify installation, launch, and AI workflows.

Exercise the actual install, launch, and key user flows on each supported target. Passing tests or packaging alone is not enough—mark any path you have not run as `NOT-VERIFIED`.

Use Desktop-supervised Electron for App development and acceptance.

---

## Publishing on GitHub

### Canonical release boundary
Public publishing is currently available for configured pilot repositories. Keep in mind how lifecycle stages are separated:
- **Independent milestones**: Creating a publisher GitHub Release, passing Registry human admission, installing the package, launching the process, and obtaining ready Nimi Access are separate outcomes. App Tools never approves or installs an App as a side effect of packaging or releasing.
- **Platform support**: Local-import implementations are available on `macos-aarch64` (macOS arm64) and `windows-x86_64`; combined end-to-end product acceptance and public release readiness require their own verification. Package lifecycles for other platforms and ordinary repair flows are not yet available.

### Step 1: Configure the Publisher Repository
Use a public GitHub repository owned by the publisher (administrator access is required):
- In **Settings → General → Releases**, enable **Release immutability**.
- In **Settings → Rules → Rulesets**, create a **tag** ruleset with enforcement set to **Active** for tags matching `v*`. Enable **Restrict updates** and **Restrict deletions**, while leaving tag creation available to the publisher.

These settings protect published versions. The release workflow only verifies them—it does not modify repository settings.

### Step 2: Create a Read-Only Settings Token
Open [GitHub's fine-grained token page](https://github.com/settings/personal-access-tokens/new) to create a token that lets the release workflow verify your tag protection and release immutability settings:
1. Name the token clearly and choose an expiration date.
2. Set **Resource owner** to the user or organization that owns the App repository.
3. Under **Repository access**, choose **Only select repositories** and select this App repository.
4. Under **Repository permissions**, set **Administration** to **Read-only** (GitHub automatically includes read-only **Metadata**). Do not grant write access to Contents, Actions, or Secrets, and do not enable organization-wide access.
5. Generate the token. If your organization requires token approval, complete that approval before publishing.

The workflow uses GitHub's separate built-in token to publish release artifacts and GitHub OIDC permissions to generate build attestations.

### Step 3: Save the Token as an Actions Secret
In your App repository, open **Settings → Secrets and variables → Actions → New repository secret**:
- **Name**: `NIMI_REPOSITORY_ADMIN_TOKEN`
- **Secret**: Paste the fine-grained token value from Step 2.

Save it as a **secret** (not an Actions variable) and confirm the exact name appears in your Actions secrets. An organization secret is also supported when its repository-access list includes this App. Never place the token value in source files, `.env`, or release notes.

### Step 4: Prepare, Verify, and Tag a Release

#### License Ownership & Byte Stability
- **App-owned `LICENSE`**: The root `LICENSE` file belongs to your App. `create` initializes it once as an MIT license naming `--author` (or the App title if omitted); replace it with your App's actual license terms and set the matching `package.json.license` identifier. `sync` never rewrites `LICENSE`, and `check` does not lock it. The scaffold template's own MIT notice stays in the managed `licenses/nimi-app-template.txt` file.
- **Handover from older scaffolds**: Projects created by an earlier `app-tools` version that managed `LICENSE` retain their existing file byte-for-byte—running `sync` records the App as the owner, reports the handover, and adds `licenses/nimi-app-template.txt` (`check` will prompt you to run `sync` first).
- **Preventing line-ending mutation**: The packaged `LICENSE` must remain byte-for-byte identical to the reviewed Git source. Fresh scaffolds include `LICENSE -text` in `.gitattributes`. For existing repositories, add `LICENSE -text` to `.gitattributes` (preserving your other rules) and commit it before tagging so Windows checkout conversion cannot alter the bytes verified by the Registry against the source tag.

#### Native Addon Unpacking
Electron packages must keep native add-ons and their companion libraries outside the ASAR archive with their relative directory layout intact. The scaffold configures `asar: { unpack: '**/*.{node,dylib,dll}' }` on macOS and Windows. Apply the equivalent rule to any custom App-owned packager configuration and verify native module loading from the packaged layout—unpacking only `.node` files can leave companion libraries such as Sharp's `libvips` unavailable to the OS dynamic loader.

#### Local Pre-Release Check & Tagging
Run the production verification path locally from the App repository:

```bash
pnpm run sync
pnpm exec nimi-app check --production
pnpm exec nimi-app test
pnpm exec nimi-app build --target windows-x86_64 --production
pnpm exec nimi-app pack --target windows-x86_64 --production
```

Ensure `package.json` and `nimi.app.yaml` declare the exact same version, commit all release changes, and land that exact commit on the repository's canonical default branch. Then create and push an annotated tag matching that version (`0.1.0` shown as an example):

```bash
git tag -a v0.1.0 -m "Release 0.1.0"
git push origin v0.1.0
```

Open **Actions → nimi-app-release**. A successful run produces the immutable GitHub Release containing the `.nimiapp` bundle and aggregate candidate JSON (native code signing remains publisher-owned). Triggering the workflow manually checks the development path only and does not publish.

- **Troubleshooting**: If a setup check fails, the failed step points to the required setting. Add or replace the secret, fix its repository selection or permissions, or enable the named repository setting, then click **Re-run failed jobs** on the same workflow run. A tag pointing outside the default branch requires merging that exact commit into the default branch first. Any code change requires a new version and tag. Newly published release proofs can take a short time to appear; the workflow waits for this delay and still requires verification to succeed.

### Step 5: Submit to the Nimi App Registry
Once the GitHub Release is published, submit a Pull Request to the [Nimi App Registry](https://github.com/nimiplatform/nimi-app-registry) following the [Registry submission and human admission flow](https://github.com/nimiplatform/nimi-app-registry#ownership-boundary).

---

## Portable App Information (Package v2)

Every `pack`—including development-mode packaging and non-release CI—requires valid App information, and production `check`/`build` validates these inputs before compilation starts. Incomplete projects remain editable with `dev` and ordinary non-production builds, but package-producing CI will fail until the required metadata and assets are in place.

Configure your metadata, capability references, and storage policy in `nimi.app.yaml`:

```yaml
metadata:
  summary: A short description of what your App helps people do.
  icon: assets/app-icon.png
  release_notes: RELEASE_NOTES.md
  author: Your team
  homepage_url: https://example.com
  support_url: https://example.com/support
capability_contract_refs: []
required_standardized_feature_refs: []
storage_policy:
  kind: nimi-mediated-default
```

Scaffold `sync` preserves your author-edited `metadata`, requirement, and storage fields while continuing to validate managed identity and carrier fields.

`metadata.icon` is portable App artwork for Nimi Home and distribution information, not a pre-rendered macOS Dock tile. Keep platform padding, outer bevels and shadows out of this source; a background that belongs to the App's brand can remain. The generated Electron build preserves that artwork in `app-icon.png`, derives a separate `app-icon-macos.png` with a light neutral rounded-square plate and transparent outer margin, and packages the same macOS composition as ICNS with 1×/2× representations from 16 through 1024 pixels. Windows ICO preserves the source silhouette and transparency, with 15 sizes from 16 through 256 pixels, including intermediate high-DPI taskbar sizes. Development uses the platform-specific window/Dock resource; production packaging includes those runtime resources and embeds ICNS or ICO before signing. Custom repository-relative source paths are supported. Rebuild after changing the image or its declaration. Development without artwork remains available with an explicit warning; invalid artwork fails the build, and production requires valid artwork. Removing or invalidating an image clears its old derived icons.

Windows taskbar identity is `ai.nimi.dev.apps.<app_id>` for the generated development Host and `ai.nimi.apps.<app_id>` for a production bundle. Separate namespaces also avoid collisions with an App whose canonical ID ends in `.dev`. This does not change the canonical App ID or Runtime registration. Existing scaffold projects receive this managed Host/build logic through `sync`; adopted App-owned Hosts must implement the same behavior in their own code.

### Field & Asset Requirements
All `metadata` file paths are relative to the App repository root:

| Item | Constraints & Admission Rules |
| :--- | :--- |
| **Name & Summary** | Up to **120 characters** for the App name and **280 characters** for `metadata.summary`. |
| **App Icon (`icon`)** | Required. Complete static PNG, square (`128–1024` pixels), max **512 KiB**, and not fully transparent. The scaffold does not supply finished artwork (the legacy `1×1` scaffold native icon is not valid distribution artwork). |
| **Root `LICENSE` & `package.json.license`** | Required (`LICENSE` max **128 KiB**). `package.json.license` provides the explicit license identifier; setting an identifier does not turn a private license into an open-source Registry license. |
| **App introduction (`NIMI_APP.md`)** | Required at the repository root for every App, including local/private packages. Nonempty UTF-8 regular file, at most **96 KiB**. Home reads this file; `metadata.readme` and README fallback are not supported. |
| **Version Notes (`release_notes`)** | Optional for local/private packages, required for Registry admission; at most **32 KiB**. |
| **Author, Homepage & Support URLs** | Optional claims for local/private imports. Public Registry admission enforces its own independent public-source, open-source license, and support requirements. |
| **Capability & Feature Refs** | Use the canonical requirement references your App needs; an explicitly empty list (`[]`) is valid. |
| **Storage Policy (`storage_policy`)** | Declare `kind: nimi-mediated-default` for Nimi-mediated storage. Apps managing their own OS storage must declare `kind: app-owned-os-storage` along with `os_storage_disclosure` entries specifying `path_pattern`, `purpose`, and `expected_size_band` (these are disclosures only, not instructions for Nimi to delete files). |
| **Safety Declaration (`safety_profile`)** | When declared in `nimi.app.yaml`, included in `app-info.json` (see the lifecycle skill's safety-declaration reference). An undeclared `safety_profile` stays absent and blocks nothing locally; the Registry's current admission policy determines whether public submissions require it (App Tools does not fetch Registry policy during local checks). |

### Write the App introduction

`NIMI_APP.md` is the single Home introduction source. Write for the App's actual users: what it helps them do, how to start the main task, required configuration, relevant data handling and current limitations, and where to get help. Developer tools may retain the technical precision their users need. Describe available behavior, not roadmap promises or inferred acceptance.

Keep repository setup, architecture, build/release commands and engineering acceptance logs in `README.md` or developer documentation. Use self-contained Markdown: Home displays image alt text and only opens absolute HTTP(S) links; relative file links and anchors are not navigable. Keep necessary instructions in the introduction itself.

`create` supplies an honest starter introduction. Replace its unfinished-product notice with the App's actual user content as the product develops. `NIMI_APP.md` is App-owned: `sync` neither overwrites nor recreates it. Existing Apps must author this file and remove `metadata.readme` before checking; there is no automatic document migration. `check` and `pack` validate the file, not the truth or quality of its prose. Review it alongside the real user journey.

Packaging copies its exact text into the existing `app-info.json` `readme_markdown` field. Installed and Catalog entries display their exact release snapshot; changing source documentation does not rewrite an immutable release.

### Package v2 Output & Sidecar Verification
`pack` writes the `nimi.app-package/v2` format and emits the exact embedded `app-info.json` bytes as a sidecar file named `<app_id>-<version>-<target_id>.app-info.json` alongside the `.nimiapp` bundle and `.target.json`. Aggregate verification checks both files and confirms they match the embedded document byte-for-byte.

During release, the managed GitHub Actions workflow uploads this sidecar to the immutable GitHub Release. A Registry candidate must reference the actual immutable Release asset identity, URL, size, and digest—no App icon or documentation is copied into Registry storage.

---

## License

Licensed under [Apache-2.0](../licenses/Apache-2.0.txt).
