# 网页端与 Nimi Home

Nimi 网站与 Nimi Home 服务不同的任务。公开网站介绍产品、提供下载与政策信息，并承载由 Realm 支持的账户登录和安全交互。Nimi Home 是安装后的产品入口，目前由 Desktop 承载。

## 浏览器中的任务

公开网页提供产品与 App 介绍、账户登录和安全操作、法律条款、下载状态及导航。App 介绍页用于说明产品，不在浏览器里运行 Nimi Home，也不会建立 App 安装、Registry 准入或 Runtime 访问事实。

Realm 仍负责账户与生态身份。网页端呈现账户交互；Desktop 使用已准入的浏览器交接流程，不嵌入凭据表单，也不自行拼出另一条登录路径。

## Nimi Home 中的任务

通过 Desktop 监督的宿主运行本地 App 开发，使用 App 的公开 SDK/Kit 绑定。Runtime 负责能力执行与访问决定。公开网站不承载 Desktop renderer，也不通过 Desktop Web 适配器提供桌面端的缩小版本。

第三方 App 代码使用公开 SDK 与 Kit，不导入 Desktop renderer 私有实现，也不借公开网站绕过 Runtime 授权。

## 读者场景：在浏览器登录，再返回 App

用户可以在浏览器完成账户交互后返回 Nimi Home。这次网页交互本身不证明某个 App 已安装、正在运行或有权调用 AI 能力。App 仍需使用当前宿主会话，并处理真实的访问或执行结果。

开发 App 请从[创建 Nimi App](/zh/start/create-an-app)开始；产品构建的可用范围以[下载页](https://nimi.ai/download)为准。

## 来源依据

- [`.nimi/spec/platform/product-lifecycle.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/product-lifecycle.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`apps/web/src/site-router.tsx`](https://github.com/nimiplatform/nimi/blob/main/apps/web/src/site-router.tsx)
