# Offline Degradation Contract

> Authority: Desktop Kernel

## Scope

Desktop 离线/断联降级策略。定义 Runtime daemon 和 Realm 云服务不可达时的分级降级行为、本地数据缓存策略、消息队列行为和重连冲突解决。

## D-OFFLINE-001 — 降级等级定义

Desktop 按照以下三级降级模型运行：

| 等级 | Runtime | Realm | 可用功能 | 不可用功能 |
|---|---|---|---|---|
| **L0 全功能** | 可达 | 可达 | 全部 | — |
| **L1 Realm 离线** | 可达 | 不可达 | 本地 AI 推理、离线 agent 交互 | 云同步、在线社交、经济交易、跨设备状态同步 |
| **L2 全离线** | 不可达 | 不可达 | UI 浏览已缓存数据、设置页面 | 所有 AI 推理、数据写入 |

Bootstrap 阶段检测到 Runtime 不可达时执行 D-BOOT-008 错误/降级路径。此合约覆盖**运行时**（非启动阶段）的降级。

## D-OFFLINE-002 — Realm 离线行为（L1）

Realm 不可达时的行为规则：

- 聊天消息写入 Desktop bounded chat shell scaffold 的本地 outbox 队列（DataSync non-admission owner map records this ownership boundary; current code must not depend on a DataSync facade）。
- outbox 消息按 FIFO 顺序排列，每条消息附带 `enqueued_at` 时间戳。
- outbox 最大容量 1000 条消息；超出后拒绝新写入并提示用户。
- 社交 post interaction 操作（例如点赞/取消点赞）可静默排队，重连后批量提交。Friendship / source materialization / LocalAgent linkage 相关 mutation 不得进入 generic social outbox；离线时必须失败关闭，除非 Realm Social/Core contract 明确提供后端持久化 intent。
- 本地 outbox 是 Desktop shell/scaffold 的待提交 intent transport，不能表示 Realm commit success，也不能作为 Chat/Social canonical state。重放必须通过 Realm/SDK public API，只有 Realm 接受后才可删除待提交记录；非网络失败必须标记 `failed` 并停止自动重放。
- 经济交易（充值、打赏）不得离线排队，必须在线执行。向用户展示明确提示。
- 世界/source 浏览使用本地缓存数据，标记"离线模式"水印。

## D-OFFLINE-003 — 全离线行为（L2）

Runtime 和 Realm 均不可达时的行为规则：

- UI 切换为只读模式：用户可浏览已缓存的聊天历史和设置。
- 所有 AI 推理请求返回用户可读错误"运行时不可用"。
- 本地模型管理命令（install/start/stop）不可用（依赖 Runtime daemon）。
- 设置页面保持可编辑，配置变更暂存本地，Runtime 恢复后自动同步。

## D-OFFLINE-004 — 重连策略

After reconnect, `OpenSession` may restore only `BINDING_ONLY`. Desktop must
repeat the complete protected endpoint/process/executable handshake and
`OpenDesktopSession` before account-control commands. A local app cannot resume
until the final carrier supplies a fresh launch lease, exact process bind and
request-empty `OpenLocalAppSession`; cached metadata/session ids never authorize replay.

断联后的重连行为：

- 使用指数退避重连，初始间隔 1s，最大间隔 30s。
  - **适用范围**: Realm REST 断联重连 + Socket.IO 断联重连。
  - **与 D-NET-002 的区别**: D-NET-002 定义单次 HTTP 请求重试退避（120ms/900ms），本规则定义连接级别恢复退避（1s/30s），两者独立。
- Realm 重连成功后立即触发 Desktop chat shell scaffold outbox flush。
- 冲突解决策略：Last-Write-Wins（LWW）based on server timestamp。
- outbox 消息发送失败（非网络原因）时标记为 `failed`，不重试，向用户展示失败原因。
- Runtime 重连成功后重新初始化 SDK session（D-BOOT-004 re-bootstrap），遵循 `S-RUNTIME-070` session recovery 协议执行 `connect()` + `OpenSession()`。
- Runtime Config 在 Realm 离线但 Runtime 可达时保留 `local` / `runtime` 页面可用，云 connector 写操作投影为排队或在线要求。
- Runtime 与 Realm 同时不可达时，Runtime Config 降级为只读浏览；daemon 管理、本地引擎启停、connector 写入与 external-agent token 签发不可用。
- Runtime 重连成功后，Runtime Config 通过 SDK projection 刷新 daemon status、
  provider health、connector 配置与 Runtime-owned External Agent gateway
  status。

## D-OFFLINE-005 — 本地缓存策略

- 聊天历史：最近 50 条消息/会话，最近 20 个会话。
- Source/World 元数据：用户已访问的 source/world profile 缓存。
- Runtime local model / asset inventory must be read from Runtime/SDK local asset
  projections when Runtime is reachable. Desktop must not persist a browser or
  IndexedDB model-manifest fallback as local readiness/capability truth.
- 缓存使用 IndexedDB 存储。
- IndexedDB-backed cache / outbox managers may expose an explicitly named
  ephemeral store for test/development harnesses only. In production renderer
  paths, missing IndexedDB support must fail closed; Desktop must not silently
  degrade offline cache or outbox persistence into process memory.
- 缓存无 TTL 自动过期；在线时通过 Realm 增量同步更新。

**存储拓扑**:
- **Zustand store** (in-memory): 运行时活跃状态，HMR 通过 globalThis 保活。
- **Tauri IPC / Runtime secure custody / Realm projections** (owner persistence): app-level persistence must be owned by the admitted Runtime/Realm/IPC owner, not by renderer hot-state.
- **IndexedDB cache stores** (offline cache): 离线降级期间的只读缓存层，仅用于 D-OFFLINE-005 定义的缓存数据集。在线时由 feature-local Realm data loaders / SDK public services refresh，不作为数据修改通道。
- **IndexedDB outbox stores** (shell/scaffold intent transport): D-OFFLINE-002 admitted outbox stores are separate from the offline cache manager. They may persist pending chat/social submit intents, but they remain non-authoritative transport records and must not be read as Realm Chat/Social truth.

## Fact Sources

- `tables/ipc-commands.yaml` — IPC 命令清单
- Cross-reference: D-BOOT-008（Runtime bootstrap 失败/降级路径）, D-BOOT-012（Realm 可达性策略）, D-NET-006, D-NET-007
