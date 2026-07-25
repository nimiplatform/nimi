# Runtime Kernel — Migrated Domain Index

本域契约散文已全量迁入 canonical authority(S6 域 3,2026-07-24)。本目录余件为冻结邻接素材,处置权已移交对应后续包。

## Canonical 容器(规范权威)

| 容器 | 覆盖面 |
|---|---|
| `.nimi/spec/runtime/security-core.authority.yaml` | 令牌校验/所有权授权/端点安全/grant/密钥路由/workspace 绑定 |
| `.nimi/spec/runtime/rpc-foundations.authority.yaml` | 审计/错误模型/分页/route-describe/流式/目标身份/reason-codes 语义 |
| `.nimi/spec/runtime/service-operations.authority.yaml` | local service/artifact/scenario-job/daemon 生命周期/CLI onboarding |
| `.nimi/spec/runtime/ai-provider.authority.yaml` | AI profile 执行/connector/model service/多模态 provider/nimillm/健康 |
| `.nimi/spec/runtime/model-catalog.authority.yaml` | 目录/本地解析/provider 元数据/voice/workflow |
| `.nimi/spec/runtime/local-compute.authority.yaml` | 设备画像/资产清单/类目能力/引擎/加速器/物化器/profile 应用 |
| `.nimi/spec/runtime/delegation.authority.yaml` | 能力网关/MCP 适配/输出防火墙/审批/审计回放/A2A 负向缝 |
| `.nimi/spec/runtime/agent-participation.authority.yaml` | 会话锚/hook/输出线/呈现(流)/avatar 调试/参与全家族/房间编排/AI 配置/app 消费/生命自治 |
| `.nimi/spec/runtime/memory-world.authority.yaml` | canonical memory/memory service/substrate/knowledge/scheduling/world-evolution |
| `.nimi/spec/runtime/app-surface.authority.yaml` | app 生命周期/消息/投影/local-app 主体记录/scoped 绑定/auth 服务 |
| `.nimi/spec/runtime/protected-session.authority.yaml` | 受保护本地会话/账户会话/配置/RPC 面(dev_kernel_checkpoint 语义逐字) |
| `.nimi/spec/runtime/agent-service.authority.yaml` | 上下文组装/agent 服务/本地 agent 物化(runtime 消费侧) |

原文散文(rationale,非规范)见 `docs/authority/runtime-*-rationale.md`;机器行数据见 `config/runtime-*.yaml`(头注声明非权威)。

## 冻结邻接素材(本目录余件,零改动保留)

- **dev-kernel/local-development 载体(D4,处置权 = dev-kernel 解缠包)**:`tables/protected-local-*.yaml` 六件套、`tables/local-app-*.yaml`、`tables/provider-probe-targets.yaml`、`tables/profile-image-family-companion-slots.yaml`(后两者 runtime Go 测试直读)
- **realm 冻结(处置权 = realm 合流包)**:`tables/account-rpc-permission-matrix.yaml`、`tables/realm-broker-operations.yaml`、`tables/config-schema.yaml`、`tables/runtime-rpc-auth-posture.yaml`、`tables/error-mapping-matrix/**` realm 分片
- 其余分片子目录随其父表归属。

不得基于本索引推断权威;权威只在 canonical 容器。
