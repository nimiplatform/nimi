# Release Process

## Versioning

All components follow semantic versioning (`major.minor.patch`).
Current public phase is `0.x` (pre-1.0 contract hardening):

- **major**: Reserved for 1.0+ breaking changes
- **minor**: New features; in `0.x`, minor bumps may include breaking changes under SemVer pre-1.0 rules
- **patch**: Bug fixes

The SDK, Kit, App Tools, Runtime, Proto, and shell crate publish independently.
Each package declares its own supported dependency ranges. Cross-package
lockstep is a directional release planning intent only, not a tag or versioning
requirement.

## Release Targets

| Component | Registry | Format |
|-----------|----------|--------|
| runtime | GitHub Releases | Multi-platform binary (GoReleaser) |
| sdk | npm | `@nimiplatform/sdk` |
| kit | npm | `@nimiplatform/kit` |
| app-tools | npm | `@nimiplatform/app-tools` |
| nimi-shell-tauri | crates.io | `nimi-shell-tauri` |
| proto | buf.build (`nimiplatform`) | Proto schema |
| desktop | GitHub Releases | macOS / Windows / Linux installers |
| mods catalog (future repo) | GitHub Pages / static hosting | `index/v1/*.json` static registry |

## Release Steps

### 1. Pre-release Checks

```bash
pnpm preflight --require-release
```

该命令是 Node mjs 实现的 release preflight，从单一 source of truth
`.nimi/spec/platform/kernel/tables/release-gate-registry.yaml` 投影出
所有 release-blocking gate（149 行 / 20 owner namespaces，由 P-RELG-001..014
治理）。每个 gate 的 stdout/stderr 持久化到
`.local/report/release/preflight-logs/<gate_id>-<ISO8601>.log`，结构化的
verdict + summary 输出到 `.local/report/release/preflight-evidence-<ISO8601>.json`
（schema: release-gate-evidence/v1）。

`--require-release` 让 blocked verdict 计为 fail（CI release 必须用此 flag）；
开发者本地可省略，让 live / external-repo tier 的 blocked 不阻断。

详细命令行参考 `pnpm preflight --help`。Topic 闭环：
`2026-05-10-release-preflight-gate-authority-hardcut`（已 closed）。
如需自定义日志文件，可设置 `NIMI_RELEASE_PREFLIGHT_LOG_FILE=/abs/path/to.log`。
如需调整失败时回显的日志尾部行数，可设置 `NIMI_RELEASE_PREFLIGHT_TAIL_LINES=120`。

调试单个 proto 步骤时，使用仓库脚本而不是在根目录或 `runtime/` 目录直接执行裸 `buf`：

```bash
pnpm proto:generate
pnpm proto:lint
pnpm proto:breaking
pnpm proto:drift-check
```

对应的裸命令目录约定是：

- `cd proto && buf generate`
- `cd proto && buf lint`
- `cd proto && buf breaking --against ../runtime/proto/runtime-v1.baseline.binpb`

当前 `runtime-v1.baseline.binpb` 对应的是 typed AI contract：
`ExecuteScenarioResponse.output = ScenarioOutput`，以及
`ScenarioStreamDelta.delta.oneof { text, artifact }`。
如果这些 proto contract 有意变更，必须先更新实现与消费端，再同步重建 baseline。

`buf breaking proto/ --against .git#branch=main` 这种写法如果要用，必须从仓库根目录执行；但它不是本仓当前 release 主路径。

### 2. Version Bump

Runtime 版本不通过仓库内 `version.go` 固化，直接由 Git tag `runtime/v<major>.<minor>.<patch>` 推导。

SDK 发布前必须更新：

- `sdks/typescript/package.json`

Kit 发布前必须更新：

- `kit/package.json`

App Tools 发布前必须更新：

- `app-tools/package.json`

Nimi shell Tauri crate 发布前必须更新：

- `kit/shell/tauri/Cargo.toml`

Desktop 发布前必须更新并对齐以下版本号（`desktop/vX.Y.Z` 与配置严格一致）：

- `apps/desktop/package.json`
- `apps/desktop/src-tauri/tauri.conf.json`

Proto 发布由 tag 驱动（`proto/vX.Y.Z`），不依赖仓库内单独版本文件。

### 3. Changelog

