# 禁用反模式目录

本页提供 10 个已准入反模式的字段级技术参考。如需了解概念层面的叙述性解释，请参阅 [禁用反模式](/zh/nimicoding/forbidden-shortcuts)。

目录原始定义路径：`.nimi/contracts/forbidden-shortcuts.catalog.yaml`。

## 目录清单

| 键值 | 禁用动作的技术含义 |
| --- | --- |
| `mvp_subset_contract` | 严禁将规范的完整契约事实拆分为临时的最小子集 |
| `legacy_alias` | 严禁通过软别名维持过时语义的存活状态 |
| `compat_shim` | 严禁将所有权归属变更 (Owner-cut) 造成的缺口隐藏于临时兼容代码之后 |
| `dual_read` | 严禁在未经显式准入的前提下，保留并行的双重事实读取路径 |
| `dual_write` | 严禁在未经显式准入的前提下，保留并行的双重事实写入路径 |
| `placeholder_success` | 严禁在必需的事实依据缺失时，伪造执行成功或闭合状态 |
| `happy_path_only_closure` | 严禁在仅完成理想路径 (Happy-path) 的情况下声称已达成闭合 |
| `time_phased_layering` | 严禁以基于时间片段的分层取代基于业务本体的语义分层 |
| `app_local_shadow_truth` | 严禁使应用程序内部的局部临时状态隐性演变为规范的权威真相 |
| `silent_owner_cut_reopen` | 严禁在执行下游处理的 wave 内部，静默修改或重开所有权域内的核心真相 |

## 各模式工程细节解析

### `mvp_subset_contract`

| 评估属性 | 参数说明 |
| --- | --- |
| 触发条件 | 将系统契约作为最小功能子集准入，并推迟处理其剩余核心部分。 |
| 失效后果 | 临时子集演变为事实上的标准契约；未来的合理扩展将导致系统级的破坏性变更。 |
| 标准替代方案 | 优先设计具有完整语义的系统契约；分层应基于业务本体而非演进时间。 |
| 关联键值 | `time_phased_layering` |

### `legacy_alias`

| 评估属性 | 参数说明 |
| --- | --- |
| 触发条件 | 通过引入软别名等机制，使已废弃的语义逻辑继续发挥作用。 |
| 失效后果 | 导致系统存在平行的事实真相；产生永久性的系统迁移技术债务。 |
| 标准替代方案 | 实施彻底切断；或经由显式准入，设定包含弃用时间线的双轨过渡契约。 |
| 关联键值 | `compat_shim`、`dual_read`、`dual_write` |

### `compat_shim`

| 评估属性 | 参数说明 |
| --- | --- |
| 触发条件 | 将所有权归属变更所暴露的设计缺口，掩藏于临时性兼容代码的封装中。 |
| 失效后果 | 与 `legacy_alias` 引发的后果一致。 |
| 标准替代方案 | 与 `legacy_alias` 处理方式一致。 |

### `dual_read`

| 评估属性 | 参数说明 |
| --- | --- |
| 触发条件 | 系统内同时存在两条未获显式准入的并行事实读取路径。 |
| 失效后果 | 引发路径间的数据状态漂移；不同消费方获取不一致的语义真相。 |
| 标准替代方案 | 收敛至单一读取路径；或基于显式过渡契约，暂时准入双重事实并存。 |
| 关联键值 | `dual_write`、`legacy_alias` |

### `dual_write`

| 评估属性 | 参数说明 |
| --- | --- |
| 触发条件 | 系统内同时存在两条未获显式准入的并行事实写入路径。 |
| 失效后果 | 导致数据漂移；所谓的“从 A 迁移至 B”成为不可完结的永久状态。 |
| 标准替代方案 | 与 `dual_read` 处理方式一致。 |

### `placeholder_success`

