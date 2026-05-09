# 账户与会话

> 状态：运行中 (Running)。`RuntimeAccountService` 拥有本地机器的账户会话事实、保管、登录生命周期以及在 `K-ACCSVC-*` 下的第一方范围绑定发行。

`RuntimeAccountService` 是**本地第一方账户身份**的运行时权威：谁登录了这台机器，当前活动的是哪个账户，如何进行登录/刷新/登出流程，以及短期访问令牌如何分发给已准入的本地第一方应用程序中。

## 权限边界

| 拥有 | 不拥有 |
| --- | --- |
| 本地机器账户会话事实 | 应用端会话状态 |
| 登录/刷新/登出/切换生命周期 | 应用发行的令牌（应用不发行它们） |
| 刷新令牌保管 | 应用持有的刷新令牌（应用可能不持有它们） |
| 守护进程重启恢复 | 外部主体会话（这些是 `RuntimeAuthService` 的职责） |
| 第一方短期应用访问令牌投射 | 应用工作区状态 |
| 第一方范围应用绑定发行和撤销 | 每个应用的对话事实 |
| 账户 `subject_user_id` 推导 | 调用者提供的 `subject_user_id`（运行时从不信任调用者提供的主体身份） |

应用会话和外部主体会话存在于 `RuntimeAuthService` (`K-AUTHSVC-*`) 中。这两个服务不可互换。

## 方法表面

`RuntimeAccountService` 的方法是**冻结**的：

| 方法 | 目的 |
| --- | --- |
| `GetAccountSessionStatus` | 当前账户会话状态 |
| `SubscribeAccountSessionEvents` | 会话转换的事件流 |
| `BeginLogin` | 开始登录尝试 |
| `CompleteLogin` | 完成登录证明 |
| `GetAccessToken` | 获取运行时发行的短期访问令牌 |
| `RefreshAccountSession` | 主动/反应式会话刷新 |
| `Logout` | 撤销本地凭证 + 绑定 |
| `SwitchAccount` | 原子激活账户切换 |
| `IssueScopedAppBinding` | 为第一方应用发行一个范围绑定 |
| `RevokeScopedAppBinding` | 撤销先前发行的绑定 |

新方法需要明确的内核规则准入。该集合不能通过应用约定扩展。

## 会话状态机

| 状态 | 含义 |
| --- | --- |
| `anonymous` | 无账户会话 |
| `login_pending` | 登录尝试正在进行中 |
| `authenticated` | 有效的账户材料 + 投射 |
| `refresh_pending` | 正在刷新账户材料 |
| `expired` | 材料已过期；无法授权工作 |
| `reauth_required` | 需要用户操作才能继续 |
| `switching` | 原子激活账户切换正在进行中 |
| `logging_out` | 撤销本地材料 + 绑定 |
| `unavailable` | 无法安全地决定/保管账户状态 —— 故障关闭 |

**单个活跃账户不变性：** 一个运行时实例一次最多有一个 `authenticated` 账户。`SwitchAccount` 是原子的；两个有效的账户投射不能共存。

## 为什么应用不持有刷新令牌

刷新令牌是持久的身份验证密钥。如果应用持有它，每个已准入的本地第一方应用都会成为一个单独的刷新令牌保管站点 —— 每个应用都必须实现安全存储，每个应用都是一个单独的妥协向量，并且撤销需要按应用分发。

运行时一次性拥有刷新令牌的保管权。应用通过 `GetAccessToken` 获取短期访问令牌，并直接使用它们与已准入的 Realm 数据 API 进行交互。当访问令牌过期时，应用请求运行时提供一个新的令牌。刷新保留在守护进程中。

## 读者场景：在全新机器上登录

1. **状态 `anonymous`。** 不存在会话。
2. **应用调用 `BeginLogin`。** 运行时发出 `login.started`；状态移动到 `login_pending`。应用收到一个待处理的尝试句柄；在过期之前重复 `BeginLogin` 将返回相同的待处理尝试。
3. **用户完成证明**（Web 流程/设备代码等）。
4. **应用调用 `CompleteLogin`。** 运行时验证证明，将账户材料写入保管，并发出 `login.completed` + `account.status`。状态移动到 `authenticated`。
5. **应用在需要与 Realm 通信时调用 `GetAccessToken`。** 运行时返回一个短期令牌。

