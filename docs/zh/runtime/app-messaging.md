# 应用消息

> 状态：运行中 (Running)。`RuntimeAppService.SendAppMessage` 和 `SubscribeAppMessages` 是已发布的运行时中介跨应用消息原语 (`K-APP-001..K-APP-013+`)。

Nimi 上的应用间协调通过**运行时中介应用消息**进行。应用之间不会直接互相调用——它们通过 `RuntimeAppService` 发送类型化消息并订阅类型化事件，该服务负责验证发送者身份、实施速率限制、检测循环，并在应用向代理表面发送消息时应用凭证平面范围绑定要求。

## 方法接口

`RuntimeAppService` 方法是固定的：

| 方法 | 用途 |
| --- | --- |
| `SendAppMessage` | 发送应用间消息 |
| `SubscribeAppMessages` | 订阅应用间消息的事件流 |

## SendAppMessage

| 字段 | 是否必填 | 备注 |
| --- | --- | --- |
| `from_app_id` | 是 | 发送方应用 ID（必须经过运行时认证） |
| `to_app_id` | 是 | 接收方应用 ID |
| `subject_user_id` | 否 | 关联用户 |
| `message_type` | 否 | 消息类型标识符 |
| `payload` | 否 | JSON 结构体 |
| `require_ack` | 否 | 发送方是否需要确认回执 |
| `scoped_binding` | 条件性 | 当 `to_app_id=runtime.agent` 且消息家族属于 K-APP-008 集合时必需 |

返回 `message_id`（ULID），`accepted`，`reason_code`。

`scoped_binding` 字段是凭证平面边界：向运行时代理表面发送已准入家族消息的应用必须提供其已准入的范围绑定（由 `RuntimeAccountService.IssueScopedAppBinding` 发布）。绑定携带非秘密绑定 ID/可选句柄/非秘密关系选择器。这就是为什么应用消息接口位于 auth/identity 波中——绑定本身具有认证功能。

## SubscribeAppMessages

| 字段 | 是否必填 | 备注 |
| --- | --- | --- |
| `app_id` | 是 | 订阅者应用 ID |
| `subject_user_id` | 否 | 过滤特定用户 |
| `cursor` | 否 | 恢复游标 |
| `from_app_ids` | 否 | 按发送者过滤（可重复） |
| `scoped_binding` | 条件性 | 当 `from_app_ids` 包含 `runtime.agent` 且流用于显式绑定仅消费时必需 |

`AppMessageEvent` 字段：

| 字段 | 类型 | 用途 |
| --- | --- | --- |
| `event_type` | `AppMessageEventType` | `RECEIVED` / `ACKED` / `FAILED` |
| `sequence` | uint64 | 单调递增 |
| `message_id` | string | 消息 ID |
| `from_app_id` | string | 发送方 |
| `to_app_id` | string | 接收方 |
| `subject_user_id` | string | 关联用户 |
| `message_type` | string | 消息类型 |
| `payload` | Struct | 负载 |
| `reason_code` | ReasonCode | 结果代码 |
| `trace_id` | string | 跟踪 ID |
| `timestamp` | Timestamp | 事件时间 |

## 安全基线

第二阶段发布基线规则：

| 规则 | 约束 | 原因 |
| --- | --- | --- |
| 应用认证 | `SendAppMessage` 必须验证 `from_app_id` 已在 `RuntimeAuthService` 注册且当前会话持有有效令牌。未认证返回 `UNAUTHENTICATED` | 防止任意进程冒充注册应用 |
| 负载大小限制 | `payload` 结构体序列化后不得超过 **64 KB**。超过限制返回 `INVALID_ARGUMENT` + `APP_MESSAGE_PAYLOAD_TOO_LARGE` | 防止单个消息耗尽运行时内存 |
| 发送速率限制 | 每 `from_app_id`：**每秒 100 条消息** 滑动窗口。超过限制返回 `RESOURCE_EXHAUSTED` + `APP_MESSAGE_RATE_LIMITED` | 防止风暴/DoS 攻击 |
| 循环检测 | 相同的 `(from_app_id, to_app_id)` 对在 **1 秒内双向交换超过 20 条消息** 自动断路该对 **60 秒** 返回 `FAILED_PRECONDITION` + `APP_MESSAGE_LOOP_DETECTED`。两个应用在此期间可以继续与其他应用通信 | 防止两个模块之间的 fork-bomb |

