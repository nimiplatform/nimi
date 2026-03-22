# Data Sync Contract

> Authority: Desktop Kernel

## Scope

Desktop DataSync facade 契约。定义统一数据同步层的业务流规则，每条规则对应一个独立的数据流域。

## D-DSYNC-000 — DataSync 基础设施

DataSync facade 提供以下基础设施能力，业务流规则按需使用：

- **API 初始化** — `dataSync.initApi(config)` 设置 realm 连接参数（`realmBaseUrl`、`accessToken`、`fetchImpl`），持久化到 `globalThis.__NIMI_DATA_SYNC_API_CONFIG__` 热状态。
- **热状态** — `readDataSyncHotState()` / `writeDataSyncHotState()` 跨 HMR 重载保持 API 连接状态。Store 热状态通过 `globalThis` 键保持 HMR 连续性。
- **上下文锁** — `callApi()` 内部使用 SDK `withRealmContextLock` 确保同一时刻只有一个 Realm 客户端上下文激活，响应通过 JSON 解析归一化，错误通过 `normalizeApiError` 归一化（错误格式参考 `D-NET-005`）。
- **轮询管理** — `DataSyncPollingManager` 提供 key-based 轮询：`startPolling(key, callback, intervalMs)`、`stopPolling(key)`、`stopAllPolling()`。
- **错误日志** — `emitDataSyncError` 通过 runtime telemetry 记录错误（日志区域 `datasync`，消息格式 `action:${actionName}:failed`）。
- **初始数据加载** — `loadInitialData()` 按序加载 `loadCurrentUser()` → `loadChats()` → `loadContacts()`。
- **Facade 委托** — 所有业务操作委托给 `createDataSyncActions` 工厂创建的 actions 对象，注入 `callApiTask`、`emitFacadeError`、`setToken`、`clearAuth`、`stopAllPolling`、`isFriend`。
- **分页基础设施** — 所有 `loadMore*` 方法遵循统一分页契约：
  - 默认 `pageSize: 20`（可由调用方覆盖），上限 `100`（超过 100 截断为 100）。
  - Cursor 传递：首次请求不传 cursor；后续请求传递上一次响应返回的 `nextCursor`。
  - 末页检测：响应中 `hasMore=false` 或返回结果数量 < `pageSize` 时标记为末页，UI 停止触发加载。
  - 适用方法：`loadMoreChats`、`loadMoreMessages`、`loadMoreExploreFeed` 及其他分页场景。
  - **跨域分页参数说明**：D-DSYNC-000 的 `pageSize: 20` 是 Desktop DataSync 层面向 Realm REST API 的客户端默认值。Runtime gRPC List RPC 的分页默认值（K-PAGE-005: page_size=50, max=200）独立于此，由 SDK runtime.md S-RUNTIME-066 投影。两者服务不同传输域，差异为设计意图。

## D-DSYNC-001 — Auth 数据流

认证流方法：`login`、`register`、`logout`。

- 使用基础设施：上下文锁、错误日志。
- `login`/`register` 成功后通过 `setToken()` 更新热状态和 store。
- `logout` 触发 `clearAuth()` + `stopAllPolling()`。

## D-DSYNC-002 — User 数据流

用户资料读写方法：`loadCurrentUser`、`updateUserProfile`、`loadUserProfile`。

- 使用基础设施：上下文锁、错误日志、初始数据加载。
- `loadCurrentUser` 在 `loadInitialData()` 中首先执行。

## D-DSYNC-003 — Chat 数据流

聊天数据流方法：`loadChats`、`loadMoreChats`、`startChat`、`loadMessages`、`loadMoreMessages`、`sendMessage`、`syncChatEvents`、`flushChatOutbox`、`markChatRead`。

- 使用基础设施：上下文锁、轮询管理、错误日志、初始数据加载。
- `syncChatEvents` 通过 `PollingManager` 定期轮询。
- `flushChatOutbox` 处理离线消息队列。

## D-DSYNC-004 — Social 数据流

社交数据流方法：`loadContacts`、`loadSocialSnapshot`、`searchUser`、`requestOrAcceptFriend`、`rejectOrRemoveFriend`、`removeFriend`、`blockUser`、`unblockUser`、`loadFriendRequests`。

- 使用基础设施：上下文锁、错误日志、初始数据加载。
- 辅助方法：`isFriend(userId)` 在 contacts 状态中检查好友关系。

## D-DSYNC-005 — World 数据流

世界数据流方法：`loadWorlds`、`loadWorldDetailById`、`loadWorldAgents`、`loadWorldDetailWithAgents`、`loadWorldSemanticBundle`、`loadWorldEvents`、`loadWorldLorebooks`、`loadWorldMediaBindings`、`loadMainWorld`、`loadWorldLevelAudits`。

- 使用基础设施：上下文锁、错误日志。
- `loadWorldSemanticBundle` 返回的 `worldview.coreSystem.rules` 必须是 ordered rule item array（`key / title / value`），不得回退为 JSON object map。
- creator audit 读取统一来自 `WorldStateDto.items` 与 `WorldHistoryListDto.items`；Desktop 不再定义独立 world mutation 读取面。

## D-DSYNC-006 — Economy 数据流

经济数据流方法：

- 余额：`loadCurrencyBalances`
- 交易：`loadSparkTransactionHistory`、`loadGemTransactionHistory`
- 订阅：`loadSubscriptionStatus`
- 充值：`loadSparkPackages`、`createSparkCheckout`
- 提现：`loadWithdrawalEligibility`、`loadWithdrawalHistory`、`createWithdrawal`
- 礼物：`loadGiftCatalog`、`loadReceivedGifts`、`sendGift`、`acceptGift`、`rejectGift`、`createGiftReview`

