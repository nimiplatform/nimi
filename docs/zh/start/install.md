# 当前开发环境

使用当前 Nimi 源码及相互匹配的完整包。本指南面向 App Tools 0.11.4、SDK 0.21.0、Kit/原生包 0.18.0 和匹配的 Runtime。可选 Vercel AI SDK adapter 为 0.5.0，Tauri 载体为 0.10.0。这些是工作区版本，不表示它们已在公共仓库发布。

## 工具链

使用 Node.js 24 或更新版本，以及 pnpm 10.34.5。App 项目还声明本地 Nimi Coding 0.6.3，在安装依赖后通过 `pnpm run init` 明确初始化。

准备完整 App Tools、SDK、Kit，以及当前宿主对应的 Kit 原生包。通过当前源码的组件打包流程构建，或使用匹配交付包；不能把正式 App 依赖链接到源码目录，也不能在缺少当前归档时替换成旧 registry 包。Kit 原生可选依赖与 Kit 同版本。

## 选择当前组合

App Tools 0.11.4 默认仍生成 SDK `^0.18.1` / Kit `^0.15.3`。使用本指南的当前接口时，在初始化前把 App 的依赖声明明确改为 SDK `^0.21.0` / Kit `^0.18.0`。当前 App Tools 矩阵已准入这一组合；使用 Tauri 时对应 0.10.0。初始化和同步会保留明确选中的已准入组合。

`package.json` 保留 registry 版本声明，完整本地归档通过 `pnpm-workspace.yaml` overrides 提供。完整步骤见[创建 App](/zh/start/create-an-app)。独立升级单个包或版本号碰巧一致，都不能证明 Runtime 与原生接口匹配。

## 通过 Nimi Home 运行

先准备匹配的 Nimi Home 开发实例与 Runtime。Home 需要 Nimi 账号并通过浏览器登录。在 Developer Mode 中注册和授权 App，再在 App 项目运行 `pnpm dev`，请求 Desktop 监督的 Electron Host。

窗口可见不代表 Nimi Access 或 AI 配置已就绪。通过绑定宿主的客户端配置能力，准备机器选中的 Local Loadout 或确切 Cloud 目标，再执行真实请求。直接打开 Vite 或普通 loopback gRPC 都不能代替受保护 Host。

公开安装包可用性见[下载页面](https://nimi.ai/download)。创建 App 项目不会安装 Home，不会发布 App，也不会授予 Registry 准入。

## 继续操作

- [创建 App](/zh/start/create-an-app)
- [第一次 AI 调用](/zh/sdk/first-ai-call)
- [AIConfig](/zh/sdk/ai-config-surface)
- [故障排查](/zh/start/troubleshooting)
- [开发与分发](/zh/start/#本地开发与对外分发)

## Source Basis

- [`app-tools/README.md`](https://github.com/nimiplatform/nimi/blob/main/app-tools/README.md)
- [`app-tools/package.json`](https://github.com/nimiplatform/nimi/blob/main/app-tools/package.json)
- [`app-tools/lib/app-dependency-combinations.mjs`](https://github.com/nimiplatform/nimi/blob/main/app-tools/lib/app-dependency-combinations.mjs)
- [`app-tools/lib/app-scaffold.mjs`](https://github.com/nimiplatform/nimi/blob/main/app-tools/lib/app-scaffold.mjs)
- [`.nimi/spec/platform/product-lifecycle.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/product-lifecycle.authority.yaml)
- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
