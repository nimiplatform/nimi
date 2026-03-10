# Offline Degradation Contract

> Authority: Desktop Kernel

## Scope

Desktop 离线/断联降级策略。定义 Runtime daemon 和 Realm 云服务不可达时的分级降级行为、本地数据缓存策略、消息队列行为和重连冲突解决。

## D-OFFLINE-001 — 降级等级定义

Desktop 按照以下三级降级模型运行：

| 等级 | Runtime | Realm | 可用功能 | 不可用功能 |
|---|---|---|---|---|
| **L0 全功能** | 可达 | 可达 | 全部 | — |
| **L1 Realm 离线** | 可达 | 不可达 | 本地 AI 推理、离线 agent 交互、mod 执行 | 云同步、在线社交、经济交易、跨设备状态同步 |
| **L2 全离线** | 不可达 | 不可达 | UI 浏览已缓存数据、设置页面 | 所有 AI 推理、mod 执行、数据写入 |

Bootstrap 阶段检测到 Runtime 不可达时执行 D-BOOT-012 启动失败流程。此合约覆盖**运行时**（非启动阶段）的降级。

## D-OFFLINE-002 — Realm 离线行为（L1）

Realm 不可达时的行为规则：

- 聊天消息写入本地 outbox 队列（参考 D-DSYNC-003 `flushChatOutbox`）。
- outbox 消息按 FIFO 顺序排列，每条消息附带 `enqueued_at` 时间戳。
- outbox 最大容量 1000 条消息；超出后拒绝新写入并提示用户。
- 社交操作（关注、评论、点赞）静默排队，重连后批量提交。
- 经济交易（充值、打赏）不得离线排队，必须在线执行。向用户展示明确提示。
- 世界/Agent 浏览使用本地缓存数据，标记"离线模式"水印。

## D-OFFLINE-003 — 全离线行为（L2）

Runtime 和 Realm 均不可达时的行为规则：

- UI 切换为只读模式：用户可浏览已缓存的聊天历史、设置、已安装 mod 列表。
- 所有 AI 推理请求返回用户可读错误"运行时不可用"。
- mod 执行被挂起，不执行 hook callbacks。
- 本地模型管理命令（install/start/stop）不可用（依赖 Runtime daemon）。
- 设置页面保持可编辑，配置变更暂存本地，Runtime 恢复后自动同步。

## D-OFFLINE-004 — 重连策略

断联后的重连行为：

- 使用指数退避重连，初始间隔 1s，最大间隔 30s。
  - **适用范围**: Realm REST 断联重连 + Socket.IO 断联重连。
  - **与 D-NET-002 的区别**: D-NET-002 定义单次 HTTP 请求重试退避（120ms/900ms），本规则定义连接级别恢复退避（1s/30s），两者独立。
- Realm 重连成功后立即触发 outbox flush（D-DSYNC-003）。
- 冲突解决策略：Last-Write-Wins（LWW）based on server timestamp。
- outbox 消息发送失败（非网络原因）时标记为 `failed`，不重试，向用户展示失败原因。
- Runtime 重连成功后重新初始化 SDK session（D-BOOT-004 re-bootstrap）。

## D-OFFLINE-005 — 本地缓存策略

- 聊天历史：最近 50 条消息/会话，最近 20 个会话。
- Agent/World 元数据：用户已访问的 agent/world profile 缓存。
- 模型列表：已安装模型的 manifest 缓存。
- 缓存使用 IndexedDB 存储，受 D-SEC-003 安全约束。
- 缓存无 TTL 自动过期；在线时通过 Realm 增量同步更新。

**存储拓扑**:
- **Zustand store** (in-memory): 运行时活跃状态，HMR 通过 globalThis 保活。
- **Tauri IPC / DataSync 热状态** (primary persistence): 应用级持久化，支撑 D-AUTH-002、D-STATE-005。
- **IndexedDB** (offline cache): 离线降级期间的只读缓存层，仅用于 D-OFFLINE-005 定义的缓存数据集。在线时由 DataSync 增量同步更新，不作为数据修改通道。

## Fact Sources

- `tables/ipc-commands.yaml` — IPC 命令清单
- Cross-reference: D-BOOT-012, D-DSYNC-003, D-NET-006, D-NET-007, D-SEC-003
