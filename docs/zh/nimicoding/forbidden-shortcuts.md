# 禁用快捷方式

Nimi Coding 自带一份**包内维护的具名反模式目录**。每一种被拒绝的快捷方式都有名字、有 key，packet 可以直接引用。

这套设计的特点是：目录在"议题可声明本地扩展"的意义上是开放的，但**所有被拒绝的模式都有名字**。不存在"杂项坏模式"这种箱子。

## 目录

| Key | 它禁止什么 |
| --- | --- |
| `mvp_subset_contract` | 把权威契约切成临时最小子集——必须先做完整设计 |
| `legacy_alias` | 用软性别名让过时语义继续存活——旧语义必须硬切，不能软处理 |
| `compat_shim` | 用临时兼容代码遮盖所有权切换的缺口 |
| `dual_read` | 没有显式准入的两条并行真相读路径 |
| `dual_write` | 没有显式准入的两条并行真相写路径 |
| `placeholder_success` | 真相缺失时伪造成功或闭合 |
| `happy_path_only_closure` | 只闭合了 happy path 就声称完成 |
| `time_phased_layering` | 用时间切片（v1 / v2 / v3）替代语义分层（core / extended / custom）——方法论是本体论分层，不是时间分层 |
| `app_local_shadow_truth` | 应用本地的"方便状态"悄悄变成隐藏权威 |
| `silent_owner_cut_reopen` | 在下游执行 wave 内部重开所有者域真相 |

包目录的这 10 项是基础。议题可声明额外的本地扩展，但只能使用包级 key 或显式声明的本地扩展，不能用自由文本。

## 为什么要做目录而不是自由式拒绝

"应当避免哪些事"如果只用文字描述，难以执行。审查者在精神层面或许一致，对某个具体模式是否构成违规却经常分歧。机器审计也无法核对自由式规则。

目录把"应当避免"转成强类型 key。packet 声明它拒绝哪些 key；审计员按声明集对照检查；收尾时由抗漂移维度核验这些 key 仍处于禁用状态。

## 逐项说明

### `mvp_subset_contract`

契约以最小子集形态被准入，剩下的"以后再加"。方法论拒绝它，原因是：

- "以后"本身就是 `time_phased_layering` 的一种。
- 子集契约会把推迟掉的关切渗成隐含默认值。
- 消费方依赖这个子集；后续扩展会变成被伪装成"补全契约"的破坏性变更。

**正确替代**：先把完整契约设计出来；按本体（core / extended / custom）分层准入，而不是按时间（v1 / v2 / v3）分层。

### `legacy_alias`

旧语义靠软性别名活下去。方法论拒绝它，原因是：

- 别名本身就是并行真相。
- 它带来隐性兼容负担。
- 它让下一次重构更难，而不是更易。

**正确替代**：硬切。旧语义要么作为权威保留，要么删除。所谓"只为迁移用"的别名，最终都会留下来。

### `compat_shim`

所有权切换缺口被临时兼容代码遮盖。这是面向所有权切换的 `legacy_alias`，处理方式相同。

### `dual_read` / `dual_write`

没有显式准入的两条并行真相读路径或写路径。被禁的原因：

- 两条路径会漂移。
- 走其中一条的应用看不到另一条干了什么。
- 所谓"从一条迁到另一条"会变成永久状态。

**正确替代**：把双路真相显式准入为一份过渡契约，命名时间表与闭合验收标准。

### `placeholder_success`

强类型契约失败被一段 fallback 遮盖，返回"某种东西"而不是 fail-closed。被禁的原因：

- 下游代码收不到任何"出错了"的信号。
- 那个"某种东西"会变成事实接口。
- 审计无法侦测这次失败。

**正确替代**：fail-closed，附强类型 reason。运行时恢复只在传输层 / 鉴权刷新层准入，绝不能用来挽救契约失败。

### `happy_path_only_closure`

只闭合了 happy path 就声称完成。失败模式仍然隐含。在语义闭合下被禁。

**正确替代**：在声称语义闭合前，把失败模式显式钉死。

### `time_phased_layering`

按时间分层（v1 → v2 → v3），而不是按本体分层（core / extended / custom）。被禁的原因：

- 时间分层会持续制造代际更替的搅动。
- 每一个"下一版"都是软性 `legacy_alias` 迁移。
- 本体分层在语义上是稳定的；时间分层不是。

**正确替代**：按抽象的语义含义分层（core 与 extended 与 custom），而不是按引入的时间分层。

### `app_local_shadow_truth`

应用本地的"方便状态"悄悄变成隐藏权威。被禁的原因：

- 应用状态从权威分叉。
- 其他应用看到的不一致。
- 审计无法重建。

**正确替代**：应用状态以临时性、本地性准入；任何应当作为真相留存的内容，归在所有者域。

### `silent_owner_cut_reopen`

在下游执行 wave 内部重开所有者域真相。被禁的原因：

- 所有者域改动需要自己的准入。
- 把它和下游执行混在一起会隐藏权威漂移。
- 审计血缘变得无法重建。

**正确替代**：先准入一个独立的所有者域 wave；再在更新后的真相之上跑下游执行。

## packet 如何声明禁用快捷方式

packet 的 `forbidden_shortcuts` 字段列出它拒绝的 key：

```yaml
forbidden_shortcuts:
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
```

议题也可以声明本地扩展：

```yaml
forbidden_shortcuts:
  # 包级 key
  - mvp_subset_contract
  - legacy_alias
  # 议题本地扩展
  - sidebar_links_to_unwritten_pages
```

议题本地扩展必须**显式声明、有名字**，不能是自由文本。

## 读者场景：审计抓到一个禁用模式

某次 wave 在审计阶段被发现存在 `legacy_alias`：旧路由"留着方便迁移"。

| 步骤 | 发生了什么 |
| --- | --- |
| 审计员识别 | 该模式与目录中的 `legacy_alias` 匹配 |
| 审计裁决 | `NEEDS_REVISION`（如果阻塞则 `FAIL`） |
| worker 处理 | 要么删除别名，要么把它显式准入为过渡契约 |
| 复审 | 核验处置 |

目录让违规变得**有名、有类型**。这个模式能不能接受，没有歧义可言。

## 来源依据

- [`.nimi/contracts/forbidden-shortcuts.catalog.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/forbidden-shortcuts.catalog.yaml)
- [`.nimi/contracts/packet.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/packet.schema.yaml)
