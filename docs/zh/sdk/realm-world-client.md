# App 中的 Realm 访问

账号、Character、World、社交、经济、历史和资源真相归 Realm。Nimi App 使用绑定宿主客户端上的已准入 `client.realm` 操作。Runtime 中介已授权 Realm 访问，不把 Realm token 或原始 REST/WebSocket 传输交给 App。

## 使用明确的 owner 操作

只调用当前 App 声明和权限覆盖的操作，账号与 App 主体由受保护载体推导。PersonaCharacter owner 操作、World 接口及 Realm realtime 分别保留自己的强类型输入、授权和结果契约，不提供任意路径代理。

直接 `@nimiplatform/sdk/realm` facade 面向自行持有已准入 Realm 会话的其他消费者，不能用来绕过正式 Nimi App 的宿主访问边界。已删除的 `@nimiplatform/sdk/world` 不再提供。

## 组合产品流程

1. 通过已准入 App 操作读取必要 Realm 信息。
2. App AI 工作使用 `client.ai`；Agent 工作使用独立授权的 Agent 操作。
3. 项目工作流和结果保存留在 App。
4. 用户要求修改 Realm 时，提交对应 owner 操作并展示真实结果。

本地执行、缓存视图或 App 成功消息不能提交 Realm 真相。载体缺失或操作被拒绝时明确失败，不能用原始 `/api/...` 调用替代。

## Source Basis

- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
- [`.nimi/spec/sdks/client-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/client-core.authority.yaml)

- [`.nimi/spec/runtime/protected-session.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/protected-session.authority.yaml)
