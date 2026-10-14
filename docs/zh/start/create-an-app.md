# 创建你的第一个 Nimi App

欢迎来到 Nimi App 开发世界！借助 Nimi 工具链，你可以快速构建现代化桌面应用，在受管宿主环境中安全调用本地与云端 AI 能力。

本教程将带你使用 App Tools 脚手架初始化工程、配置 SDK 与 Kit 依赖，并在 Nimi Desktop 托管的开发环境中运行和调试应用。

---

## 1. 使用脚手架生成工程

打开终端，进入工作目录并运行脚手架命令：

```bash
# 使用已发布的 App Tools（请选用与当前宿主匹配的发布版本）：
pnpm dlx --package @nimiplatform/app-tools nimi-app create \
  --dir my-nimi-app \
  --profile standalone \
  --features studio-create \
  --app-id example.app \
  --title "My Nimi App" \
  --package-name my-nimi-app \
  --author "Your Name"

# 或者使用本地构建的离线归档包（适用于源码仓库开发环境）：
pnpm dlx --package=file:./nimi-packages/nimiplatform-app-tools-0.13.0.tgz nimi-app create \
  --dir my-nimi-app \
  --profile standalone \
  --features studio-create \
  --app-id example.app \
  --title "My Nimi App" \
  --package-name my-nimi-app \
  --author "Your Name"
```

进入新建的项目目录：

```bash
cd my-nimi-app
```

### 关键参数说明

- `--profile standalone`：生成独立的单应用工程结构。
- `--features studio-create`：引入创作套件并自动声明 `runtime.consume` 权限，使应用能够通过本地 Runtime 请求文本与多模态生成能力。
- `--app-id`：全局唯一的应用标识符（推荐使用反向域名格式，如 `com.mycompany.myapp` 或 `example.app`）。

---

## 2. 检查与配置依赖

打开生成的 `package.json`，保持脚手架生成的配套依赖版本组合。以下示例展示了当前源码仓库脚手架模板中的依赖配置（仅作结构参考，不代表 npm 上的实时发布状态）：

```json
{
  "dependencies": {
    "@nimiplatform/sdk": "^0.21.0",
    "@nimiplatform/kit": "^0.21.0"
  }
}
```

如果你在本地源码环境中开发，或使用预打包的离线 `.tgz` 归档包，请在项目根目录的 `pnpm-workspace.yaml` 中配置 `overrides` 路径：

```yaml
packages:
  - .
overrides:
  '@nimiplatform/app-tools': file:../nimi-packages/nimiplatform-app-tools-0.13.0.tgz
  '@nimiplatform/sdk': file:../nimi-packages/nimiplatform-sdk-0.21.0.tgz
  '@nimiplatform/kit': file:../nimi-packages/nimiplatform-kit-0.21.0.tgz
  '@nimiplatform/kit-protected-local-darwin-arm64': file:../nimi-packages/nimiplatform-kit-protected-local-darwin-arm64-0.21.0.tgz
```

> [!TIP] 系统架构说明
> 上述原生扩展包适用于 macOS arm64（Apple Silicon）。如果在 Windows x86_64 环境下开发，请将其替换为对应版本的 `@nimiplatform/kit-protected-local-win32-x64`。该原生包作为 Kit 的底层可选扩展自动加载，无需在业务代码中手动 `import`。

---

## 3. 安装、校验与本地调试

在项目根目录下依次执行：

```bash
pnpm install
pnpm run init
pnpm run check
pnpm run test
pnpm dev
```

### 常用命令说明

1. **`pnpm run init`**：在安装依赖后生成受管配置文件，并初始化脚手架锁文件。
2. **`pnpm run check`**：校验脚手架结构、依赖版本组合与项目声明（应用自身的类型检查与单元测试仍需通过对应脚本单独运行）。
3. **`pnpm run sync`**：升级依赖或调整脚手架配置后，用于刷新受管配置文件，不会覆盖你的业务代码。
4. **`pnpm dev`**：在 Nimi Desktop 托管的 Electron 开发环境中启动应用。运行前请先在 Nimi Home 开启开发者模式；启动器会自动新建或复用开发注册项，若存在多个注册项，按终端提示选择即可。

---

## 4. 构建与分发打包

当应用完成测试、准备打包验证时，请在目标平台主机上执行对应命令：

```bash
# macOS
pnpm run app:build -- --target macos-aarch64
pnpm run pack --target macos-aarch64 --production

# Windows
pnpm run app:build -- --target windows-x86_64
pnpm run pack --target windows-x86_64 --production
```

`pack --production` 会校验构建产物的代码签名与运行前置条件，生成可用于本地导入（Local Import）测试的安装包。请注意，打包成功仅代表产物符合打包规范，实际安装体验与业务流程仍需在宿主环境中完成验收。若计划将应用上架至官方 Registry，还需通过完整的平台预检与审核流程。

---

## 接下来

- [发起第一次 AI 调用](/zh/sdk/first-ai-call) — 几行代码连接本地模型与云端模型
- [使用 Nimi Kit 丰富 UI 界面](/zh/platform/kit/use-kit-in-app) — 打造美观一致的沉浸式体验
- [配置 AI 能力意图](/zh/sdk/ai-config-surface) — 让用户自主选择模型路由与密钥

## Source Basis

- [`app-tools/README.md`](https://github.com/nimiplatform/nimi/blob/main/app-tools/README.md)
- [`apps/lab/README.md`](https://github.com/nimiplatform/nimi/blob/main/apps/lab/README.md)
- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
