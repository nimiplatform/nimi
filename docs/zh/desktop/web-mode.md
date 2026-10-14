# 网页端与桌面端 Nimi Home

Nimi 官方网站与桌面端 Nimi Home 各司其职、相互配合。公开网站负责展示产品概览、各平台发布状态与政策条款，并提供基于 Realm 的统一账户认证；安装到本机的 Nimi Home 则是本地执行环境，提供本地 AI 推理与受控的应用托管。

## 浏览器网页端

- **产品与生态展示**：浏览平台特性介绍、开发文档与精选应用。
- **账户认证与安全设置**：直接对接 Realm 身份认证服务，在浏览器中完成注册、登录、双因素认证与安全管理。
- **版本与下载状态**：查看 macOS、Windows 等平台的当前发布状态与下载可用性。
- **职责边界**：网页端定位于信息展示与身份认证，不替代桌面端执行本地模型推理或硬件加速的应用托管。

## 桌面端 Nimi Home

- **本地隐私 AI 推理**：通过本地 Runtime 在设备端运行开源权重模型，所选本地推理均在本机执行；云端推理与在线功能则走各自独立的数据流。
- **受控应用托管**：受监管的 Electron 宿主向当前 App 提供经准入校验的 SDK 与 Kit 操作。会话凭据由 Host 与 Runtime 持有并管理，App 仅接收受限的执行结果与会话状态。
- **系统资源管理**：查看 Runtime 与本机模型状态，管理模型下载与存储。

## 跨端协同：浏览器登录与桌面端交接

1. **发起登录**：在 Nimi Desktop 中点击登录，客户端会拉起系统默认浏览器并打开官方认证页面。
2. **安全验证**：使用网页提供的认证方式登录，并完成所需的双因素验证。
3. **授权交接**：验证通过后，浏览器通过本次会话配置的本地环回回调（loopback callback）将授权码传回桌面端。
4. **激活会话**：Desktop 将回调信息转交本地 Runtime，由 Runtime 校验响应、用授权码换取凭据并安全托管会话令牌，从而激活本地会话。

## Source Basis

- [`.nimi/spec/platform/product-lifecycle.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/product-lifecycle.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`apps/web/src/site-router.tsx`](https://github.com/nimiplatform/nimi/blob/main/apps/web/src/site-router.tsx)
