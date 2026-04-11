# 架构概览

Nimi 由三个面向开发者的层组成：

1. `nimi-runtime`（本地 AI 执行）
2. `nimi-realm`（云端持久化状态）
3. `@nimiplatform/sdk`（统一开发者接口）

## 边界规则

- 应用通过 SDK 消费 runtime/realm。
- Mod 通过 `nimi-hook` 消费能力。
- Runtime/realm 相互独立，可以分别单独使用。

## 延伸阅读

- [Spec Map](./spec-map.md)
- [Realm 互联范式：让应用不是孤岛](./realm-interconnect-paradigm.md)
- [AI Agent 安全调用接口白皮书（Nimi 方案）](./ai-agent-security-interface.md)
- [AI Agent 安全调用接口（对外一页摘要）](./ai-agent-security-interface-summary.md)
- [Nimi MCP × Agent 交互架构白皮书（中文）](./mcp-agent-interaction.md)
- [协议参考](../reference/protocol.md)
- [Runtime 参考](../reference/runtime.md)
