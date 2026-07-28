# SDKs Kernel — Migrated Domain Index

本域契约散文已全量迁入 canonical authority(S6 域 4,2026-07-24)。

## Canonical 容器(规范权威)

| 容器 | 覆盖面 |
|---|---|
| `.nimi/spec/sdks/client-core.authority.yaml` | 公开面/runtime 客户端/传输/错误投影/边界/scope(含无 fallback 旋钮与重试不救契约失败硬边界) |
| `.nimi/spec/sdks/feature-clients.authority.yaml` | AI 适配与配置/第三方 app 客户端/permission/proposal/connector 认证/本地环境投影/route/delegation/avatar 控制/agent 参与/companion/包治理与 vnext |
| `.nimi/spec/sdks/realm-consumer.authority.yaml` | Realm API 消费/生成核心/facade/world/world-evolution 投影与消费/群组参与客户端(Realm 产权只引用) |

机器行数据见 `config/sdks-*.yaml`，其头注声明非权威；历史契约散文
仅保留在 Git 历史中。

## 冻结邻接素材(零改动保留)

- `tables/realm-private-operation-carriers.yaml` — realm 冻结,处置权 = realm 合流包(conformance 运行链原位消费)。

不得基于本索引推断权威;权威只在 canonical 容器。
