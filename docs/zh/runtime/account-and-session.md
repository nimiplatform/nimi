# 账户认证与受保护应用会话

在 Nimi 架构中，全平台通用的用户身份认证与账号权限均由 Realm 权威签发。本地 `RuntimeAccountService` 负责协调浏览器授权流程、授权码（OAuth Code）交换、会话静默刷新与受保护凭据的本地托管。Desktop 负责拉起系统默认浏览器并协助处理本地回环回调（Loopback Callback），确保凭据由受保护的 Runtime 托管，避免泄露至前端渲染进程。

## 登录流程与授权握手

1. **发起认证事务**：Nimi Home 向 `RuntimeAccountService` 请求创建新的认证事务；
2. **拉起系统浏览器**：Desktop 在系统默认浏览器中打开官方认证页面；
3. **完成身份核验**：用户在浏览器中通过 Realm 完成登录、多因素验证或通行密钥核验；
4. **安全回调握手**：浏览器将授权码通过该次事务专用的本地回环回调地址安全回传至本地 Runtime；
5. **凭据安全托管**：Runtime 负责与 Realm 验证授权码并完成凭据交换，将长效凭据持久保存在受保护的本地存储中；
6. **就绪激活**：Home 收到就绪信号，向用户展示当前激活的账号上下文。

## 应用权限隔离与会话绑定

通过 Nimi Home 启动的应用会使用官方 SDK 自动建立受保护的会话绑定：
- **上下文自动推导**：Runtime 直接根据受监管的对等连接，推导调用方账号身份、应用 ID 及获准的权限范围（Scopes），应用无需自行管理明文 Bearer Token；
- **凭据隔离防越权**：客户端应用永远不会直接接触 Realm 的 Access/Refresh Token；受保护的 Nimi AI 调用由 Runtime 执行；App 自有在线业务有各自的数据流；
- **受控边界约束**：不受管的独立客户端无法绕过宿主监管越权声明应用权限范围，从而严格保障受保护通道的准入边界。

## 会话变更与生命周期响应

- **静默令牌刷新**：Runtime 会尝试在后台更新即将过期的凭据；若刷新失败或需要用户处理，会话会显示对应状态，受保护操作按当前访问判定执行。
- **账号切换与退出**：用户主动切换账号或退出登录会立即使现存的应用会话失效，并清理临时数据缓存；
- **技术性会话变更**：会话轮换（Session Rotation）或解绑观察者本身不会撤销已在有效 Job 许可下接纳的工作；但读取任务执行结果仍需当前具备有效授权；
- **权限撤销与失效边界**：退出登录、切换账号或撤销相关应用访问权限/策略会立即使对应的任务许可失效。Runtime 会拦截后续的外发工作与结果发布，并取消正在运行的本地工作；但无法撤销外部已经产生的既成影响。

## Source Basis

- [`.nimi/spec/runtime/protected-session.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/protected-session.authority.yaml)
- [`.nimi/spec/runtime/app-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/app-surface.authority.yaml)
- [`.nimi/spec/runtime/security-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/security-core.authority.yaml)
- [`proto/runtime/v1/account.proto`](https://github.com/nimiplatform/nimi/blob/main/proto/runtime/v1/account.proto)
