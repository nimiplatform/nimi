<!-- nimi-docs: {"authority":["rule.nimi.platform.app-ecosystem.p-napp-035a"],"sources":["app-tools/bin/nimi-app.mjs","app-tools/package.json","app-tools/lib/app-project-lifecycle.mjs"]} -->

# 创建你的第一个 Nimi App

欢迎来到 Nimi App 开发世界！借助 Nimi 工具链，你可以快速构建现代化桌面应用，在受管宿主环境中安全调用本地与云端 AI 能力。

本页从稳定版工具开始创建桌面 App。如果产品同时面向 PC 和浏览器，建桌面工程时就选用[网页端指南](/zh/start/connect-web-app)列出的已发布版本，在同一个仓库、同一个产品 ID 下增加网页入口。已有业务工程可以直接走[存量 App 接入流程](https://github.com/nimiplatform/nimi/blob/main/app-tools/skills/nimi-app-lifecycle/references/adapt.md)。

---

## 1. 使用脚手架生成工程

打开终端，进入工作目录并运行脚手架命令：

```bash
# 使用已发布的 App Tools（请选用与当前宿主匹配的发布版本）：
pnpm dlx --package @nimiplatform/app-tools@0.14.0 nimi-app create \
  --dir my-nimi-app \
  --profile standalone \
  --features studio-create \
  --app-id example.app \
  --title "My Nimi App" \
  --package-name my-nimi-app \
  --author "Your Name"

# 或者使用本地构建的离线归档包（适用于源码仓库开发环境）：
pnpm dlx --package=file:./nimi-packages/nimiplatform-app-tools-0.14.0.tgz nimi-app create \
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
- `--features studio-create`：加入文本生成、流式聊天和向量计算，并为这些 Runtime 操作声明 `runtime.consume`。
- `--app-id`：全局唯一的应用标识符（推荐使用反向域名格式，如 `com.mycompany.myapp` 或 `example.app`）。

---

## 2. 检查与配置依赖

按[环境准备](/zh/start/install)选择制品，并保留所选 App Tools 生成的依赖组合。使用源码工具归档时，必须同时选择完整、匹配的 SDK、Kit 和目标原生包，配置方式见[源码包归档](/zh/start/install#source-package-archives)。不要将新版源码工具与同数字版本的旧 npm 包混用。

上面的 `0.14.0` 示例适用于原生 App。开发 Web 或 Android 客户端时，请按[开发环境准备](/zh/start/install)选择配套的候选包和宿主。

---

## 3. 安装、校验与本地调试

在项目根目录下依次执行：

```bash
pnpm install
pnpm run init
pnpm run check
pnpm dev
```

### 常用命令说明

1. **`pnpm run init`**：在安装依赖后生成受管配置文件，并初始化脚手架锁文件。
2. **`pnpm run check`**：校验脚手架结构、依赖版本组合与项目声明（应用自身的类型检查与单元测试仍需通过对应脚本单独运行）。
3. **`pnpm run sync`**：升级依赖或调整脚手架配置后，用于刷新受管配置文件，不会覆盖你的业务代码。
4. **`pnpm dev`**：在 Nimi Desktop 托管的 Electron 开发环境中启动应用。运行前请先在 Nimi Home 开启开发者模式；启动器会自动新建或复用开发注册项，若存在多个注册项，按终端提示选择即可。

---

## 4. 构建与分发打包

先在 `test/*.test.mjs` 加入一项实际业务测试，或配置工程已有的测试命令，再运行 `pnpm run test`。补齐应用摘要、作者和链接，提供 `metadata.icon` 指向的 PNG、版本说明和用户介绍 `NIMI_APP.md`。在 `package.json.license` 填写与根目录 `LICENSE` 一致的许可证标识。先运行 `pnpm exec nimi-app check --production` 检查分发资料，再在对应系统上构建并打包。

```bash
# macOS
pnpm exec nimi-app build --target macos-aarch64 --production
pnpm exec nimi-app pack --target macos-aarch64 --production

# Windows
pnpm exec nimi-app build --target windows-x86_64 --production
pnpm exec nimi-app pack --target windows-x86_64 --production
```

`pack --production` 会校验构建产物的代码签名与运行前置条件，生成可用于本地导入（Local Import）测试的安装包。请注意，打包成功仅代表产物符合打包规范，实际安装体验与业务流程仍需在宿主环境中完成验收。若计划将应用上架至官方 Registry，还需通过完整的平台预检与审核流程。

---

## 接下来

- [升级 App Tools、SDK 和 Kit](https://github.com/nimiplatform/nimi/blob/main/app-tools/skills/nimi-app-lifecycle/references/upgrade-platform.md)可查受支持的版本组合、受管文件变更预览及锁文件验证步骤。
- 准备上架桌面端时，按[原生包发布指南](https://github.com/nimiplatform/nimi/blob/main/app-tools/README.md#publishing-on-github)配置标签保护，为实际发布的系统和架构提交审核。
- [发起第一次 AI 调用](/zh/sdk/first-ai-call) — 几行代码连接本地模型与云端模型
- [使用 Nimi Kit 丰富 UI 界面](/zh/platform/kit/use-kit-in-app) — 打造美观一致的沉浸式体验
- [配置 AI 能力意图](/zh/sdk/ai-config-surface) — 让用户自主选择模型路由与密钥

## Source Basis

- [`app-tools/README.md`](https://github.com/nimiplatform/nimi/blob/main/app-tools/README.md)
- [`apps/lab/README.md`](https://github.com/nimiplatform/nimi/blob/main/apps/lab/README.md)
- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