Update `CHANGELOG.md` with the new version entry. Follow [Keep a Changelog](https://keepachangelog.com/) format.

### 4. Tag and Release

按组件打 tag 触发自动发布：

```bash
git tag runtime/v0.x.x
git push origin runtime/v0.x.x

git tag sdk/v0.x.x
git push origin sdk/v0.x.x

git tag nimi-shell-tauri/v0.x.x
git push origin nimi-shell-tauri/v0.x.x

git tag kit/v0.x.x
git push origin kit/v0.x.x

git tag app-tools/v0.x.x
git push origin app-tools/v0.x.x

git tag proto/v0.x.x
git push origin proto/v0.x.x

git tag desktop/v0.x.x
git push origin desktop/v0.x.x
```

对应工作流行为：

- `runtime/v*` -> `.github/workflows/release-runtime.yml`（GoReleaser 多平台二进制）
- `sdk/v*` -> `.github/workflows/release.yml` `release-sdk` job（发布 `@nimiplatform/sdk`）
- `nimi-shell-tauri/v*` -> `.github/workflows/release-nimi-shell-tauri.yml`（发布 `nimi-shell-tauri` crate）
- `kit/v*` -> `.github/workflows/release-kit.yml`（发布 `@nimiplatform/kit`）
- `app-tools/v*` -> `.github/workflows/release-app-tools.yml`（发布 `@nimiplatform/app-tools`）
- `proto/v*` -> `.github/workflows/release.yml` `release-proto` job（`buf push`）
- `desktop/v*` -> `.github/workflows/release.yml` `release-desktop` job（Tauri 多平台构建并上传到 GitHub Release）

必需 secrets：

- `NPM_TOKEN`（npm author package 发布）
- `CARGO_REGISTRY_TOKEN`（crates.io crate 发布）
- `BUF_TOKEN`（Proto 发布）

必需权限（workflow/job permissions）：

- `id-token: write`（runtime / desktop 发布产物的 keyless cosign 签名）
- `contents: write`（向 GitHub Release 上传产物与签名/SBOM）

desktop 发布前置契约（Zero-Bundle）：

1. `release-desktop` job 不得 checkout 或打包任何外部 mod 仓产物。
2. 发布包必须允许在零已安装 mod 状态启动。
3. 构建 desktop 前必须先执行 `pnpm build:sdk`，确保 `sdks/typescript`
   中 `@nimiplatform/sdk` 的 `dist/*` 产物可被 Vite 解析；独立 adapter
   package 如参与发布，也必须先完成各自 build。
4. 如需做安装链验证，只能使用预构建 mod 包作为测试输入，不得把其打进桌面发布产物。

支持 dry-run：

- 手动触发 `.github/workflows/release.yml`，选择 `target + version + publish=false`。

desktop 本地 dry-run（用于复现 release-desktop 构建输入）：

```bash
pnpm build:sdk
pnpm -C apps/desktop run build
```

3. 若需要验证远程安装，再额外回放 install/update/uninstall 生命周期。

official mod package / catalog dry-run：

1. 手动触发 `.github/workflows/release-mod-package.yml`
2. 设 `publish=false`
3. CI 仍会打包 mod、生成 `release.manifest.json`、更新 catalog working tree，并上传 patch preview artifact，但不会创建 GitHub Release 或 catalog PR

official mod package / catalog publish：

1. 手动触发 `.github/workflows/release-mod-package.yml`
2. 设 `publish=true`
3. workflow 会创建或复用 mod GitHub Release、上传 zip 与 `release.manifest.json`
4. workflow 会 checkout catalog repo、运行 `scripts/update-mod-catalog.mjs` 与 signer/catalog 校验
5. workflow 会 force-update `codex/catalog-<packageId>-<version>` 分支，并创建或更新对应 catalog PR

### 5. Post-release

- Verify npm packages: `npm view @nimiplatform/sdk version`
- Verify npm packages: `npm view @nimiplatform/kit version`
- Verify npm packages: `npm view @nimiplatform/app-tools version`
- Verify crates.io package: `cargo search nimi-shell-tauri --limit 1`
- Verify one-shot author entrypoints:
  - `pnpm dlx @nimiplatform/app-tools nimi-app --help`
- Verify proto module on buf.build
- Verify runtime binaries on GitHub Releases
- Verify desktop bundles on GitHub Releases
- Verify `checksums.txt` exists in release assets
- Verify runtime/desktop release assets include:
  - `*.spdx.json` SBOM
  - `*.sigstore.json` keyless signing bundles
- Verify signatures:
  - `cosign verify-blob --bundle <file>.sigstore.json --certificate-oidc-issuer https://token.actions.githubusercontent.com --certificate-identity-regexp 'https://github.com/<org>/<repo>/.github/workflows/release.*@.*' <file>`

## Hotfix Process

For critical patches:

1. Branch from the release tag: `git checkout -b hotfix/<component>-v0.x.x+1 <component>/v0.x.x`
2. Apply fix
3. Run full test suite
4. Bump patch version
5. Tag and release (`<component>/v0.x.x+1`)

## Version Matrix

| SDK | Runtime | Proto | Status |
|-----|---------|-------|--------|
| 0.x | 0.x | 0.x | Supported |
| 0.x | 1.x | — | Not supported |
| 1.x | 0.x | — | Not supported |