应用从未看到刷新令牌。应用从未将认证材料写入磁盘。应用不拥有账户会话。

## 读者场景：使用中途的令牌刷新

应用正在进行一个长时间运行的操作；访问令牌即将过期。

1. **状态 `authenticated`。** 应用持有一个短期访问令牌。
2. **刷新开始。** 运行时发出 `refresh.started`；状态移动到 `refresh_pending`。每次只有一个刷新在进行中。
3. **刷新成功。** 运行时原子地交换新的令牌替换旧的令牌。发出 `refresh.completed` + `account.status`。状态返回到 `authenticated`。
4. **应用的下一个 `GetAccessToken` 返回新的令牌。**

如果刷新可恢复地失败，状态移动到 `reauth_required` 并且绑定被暂停或撤销。应用不能假装刷新成功。

## 读者场景：账户切换

用户有两个 Nimi 账户（工作和个人），并进行切换。

1. **应用调用 `SwitchAccount`。** 状态移动到 `switching`。
2. **原子转换。** 运行时使之前的账户投射无效，并允许新的账户投射。没有“两个账户同时认证”的时刻。
3. **状态返回到 `authenticated`。** 订阅者接收到反映新活动账户的 `account.status`。

订阅了 `SubscribeAccountSessionEvents` 的应用可以看到切换并重新推导其每个账户的状态。没有跨账户共享的“当前用户”字符串供应用读取。

## 读者场景：守护进程重启恢复

1. **守护进程重启。** 所有进程中状态丢失。
2. **账户保管持续存在。** 刷新令牌 + 最小必需的账户状态由运行时持久存储。
3. **状态恢复** 到 `authenticated`（或根据持久状态恢复到 `expired` / `reauth_required`）。
4. **应用重新连接。** 订阅的应用接收到反映恢复状态的 `account.status` 事件。它们不需要重新提示用户。

如果恢复的状态是 `expired`，应用的下一个 `GetAccessToken` 将关闭失败 —— 没有隐式的重新登录。

## 范围应用绑定

`IssueScopedAppBinding` 发行一个绑定，将已准入的第一方应用与具有有限范围的活动账户关联起来。绑定是应用在希望以账户权限执行有限目的时所呈现的内容。`RevokeScopedAppBinding` 可以撤销它。

绑定：

- 由运行时发行，而不是应用发行
- 具有范围（绑定声明其目的）
- 可以由运行时独立于登出而撤销
- 在登出时自动撤销

## 账户服务不做的事情

- 它不会代理每一个 Realm 数据请求 —— 已准入的本地第一方应用可以直接使用短期令牌调用 Realm 数据 API。
- 它不拥有应用会话事实 —— 那是 `RuntimeAuthService` 的职责。
- 它不拥有外部主体会话 —— 也是 `RuntimeAuthService` 的职责。
- 它不接受调用者提供的 `subject_user_id`。

## 边界总结

| 关注点 | 所有者 |
| --- | --- |
| 本地机器账户会话 + 保管 + 生命周期 | `RuntimeAccountService` (`K-ACCSVC-*`) |
| 应用会话 + 外部主体会话 | `RuntimeAuthService` (`K-AUTHSVC-*`) |
| 令牌验证（传入的承载 JWT） | 认证令牌验证 (`K-AUTHN-*`) |
| 令牌授权/所有权（谁拥有什么） | 授权所有权 |

## 来源依据

- [`.nimi/spec/runtime/kernel/account-session-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/account-session-contract.md)
- [`.nimi/spec/runtime/kernel/auth-service.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/auth-service.md)
- [`.nimi/spec/runtime/kernel/authn-token-validation.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/authn-token-validation.md)
- [`.nimi/spec/runtime/kernel/authz-ownership.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/authz-ownership.md)