<!-- nimi-docs: {"authority":["rule.nimi.platform.governance-release.p-gov-026-positioning"],"sources":["app-tools/package.json","sdks/typescript/package.json","kit/package.json","sdks/typescript/adapters/vercel-ai/package.json","scripts/dev-app.mjs"]} -->

# 开发环境准备

先选择实际制品和 App 载体，再安装依赖。已发布包与本地源码归档可能使用相同版本号，却提供不同的接口。

## 选择实际制品

| 制品 | 内容与适用方式 |
| --- | --- |
| [Nimi Beta `nimi/v0.2.4`](https://github.com/nimiplatform/nimi/releases/tag/nimi%2Fv0.2.4) | macOS arm64 与 Windows x86_64 安装版。请遵循该版本的兼容性与恢复说明；该安装版不包含后续源码新增的接口。 |
| [npm SDK `0.22.2`](https://registry.npmjs.org/@nimiplatform%2fsdk/0.22.2) | 已发布的原生 App 接口；该制品不包含 `runtime/remote` 和 `realm/runtime-client` 入口。 |
| [npm Kit `0.22.1`](https://registry.npmjs.org/@nimiplatform%2fkit/0.22.1) | 已发布的组件与工具包；该制品不包含 `auth/app/*` 和 `core/app-session` 入口。 |
| [npm App Tools `0.14.0`](https://registry.npmjs.org/@nimiplatform%2fapp-tools/0.14.0) | 原生应用开发 CLI；该制品不包含 Web 导出或 `--platform` 入口。 |
| [npm Vercel 适配器 `0.6.2`](https://registry.npmjs.org/@nimiplatform%2fsdk-adapter-vercel-ai/0.6.2) | 已发布，声明依赖 SDK `^0.22.2`、AI SDK `^7.0.0` 与 provider `^4.0.0`。实际兼容性仍需在目标宿主组合中验证，不能仅凭依赖范围推定。 |

上表列出公开 Beta 和 npm 稳定包。开发 Web 或 Android 客户端时，请使用支持远程接入的 Home 和 Runtime，并选用配套的预发布包。已发布的一组是 App Tools `0.16.0-rc.9`、SDK `0.24.0-rc.10` 和 Kit `0.24.0-rc.16`。创建工程后，沿用脚手架生成的版本组合并提交锁文件。需要测试尚未发布的源码改动时，再使用下文的完整归档。

## 工具链与源码组合

使用 Node `>=24.22.3 <25`、pnpm `10.34.7`。原生源码构建还需目标系统的构建工具；Android 另需 JDK、Android SDK、原生工程与设备条件。

源码联调以所选 App Tools 包的 `nimiScaffoldVersions` 和 App 锁文件为准，其中声明了配套的 SDK、Kit 和工具版本；详见 [App Tools 清单](https://github.com/nimiplatform/nimi/blob/main/app-tools/package.json)。

## 源码包归档 {#source-package-archives}

按 [App Tools 本地包流程](https://github.com/nimiplatform/nimi/blob/main/app-tools/README.md#local-development-packages)构建完整包后，在独立 App 的 `pnpm-workspace.yaml` 中填入实际归档路径。下例使用相邻的 `nimi-packages` 目录，请将版本占位符替换为对应归档文件的实际版本。

```yaml
packages:
  - .
overrides:
  '@nimiplatform/app-tools': file:../nimi-packages/nimiplatform-app-tools-<app-tools-version>.tgz
  '@nimiplatform/sdk': file:../nimi-packages/nimiplatform-sdk-<sdk-version>.tgz
  '@nimiplatform/kit': file:../nimi-packages/nimiplatform-kit-<kit-version>.tgz
  '@nimiplatform/kit-protected-local-darwin-arm64': file:../nimi-packages/nimiplatform-kit-protected-local-darwin-arm64-<kit-version>.tgz
```

Windows x86_64 请将 Darwin 包换为匹配版本的 `kit-protected-local-win32-x64` 归档。原生可选包必须与 Kit 配套；Web App 不会因安装这些包而获得原生 Host 身份。

执行 `pnpm install`，再依次运行 App 的 init/check、类型检查、测试与构建。请保留所选源码版本的 revision 和 lockfile integrity；归档内容更新后，请换用新的候选版本并重新安装依赖，切勿直接修补已安装的依赖文件，也不要改为源码目录依赖。注意，生成本地归档并不代表已发布至 npm，也不等同于真实 Runtime 调用已经走通。

## 启动源码主机

普通原生 App 开发默认用已安装 Nimi 和官方 Realm。修改 Home、Runtime、SDK 或 Kit 时，按[仓库入门指南](https://github.com/nimiplatform/nimi/blob/main/ONBOARDING.md)准备 Go 和原生工具。公开仓库的源码 Runtime 默认连接官方 Realm。

在 Nimi 根目录用第一条命令查看能否复用已有源码 Runtime。匹配且 Home 已打开，就在当前窗口继续。需要启动 Home 时再运行第二条。

```bash
pnpm doctor:dev -- --host source --realm official
pnpm dev:desktop -- --realm official
```

联调 Realm 服务或需要受控测试数据时，运行 `pnpm dev:desktop -- --realm local`。只有该模式会检查本地 API、Realtime 和登录页；既可以复用已有服务，也可以通过 `NIMI_DEV_REALM_DIR` 指定工作区来启动缺失的 Realm 服务。切换 Runtime 前，请先与同机开发者协调。

首次打开 Home 后，选择数据目录并完成浏览器登录。开发原生 App 时，开启 Developer Mode，通过 App 工程的 `pnpm dev` 启动，并在 App 中确认 Nimi Access。

独立调试 Runtime 时，可在专用终端运行 `pnpm dev:runtime` 并查看前台日志，Home 会复用该进程。Windows 固定服务的 `status`/`health` 命令不用于诊断源码 supervisor，也不能证明 AI 已就绪，详见 [CLI 与启动路径](/zh/runtime/cli-and-daemon)。

## 接下来

- [创建桌面 App](/zh/start/create-an-app)
- [第一次 AI 调用](/zh/sdk/first-ai-call)
- [故障排查](/zh/start/troubleshooting)
- [产品下载](https://nimi.ai/download)

## 选择客户端入口

准备好主机和开发所需的软件包后，可继续[Web App](/zh/start/connect-web-app)或[Android App](/zh/start/connect-android-app)指南。

## Source Basis

- [`app-tools/README.md`](https://github.com/nimiplatform/nimi/blob/main/app-tools/README.md)
- [`app-tools/lib/app-dependency-combinations.mjs`](https://github.com/nimiplatform/nimi/blob/main/app-tools/lib/app-dependency-combinations.mjs)
- [`.nimi/spec/platform/product-lifecycle.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/product-lifecycle.authority.yaml)
- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
- [`app-tools/package.json`](https://github.com/nimiplatform/nimi/blob/main/app-tools/package.json)
- [`sdks/typescript/package.json`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/package.json)
- [`kit/package.json`](https://github.com/nimiplatform/nimi/blob/main/kit/package.json)
- [`sdks/typescript/adapters/vercel-ai/package.json`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/adapters/vercel-ai/package.json)
- [`scripts/dev-app.mjs`](https://github.com/nimiplatform/nimi/blob/main/scripts/dev-app.mjs)
- [`runtime/cmd/nimi/runtime_health_commands.go`](https://github.com/nimiplatform/nimi/blob/main/runtime/cmd/nimi/runtime_health_commands.go)
