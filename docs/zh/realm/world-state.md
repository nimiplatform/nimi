# 世界状态

## 状态：现在 (Running today)

Realm R-WSTATE-* 是已交付的共享当前状态权威。

世界状态是一个世界的**持久共享当下**。它回答"这个世界现在是什么样"。变更必须带显式 commit envelope；真相和历史分别守在状态的两侧。

## 世界状态是什么

| 属性 | 值 |
| --- | --- |
| 存储 | Realm `R-WSTATE-*` |
| 形状 | 世界的当前快照 |
| 变更 | 通过准入的 commit envelope |
| 权威 | Realm |
| 读取模式 | 单状态读取或 projection |

状态不是缓存，它就是规范当下。读状态的应用拿到的是当下真相；这次读取不需要从历史里重建。

## Commit Envelope

每一次状态变更都绑定到一份显式 commit envelope。

| 字段 | 用途 |
| --- | --- |
| `worldId` | 哪个世界要变更 |
| `appId` | 哪个应用在 commit |
| `sessionId` | 会话血缘 |
| `effectClass` | `NONE` / `STATE_ONLY` / `STATE_AND_HISTORY` |
| `scope` | `WORLD` / `ENTITY` / `RELATION` |
| `schemaId` | 这次 commit 遵循哪份 schema |
| `schemaVersion` | schema 的哪一版 |
| `actorRefs` | 谁动手 |
| `reason` | 原因 |
| `evidenceRefs` | 支撑证据 |

创作者工具和获授权的世界连接应用使用**同一份 commit envelope 模型**。创作者工具没有特权捷径。

## Effect Class

`effectClass` 控制本次 commit 影响什么：

| 值 | 含义 |
| --- | --- |
| `NONE` | 不变更状态；这是 dry run / 探针 / 观察 |
| `STATE_ONLY` | 变更状态但不追加历史 |
| `STATE_AND_HISTORY` | 变更状态并追加历史 |

绝大多数真实变更是 `STATE_AND_HISTORY`。`STATE_ONLY` 留给特定情形（瞬时调整、某些策略性操作）。`NONE` 留给 dry-run 和观察。

## Scope

`scope` 控制变更切入到世界的哪一片：

| 值 | 目标 |
| --- | --- |
| `WORLD` | 世界级状态 |
| `ENTITY` | 世界中某个具体实体 |
| `RELATION` | 实体之间的某条关系 |

每次 commit 必须声明 scope；scope 含糊的 commit 会被拒收。

## 场景：扩展应用发起的状态变更

某个准入的扩展应用要修改一个参与者在世界中的位置。

1. **构造 envelope**。应用填写：
   - `worldId`：本世界
   - `appId`：本扩展应用
   - `sessionId`：当前活跃会话
   - `effectClass`：`STATE_AND_HISTORY`
   - `scope`：`ENTITY`
   - `schemaId` / `schemaVersion`：位置更新 schema
   - `actorRefs`：被移动的参与者
   - `reason`："参与者进入建筑"
   - `evidenceRefs`：支撑证据（例如导致这次移动的参与者动作）
2. **提交**。Realm 收到 commit。
3. **校验**。Realm 检查应用-世界绑定是否生效、schema 是否准入、scope 是否合理、证据是否有效。
4. **应用**。状态更新；历史追加。
5. **审计**。commit 血缘入账。

Envelope 是状态变更可审计的关键。每一次变更都可以重建：谁、何时、为何、用了什么证据。

## 场景：读取当前状态

某应用要渲染一个世界的当前状态。

1. **查询状态**。应用通过准入的 Realm 读取，按相关 scope 查世界状态。
2. **Realm 返回当前状态**。单快照读取。
3. **应用渲染**。应用拿到当前状态。

应用不需要从历史重建状态。状态就是规范当下，针对读取做了优化。

## 场景：跨多条基础协议的变更

一次动作引发社交、经济、存在感三方面的后果——比如在一个公共 scene 里转移一件物品。

1. **多次 commit**。平台可能用多次 commit 来原子化地捕获后果：
   - 物品所有权转移（`scope: RELATION`、`effectClass: STATE_AND_HISTORY`）
   - 社交互动事件（相关社交状态）
   - 经济事件（已准入的货币或收入事件）
   - 存在感记录（旁观者）
2. **每条 commit 自带 envelope**。各自携带强类型 envelope。
3. **历史各记一笔**。每条 commit 都在历史中追加一条记录。

这次动作是一个产品时刻；底层契约把后果分发到正确的表面，每一份都带正确的强类型 envelope。

## 应用不能做的事

| 禁止 | 原因 |
| --- | --- |
| 不带 envelope 改状态 | 可审计性需要 envelope |
| 用自定义的 `schemaId` | Schema 在 kernel 准入 |
| 不声明 scope 或 scope 含糊 | scope 是声明式的；含糊会被拒收 |
| 跳过证据引用 | 可追溯性要求带证据 |

## 来源依据

- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
