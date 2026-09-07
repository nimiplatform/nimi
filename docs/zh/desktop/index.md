# Nimi Home 与 App 开发

Nimi Home 是 Nimi 个人 AI 产品的桌面入口，将对话、角色、作品、世界、设置和 Nimi App 放在一起。Runtime 执行本地或云端 AI，Realm 负责账号与生态身份。

## 在本地运行 App

第三方 App 开发从[创建 Nimi App](/zh/start/create-an-app)开始。受支持的开发命令会在 Desktop 监督的 Electron 宿主中启动 App。直接用浏览器打开渲染页面，不能建立这个 App 会话，也不能获得它的受保护 Runtime 访问能力。

本地运行不等于公开发布。Registry 已验证安装包、明确选择的不可变本地包导入、Developer Mode 是三条独立路径。当前预发布支持 Windows x86_64 的 Registry 包生命周期和本地开发；本地包导入入口、其他平台的包生命周期、更新与修复仍不可用。试点分发和准入条件见 [App 分发](/zh/start/#本地开发与分发)。

## 按任务选择入口

- **开发 App：**先[创建、检查并运行项目](/zh/start/create-an-app)，再完成[第一次 AI 调用](/zh/sdk/first-ai-call)。
- **接入 AI 设置：**使用 [Kit App 模式](/zh/platform/kit/use-kit-in-app)，通过受支持的 SDK 和宿主路径处理 Runtime 访问与权限。
- **下载产品：**查看[当前发布状态](https://nimi.ai/download)。Windows Runtime bootstrap 不会安装 Nimi Home。
- **了解网页端：**[网页端与 Nimi Home](/zh/desktop/web-mode)说明公开／账号网站与桌面入口各自的用途。

## 来源依据

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/platform/product-lifecycle.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/product-lifecycle.authority.yaml)
- [`.nimi/spec/start/#本地开发与分发.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/start/#本地开发与分发.authority.yaml)
