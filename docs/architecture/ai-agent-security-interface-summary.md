# AI Agent 安全调用接口（对外一页摘要）

> 版本：2026-03-03  
> 受众：合作方、管理层、安全评审、生态开发者  
> 详细版：[`ai-agent-security-interface.md`](./ai-agent-security-interface.md)

## 核心结论

1. AI Agent 不应以“模拟人类操作”作为主执行模型。  
2. 生产级 Agent 系统必须同时具备：沙盒执行、局部授权、全链路审计、可追溯错误语义。  
3. Nimi 的方案是 AI 原生接口调用：显式参数、显式授权、显式审计，而不是 UI 自动化黑盒。

## Nimi 方案（四层）

1. 意图层：动作 schema、风险分级、幂等键。  
2. 能力层：scope/TTL/委托/撤销，默认最小权限。  
3. 执行层：字段更新语义、分页边界、确定性错误。  
4. 证据层：trace/principal/operation/reason_code 全链路可追踪。

## 为什么有必要

“模拟人类操作”在 PoC 阶段快，但长期会带来权限扩大、注入面增大、审计不可复现、治理成本高的问题。  
接口化方案把安全与治理前移为架构属性，适合长期生态演进。

## 进一步阅读

1. 白皮书：[`ai-agent-security-interface.md`](./ai-agent-security-interface.md)  
2. 规则映射：[`spec/platform/ai-agent-security-interface.md`](https://github.com/nimiplatform/nimi/blob/main/spec/platform/ai-agent-security-interface.md)
