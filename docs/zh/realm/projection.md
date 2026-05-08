# Projection

Projection 是规范真相的**正式消费层**。它不是世界设定的复刻，不是 worldview 预览，也不是 prompt 拼装的辅助函数。它的语义归 Realm Projection kernel 所有，runtime 是消费方。

## Projection 是什么

| 属性 | 值 |
| --- | --- |
| 用途 | 在规范真相之上做读侧聚合 |
| 拥有者 | Realm Projection kernel |
| 消费方 | Runtime、各应用 |
| 权限 | 不能改写真相；只读 |
| 形状 | 已准入的强类型聚合 |

Projection 回答的是"给我这份真相的结构化读视图"。它**不**回答"模型 prompt 里该看到什么"，那归 Cognition 的 prompt 拼装管。

## Projection 不是什么

| 容易混淆的对象 | 区分原因 |
| --- | --- |
| 世界设定（lorebook） | 设定是内容；projection 是读视图 |
| Worldview 预览 | Worldview 是 agent 的信念；projection 是规范视图 |
| Prompt 拼装辅助 | Prompt 由 Cognition Prompt Service 处理；projection 是它的输入，不是它本身 |
| 应用侧缓存 | 缓存是实现；projection 是契约 |

混淆这些会出现并行真相。"projection 顺手拼 prompt"会变成 Cognition 的活；把 projection 守在读侧聚合这一档，职责才清楚。

## 场景：应用读取一份 projection

某个应用要展示一个世界的当前状态。

1. **查询 projection**。应用调用一个准入的 projection 表面（例如 `detail-with-agents`）。
2. **聚合即时计算**。Realm 从规范真相 + 当前状态 + 相关读取数据，算出这份聚合。
3. **强类型结果**。应用收到一份强类型视图。
4. **应用渲染**。应用拿这份视图去做展示。

Projection 不是"在 T 时刻拍下状态再缓存"。它是按需计算出来的强类型读侧聚合。

## 场景：projection 不能改写真相

某个应用拿了 projection 结果，想"保存回去"成真相。

1. **读 projection**。返回强类型视图。
2. **本地修改**。应用改自己手里的副本（这是应用本地的活，没问题）。
3. **尝试写回**。应用想把改过的 projection 当真相 commit。
4. **Realm 拒收**。projection 是只读的；真相变更必须走准入的 commit envelope 路径。
5. **强类型错误**。"projection 写入未准入；请使用 commit envelope。"

这个分工是结构性的。压根没有"projection 写"这条路。写入只走准入的 commit 流程，必须带 envelope。

## 场景：Cognition 拿 projection 来拼 prompt

某个 agent 拼 prompt 时需要规范的世界上下文。

1. **Prompt service 调用 projection**。Cognition 的 `FormatCore` 通道通过 projection 读规范真相。
2. **Projection 返回规范聚合**。只读的强类型形状。
3. **Prompt service 做格式化**。把这份聚合翻译成 prompt 上下文，是 Cognition prompt service 的职责。
4. **模型看到强类型 prompt**。其中包含来自 projection 的规范世界上下文。

Projection 喂给 prompt 拼装；projection 本身不是 prompt 拼装。这条边界让 Realm Projection 保持为可复用的读侧聚合层。

## 边界为什么重要

如果不守住边界：

- 应用会自建缓存，缓存与规范真相会出现分歧。
- Prompt 拼装逻辑会渗进 projection，规范读取与模型上下文启发式会混在一起。
- 写入会通过"projection 写"这种模式偷渡进来。
- 读者分不清一个事实是来自规范真相，还是 projection 的解读。

守住边界以后：

- Projection 是规范读侧聚合。
- 应用消费它，不再自行编造。
- Cognition 在下游处理 prompt 上下文拼装。
- 真相变更走单独的显式路径。

## Source Basis

- [`.nimi/spec/realm/projection.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/projection.md)
- [`.nimi/spec/realm/truth.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/truth.md)
- [`.nimi/spec/realm/world-state.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/world-state.md)
- [`.nimi/spec/realm/world-history.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/world-history.md)
- [`.nimi/spec/realm/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/index.md)
- [`.nimi/spec/cognition/kernel/prompt-serving-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/prompt-serving-contract.md)
