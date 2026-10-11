# 账户认证与受保护应用会话

在 Nimi 架构中，全网通用的用户身份认证与账号权限由 Realm 核心统一签发。本地的 `RuntimeAccountService` 负责协调本地浏览器授权流、授权码（OAuth Code）交换、自动刷新与凭据安全托管。桌面端（Desktop）负责拉起浏览器并协助本地回调，所有敏感情报（如 Access Token）均保留在受保护的本地环境中，不向前端应用渲染进程暴露。

## 登录流程与授权握手

1. **发起登录**：Nimi Home 向 `RuntimeAccountService` 请求创建新的认证事务；
2. **拉起浏览器**：Desktop 自动打开由系统生成的官方认证页面；
3. **完成身份校验**：用户在浏览器中通过 Realm 完成登录、多因素验证或通行密钥校验；
4. **安全回调握手**：浏览器将授权码通过该次登录指定的本地回环回调（Loopback）安全传递给本地 Runtime；
5. **凭据安全托管**：由 Runtime 负责与 Realm 验证授权码并完成一次性凭据交换，将长效凭据安全托管于受保护的本地存储；
6. **就绪同步**：Home 接收到认证成功的通知，展示当前登录用户信息。

## 应用权限隔离与会话绑定

通过 Nimi Home 启动的桌面端 App 会使用官方 SDK 自动建立受保护的宿主会话绑定：
- **身份自动推导**：Runtime 基于调用方的宿主会话凭证，自动推导其所属账号、应用身份及授权的能力范围（Scopes），应用无需手动传入明文 Token；
- **凭据保护防越权**：应用无需直接持有敏感的 Realm Bearer Token，所有对云端资源或本地模型的访问均由 Runtime 统一鉴权代理；
- **独立客户端限制**：非受控的普通直连调用无法获取应用级私有权限，确保了受保护通道的隔离与准入边界。

## 会话变更与生命周期响应

- **会话刷新与断线重连**：当短期 Token 过期时，Runtime 会在后台自动完成静默刷新，不打断正在进行的会话；
- **账号切换与退出**：用户主动切换账户或退出登录后，之前的应用会话将自动失效并清空缓存；
- **任务连续性**：对于已处于排队或执行中的长耗时计算任务，会话轮换不会强行中断底层已提交的工作，但未获授权的第三方将无法提取任务结果。

## Source Basis

- [`.nimi/spec/runtime/protected-session.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/protected-session.authority.yaml)
- [`.nimi/spec/runtime/app-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/app-surface.authority.yaml)
- [`.nimi/spec/runtime/security-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/security-core.authority.yaml)
- [`proto/runtime/v1/account.proto`](https://github.com/nimiplatform/nimi/blob/main/proto/runtime/v1/account.proto)
