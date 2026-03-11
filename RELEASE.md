# Release Process

## Versioning

All components follow semantic versioning (`major.minor.patch`).
Current public phase is `0.x` (pre-1.0 strict contract hardening):

- **major**: Breaking changes
- **minor**: New features (backward compatible)
- **patch**: Bug fixes

The SDK, Dev Tools, Runtime, and Proto versions must be aligned within the same `major.minor`. The npm author release set (`@nimiplatform/sdk` + `@nimiplatform/dev-tools`) uses the same exact `major.minor.patch`. Cross-version combinations are unsupported (strict-only).

## Release Targets

| Component | Registry | Format |
|-----------|----------|--------|
| runtime | GitHub Releases | Multi-platform binary (GoReleaser) |
| sdk | npm (`@nimiplatform/*`) | `@nimiplatform/sdk` + `@nimiplatform/dev-tools` |
| proto | buf.build (`nimiplatform`) | Proto schema |
| desktop | GitHub Releases | macOS / Windows / Linux installers |

## Release Steps

### 1. Pre-release Checks

```bash
pnpm check:release-preflight
```

该命令会将完整输出持久化到 `dev/release/preflight-YYYYMMDD-HHMMSS.log`。
终端默认只显示阶段、命令和通过/失败摘要，完整 stdout/stderr 只写入日志。
如果中途失败，脚本会打印失败的 `section`、`command`、日志路径，以及日志尾部片段。
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

`buf breaking proto/ --against .git#branch=main` 这种写法如果要用，必须从仓库根目录执行；但它不是本仓当前 release 主路径。

### 2. Version Bump

Runtime 版本不通过仓库内 `version.go` 固化，直接由 Git tag `runtime/v<major>.<minor>.<patch>` 推导。

SDK 发布前必须更新并对齐以下版本号（`sdk/vX.Y.Z` 与 npm author release set 严格一致）：

- `sdk/package.json`
- `dev-tools/package.json`

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

git tag proto/v0.x.x
git push origin proto/v0.x.x

git tag desktop/v0.x.x
git push origin desktop/v0.x.x
```

对应工作流行为：

- `runtime/v*` -> `.github/workflows/release-runtime.yml`（GoReleaser 多平台二进制）
- `sdk/v*` -> `.github/workflows/release.yml` `release-sdk` job（发布 `@nimiplatform/sdk` 与 `@nimiplatform/dev-tools`）
- `proto/v*` -> `.github/workflows/release.yml` `release-proto` job（`buf push`）
- `desktop/v*` -> `.github/workflows/release.yml` `release-desktop` job（Tauri 多平台构建并上传到 GitHub Release）

必需 secrets：

- `NPM_TOKEN`（npm author package 发布）
- `BUF_TOKEN`（Proto 发布）

必需权限（workflow/job permissions）：

- `id-token: write`（runtime / desktop 发布产物的 keyless cosign 签名）
- `contents: write`（向 GitHub Release 上传产物与签名/SBOM）

desktop 发布前置契约（Zero-Bundle）：

1. `release-desktop` job 不得 checkout 或打包任何外部 mod 仓产物。
2. 发布包必须允许在零已安装 mod 状态启动。
3. 构建 desktop 前必须先执行 `pnpm build:sdk`，确保 `@nimiplatform/sdk-*` 的 `dist/*` 产物可被 Vite 解析。
4. 如需做安装链验证，只能使用预构建 mod 包作为测试输入，不得把其打进桌面发布产物。

支持 dry-run：

- 手动触发 `.github/workflows/release.yml`，选择 `target + version + publish=false`。

desktop 本地 dry-run（用于复现 release-desktop 构建输入）：

```bash
pnpm build:sdk
pnpm -C apps/desktop run build
```

可选安装链验证（不进入发布产物）：

1. 通过 CI 或手工任务准备单独的预构建 mod `.zip`。
2. 设置 `NIMI_RUNTIME_MODS_DIR` 到临时目录，执行 `pnpm check:desktop-mods-smoke`。
3. 若需要验证远程安装，再额外回放 install/update/uninstall 生命周期。

### 5. Post-release

- Verify npm packages: `npm view @nimiplatform/sdk version`
- Verify npm packages: `npm view @nimiplatform/dev-tools version`
- Verify one-shot author entrypoints:
  - `pnpm dlx @nimiplatform/dev-tools nimi-mod --help`
  - `pnpm dlx @nimiplatform/dev-tools nimi-app --help`
- Verify proto module on buf.build
- Verify runtime binaries on GitHub Releases
- Verify desktop bundles on GitHub Releases
- Verify `checksums.txt` exists in release assets
- Verify runtime/desktop release assets include:
  - `*.spdx.json` SBOM
  - `*.sig` + `*.pem` keyless signing outputs
- Verify signatures:
  - `cosign verify-blob --certificate <file>.pem --signature <file>.sig --certificate-oidc-issuer https://token.actions.githubusercontent.com --certificate-identity-regexp 'https://github.com/<org>/<repo>/.github/workflows/release.*@.*' <file>`

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
