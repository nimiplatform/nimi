# 创建 Nimi App

使用公开的 App Tools CLI 创建第三方 App 项目。本页命令以 `@nimiplatform/app-tools@0.2.7` 为基准。

## 开始前准备

- 使用 Node.js 24 或更新版本，以及 pnpm。生成项目会声明所用的包管理器版本。
- 为项目选择一个空目录和 App ID。
- 通过 Nimi 运行 App 时，需要兼容的 Nimi Home 开发实例、Developer Mode 和可用的 Runtime。先看[开发环境与可用性](/zh/start/install)。创建项目不会安装 Nimi Home；公开的 Windows Runtime bootstrap 也不是 Home 安装包。

## 创建并初始化

本例包含文本生成功能，便于接着完成第一次 AI 调用。`studio-create` 会加入 Create 功能、它依赖的 AI Studio 基础模块，并生成 `runtime.consume` 声明。它会带入功能代码和界面，不是单独的权限开关。

```bash
pnpm dlx --package @nimiplatform/app-tools@0.2.7 nimi-app create --dir my-nimi-app --profile standalone --features studio-create --app-id example.app --version 0.1.0 --title "My Nimi App" --package-name my-nimi-app
cd my-nimi-app
pnpm install
pnpm run init
```

将目录、身份和标题换成你的项目值。Standalone 项目使用公开依赖；`init` 会显式同步随工具链提供的 nimicoding 投影，并初始化 App 的受管配置。使用这一入口前，无需先单独学习或执行 Nimi 主仓的治理流程。

如果只需要空白 App，可省略 `--features studio-create`。此时生成的 `app_access: []` 不包含文本生成示例所需的权限声明。在受管脚手架中，`nimi.app.yaml` 按所选功能生成；手改其中的权限会导致 `check` 失败，`sync` 会恢复生成的声明。App Tools 0.2.7 的 `sync` 不接受 `--features`。如果已经创建空白项目，想继续本例，请保留原项目，将上面的命令指向另一个空目录。

## 检查并运行

```bash
pnpm run check
pnpm run test
pnpm dev
```

`check` 只检查项目；`test` 执行 App 声明的测试；`dev` 请求由 Desktop 监督的 Electron 开发宿主。生成的 `dev:shell` 也进入 `nimi-app dev`，不会自行启动独立的 Tauri 开发外壳。

按开发宿主的要求，在 Nimi Home 的 Developer Mode 中登记并授权本地项目。窗口正在运行和拥有 Nimi Access 是两种状态；访问不可用时，根据实际原因处理项目登记、授权、Runtime 或能力配置，再重试。不要绕过宿主伪造成功。

Tauri 仍可作为明确配置的生产构建选项，但它不是默认开发宿主。

## 项目命令

| 命令或文件 | 用途 |
| --- | --- |
| `nimi.app.yaml` | 生成的 App 身份与提交配置，并非 Registry 批准的描述符；App Access 声明来自所选功能，不通过手改该受管文件添加 |
| `pnpm run init` | 安装依赖后初始化项目，包括 nimicoding 集成 |
| `pnpm run sync` | 更新脚手架管理的配置与依赖，保留 App 自己的代码 |
| `pnpm run check` | 检查项目、受管文件和依赖是否一致，不写入改动 |
| `pnpm run test` | 执行 App 声明的测试命令 |
| `pnpm run app:build -- --target windows-x86_64` | 按该目标的配置执行 App 生产构建 |
| `pnpm run pack --target windows-x86_64` | 在本地打包，不上传，也不授予 Registry 准入 |

以实际安装版本生成的 scripts 为准。旧的 `local-audit`、`doctor`、`update` 脚本已不存在；当前 `check` 和 `sync` 各自按文档承担检查与同步职责。

## 接入一项能力

添加 App 代码时，保留生成的 SDK/Kit 宿主集成。[第一次 AI 调用](/zh/sdk/first-ai-call)解释请求输入、能力意图和类型化错误；[在 App 中使用 Kit](/zh/platform/kit/use-kit-in-app)说明宿主与共享 UI。使用已配置的 App 身份和所需访问权限，真实完成一次 App 自己的请求后，再确认这项接入可用。

遇到失败时查[故障排查](/zh/start/troubleshooting)。[Nimi Lab](/zh/start/use-nimi-lab)提供能力示例；只有明确收录的功能切片可由脚手架生成，并非整个 Lab App。

## 分发之前

创建、检查或运行项目都不等于发布，也不会取得 Registry 准入。发布前请阅读[本地开发与对外分发](/zh/start/#本地开发与对外分发)和 [App Tools 发布说明](https://github.com/nimiplatform/nimi/tree/main/app-tools#canonical-release-boundary)。

## 来源依据

- [`app-tools/README.md`](https://github.com/nimiplatform/nimi/blob/main/app-tools/README.md)
- [`apps/lab/README.md`](https://github.com/nimiplatform/nimi/blob/main/apps/lab/README.md)
- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
