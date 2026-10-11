# 网页端与桌面端 Nimi Home

Nimi 官方网站与桌面端 Nimi Home 各自承担明确的业务定位。公开网站面向广泛的用户与开发者，负责产品介绍、各平台发布状态展示、政策条款展示，以及由 Realm 支持的统一账户登录与安全交互。而 Nimi Home 则是用户安装到本地的完整产品工作台，由桌面端程序（Desktop）监督启动并提供坚实的本地算力与应用执行环境。

## 浏览器网页端定位

- **产品与生态呈现**：浏览 Nimi 平台的特性介绍、开发文档与精选应用展示。
- **账户登录与安全交互**：通过浏览器完成用户注册、多因素认证与密码重置。浏览器交互直接对接 Realm 权威认证服务，保障用户账户安全。
- **安装包获取**：查看 macOS、Windows 等主流操作系统的当前下载与发布状态。
- **说明**：公开网页主要用于信息展示与安全身份认证，不直接替代桌面端运行本地模型或托管本地应用。

## 桌面端 Nimi Home 定位

- **本地隐私 AI 计算**：通过本地 Runtime 驱动开源大模型推理，数据全流程保留在本地，提供真正的离线与私密 AI 体验。
- **应用生态与开发调试**：通过受桌面端托管的 Electron 开发环境，本地 App 可以直接使用 `@nimiplatform/sdk` 和 `@nimiplatform/kit` 获得硬件加速、本地存储与权限会话支持。
- **统一设备管理**：集中管理 GPU / NPU 硬件资源、模型下载、存储限额与多智能体调度。

## 典型协同流程：在浏览器完成登录并交接回桌面端

1. **发起登录**：在 Nimi Desktop 中点击登录，客户端调用系统默认浏览器打开官方授权页面。
2. **安全认证**：使用浏览器页面提供的方式登录，并完成需要的二次验证。
3. **授权交接**：认证完成后，浏览器通过此次登录指定的本地回调将授权码返回给桌面环境。
4. **桌面端激活会话**：Desktop 将回调信息转交本地 Runtime，由 Runtime 验证授权码、完成一次性凭据交换并安全托管，激活本地用户会话。

## Source Basis

- [`.nimi/spec/platform/product-lifecycle.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/product-lifecycle.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`apps/web/src/site-router.tsx`](https://github.com/nimiplatform/nimi/blob/main/apps/web/src/site-router.tsx)
