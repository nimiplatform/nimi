# Nimi Home 与 App 开发

Nimi Home 是 Nimi 个人 AI 产品的桌面入口，将对话、角色、作品、世界、设置和 Nimi App 放在一起。Runtime 执行本地或云端 AI，Realm 负责账号与生态身份。

## 在本地运行 App

第三方 App 开发从[创建 Nimi App](/zh/start/create-an-app)开始。受支持的开发命令会在 Desktop 监督的 Electron 宿主中启动 App。直接用浏览器打开渲染页面，不能建立这个 App 会话，也不能获得它的受保护 Runtime 访问能力。

本地开发主要通过 Developer Mode 进行，便于在桌面宿主中快速调试；打包验证支持本地导入不可变包，对外分发则通过官方 Registry 审核目录。目前桌面应用管理支持 Windows (x86_64) 与 macOS (arm64)；其他平台的包生命周期与普通修复仍不可用。更多要求见[本地开发与分发模式](/zh/start/#本地开发与分发模式)。

## 按任务选择入口

- **开发 App：**先[创建、检查并运行项目](/zh/start/create-an-app)，再完成[第一次 AI 调用](/zh/sdk/first-ai-call)。
- **接入 AI 设置：**使用 [Kit App 模式](/zh/platform/kit/use-kit-in-app)，通过受支持的 SDK 和宿主路径处理 Runtime 访问与权限。
- **下载产品：**查看[当前发布状态](https://nimi.ai/download)；目前还没有发布 Nimi Home 下载。使用 Nimi Home 需要 Nimi 账号，并在浏览器中登录。
- **了解网页端：**[网页端与 Nimi Home](/zh/desktop/web-mode)说明公开／账号网站与桌面入口各自的用途。

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/platform/product-lifecycle.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/product-lifecycle.authority.yaml)
- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
