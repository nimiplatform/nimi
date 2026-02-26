# Release Process

## Versioning

All components follow semantic versioning (`major.minor.patch`).
Current public phase is `0.x` (pre-1.0 strict contract hardening):

- **major**: Breaking changes
- **minor**: New features (backward compatible)
- **patch**: Bug fixes

The SDK, Runtime, and Proto versions must be aligned within the same `major.minor`. Cross-version combinations are unsupported (strict-only).

## Release Targets

| Component | Registry | Format |
|-----------|----------|--------|
| runtime | GitHub Releases | Multi-platform binary (GoReleaser) |
| sdk | npm (`@nimiplatform/*`) | TypeScript packages |
| proto | buf.build (`nimiplatform`) | Proto schema |
| desktop | GitHub Releases | macOS / Windows / Linux installers |

## Release Steps

### 1. Pre-release Checks

```bash
# All tests pass
pnpm test
cd runtime && go test ./...

# Codegen is up to date
buf generate
git diff --exit-code

# No breaking proto changes (unless major bump)
buf breaking proto/ --against .git#branch=main

# Lint passes
pnpm lint
pnpm check:markdown
cd runtime && golangci-lint run

# Security gates
python3 -m pip install detect-secrets==1.5.0
git ls-files -z | xargs -0 detect-secrets-hook --baseline .secrets.baseline
cargo install --locked zizmor
zizmor --no-online-audits --min-severity high --collect workflows --collect dependabot -- .github/workflows .github/dependabot.yml
cargo install cargo-audit --locked
cargo audit --file apps/desktop/src-tauri/Cargo.lock

# Workflow lint
go install github.com/rhysd/actionlint/cmd/actionlint@v1.7.7
"$(go env GOPATH)/bin/actionlint" -color

# Runtime release config dry-run
go run github.com/goreleaser/goreleaser/v2@latest check --config .goreleaser.yml
go run github.com/goreleaser/goreleaser/v2@latest release --clean --snapshot --skip=publish --skip=announce --config .goreleaser.yml

# Coverage gates
pnpm check:sdk-coverage
pnpm check:runtime-go-coverage
```

### 2. Version Bump

Runtime 版本不通过仓库内 `version.go` 固化，直接由 Git tag `runtime/v<major>.<minor>.<patch>` 推导。

SDK 发布前必须更新并对齐以下版本号（`sdk/vX.Y.Z` 与包版本严格一致）：

- `sdk/package.json`

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
- `sdk/v*` -> `.github/workflows/release.yml` `release-sdk` job（发布 npm 包）
- `proto/v*` -> `.github/workflows/release.yml` `release-proto` job（`buf push`）
- `desktop/v*` -> `.github/workflows/release.yml` `release-desktop` job（Tauri 多平台构建并上传到 GitHub Release）

必需 secrets：

- `NPM_TOKEN`（SDK 发布）
- `BUF_TOKEN`（Proto 发布）

必需权限（workflow/job permissions）：

- `id-token: write`（runtime / desktop 发布产物的 keyless cosign 签名）
- `contents: write`（向 GitHub Release 上传产物与签名/SBOM）

desktop 发布前置契约（No-Legacy，external mods repo）：

1. `release-desktop` job 必须 checkout 外部 `nimiplatform/nimi-mods`（pinned ref）。
2. `NIMI_MODS_ROOT` 必须设置为 workflow 内的 external mods 路径（绝对路径）。
3. `NIMI_RUNTIME_MODS_DIR` 必须与 `NIMI_MODS_ROOT` 保持一致。
4. 构建前必须执行 `pnpm --filter @nimiplatform/desktop run env:check:mods-root` fail-fast。
5. 构建 desktop 前必须先执行 `pnpm build:sdk`，确保 `@nimiplatform/sdk-*` 的 `dist/*` 产物可被 Vite 解析。

支持 dry-run：

- 手动触发 `.github/workflows/release.yml`，选择 `target + version + publish=false`。

desktop 本地 dry-run（用于复现 release-desktop 构建输入）：

```bash
export NIMI_MODS_ROOT=/ABS/PATH/TO/nimi-mods
export NIMI_RUNTIME_MODS_DIR="$NIMI_MODS_ROOT"
pnpm -C apps/desktop run env:check:mods-root
pnpm -C apps/desktop run build:renderer:with-mods
```

`NIMI_MODS_REF` 升级与回滚策略（必须执行）：

1. 变更入口：仅允许通过 PR 修改 `.github/workflows/ci.yml` 与 `.github/workflows/release.yml` 中的 `NIMI_MODS_REF`，且两处必须同值。
2. 升级节奏：默认每周一次（或在 external `nimi-mods` 有阻断修复时即时升级）。
3. 审批责任：至少包含 desktop maintainer + release maintainer 双人审批（CODEOWNERS 覆盖）。
4. 升级门禁：
   - `pnpm -C apps/desktop run env:check:mods-root`
   - `pnpm -C apps/desktop run build:renderer:with-mods`
   - `pnpm check:desktop-mods-smoke:local-chat`
   - `workflow_dispatch(target=desktop, publish=false)` 通过并附 run 证据
5. 回滚策略：若升级后失败，立即将 `NIMI_MODS_REF` 回退到上一个已验证 commit，并重新执行上述四项门禁。

### 5. Post-release

- Verify npm packages: `npm view @nimiplatform/sdk version`
- Verify npm packages: `npm view @nimiplatform/sdk/mod version`
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
