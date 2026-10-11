# 创建 Nimi App

本教程指导你如何使用 App Tools 0.11.4、SDK 0.21.0 与 Kit 0.18.0 初始化并运行一个完整的 Nimi App。请确保先完成[开发环境准备](/zh/start/install)，并将相应的包文件放置在待建项目同级的 `nimi-packages` 目录下。

## 1. 创建项目工程

在终端中执行以下命令创建新应用：

```bash
pnpm dlx --package=file:./nimi-packages/nimiplatform-app-tools-0.11.4.tgz nimi-app create --dir my-nimi-app --profile standalone --features studio-create --app-id example.app --version 0.1.0 --title "My Nimi App" --package-name my-nimi-app --author "Your Name"
cd my-nimi-app
```

- `--features studio-create`：为应用注入 Create 相关能力及其 `runtime.consume` 权限声明。如果仅创建不涉及 AI 能力的空白应用，可以省略此参数。
- 应用 ID、名称及作者信息请根据实际项目需求替换。

## 2. 配置依赖项

在生成的 `package.json` 中，确认 `dependencies` 包含以下核心依赖：

```json
{
  "@nimiplatform/sdk": "^0.21.0",
  "@nimiplatform/kit": "^0.18.0"
}
```

在项目根目录创建 `pnpm-workspace.yaml`，指定本地离线包的 override 路径：

```yaml
packages:
  - .
overrides:
  '@nimiplatform/app-tools': file:../nimi-packages/nimiplatform-app-tools-0.11.4.tgz
  '@nimiplatform/sdk': file:../nimi-packages/nimiplatform-sdk-0.21.0.tgz
  '@nimiplatform/kit': file:../nimi-packages/nimiplatform-kit-0.18.0.tgz
  '@nimiplatform/kit-protected-local-darwin-arm64': file:../nimi-packages/nimiplatform-kit-protected-local-darwin-arm64-0.18.0.tgz
```

> **系统适配说明**：上述原生包配置适用于 macOS arm64。若在 Windows x86_64 环境下开发，请替换为 `@nimiplatform/kit-protected-local-win32-x64` 及对应版本的归档包。该原生包作为 Kit 的可选底层扩展，无需直接作为应用的手动依赖引入。

## 3. 初始化、代码检查与本地运行

执行以下命令完成初始化并启动开发：

```bash
pnpm install
pnpm run init
pnpm run check
pnpm run test
pnpm dev
```

- `init`：锁定脚手架状态并同步 Nimi Coding 规范配置。
- `sync`：在未来升级依赖或调整配置后，使用 `pnpm run sync` 刷新受管配置文件，保留应用自身的业务代码。
- `dev`：在受桌面端托管的 Electron 开发环境中启动应用。请在 Nimi Home 的开发者模式下注册并授权该项目，随后即可配置所需的 AI 模型能力。

## 4. 构建与分发打包

当应用开发完成准备交付时，可使用以下命令构建并打包生产形态的安装产物：

```bash
# macOS
pnpm run app:build -- --target macos-aarch64
pnpm run pack --target macos-aarch64 --production

# Windows
pnpm run app:build -- --target windows-x86_64
pnpm run pack --target windows-x86_64 --production
```

`pack --production` 会验证目标平台的签名与系统执行要求，生成可供本地安装与测试的交付包。面向公众的应用商店上架（Registry 发布）需走完整的发布审核预检流程。

## 下一步

- [发起第一次 AI 调用](/zh/sdk/first-ai-call)
- [使用 Nimi Kit 丰富 UI 界面](/zh/platform/kit/use-kit-in-app)
- [配置 AI 能力意图](/zh/sdk/ai-config-surface)

## Source Basis

- [`app-tools/README.md`](https://github.com/nimiplatform/nimi/blob/main/app-tools/README.md)
- [`apps/lab/README.md`](https://github.com/nimiplatform/nimi/blob/main/apps/lab/README.md)
- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
