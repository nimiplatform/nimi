# 委派能力

委派或 external action 是可选的 Runtime capability。它不是 Local AI、
LocalAgent Conversation、Memory、voice、SDK 使用、Nimi Home、
Avatar 或普通 App 能力执行 的前置。

## 边界

当某项委派能力未来被单独准入时，Runtime 持有其 gateway、authorization、
输出校验、approval decision 与 audit projection。外部 Provider 可以提出
强类型输入，但不能直接修改 Realm 真相、创建 LocalAgent 真相或绕过 active
session。

Provider-native payload、tool schema、Credential 与外部 execution state 都
留在 Runtime 边界之后。Consumer 只能取得强类型、已授权的结果。

## 失败行为

不可用的外部能力应单独返回 typed unavailable 或 failed，不得被 Runtime
转换成 LocalAgent failure 或全局 readiness blocker。

MCP 可以作为独立[集成](/zh/runtime/integrations)契约的适配器。普通 App Integration 调用不要求委派 Agent 会话、建议防火墙、隔离或审批重放；实际适配器与操作可用性分别检查。A2A 仍是未来接口方向，消费者不能通过私有协议客户端绕过 Runtime。

## 来源依据

- [`.nimi/spec/runtime/delegation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/delegation.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/protected-session.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/protected-session.authority.yaml)