安全基线是合同的一部分，不是建议性的。

## 为什么使用运行时中介而不是直接通信

原则上，两个应用可以直接通信。存在运行时中介路径的原因如下：

| 关注点 | 直接路径 | 运行时中介路径 |
| --- | --- | --- |
| 发送者认证 | 应用端信任假设 | 运行时验证 `from_app_id` 与已准入注册 |
| 审计 | 每对审计逻辑 | 一个标准审计界面 |
| 速率限制 | 每对逻辑 | 一个标准速率限制 |
| 循环检测 | 每对重新实现 | 一个标准断路器 |
| 凭证平面绑定到代理表面 | 应用责任 | 通过 `scoped_binding` 强制执行 |
| 应用间协调语义 | 临时 | 类型化事件流 |

运行时是协调基础。应用不需要重新发明它。

## 读者场景：一个模块向另一个应用发送类型化消息

一个笔记模块希望向日历模块查询用户的空闲时间。

1. **模块已注册并认证。** `RuntimeAuthService` 了解笔记模块；当前会话有一个有效令牌。
2. **`SendAppMessage`。** 笔记模块调用 `from_app_id: notes`，`to_app_id: calendar`，`message_type: 'free-time-query'`，`payload: { date: '...' }`。
3. **运行时验证发送者。** 验证 `from_app_id`。
4. **运行时检查大小和速率。** 在限制范围内。
5. **运行时传递。** 日历模块的 `SubscribeAppMessages` 流发出 `RECEIVED`。
6. **日历处理。** 通过其自己的 `SendAppMessage` 发送响应。
7. **笔记接收。** 通过其自己的订阅流接收。

两个模块都通过 `RuntimeAppService` 参与。没有尝试绕过运行时。

## 读者场景：一个模块向代理表面发送消息

一个模块希望向用户的代理发送类型化消息。这是 `scoped_binding` 要求覆盖的情况。

1. **模块有范围绑定。** 之前由 `RuntimeAccountService.IssueScopedAppBinding` 为已准入目的发布。
2. **`SendAppMessage`。** `from_app_id: mod-x`，`to_app_id: runtime.agent`，消息家族属于 K-APP-008 集合，加上 `scoped_binding`。
3. **运行时验证绑定。** 绑定 ID 解析；关系选择器检查；非秘密句柄（如果存在）匹配。
4. **传递。** 消息在已准入绑定上下文中到达代理表面。

没有有效的范围绑定，相同的消息将被拒绝。边界防止模块到代理的消息成为凭证平面的绕过。

## 读者场景：循环触发断路器

两个模块意外进入聊天循环，快速互相发送消息。

1. **发送速率上升。** 在一秒钟内，`(mod-a, mod-b)` 对双向交换超过 20 条消息。
2. **断路器触发。** 运行时对后续发送发出 `APP_MESSAGE_LOOP_DETECTED`。
3. **对在 60 秒内被阻止。** 其他应用继续正常消息传递；只有违规对被阻止。
4. **作者看到类型化原因。** 模块作者修复其循环逻辑。

## 应用消息不做的事情

- 它不允许未注册的进程发送消息。
- 它不允许负载超过 64 KB。
- 它不允许每个应用的速率超过每秒 100 条。
- 它不允许两个应用在没有断路器的情况下创建 fork-bomb 循环。
- 它不允许模块消息在没有已准入范围绑定的情况下到达运行时代理表面。
- 它不替代 `RuntimeAuthService` —— 应用仍然在那里进行认证。

## 边界总结

| 关注点 | 所有者 |
| --- | --- |
| `SendAppMessage` / `SubscribeAppMessages` 语义 | `RuntimeAppService` (`K-APP-001..002`) |
| `AppMessageEventType` 枚举 | `K-APP-004` |
| 安全基线（认证、大小、速率、循环） | `K-APP-005` |
| 范围绑定发行 | `RuntimeAccountService.IssueScopedAppBinding` |
| 模块间路径比较 | `K-APP-006`（桌面模块 interMod 路径） |

## Source Basis

- [`.nimi/spec/runtime/kernel/app-messaging-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/app-messaging-contract.md)
- [`.nimi/spec/runtime/kernel/account-session-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/account-session-contract.md)
- [`.nimi/spec/runtime/kernel/auth-service.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/auth-service.md)