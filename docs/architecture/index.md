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

- [Nimi Coding](./nimi-coding.md)
- [Nimi Coding（中文）](./nimi-coding_cn.md)
- [Spec Map](./spec-map.md)
- [Realm 互联范式：让应用不是孤岛](./realm-interconnect-paradigm.md)
- [AI Agent 安全调用接口白皮书（Nimi 方案）](./ai-agent-security-interface.md)
- [AI Agent 安全调用接口（对外一页摘要）](./ai-agent-security-interface-summary.md)
- [Nimi MCP × Agent 交互架构白皮书（中文）](./mcp-agent-interaction_cn.md)
- [Protocol Reference](../reference/protocol.md)
- [Runtime Reference](../reference/runtime.md)
