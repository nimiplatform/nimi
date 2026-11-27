<!-- nimi-docs: {"authority":["rule.nimi.runtime.remote-access.source-admission","rule.nimi.runtime.remote-access.primary-control"],"sources":["sdks/typescript/realm/runtime-client.ts","kit/core/src/app-session.ts"]} -->

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

## 会话生命周期与离线连续性

- **本地登录身份与在线凭据分离**：Runtime 将已建立的可信本地登录托管记录与短期在线 Realm Access/Refresh Token 分开管理。已登录设备在离线状态或在线 Access Token 自然过期后冷启动时，Home 保持本机登录态，已授权的本地数据与已准备的本地模型可继续运行；当官方 Registry 不可达时，已安装的官方校验 App 只要安装身份、账号有效性与本地授权保持有效，可不限时长复用该精确安装目标上一次经官方验证通过的审批结果。
- **静默刷新与不明确刷新的恢复边界**：联网时 Runtime 在后台静默刷新即将过期的在线凭据。若刷新在发出前即因离线等原因未发出，Runtime 会延迟重试并保留可恢复的刷新凭据与本地身份；若刷新结果不明确或令牌可能已轮换（发出后传输中断、Realm 503 无法核验，或重启恢复遇到刷新前崩溃围栏），Runtime 会立即清除并隔离可能已轮换的在线令牌且绝不重放，同时保留本地登录身份。此时在线 Realm 与受保护远程接入请求会如实提示需要在线认证，直到在 Home 重新完成在线登录（同账号重新登录会保留当前本地会话代际）。
- **退出、切号、吊销与 Kill-Switch 立即生效**：主动退出登录、切换账号、已确认的吊销/封禁/注销，或契约无效的刷新失败会原子化地同时失效在线凭据与本地认证身份，立即隔离活跃 App 会话、拦截后续外发与结果发布，并取消正在运行的本地工作（已发生的外部副作用无法撤回）。对于已安装校验 App，一旦观测到生效中的 kill-switch 或 Registry 中不存在对应记录，即使后续断网也会立即阻止新的启动与绑定。
- **技术性会话变更**：会话轮换（Session Rotation）或解绑观察者本身不会撤销已在有效 Job 许可下接纳的工作；但读取任务执行结果仍需当前具备有效授权。

## 远程 App 身份与来源确认

Web 和 Android 通过官方 Runtime-client 浏览器登录获取受限的 App 上下文，进而发现账号绑定的主 Runtime。来源资格由 Registry 判定，首次来源确认和逐操作权限则由 Runtime 控制；网站域名、App 名称或客户端自报角色均不能代替这些判断。

Kit 将身份视图与 Runtime 连接 scope 分开管理：PC 暂时不可达并不等于退出账号；但当账号切换、已确认的身份失效、来源暂停或连接结束时，对应的旧 scope 会随之失效。来源确认按账号、主 Runtime 与来源版本保存，不会按设备另建一套业务许可。普通 App 不获取通用 Account bearer；Android 端仅保存短期登录事务，当前上下文留在内存中。详见[共享 App 会话](/zh/platform/kit/use-kit-in-app)。

## Source Basis

- [`.nimi/spec/runtime/protected-session.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/protected-session.authority.yaml)
- [`.nimi/spec/runtime/app-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/app-surface.authority.yaml)
- [`.nimi/spec/runtime/security-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/security-core.authority.yaml)
- [`proto/runtime/v1/account.proto`](https://github.com/nimiplatform/nimi/blob/main/proto/runtime/v1/account.proto)
- [`.nimi/spec/platform/remote-clients.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/remote-clients.authority.yaml)
- [`.nimi/spec/runtime/remote-access.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/remote-access.authority.yaml)
- [`kit/auth/README.md`](https://github.com/nimiplatform/nimi/blob/main/kit/auth/README.md)
