# 世界状态

世界状态是世界的**持久共享当下**。它回答「这个世界现在长什么样」。修改要明确的 commit 信封；真相和历史分别在状态的两侧。

## 世界状态是什么

| 性质 | 值 |
| --- | --- |
| 存储 | Realm `R-WSTATE-*` |
| 形状 | 世界的当前快照 |
| 修改 | 通过准入 commit 信封 |
| 权威 | Realm |
| 读模式 | 单状态读或聚合读 |

状态不是缓存。它是规范化的当下。读状态的 App 拿到的是当前真相；不需要从历史重建。

## Commit 信封

每次状态修改都绑到一个明确的 commit 信封。

| 字段 | 用途 |
| --- | --- |
| `worldId` | 改的是哪个世界 |
| `appId` | 谁在 commit |
| `sessionId` | Session lineage |
| `effectClass` | `NONE` / `STATE_ONLY` / `STATE_AND_HISTORY` |
| `scope` | `WORLD` / `ENTITY` / `RELATION` |
| `schemaId` | 这次 commit 符合什么 schema |
| `schemaVersion` | Schema 哪个版本 |
| `actorRefs` | 谁在动作 |
| `reason` | 为什么 |
| `evidenceRefs` | 支撑证据 |

创作者工具与授权的世界连接 App **用同一套 commit 信封模型**。创作者工具没有特权捷径。

## Effect Class

`effectClass` 控制 commit 影响什么：

| 值 | 含义 |
| --- | --- |
| `NONE` | 无状态变化；这是 dry run / 探测 / 观察 |
| `STATE_ONLY` | 只改状态、不追加历史 |
| `STATE_AND_HISTORY` | 改状态并追加历史 |

大多数真实修改是 `STATE_AND_HISTORY`。`STATE_ONLY` 用于特定情况（瞬时调整、某些策略操作）。`NONE` 用于 dry-run 和观察。

## Scope

`scope` 控制目标是世界的哪一片：

| 值 | 目标 |
| --- | --- |
| `WORLD` | 世界级状态 |
| `ENTITY` | 世界里某个实体 |
| `RELATION` | 实体之间的关系 |

Commit 必须声明 scope；模糊 scope 被拒。

## 阅读场景：扩展 App 改状态

某准入扩展 App 想改一个参与者在世界里的位置。

1. **构造信封。** App 构造：
   - `worldId`：这个世界
   - `appId`：这个扩展 App
   - `sessionId`：当前 session
   - `effectClass`：`STATE_AND_HISTORY`
   - `scope`：`ENTITY`
   - `schemaId` / `schemaVersion`：位置更新 schema
   - `actorRefs`：被移动的参与者
   - `reason`：「参与者走进建筑」
   - `evidenceRefs`：支撑证据（比如导致移动的参与者动作）
2. **提交。** Realm 收到 commit。
3. **校验。** Realm 检查：App-世界绑定活跃、schema 准入、scope 合适、证据有效。
4. **应用。** 状态更新；历史追加。
5. **审计。** Commit lineage 被记下。

信封是让状态修改可审计的关键。每次修改可重建：谁、何时、为什么、带什么证据。

## 阅读场景：读当前状态

某 App 想渲染一个世界的当前状态。

1. **查询状态。** 通过准入 Realm 读，App 在合适的 scope 下查世界状态。
2. **Realm 返回当前状态。** 单快照读。
3. **App 渲染。** App 看到当前状态。

App **不**从历史重建状态。状态是规范化的当下，为读优化。

## 阅读场景：跨多个基础协议的修改

一个动作引发社交、经济、在场后果 — 比如在公开 Scene 里送礼物。

1. **多个 commit。** 平台可能用多个 commit 原子地捕捉后果：
   - 物品所有权转移（`scope: RELATION`、`effectClass: STATE_AND_HISTORY`）
   - 社交交互事件（相关社交状态）
   - 经济事件（仅追加经济里的礼物事件）
   - 在场记录（见证人）
2. **每个 commit 信封。** 各自带类型化信封。
3. **历史记录每一个。** 每个 commit 追加一条历史记录。

动作是一个产品时刻；底层合同把后果分散到对的面、用对的类型化信封。

## App **不**能做什么

| 禁止 | 为什么 |
| --- | --- |
| 不带信封改状态 | 可审计性需要信封 |
| 用自由 `schemaId` | Schema 在 kernel 准入 |
| 用未声明 scope | Scope 是被准入的；模糊 scope 被拒 |
| 跳过证据引用 | 证据是 traceability 的必填项 |

## 来源

- [`.nimi/spec/realm/world-state.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/world-state.md)
- [`.nimi/spec/realm/kernel/world-state-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/world-state-contract.md)
- [`.nimi/spec/realm/kernel/tables/world-state-contract.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/tables/world-state-contract.yaml)
- [`.nimi/spec/realm/kernel/tables/commit-authorization-matrix.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/tables/commit-authorization-matrix.yaml)
- [`.nimi/spec/realm/world.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/world.md)
