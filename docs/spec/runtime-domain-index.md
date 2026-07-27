# Runtime Authority Index

## Canonical 容器(规范权威)

| 容器 | 覆盖面 |
|---|---|
| `.nimi/spec/runtime/security-core.authority.yaml` | 令牌校验/所有权授权/端点安全/grant/密钥路由/workspace 绑定 |
| `.nimi/spec/runtime/rpc-foundations.authority.yaml` | 审计/错误模型/分页/route-describe/流式/目标身份/reason-codes 语义 |
| `.nimi/spec/runtime/service-operations.authority.yaml` | local service/artifact/scenario-job/daemon 生命周期/CLI onboarding |
| `.nimi/spec/runtime/ai-provider.authority.yaml` | AI profile 执行/connector/model service/多模态 provider/nimillm/健康 |
| `.nimi/spec/runtime/model-catalog.authority.yaml` | 目录/本地解析/provider 元数据/voice 与内部媒体 pipeline；不创建通用 Workflow 产品 |
| `.nimi/spec/runtime/local-compute.authority.yaml` | 设备画像/资产清单/类目能力/引擎/加速器/物化器/profile 应用 |
| `.nimi/spec/runtime/delegation.authority.yaml` | 可选能力网关边界/输出防火墙/审批/审计；MCP 与 A2A 仅为延期负向缝 |
| `.nimi/spec/runtime/agent-participation.authority.yaml` | 会话锚/输出线/呈现流/Avatar 投影/App 消费；可选 continuation 不构成通用 Workflow |
| `.nimi/spec/runtime/memory-world.authority.yaml` | Runtime-owned Memory/Memory service/substrate/Knowledge；World Evolution 明确延期且非阻塞 |
| `.nimi/spec/runtime/app-surface.authority.yaml` | app 生命周期/消息/投影/local-app 主体记录/scoped 绑定/auth 服务 |
| `.nimi/spec/runtime/protected-session.authority.yaml` | 受保护本地会话/账户会话/配置/RPC 面(dev_kernel_checkpoint 语义逐字) |
| `.nimi/spec/runtime/agent-service.authority.yaml` | 上下文组装/agent 服务/本地 agent 物化(runtime 消费侧) |

机器行数据位于 `config/runtime-*.yaml`，并明确声明为非权威 projection。
不得基于本索引推断权威；权威只在 canonical 容器。
