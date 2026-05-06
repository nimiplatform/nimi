# Realm 读聚合面

读聚合面是规范化真相的**形式消费层**。它**不是** lorebook 重建、**不是** worldview 预览、**不是** prompt 拼装辅助。语义所有者是 Realm Projection kernel；runtime 是消费方。

## 读聚合面是什么

| 性质 | 值 |
| --- | --- |
| 用途 | 规范化真相之上的只读聚合 |
| 拥有者 | Realm Projection kernel |
| 消费方 | Runtime、App |
| 权威 | **不能**改真相；只读 |
| 形状 | 类型化准入聚合 |

读聚合面回答「给我这份真相的结构化读视图」。它**不**回答「模型在 prompt 里该看什么」 — 那是 prompt 拼装，归 Cognition。

## 读聚合面**不是**什么

| 容易混 | 为什么不同 |
| --- | --- |
| Lorebook 重建 | Lorebook 是内容；读聚合面是结构化读视图 |
| Worldview 预览 | Worldview 是 Agent 的信念；读聚合面是规范化的视图 |
| Prompt 拼装辅助 | Cognition Prompt 服务做 prompt；读聚合面给它喂料但不是它 |
| App 侧缓存 | 缓存是实现；读聚合面是合同 |

区分重要因为混在一起就会创建并行真相。「会拼 prompt 的读聚合面」是 Cognition 的活；把读聚合面留为只读聚合让职责清楚。

## 阅读场景：App 读一份聚合视图

某 App 需要一个世界当前状态的结构化视图来显示。

1. **查询读聚合面。** App 调一个准入读聚合面（比如 `detail-with-agents`）。
2. **聚合物化。** Realm 从规范化真相 + 状态 + 相关附加读算出聚合。
3. **类型化结果。** App 收到类型化视图。
4. **App 渲染。** App 用这份视图来显示。

读聚合面**不是**「时刻 T 的状态快照然后缓存」。它是按需算出的类型化只读聚合。

## 阅读场景：聚合视图**不能**改真相

某 App 试图用读聚合的结果并「保存回」真相。

1. **读视图。** 返回类型化视图。
2. **改视图。** App 改本地副本（这没问题；这是 App 的本地工作）。
3. **试图保存回。** App 试图把改过的视图当成真相去 commit。
4. **Realm 拒。** 读聚合面只读；真相修改要走准入 commit 流的类型化 commit 信封。
5. **类型化错误。** 「读聚合面写入未准入；用 commit 信封」。

切分是结构上的。**没有**「读聚合面写入」路径。写走准入 commit 流带信封。

## 阅读场景：Cognition 为 prompt 服务消费读聚合面

某 Agent 的 prompt 拼装需要规范化世界上下文。

1. **Prompt 服务咨询读聚合面。** Cognition 的 `FormatCore` 道经读聚合面读规范化真相。
2. **读聚合面返回规范化聚合。** 只读类型化形状。
3. **Prompt 服务格式化。** Cognition 的 prompt 服务是把它翻成 prompt 上下文的地方。
4. **模型看到类型化 prompt。** 含来自读聚合面的规范化世界上下文。

读聚合面给 prompt 拼装喂料；读聚合面**不是** prompt 拼装。这条边界让 Realm Projection 保持是可重用的只读聚合层。

## 为什么这条边界重要

没这条边界：

- App 会自建跟规范化真相漂移的缓存。
- Prompt 拼装逻辑会渗进读聚合面里，规范化读跟模型上下文启发法混在一起。
- 修改可能通过「读聚合面写入」模式偷偷溜进。
- 读者不知道某事实来自规范化真相还是来自读聚合面的解释。

有这条边界：

- 读聚合面是规范化的只读聚合。
- App 消费；不发明。
- Cognition 在下游处理 prompt 上下文拼装。
- 真相修改是单独的明确路径。

## 来源

- [`.nimi/spec/realm/projection.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/projection.md)
- [`.nimi/spec/realm/truth.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/truth.md)
- [`.nimi/spec/realm/world-state.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/world-state.md)
- [`.nimi/spec/realm/world-history.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/world-history.md)
- [`.nimi/spec/realm/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/index.md)
- [`.nimi/spec/cognition/kernel/prompt-serving-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/prompt-serving-contract.md)
