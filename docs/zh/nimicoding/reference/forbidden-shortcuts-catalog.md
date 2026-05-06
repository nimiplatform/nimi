# 禁用捷径目录

10 个 admitted 目录 key 的字段级参考。叙述解释见 [禁用捷径](/zh/nimicoding/forbidden-shortcuts)。

目录源：`.nimi/contracts/forbidden-shortcuts.catalog.yaml`。

## 目录

| Key | 禁用含义 |
| --- | --- |
| `mvp_subset_contract` | 不要把规范化合同真相切成临时最小子集 |
| `legacy_alias` | 不要用软别名让旧语义存活 |
| `compat_shim` | 不要把 owner-cut gap 藏在临时兼容代码后 |
| `dual_read` | 不要保留两条没显式准入的并行真相读路径 |
| `dual_write` | 不要保留两条没显式准入的并行真相写路径 |
| `placeholder_success` | 缺必需真相时不要伪造成功或闭合 |
| `happy_path_only_closure` | 只闭 happy-path 不要声称闭合 |
| `time_phased_layering` | 不要用时间切片替代语义分层 |
| `app_local_shadow_truth` | 不要让 App 局部便利状态变成隐藏规范化真相 |
| `silent_owner_cut_reopen` | 不要在下游执行 wave 内重开 owner 域真相 |

## 每模式细节

### `mvp_subset_contract`

| 性质 | 值 |
| --- | --- |
| 触发 | 合同作为最小子集准入、剩余 defer |
| 失败形状 | 子集变事实合同；未来扩展是破坏性 |
| 正确替代 | 先设计完整合同；按 ontology 不按 chronology 分层 |
| 相关 key | `time_phased_layering` |

### `legacy_alias`

| 性质 | 值 |
| --- | --- |
| 触发 | 旧语义经软别名存活 |
| 失败形状 | 并行真相；永久迁移负担 |
| 正确替代 | 硬切；或显式准入双真相带时间线 |
| 相关 key | `compat_shim`、`dual_read`、`dual_write` |

### `compat_shim`

| 性质 | 值 |
| --- | --- |
| 触发 | Owner-cut gap 藏在临时兼容代码后 |
| 失败形状 | 跟 `legacy_alias` 同 |
| 正确替代 | 同 |

### `dual_read`

| 性质 | 值 |
| --- | --- |
| 触发 | 两条没显式准入的并行真相读路径 |
| 失败形状 | 路径间漂移；消费方看不同真相 |
| 正确替代 | 单读路径；或显式准入双真相带过渡合同 |
| 相关 key | `dual_write`、`legacy_alias` |

### `dual_write`

| 性质 | 值 |
| --- | --- |
| 触发 | 两条没显式准入的并行真相写路径 |
| 失败形状 | 漂移；「从一个迁到另一个」变永久 |
| 正确替代 | 跟 `dual_read` 同 |

### `placeholder_success`

| 性质 | 值 |
| --- | --- |
| 触发 | 类型化合同失败被返「某种东西」的回退掩盖 |
| 失败形状 | 下游代码看不到失败信号；审计抓不到 |
| 正确替代 | 带类型化原因 fail-close；重试给 transport / auth、**不**做合同救援 |

### `happy_path_only_closure`

| 性质 | 值 |
| --- | --- |
| 触发 | 只闭 happy path 就声称闭合 |
| 失败形状 | 失败模式隐式；消费方不知道什么会失败 |
| 正确替代 | 语义闭合前显式钉死失败模式 |

### `time_phased_layering`

| 性质 | 值 |
| --- | --- |
| 触发 | 按时间分层（v1 → v2 → v3）而非按 ontology（core / extended / custom） |
| 失败形状 | 永久替代 churn；每个「下一版」是软 `legacy_alias` |
| 正确替代 | 按抽象**含义**分层、**不是**按何时加 |

### `app_local_shadow_truth`

| 性质 | 值 |
| --- | --- |
| 触发 | App 局部便利状态变成隐藏规范化真相 |
| 失败形状 | App 状态偏离规范化；别 App 不一致；审计无法重建 |
| 正确替代 | App 状态准入为短暂、本地；只在 owner 域持久 |

### `silent_owner_cut_reopen`

| 性质 | 值 |
| --- | --- |
| 触发 | 在下游执行 wave 内重开 owner 域真相 |
| 失败形状 | Owner 域改动藏在执行里；审计 lineage 断 |
| 正确替代 | 先准入独立 owner 域 wave；然后用更新真相跑下游执行 |

## Topic 局部扩展

Topic 可声明额外 topic 局部禁用捷径。扩展必须：

- 用命名 key（snake_case 标识）。
- **不**自由文本。
- 在 topic 的 `forbidden_shortcuts` 字段里跟包拥有目录 key 一起声明。

例子 topic 局部扩展：

```yaml
forbidden_shortcuts:
  # 包拥有
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
  # topic 局部扩展
  - sidebar_links_to_unwritten_pages
  - product_pages_inventing_facts_not_in_extracted_sources
```

## 检测

| 机制 | 抓什么 |
| --- | --- |
| 审计 | 代码 / 文档里模式检测 |
| Closeout drift-resistance | 校验禁用捷径仍被禁 |
| Topic-step-decision | 检测到模式则拒准入 |

## 来源

- [`.nimi/contracts/forbidden-shortcuts.catalog.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/forbidden-shortcuts.catalog.yaml)
- [`.nimi/contracts/packet.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/packet.schema.yaml)
- [`.nimi/methodology/four-closure-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/four-closure-policy.yaml)
