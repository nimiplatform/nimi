# 账号与受保护 App 会话

用户身份与账号授权归 Realm。RuntimeAccountService 管理本地浏览器授权事务、授权码交换、刷新、重启恢复与凭据托管。Desktop 传递浏览器启动和 loopback 回调，Web 提供凭据交互；两侧 renderer 都不接收 bearer。

## 通过 Home 登录

1. Home 向 RuntimeAccountService 请求登录事务。
2. Desktop 在浏览器打开 owner 返回的确切 URL。
3. 用户通过 Web 完成 Realm 授权。
4. Desktop 把经过验证的回调交给 Runtime；只有 Runtime 交换授权码并建立本地托管。
5. Home 展示有限的当前用户和会话信息。

Runtime 不可用、回调非法、事务不匹配或授权过期时拒绝继续。Renderer 不能另拼登录 URL，也不能自行交换 token。

## App 访问

Desktop 监督的 App 使用标准宿主绑定 SDK。Runtime 验证确切启动的 Host peer，并推导已注册 App 主体、账号上下文、声明代次、操作与访问范围。Localhost、App ID 或可移植 bearer 都不足以证明受保护来源。

App 只消费安全状态和强类型能力结果，不调用公开 `GetAccessToken`，不持有 Realm access/refresh token，也不用 Runtime 颁发的 bearer 直连 Realm。受保护 Realm 操作通过强类型 broker，凭据留在 Runtime。Nimi App 之外的独立 SDK 程序另有 token 托管边界，不能因此取得受保护 App 权限。

## 会话变化

切换账号、退出、注册变化或访问撤销会使对应入口和引用失效。单纯技术会话轮换或观察断线不会取消已准入的有限 Job；真正权限撤销会阻止新的出站工作及未授权结果发布。刷新会话不重放 App 任务。

退出登录不是删除账号。本地 Cognition 清理只响应实际观察到且正确关联的 Realm 账号删除结果，不能宣称已远程物理擦除离线设备。

另见 [App 授权](/zh/platform/agents/participation-authority) 与 [Job 观察](/zh/runtime/streaming)。

## Source Basis

- [`.nimi/spec/runtime/protected-session.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/protected-session.authority.yaml)
- [`.nimi/spec/runtime/app-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/app-surface.authority.yaml)
- [`.nimi/spec/runtime/security-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/security-core.authority.yaml)

- [`proto/runtime/v1/account.proto`](https://github.com/nimiplatform/nimi/blob/main/proto/runtime/v1/account.proto)