| 评估属性 | 参数说明 |
| --- | --- |
| 触发条件 | 类型化契约在处理失败时，通过返回缺省或无意义的回退数据进行错误掩盖。 |
| 失效后果 | 下游逻辑无法捕获系统的异常信号；自动化审计机制亦无法检测底层逻辑断裂。 |
| 标准替代方案 | 以附带结构化原因的形式执行安全阻断 (Fail-closed)；重试机制仅适用于传输或鉴权层，**不**用于挽救核心业务契约。 |

### `happy_path_only_closure`

| 评估属性 | 参数说明 |
| --- | --- |
| 触发条件 | 仅在系统理想路径执行顺畅时，即宣告任务闭合。 |
| 失效后果 | 导致系统失败模式变为隐性；消费方无法预判潜在的异常行为及后果。 |
| 标准替代方案 | 强制在宣告语义闭合前，明确定义并固化所有潜在的系统失败模式。 |

### `time_phased_layering`

| 评估属性 | 参数说明 |
| --- | --- |
| 触发条件 | 按时间演进（如 v1 → v2 → v3）执行架构分层，而非基于业务本体逻辑（如 core / extended / custom）进行划分。 |
| 失效后果 | 导致永久性的迭代动荡；后续的每一次“版本升级”本质上都是一种未经声明的软性 `legacy_alias` 行为。 |
| 标准替代方案 | 依据代码模块的抽象**语义**进行系统分层设计，而**非**依据功能的引入时间点。 |

### `app_local_shadow_truth`

| 评估属性 | 参数说明 |
| --- | --- |
| 触发条件 | 应用程序因内部调用便利而缓存的局部状态，演变为系统内隐藏的规范化真相。 |
| 失效后果 | 导致应用层状态与全局规范发生偏离；跨应用间行为不一致；系统审计无法追溯真实状态。 |
| 标准替代方案 | 明确将应用层状态准入定义为非持久的局部数据；核心数据的持久化操作仅允许在专属所有权域内执行。 |

### `silent_owner_cut_reopen`

| 评估属性 | 参数说明 |
| --- | --- |
| 触发条件 | 在执行具体业务流程的下游 Wave 内部，违规操作并重开所属架构域的事实真相。 |
| 失效后果 | 使所有权域内的核心修改掩藏于具体的业务执行中；导致审计追溯链路断裂。 |
| 标准替代方案 | 必须首先独立准入一个针对所有权域的 Wave 以执行规范更新；随后依赖该更新后的事实进行下游的任务执行。 |

## Topic 局部扩展配置 (Topic-Local Extensions)

系统允许各 Topic 声明满足特定业务需求的局部反模式扩展。扩展声明必须遵循：

- 采用规范命名的键值（即 `snake_case` 标识符）。
- **不得**使用非结构化的自由文本描述 (Free-form prose)。
- 在所在 Topic 的 `forbidden_shortcuts` 字段中，与包提供的基础反模式共同列出。

Topic 局部扩展规则声明示例：

```yaml
forbidden_shortcuts:
  # 包维护的全局反模式
  - mvp_subset_contract
  - legacy_alias
  - compat_shim
  - dual_read
  - dual_write
  - placeholder_success
  - happy_path_only_closure
  - time_phased_layering
  - app_local_shadow_truth
  - silent_owner_cut_reopen
  # Topic 专属局部反模式扩展
  - sidebar_links_to_unwritten_pages
  - product_pages_inventing_facts_not_in_extracted_sources
```

## 检测与防御机制

| 防护机制 | 核心检测目标 |
| --- | --- |
| 常规审计流程 | 对代码及文档输出进行深度的模式分析及识别。 |
| 抗漂移闭合检查 | 核查禁用规则在最终收尾阶段是否维持有效约束。 |
| 流程步进决策 (Topic-step-decision) | 在系统检测到违反反模式的行为时，直接拒绝准入请求。 |

## 来源依据

- [`.nimi/contracts/forbidden-shortcuts.catalog.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/forbidden-shortcuts.catalog.yaml)
- [`.nimi/contracts/packet.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/packet.schema.yaml)
- [`.nimi/methodology/four-closure-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/four-closure-policy.yaml)
