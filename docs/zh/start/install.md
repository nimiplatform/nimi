<!-- nimi-docs: {"authority":["rule.nimi.platform.governance-release.p-gov-026-positioning"],"sources":["app-tools/package.json","sdks/typescript/package.json","kit/package.json","sdks/typescript/adapters/vercel-ai/package.json","scripts/dev-app.mjs"]} -->

# 开发环境准备

先选择实际制品和 App 载体，再安装依赖。已发布包与本地源码归档可能使用相同版本号，却提供不同的接口。

## 选择实际制品

| 制品 | 内容与适用方式 |
| --- | --- |
| [Nimi Beta `nimi/v0.2.4`](https://github.com/nimiplatform/nimi/releases/tag/nimi%2Fv0.2.4) | macOS arm64 与 Windows x86_64 安装版。遵循该版本的兼容性和恢复说明；安装版版本号不能证明它支持后续源码接口。 |
| [npm SDK `0.22.2`](https://registry.npmjs.org/@nimiplatform%2fsdk/0.22.2) | 已发布的原生 App 接口；该制品没有 `runtime/remote` 和 `realm/runtime-client` 入口。 |
| [npm Kit `0.22.1`](https://registry.npmjs.org/@nimiplatform%2fkit/0.22.1) | 该制品没有 `auth/app/*` 和 `core/app-session` 入口。 |
| [npm App Tools `0.14.0`](https://registry.npmjs.org/@nimiplatform%2fapp-tools/0.14.0) | 原生应用开发 CLI；该制品没有 Web 出口或 `--platform` 入口。 |
| [npm Vercel 适配器 `0.6.2`](https://registry.npmjs.org/@nimiplatform%2fsdk-adapter-vercel-ai/0.6.2) | 已发布，声明依赖 SDK `^0.22.2`、AI SDK `^7.0.0` 与 provider `^4.0.0`。依赖范围本身不能证明与某个宿主组合已经走通。 |

使用公开原生开发路径时，选择与目标宿主匹配的 App Tools 发布版，并沿用它生成的依赖组合。当前 Web 和 Android 指南需要同一源码交付中的完整 SDK、Kit、App Tools 归档，以及匹配的源码 Runtime 和 Home。只安装上表中的 npm 版本不会得到新增入口。

## 工具链与源码组合

使用 Node `>=24.22.1 <25`、pnpm `10.34.7`。原生源码构建还需目标系统的构建工具；Android 另需 JDK、Android SDK、原生工程与设备条件。

当前源码脚手架声明的组合如下：

| 包 | 源码版本 |
| --- | --- |
| `@nimiplatform/sdk` | `^0.22.2` |
| `@nimiplatform/kit` | `^0.22.1` |
| `@nimiplatform/app-tools` | `^0.14.0` |
| `@nimiplatform/sdk-adapter-vercel-ai` | `^0.6.2` |
| `nimi-shell-tauri` | `0.11.1` |
| 项目级 Nimi Coding | `0.7.0` |

## 源码包归档 {#source-package-archives}

按 [App Tools 本地包流程](https://github.com/nimiplatform/nimi/blob/main/app-tools/README.md#local-development-packages)构建完整包。在独立 App 的 `pnpm-workspace.yaml` 中选择实际归档路径；以下示例使用相邻的 `nimi-packages` 目录：

```yaml
packages:
  - .
overrides:
  '@nimiplatform/app-tools': file:../nimi-packages/nimiplatform-app-tools-0.14.0.tgz
  '@nimiplatform/sdk': file:../nimi-packages/nimiplatform-sdk-0.22.2.tgz
  '@nimiplatform/kit': file:../nimi-packages/nimiplatform-kit-0.22.1.tgz
  '@nimiplatform/kit-protected-local-darwin-arm64': file:../nimi-packages/nimiplatform-kit-protected-local-darwin-arm64-0.22.1.tgz
```

Windows x86_64 请将 Darwin 包换为匹配版本的 `kit-protected-local-win32-x64` 归档。原生可选包必须与 Kit 配套；Web App 不会因安装这些包而获得原生 Host 身份。

执行 `pnpm install`，再运行 App 的 init/check、类型检查、测试与构建。保留所选交付的源码 revision 和 lockfile integrity；即使数字版本相同，更换归档后也需重新安装。不要补丁式修改已安装文件或改成源码目录依赖。生成归档不等于发布到 npm，也不等于真实 Runtime 调用成功。

## 启动源码主机

先完成[仓库环境准备](https://github.com/nimiplatform/nimi/blob/main/ONBOARDING.md)，包括 Go 和原生工具。源码联调使用 `http://127.0.0.1:3002` 的本地 Realm。可通过 `NIMI_DEV_REALM_DIR` 指定已有的 Realm 开发工程，或自行运行所需服务；公开 Nimi 仓库不包含该服务端实现。

在 Nimi 根目录运行：

```bash
pnpm dev:desktop
```

启动器会检查并启动已配置但缺失的开发服务和 Runtime，然后打开 Home。完成数据目录设置与浏览器登录。开发原生 App 时，开启 Developer Mode，再通过 App 声明的 `pnpm dev` 入口启动；宿主启动与该 App 的 Nimi Access 就绪需要分别确认。

独立调试 Runtime 时，可在专用终端运行 `pnpm dev:runtime` 并查看前台日志，Home 会复用该进程。Windows 固定服务的 `status`/`health` 命令不用于诊断源码 supervisor，也不能证明 AI 已就绪，详见 [CLI 与启动路径](/zh/runtime/cli-and-daemon)。

## 接下来

- [创建桌面 App](/zh/start/create-an-app)
- [第一次 AI 调用](/zh/sdk/first-ai-call)
- [故障排查](/zh/start/troubleshooting)
- [产品下载](https://nimi.ai/download)

## 选择客户端入口

准备好主机与源码包后，可继续[Web App](/zh/start/connect-web-app)或[Android App](/zh/start/connect-android-app)指南。

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
