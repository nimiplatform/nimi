# 集成

通过绑定宿主客户端的 `client.integration` 发现并调用已准入的外部服务或 Nimi App 操作。Integration Operation 是服务动作，不是 AI CapabilityContract；普通 App 调用不需要 LocalAgent 或 Conversation。

## 连接与授权

Home 的「集成」工作区管理连接、用户选择和调用历史。连接标识选中的外部账号，以及执行和凭据托管位置。Runtime 保存绑定确切 Nimi 账号、消费 App 主体、操作和目标的持续权限。

发现描述、安装来源、声明 App Access 或加载 Skill 都不会授予调用权，消费方不能自行批准自己。凭据设置走可信管理流程，秘密只写入；安全目标和配置视图不返回凭据。

当前强类型连接包括 MCP、Telegram、微信、飞书、官方 QQ 和 OneBot v11。实际可用性取决于已实现适配器、所选账号/协议与确切操作组合。只有描述符不代表能够执行；文件和媒体支持需要按具体平台及接收方检查。

## 调用与观察

1. 通过受保护客户端发现目标与操作描述。
2. 由用户在管理流程中配置连接和持续权限。
3. 调用 `invoke`，提交已准入目标、操作和符合 schema 的参数。
4. 保留返回的调用身份，用 `getCall` 或 `listCalls` 观察，分别处理 `accepted`、`completed`、`failed`、`canceled` 和 `unconfirmed`。
5. 把结果纳入 App 自己的项目工作流。

取消只请求停止，不承诺回滚外部副作用。原生消息写入不会静默重试。Provider 接受不等于接收方送达或已读；结果未确认也不代表可以安全重发。

## App 提供方与 Skill

App 可通过 provider 接口提供已准入操作描述和实际 handler。Runtime 根据确切受保护 Host 确定提供方身份与 handler 生命周期。Skill 解释如何使用操作，不创建 handler 或权限。

Runtime 管理有界调用与授权事实；目标、计划、业务等待、完成判断和恢复归消费 App。技术会话恢复不会恢复或重放业务任务。可选委派建议/防火墙路径独立存在，不是普通 Integration 调用的前提。

## Source Basis

- [`.nimi/spec/runtime/integration.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/integration.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`sdks/typescript/core/app/local-app-runtime-platform-integration.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core/app/local-app-runtime-platform-integration.ts)