- 使用基础设施：上下文锁、错误日志。

## D-DSYNC-007 — Feed 数据流

社交 feed 方法：`loadPostFeed`、`createPost`、`createImageDirectUpload`、`createVideoDirectUpload`、`finalizeMediaAsset`。

- 使用基础设施：上下文锁、错误日志。
- `createImageDirectUpload` / `createVideoDirectUpload` 返回 `MediaDirectUploadSessionDto` 语义：
  - `assetId` 是后续 `createPost` 唯一允许写入的媒体引用
  - `storageRef` 是 provider 传输层引用，仅供旧附件/上传 transport 路径使用，不得作为新 post 的媒体主键
- `finalizeMediaAsset` 在 S3 直传完成后调用，将资产状态从 PENDING 转为 READY；
  调用前后均不需要写入资产 URL，仅通过 `assetId` 引用媒体资产
- `createPost` 的 post media 写入规则：
  - `media[].assetId` 为唯一正式字段
  - 不通过 `media-bindings` 反查资产
  - 不再写入 `imageId` / `videoId` / `uid` / `key`

## D-DSYNC-008 — Explore 数据流

探索发现方法：`loadExploreFeed`、`loadMoreExploreFeed`、`loadAgentDetails`。

- 使用基础设施：上下文锁、错误日志。

## D-DSYNC-009 — Notification 数据流

通知方法：`loadNotificationUnreadCount`、`loadNotifications`、`markNotificationsRead`、`markNotificationRead`。

- 使用基础设施：上下文锁、轮询管理、错误日志。
- `loadNotificationUnreadCount` 通过 `PollingManager` 定期轮询。

## D-DSYNC-010 — Settings 数据流

设置方法：`loadMySettings`、`updateMySettings`、`loadMyNotificationSettings`、`updateMyNotificationSettings`、`loadMyCreatorEligibility`。

- 使用基础设施：上下文锁、错误日志。

## D-DSYNC-011 — Agent 数据流

Agent 方法：`loadMyAgents`。

- Agent LLM 相关的聊天路由与记忆读取不属于 Desktop core product DataSync contract。
- mods 如需 Agent chat route / memory，必须通过 desktop host 注册的 data capability 获取，而不是通过 DataSync facade。
- host memory capability 采用 cache-only 语义：只有本地已缓存并满足请求的 slice/stats 才允许返回 `local-index-only`；否则必须依赖远端成功结果。
- host memory capability 在缺少 `agentId` / `entityId`、远端失败、或无法完成 recall/backfill 时必须 fail-close，不得返回空数组、空 recall 结果、或基于本地 slice 合成统计。

- 使用基础设施：上下文锁、错误日志。

## D-DSYNC-012 — Transit 数据流

世界穿越方法：`startWorldTransit`、`listWorldTransits`、`getActiveWorldTransit`、`startTransitSession`、`addTransitCheckpoint`、`completeWorldTransit`、`abandonWorldTransit`。

- 使用基础设施：上下文锁、错误日志。

## D-DSYNC-013 — DataSync 与 Runtime 数据路径选择指导

Desktop 存在两套并行数据获取架构：

| 路径 | 传输 | 适用数据域 | 统一设施 |
|---|---|---|---|
| **DataSync Facade**（D-DSYNC-000~012） | Realm REST API | 社交、聊天、世界、经济、Feed、通知 | 上下文锁、轮询管理器、normalizeApiError |
| **Runtime 数据路径** | SDK Runtime gRPC / D-IPC commands | 本地模型、健康状态、provider 状态、AI 推理 | 无统一 facade（各 D-IPC command 独立调用） |

两套架构使用不同的重试策略（D-NET-002 vs S-RUNTIME-045）、错误归一化（normalizeApiError vs toBridgeUserError）、状态管理（DataSync Zustand slices vs Runtime store slices）。此双轨设计为有意：Realm REST 和 Runtime gRPC 是不同传输域，强行统一会引入不必要的抽象层。

**Phase 2 服务路径选择规则**：

| 新服务 | 推荐路径 | 理由 |
|---|---|---|
| Workflow UI（K-WF-012） | Runtime 数据路径 | Workflow 数据来源为 Runtime gRPC（SubscribeWorkflowEvents），不经过 Realm |
| Audit UI（K-AUDIT-013） | Runtime 数据路径 | 审计数据来源为 Runtime gRPC（ListAuditEvents/ExportAuditEvents）。注：Phase 2 Audit UI 应通过 SDK gRPC 路径消费全局审计（K-AUDIT-013: ListAuditEvents 20k ring buffer），而非 D-IPC-011 `runtime_local_audits_list`（K-LOCAL-016: 仅 5k 条本地审计）。`runtime_local_audits_list` IPC 命令仅用于本地 AI 调试视图 |
| Knowledge UI（K-KNOW-005a） | Runtime 数据路径 | 索引数据来源为 Runtime gRPC（BuildIndex/SearchIndex） |
| AppMessage UI（K-APP-006a） | Runtime 数据路径 | 应用消息来源为 Runtime gRPC（SubscribeAppMessages） |

Runtime 数据路径当前缺少统一 facade。Phase 2 服务较多地使用 Runtime 路径时，应评估是否创建类似 DataSync 的 RuntimeSync facade（提供统一的错误归一化、重试、状态管理）。

## Fact Sources

- `tables/data-sync-flows.yaml` — DataSync 流枚举
