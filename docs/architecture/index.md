# Architecture Overview

Nimi consists of three developer-facing layers:

1. `nimi-runtime` (local AI execution)
2. `nimi-realm` (cloud persistent state)
3. `@nimiplatform/sdk` (unified developer interface)

## Boundary rules

- Apps consume runtime/realm through SDK.
- Mods consume capabilities through `nimi-hook`.
- Runtime/realm are independent and can be used separately.

## Next

- [Spec Map](./spec-map.md)
- [Agent Companion Core Protocol](./agent-companion-core-protocol.md)
- [Agent Companion Design Memory Register](./agent-companion-design-memory-register.md)
- [Agent Companion Design Corpus Preservation](./agent-companion-design-corpus-preservation.md)
- [Live2D Companion Architecture](./live2d-companion.md)
- [Realm 互联范式：让应用不是孤岛](./realm-interconnect-paradigm.md)
- [AI Agent 安全调用接口白皮书（Nimi 方案）](./ai-agent-security-interface.md)
- [AI Agent 安全调用接口（对外一页摘要）](./ai-agent-security-interface-summary.md)
- [Nimi MCP × Agent 交互架构白皮书（中文）](../zh/architecture/mcp-agent-interaction.md)
- [Protocol Reference](../reference/protocol.md)
- [Runtime Reference](../reference/runtime.md)
