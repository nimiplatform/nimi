# 开源发布

这份 Runbook 固定了 Nimi 开源发布的顺序，并把公开安装入口和桌面更新入口统一到同一套链路上。

## 版本轨道

- `runtime/vX.Y.Z`：runtime GitHub Release 与 Go module tag
- `sdk/vX.Y.Z`：`@nimiplatform/sdk` 与 `@nimiplatform/dev-tools`
- `desktop/vX.Y.Z`：desktop GitHub Release
- `@nimiplatform/nimi` 与 `@nimiplatform/nimi-*`：跟随 runtime 版本，而不是 SDK 或 desktop 版本

Nimi 当前不会额外发布 Go registry 包，也不会把桌面端发布到 crates.io。

## 必需的 GitHub Secrets 与 Variables

### 通用发布门禁

- `NIMI_LIVE_OPENAI_API_KEY`
- `NIMI_LIVE_ALIBABA_API_KEY`
- `NIMI_LIVE_OPENAI_MODEL_ID`（repo variable，可选，workflow 内有默认值）
- `NIMI_LIVE_ALIBABA_BASE_URL`（repo variable，可选，workflow 内有默认值）
- `NIMI_LIVE_ALIBABA_CHAT_MODEL_ID`（repo variable，可选，workflow 内有默认值）

### Runtime 发布

- 除 `GITHUB_TOKEN` 外不需要额外 registry secret
- `.github/workflows/release-runtime.yml` 中的 runtime 签名与 `checksums.txt` 签名基于 GitHub OIDC 完成

### npm 发布

- `NPM_TOKEN`

### Desktop 发布

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
- `NIMI_DESKTOP_UPDATER_PUBLIC_KEY`（repo variable）
- `NIMI_DESKTOP_UPDATER_ENDPOINT=https://install.nimi.xyz/desktop/latest.json`（repo variable）
- `APPLE_CERTIFICATE`
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_SIGNING_IDENTITY`
- `APPLE_ID`
- `APPLE_PASSWORD`
- `APPLE_TEAM_ID`

### Cloudflare 安装网关

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `GITHUB_RELEASES_TOKEN`（可选，但建议配置以避免 GitHub API 限流）

## Install Gateway

`install.nimi.xyz` 由 `apps/install-gateway/` 下的 Cloudflare Worker 提供。

公开入口：

- `https://install.nimi.xyz/`
- `https://install.nimi.xyz/runtime/latest.json`
- `https://install.nimi.xyz/desktop/latest.json`

部署方式：

1. 为 Worker 配置 `install.nimi.xyz` 自定义域名。
2. 运行 `.github/workflows/deploy-install-gateway.yml`。
3. 验证：
   - `curl -fsSL https://install.nimi.xyz | sh`
   - [https://install.nimi.xyz/runtime/latest.json](https://install.nimi.xyz/runtime/latest.json)
   - [https://install.nimi.xyz/desktop/latest.json](https://install.nimi.xyz/desktop/latest.json)

## 发布顺序

首次对外联调先使用 RC 标签：

- `runtime/vX.Y.Z-rc.1`
- `sdk/vX.Y.Z-rc.1`
- `desktop/vX.Y.Z-rc.1`

稳定版发布顺序：

1. 部署或刷新 `install.nimi.xyz`。
2. 推送 `runtime/vX.Y.Z`。
3. 等待 `.github/workflows/release-runtime.yml` 完成。
4. 确认复用 npm workflow 已发布：
   - `@nimiplatform/nimi`
   - `@nimiplatform/nimi-darwin-arm64`
   - `@nimiplatform/nimi-darwin-x64`
   - `@nimiplatform/nimi-linux-arm64`
   - `@nimiplatform/nimi-linux-x64`
   - `@nimiplatform/nimi-win32-arm64`
   - `@nimiplatform/nimi-win32-x64`
5. 推送 `sdk/vX.Y.Z`。
6. 等待 `.github/workflows/release.yml` 发布 `@nimiplatform/sdk` 与 `@nimiplatform/dev-tools`。
7. 推送 `desktop/vX.Y.Z`。
8. 等待 `.github/workflows/release.yml` 发布桌面端 GitHub Release 资产。

## Dry Run 与 Smoke 检查

首次公开发布前运行：

- `pnpm check:release-preflight`
- `pnpm check:npm-binary-smoke`
- `node scripts/check-install-script-smoke.mjs`
- `pnpm --filter @nimiplatform/install-gateway test`
- `pnpm --filter @nimiplatform/install-gateway build`

发布演练可使用这些 GitHub Actions workflow：

- `.github/workflows/release-runtime.yml` 的 `workflow_dispatch` 快照构建
- `.github/workflows/release.yml` 的 `workflow_dispatch`，并设置 `publish=false`
- `.github/workflows/desktop-release-dry-run.yml`

## 公网验收

稳定版发布后，至少确认以下事项：

- `curl -fsSL https://install.nimi.xyz | sh` 能在 macOS 和 Linux 上安装最新 runtime，且不会因为最新 GitHub Release 不是 runtime 而取错版本
- `npm install -g @nimiplatform/nimi` 会在受支持的 macOS、Linux 和 Windows 目标上安装正确的平台包
- runtime GitHub Release 包含归档、`checksums.txt`、签名、证书和 SBOM 资产
- desktop GitHub Release 包含当前 workflow 的实际输出：macOS 更新归档、Windows NSIS 安装器、Linux AppImage、签名和 updater 元数据
- [https://install.nimi.xyz/runtime/latest.json](https://install.nimi.xyz/runtime/latest.json) 返回完整的 runtime manifest
- [https://install.nimi.xyz/desktop/latest.json](https://install.nimi.xyz/desktop/latest.json) 返回有效的 desktop updater manifest
