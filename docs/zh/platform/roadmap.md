# 路线图

## 状态：公开路线图投射

本页面描述 Nimi 面向开发者和读者公开的**路线图治理结构**：如何跟踪能力、它们如何获得准入，以及它们经过哪些状态值。它不承诺具体日期，也不是 active product authority。

已实现的产品行为由 `.nimi/spec/<domain>/kernel/**` 管理。候选路线图和 backlog 材料不作为 active spec 子树存在；在能力毕业进入 active product domain 之前，路线图状态由产品规划过程承载。

## 为什么需要路线图表面

没有路线图表面的平台最终会出现这些问题：功能未经宣布就悄悄加入，临时公开路线图与现实脱节，没有共享词汇来描述“X 在管道中的位置”。路线图表面回答这三个问题：每个被跟踪的能力都有类型化状态；每个状态转换在成为产品权威前都需要治理。

## Backlog 条目结构 (F-CAP-001)

每个 backlog 条目都有必填字段：

| 字段 | 目的 |
| --- | --- |
| `item_id` | `F-<助记符>-NNN`，全局唯一 |
| `title` | 简短标题 |
| `priority` | `high` / `medium` / `low` |
| `category` | `ux` / `integration` / `platform` / `auth` / `security` / `observability` |
| `target_layers` | 影响层：`runtime` / `sdk` / `desktop` / `web` |
| `status` | 生命周期状态 |
| `source_ids` | 至少一个 `RESEARCH-*` 来源引用 |
| `complexity` | `small` / `medium` / `large` |
| `depends_on` | 依赖项 `item_id` 列表（无自引用，无循环） |
| `architecture_notes` | 简要架构影响 |

没有 `RESEARCH-*` 来源的条目不会进入 backlog。来源链接是必需的。

## 优先级分类 (F-CAP-002)

| 优先级 | 含义 |
| --- | --- |
| `high` | 直接影响核心用户体验或竞争差距；实现路径明确 |
| `medium` | 增强平台能力或集成；需求明确但不阻塞核心流程 |
| `low` | 长期能力储备；暂无即时需求或等待外部标准成熟 |

优先级是操作指导，不是日期承诺。

## 状态生命周期 (F-CAP-003)

```
proposed -> accepted -> spec-drafted -> implemented
                   -> rejected
                   -> deferred
```

| 状态 | 含义 |
| --- | --- |
| `proposed` | 从研究报告中提取；等待审核 |
| `accepted` | 审核通过；进入 active backlog |
| `spec-drafted` | 已在 active product domain 下存在草稿权威 |
| `implemented` | 已实现并合并 |
| `rejected` | 审核后认为不适用 / 偏离方向 |
| `deferred` | 等待外部条件成熟 |

状态转换由 admitted graduation event 管理。状态不会按应用惯例改变。

## 分类 (F-CAP-004)

| 分类 | 含义 |
| --- | --- |
| `ux` | 用户体验改进（渲染、交互、编辑器） |
| `integration` | 外部协议 / 服务集成（MCP、搜索、OAuth） |
| `platform` | 平台核心能力（RAG、工作流、模型路由） |
| `auth` | 身份验证 / 授权扩展 |
| `security` | 安全和审查能力 |
| `observability` | 可观察性 + 运营 |

分类是封闭的。条目不能通过惯例发明新的分类。

## 依赖约束 (F-CAP-005)

| 规则 | 值 |
| --- | --- |
| 每个 `depends_on` 项必须解析到一个被跟踪的 backlog 条目 | 必需 |
| 自引用 | 禁止 |
| 循环 | 禁止 |
| 依赖强度 | 软约束（推荐顺序，非硬性阻塞） |

软依赖允许非互斥条目并行开发，但依赖关系仍要记录，便于审阅者看到推荐顺序。

## 来源注册表

Backlog 条目通过 `RESEARCH-*` id 引用研究来源。来源注册表准许哪些研究表面可以产生 backlog 条目。注册表是来源纪律：条目不能凭直觉发明。

## 毕业合同

毕业合同管理条目如何通过状态生命周期转换：

| 转换 | 所需证据 |
| --- | --- |
| `proposed -> accepted` | 审核通过并记录明确理由 |
| `accepted -> spec-drafted` | active product domain 下存在草稿权威 |
| `spec-drafted -> implemented` | 实现已合并 + spec 最终准入 |
| 任意状态 -> `rejected` | 记录审核原因；不静默 |
| 任意状态 -> `deferred` | 记录推迟原因；命名重新评估条件 |

毕业合同回答“X 如何成为现实”的问题。

## 读者场景：新能力进入 Backlog

一份研究报告识别出平台应考虑的能力。

1. **研究表面附加一个 `RESEARCH-*` id。** 根据来源注册表。
2. **起草 backlog 条目。** 填写所有必填字段。状态：`proposed`。Source ids 引用研究。
3. **审核。** 审核针对方向进行；结果为 `accepted`、`rejected` 或 `deferred`。记录原因。
4. **如果 `accepted`：** 条目进入 active backlog，并分配优先级、分类和目标层。

## 读者场景：条目起草 Spec

一个被接受的条目向实现迈进。

1. **提出 spec 草案。** 草案目标是已准入的产品域，例如 runtime、SDK、desktop、platform、realm、avatar 或 cognition。
2. **状态转换为 `spec-drafted`。** 根据 graduation evidence。
3. **Spec 准入过程。** 与 backlog 状态分开；spec 通过自己的准入过程。
4. **开始实现。**

## 读者场景：条目被推迟

一个被接受的条目依赖于尚未成熟的外部标准。

1. **状态变为 `deferred`。** 记录原因：“被外部标准 X 达到版本 Y 阻挡。”
2. **命名重新评估条件。** “当 X.Y 发布时重新评估。”
3. **Backlog 保持准确。** 该条目可见，但不假装处于 active。

## 路线图不做的事情

- 它不承诺日期。
- 它不承诺任何条目的具体实现。
- 它不允许没有 `RESEARCH-*` 来源的条目进入。
- 它不允许条目发明分类或状态。
- 它不会无声删除条目；`rejected` 和 `deferred` 是带有原因的显式终止或暂停状态。
- 它不允许循环或自引用依赖。
- 它不覆盖 `.nimi/spec/**` 下的 active product authority。

## 边界总结

| 关注点 | 真相来源 |
| --- | --- |
| 已实现产品行为 | `.nimi/spec/<domain>/kernel/**` 下的 active product domain spec |
| 候选路线图姿态 | Active spec 之外的产品规划记录 |
| Backlog 条目结构 | 路线图投射 taxonomy |
| 优先级分类 | 路线图投射 taxonomy |
| 状态生命周期 | Graduation event evidence |
| 分类 | 路线图投射 taxonomy |
| 来源纪律 | Research source registry |

## 来源依据

- [`.nimi/spec/INDEX.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/INDEX.md)
- `.nimi/spec/<domain>/kernel/**` 下的 active product domain specs
- 路线图规划记录和已准入的 graduation events
