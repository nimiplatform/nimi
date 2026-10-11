# 世界状态与原子提交机制（World State）

在 Nimi 的世界架构中，世界状态（World State）代表着该数字世界在**当下的权威快照**。它精确解答了系统核心问题：“这个世界现在是什么样？”。所有对世界状态的修改，均通过标准化的提交信封（Commit Envelope）由 Realm 集中进行版本控制与原子性持久化。

关于世界当前状态（State）与历史长河（History）的深层设计差异，请参阅[状态与历史对比](/zh/platform/worlds/state-vs-history)。

## 世界状态的核心特征

| 属性维度 | 规格定义 | 架构价值 |
| --- | --- | --- |
| **存储体系** | Realm 分布式状态树（`R-WSTATE-*`） | 保证高可用与毫秒级快照读取 |
| **数据形态** | 当前时刻的世界最新结构化快照 | 读取即代表最新状态，无需从历史事件中重新计算回放 |
| **变更方式** | 严格通过提交信封（Commit Envelope）原子写入 | 保证状态变更可追溯、防并发竞争与数据冲突 |
| **权威归属** | Realm 核心服务 | 全网统一的单一可信源 |

## 提交信封（Commit Envelope）字段规范

每一次尝试修改世界状态的操作，均需封装为标准的结构化信封：

| 关键字段 | 字段说明 | 业务约束 |
| --- | --- | --- |
| `worldId` | 发生变更的目标世界 ID | 必须为已在 Realm 注册的有效世界 |
| `appId` | 发起该次变更的应用 ID | 应用必须已获得对该世界的写入授权 |
| `sessionId` | 当前执行者的会话上下文 | 追踪变更的会话血缘 |
| `effectClass` | 变更影响分类 | 声明该操作仅修改状态，还是同步追加历史日志 |
| `scope` | 状态变更的作用范围 | `WORLD`（世界级）、`ENTITY`（单个实体）、`RELATION`（实体间关系） |
| `schemaId` / `schemaVersion` | 数据结构与业务 Schema 版本 | 保证状态数据符合预定义的数据结构约束 |
| `actorRefs` | 触发该动作的主体引用 | 记录具体哪个角色或用户发起了变更 |
| `reason` | 状态变更的业务原因说明 | 人类可读的操作摘要，便于后续审计与复盘 |
| `evidenceRefs` | 支撑该次变更的证据引用 | 关联相关的会话消息或动作凭证 |

创作者工具与普通扩展应用均使用同一套提交信封模型，保证了权限控制的公平与透明。

## 变更影响分类（Effect Class）

- `STATE_AND_HISTORY`（默认常见模式）：状态更新生效的同时，在世界历史日志中自动追加一条不可篡改的历史记录。
- `STATE_ONLY`：仅更新即时状态，不写入永久历史（通常用于短暂的位置微调、瞬时状态标记等无需永久保留的场景）。
- `NONE`（试运行模式）：用于变更前的前置校验与 Dry-run 试探，不产生任何真实状态变更。

## 典型操作场景：应用发起状态更新

1. **构建提交信封**：应用根据当前业务动作组装信封内容（例如玩家角色进入某栋建筑）；
2. **提交至 Realm**：应用通过 SDK 发送包含签名的提交请求；
3. **安全校验与冲突检测**：Realm 校验应用写入权限、Schema 版本兼容性及并发乐观锁版本；
4. **状态落地与广播**：变更原子化写入状态库，并向该世界内的其他客户端广播增量状态事件；
5. **审计流水归档**：操作血缘自动入账，便于后续全景回溯。

## 相关文档

- [世界历史与仅追加日志](/zh/realm/world-history)

## Source Basis

- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
