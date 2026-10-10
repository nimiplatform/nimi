# 创建 Nimi App

本例使用当前 App Tools 0.11.4 源码及 SDK 0.21.0 / Kit 0.18.0 组合。先准备[匹配的 Home、Runtime、工具链和完整本地包](/zh/start/install)，把归档放进与待创建 App 目录并列的 `nimi-packages`。

## 创建项目

```bash
pnpm dlx --package=file:./nimi-packages/nimiplatform-app-tools-0.11.4.tgz nimi-app create --dir my-nimi-app --profile standalone --features studio-create --app-id example.app --version 0.1.0 --title "My Nimi App" --package-name my-nimi-app --author "Your Name"
cd my-nimi-app
```

`studio-create` 提供 Create 功能及其 `runtime.consume` 声明。只在创建无 AI 访问声明的空白 App 时省略。示例身份、名称和作者应换成自己项目的值。

## 安装前选择包

在生成的 `package.json` 的 `dependencies` 中只修改下面两项，保留其他依赖和脚本。创建 `pnpm-workspace.yaml`，写入以下 overrides：

```json
{
  "@nimiplatform/sdk": "^0.21.0",
  "@nimiplatform/kit": "^0.18.0"
}
```

```yaml
packages:
  - .
overrides:
  '@nimiplatform/app-tools': file:../nimi-packages/nimiplatform-app-tools-0.11.4.tgz
  '@nimiplatform/sdk': file:../nimi-packages/nimiplatform-sdk-0.21.0.tgz
  '@nimiplatform/kit': file:../nimi-packages/nimiplatform-kit-0.18.0.tgz
  '@nimiplatform/kit-protected-local-darwin-arm64': file:../nimi-packages/nimiplatform-kit-protected-local-darwin-arm64-0.18.0.tgz
```

这里的原生 override 用于 macOS arm64。Windows x86_64 改用 `@nimiplatform/kit-protected-local-win32-x64` 及匹配的 0.18.0 归档。使用实际归档文件名和同一组合的原生/Runtime 构建，不能重命名旧二进制冒充新包。原生包仍是 Kit 的可选依赖，不应变成 App 自有直接依赖。

## 初始化、检查与运行

```bash
pnpm install
pnpm run init
pnpm run check
pnpm run test
pnpm dev
```

`init` 创建脚手架锁，并同步所选依赖组合及 Nimi Coding 集成，因此要求项目已安装对应 Nimi Coding 包。`sync` 只用于已初始化项目；更改依赖后运行 `sync`，如 manifest 有变化则重新安装，再执行 `check`。

`dev` 请求 Desktop 监督的 Electron Host。在 Home Developer Mode 注册并授权项目，再配置 AI 能力。保留生成的 `getNimiLocalAppClient()` 绑定，直接启动 renderer 不能建立 Nimi 访问。

Manifest 根据所选功能受管生成，不能手改 `app_access` 绕过脚手架契约。当前 `sync` 没有 `--features` 参数。空白项目需要本例功能时，保留原项目，用上述功能选项创建新项目。

## 构建和打包

```bash
pnpm run app:build -- --target macos-aarch64
pnpm run pack --target macos-aarch64 --production
```

在匹配 Windows 宿主使用 `windows-x86_64`。生产形态的本地包必须满足目标签名和执行要求；`pack --production` 检查这些条件，但不发布、不授予 Registry 准入，也不运行仅面向 registry 依赖的发布预检。普通开发包不能用于 Runtime 本地导入。

Tauri 是明确配置的生产替代载体，只承载部分 shell 能力，不是开发 Host。不支持的操作见 [Kit](/zh/platform/kit/)。

下一步是[第一次 AI 调用](/zh/sdk/first-ai-call)。公开发布还需要 registry 依赖、生产预检、发布方 release 和独立 Registry 准入；本地归档用于开发交付。

## Source Basis

- [`app-tools/README.md`](https://github.com/nimiplatform/nimi/blob/main/app-tools/README.md)
- [`apps/lab/README.md`](https://github.com/nimiplatform/nimi/blob/main/apps/lab/README.md)
- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
