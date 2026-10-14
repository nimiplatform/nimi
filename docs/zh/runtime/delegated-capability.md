# 委派能力与外部动作网关

委派能力（Delegated Capability）是 Runtime 提供的一项可选扩展机制，用于安全支持外部智能体提议的操作（例如外部工具调用、IDE 联动或跨系统动作）。该能力作为独立扩展模块运行，不影响本地 AI 基础推理、日常对话、语音交互或常规应用开发。

## 安全沙箱与防护边界

当启用委派能力时，Runtime 通过专用的网关与安全沙箱对外部请求实施全面治理：

- **接入网关（Gateway）**：统一校验外部调用方的身份签名与访问凭证，确保请求来源合法。
- **输出防火墙（Output Firewall）**：对外部智能体提议执行的动作参数进行敏感度分类，拦截未经许可的高危操作。
- **显式用户审批（Approval Decision）**：涉及系统变更或数据修改的动作，必须通过桌面端弹出确认并获得用户许可。
- **审计事件流水（Audit Lineage）**：记录经过脱敏、限长并受保留配额约束的安全事件与审批决策。

外部服务仅能向 Runtime 提交结构化的操作提议，无法直接绕过会话凭证篡改系统数据或访问未授权的私有文件。

## 异常隔离与弹性容错

为了保障核心系统的稳定性：
- **故障局部化**：若外部服务或工具不可用，系统仅针对该特定动作返回显式的不可用状态（`unavailable`），不会连带影响核心推理能力或阻塞基础对话流。
- **标准协议集成（MCP）**：支持通过 Model Context Protocol（MCP）等开放规范对接外部工具生态，将异构工具安全转换为平台标准动作。

## Source Basis

- [`.nimi/spec/runtime/delegation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/delegation.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/protected-session.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/protected-session.authority.yaml)
