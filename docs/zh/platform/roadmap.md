# 道路图

## 状态：已准入平台方向

能力积压 (`F-CAP-*`)、源注册表和毕业合同已在内核级别下被准入，位于 `nimi/.nimi/spec/future/`。本页面描述了**道路图治理结构**：如何跟踪能力、它们如何获得准入以及它们经过的状态值。它不承诺具体日期。

## 为什么需要一个道路图权威

没有道路图表面的平台最终会出现以下情况：功能未经宣布就悄悄加入，临时公开的道路图与现实脱节，没有共享词汇来描述“X 在管道中的位置”。未来的权威表面回答了所有这三个问题：每个被跟踪的能力都在积压中，并带有类型化的状态；每个状态转换都受到管理。

## 积压项结构 (F-CAP-001)

每个积压条目都有必填字段：

| 字段 | 目的 |
| --- | --- |
| `item_id` | `F-<助记符>-NNN`，全局唯一 |
| `title` | 简短标题 |
| `priority` | `high` / `medium` / `low` |
| `category` | `ux` / `integration` / `platform` / `auth` / `security` / `observability` |
| `target_layers` | 影响的层：`runtime` / `sdk` / `desktop` / `web` |
| `status` | 生命周期状态 |
| `source_ids` | 至少一个 `RESEARCH-*` 源引用 |
| `complexity` | `small` / `medium` / `large` |
| `depends_on` | 依赖项 `item_id` 列表（无自引用，无循环） |
| `architecture_notes` | 简要架构影响 |

没有 `RESEARCH-*` 源的条目不会进入积压。来源链接是必需的。

## 优先级分类 (F-CAP-002)

| 优先级 | 含义 |
| --- | --- |
| `high` | 直接影响核心用户体验或竞争差距；实现路径明确 |
| `medium` | 增强平台能力或集成；需求明确但不影响核心流程 |
| `low` | 长期能力储备；无即时需求或等待外部标准成熟 |

优先级是操作指导，不是日期承诺。

## 状态生命周期 (F-CAP-003)

```
proposed → accepted → spec-drafted → implemented
                   ↘ rejected
                   ↘ deferred
```

| 状态 | 含义 |
| --- | --- |
| `proposed` | 从研究报告中提取；等待审核 |
| `accepted` | 审核通过；在活跃积压中 |
| `spec-drafted` | 在 `.nimi/spec/runtime/` 或 `.nimi/spec/sdk/` 下有草稿规范 |
| `implemented` | 已实现并合并 |
| `rejected` | 审核后被认为不适用/偏离方向 |
| `deferred` | 等待外部条件成熟 |

状态转换由 `graduation-contract.md` 管理。状态不会按应用惯例改变；它会通过准入的毕业事件改变。

## 分类分类 (F-CAP-004)

| 分类 | 含义 |
| --- | --- |
| `ux` | 用户体验改进（渲染、交互、编辑器） |
| `integration` | 外部协议/服务集成（MCP、搜索、OAuth） |
| `platform` | 平台核心能力（RAG、工作流、模型路由） |
| `auth` | 身份验证/授权扩展 |
| `security` | 安全和审查能力 |
| `observability` | 可观察性+运营 |

分类是封闭的。条目不能通过惯例发明新的分类。

## 依赖约束 (F-CAP-005)

| 规则 | 值 |
| --- | --- |
| 每个 `depends_on` 项必须存在于 `backlog-items.yaml` 中 | 必需 |
| 自引用 | 禁止 |
| 循环 | 禁止 |
| 依赖强度 | 软约束（推荐顺序，非硬性阻塞） |

软依赖允许独立开发并行进行，即使这些条目不是互斥的——但依赖关系仍然记录下来，以便审阅者看到推荐顺序。

## 源注册表

积压项通过 `RESEARCH-*` ID 引用研究源。`future/source-registry.md` 下的源注册表准许哪些研究表面可以产生积压项。注册表是来源纪律——条目不能凭直觉“发明”。

## 毕业合同

毕业合同管理条目如何通过状态生命周期转换：

| 转换 | 所需证据 |
| --- | --- |
| `proposed → accepted` | 审核通过并有明确理由 |
| `accepted → spec-drafted` | 存在草稿规范且位于准入规范路径下 |
| `spec-drafted → implemented` | 实现已合并且准入规范最终确定 |
| 任何状态 → `rejected` | 记录审核原因；不静默 |
| 任何状态 → `deferred` | 记录推迟原因；命名重新评估条件 |

毕业合同回答了“X 如何成为现实”的问题。

## 读者场景：新能力进入积压

一份研究报告识别出平台应考虑的能力。

1. **研究表面附加一个 `RESEARCH-*` ID。** 根据源注册表。
2. **起草积压项。** 填写所有必填字段。状态：`proposed`。源 ID 引用研究。
3. **审核。** 审核针对方向进行；结果为 `accepted`、`rejected` 或 `deferred`。记录原因。
4. **如果 `accepted`：** 条目进入活跃积压，并分配优先级 + 分类 + 目标层。

## 读者场景：条目起草规范

一个被接受的条目向实现迈进。

1. **提出规范草案。** 位于准入规范路径下（`.nimi/spec/runtime/`、`.nimi/spec/sdk/` 等）。
2. **状态转换为 `spec-drafted`。** 根据毕业合同证据。
3. **规范准入过程。** 与积压状态分开；规范通过自己的准入过程。
4. **开始实现。**

## 读者场景：条目被推迟

一个被接受的条目依赖于尚未成熟的外部标准。

1. **状态变为 `deferred`。** 记录原因：“被外部标准 X 达到版本 Y 阻挡。”
2. **命名重新评估条件。** “当 X.Y 发布时重新评估。”
3. **积压保持准确。** 该条目可见但不假装处于活跃状态。

## 道路图不做的事情

- 它不承诺日期。
- 它不承诺任何条目的具体实现。
- 它不允许没有 `RESEARCH-*` 来源的条目进入。
- 它不允许条目发明分类或状态。
- 它不会无声删除条目——`rejected` 和 `deferred` 是带有原因的显式终止或暂停状态。
- 它不允许循环或自引用依赖。

## 边界总结

| 关注点 | 权威 |
| --- | --- |
| 积压项结构 | `F-CAP-001` + `tables/backlog-items.yaml` |
| 优先级分类 | `F-CAP-002` |
| 状态生命周期 | `F-CAP-003` + 毕业合同 |
| 分类分类 | `F-CAP-004` |
| 依赖规则 | `F-CAP-005` |
| 源来源 | `source-registry.md` |
| 状态转换 | `graduation-contract.md` + `tables/graduation-log.yaml` |

## 来源基础

- [`.nimi/spec/future/kernel/capability-backlog.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/future/kernel/capability-backlog.md)
- [`.nimi/spec/future/kernel/source-registry.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/future/kernel/source-registry.md)
- [`.nimi/spec/future/kernel/graduation-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/future/kernel/graduation-contract.md)
- [`.nimi/spec/future/kernel/tables/backlog-items.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/future/kernel/tables/backlog-items.yaml)
- [`.nimi/spec/future/kernel/tables/graduation-log.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/future/kernel/tables/graduation-log.yaml)