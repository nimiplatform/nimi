# 禁用捷径

Nimi Coding 包随附一份**包拥有的具名反模式目录**。每一条捷径都对应一种方法论拒绝接受的失败形态，并且配一个 packet 能引用的 key。

这是这个产品比较有特点的工程选择之一：目录是开放的（topic 可以声明 topic-local 的扩展），但每一种被拒的模式都得有名字。这里没有「杂项坏模式」这种兜底桶。

## 目录

| Key | 它禁止什么 |
| --- | --- |
| `mvp_subset_contract` | 把规范化合同真相切成临时的最小子集 —— 完整设计必须先到位 |
| `legacy_alias` | 用软别名让过时语义继续活着 —— 要硬切，不要软留 |
| `compat_shim` | 用临时兼容代码盖住 owner-cut 的缺口 |
| `dual_read` | 两条并行的真相读路径，没有显式准入 |
| `dual_write` | 两条并行的真相写路径，没有显式准入 |
| `placeholder_success` | 缺必备真相时假装成功或假装闭合 |
| `happy_path_only_closure` | 只闭 happy path 就声称闭合 |
| `time_phased_layering` | 用时间切片（v1 / v2 / v3）替代语义分层（core / extended / custom） —— 方法论按本体分层，不按时间分层 |
| `app_local_shadow_truth` | App 局部便利状态变成隐藏的规范化真相 |
| `silent_owner_cut_reopen` | 在下游执行 wave 里悄悄重开 owner-domain 真相 |

包拥有的这 10 条是地基。Topic 可以声明额外的 topic-local 扩展，但只能用包拥有的 key，或者已声明的 topic-local 扩展 —— 不能写自由散文。

## 为什么要做目录，而不是自由散文式拒绝

「要避免哪些模式」如果以自由散文形式给出，几乎没法 enforce。Reviewer 可能在精神上认同，但具体到一个模式算不算命中、就吵起来。审计也没法用机械方式去核 自由散文的规则。

目录把「要避免的模式」变成具名 key。Packet 声明它拒绝哪些 key；auditor 按声明集核对；closeout 的抗漂移维度核对这些 key 是否仍然被拒。

## 各模式细节

### `mvp_subset_contract`

合同以最小子集准入，剩下的留给「以后再补」。方法论拒绝它的理由：

- 「以后」本身就是一种 `time_phased_layering`。
- 子集合同会把被 defer 的关注点泄漏成隐式默认。
- 消费方依赖在子集上；将来扩展，会以「补完合同」的名义伪装成 breaking change。

**正确替代**：先把完整合同设计出来；按本体分层（core / extended / custom）准入，不按时间分层（v1 / v2 / v3）。

### `legacy_alias`

旧语义靠软别名继续活着。方法论拒绝它的理由：

- 别名就是一份并行真相。
- 它带来一种隐性的兼容负担。
- 它让下次重构变难，不变易。

**正确替代**：硬切。要么把旧语义继续作规范化准入，要么删掉。所谓「只是为了迁移用一段时间」的别名，最后都会变成永久存在。

### `compat_shim`

用临时兼容代码盖住 owner-cut 的缺口。本质上是 owner-cut 上的 `legacy_alias`，被拒的理由相同。

### `dual_read` / `dual_write`

两条并行的真相读路径或写路径，没有显式准入。被拒的理由：

- 两条路径会漂移。
- 用一条的 App 看不见另一条在干什么。
- 「正在从一条迁到另一条」会变成永久状态。

**正确替代**：把双真相显式准入为一份刻意为之的过渡合同，写明时间线和关闭它的接受度标准。

### `placeholder_success`

类型化合同失败被一个「返回点什么」的 fallback 兜住，没有 fail-close。被拒的理由：

- 下游代码看不到任何「出错了」的信号。
- 那个「点什么」会变成事实上的接口。
- 审计抓不到失败。

**正确替代**：以类型化原因 fail-close。运行时恢复只允许做 transport / auth refresh，绝不可以救援合同。

### `happy_path_only_closure`

只闭了 happy path 就声称闭合，失败模式仍然隐式。语义闭合层面就被拒。

**正确替代**：先显式钉住失败模式，再声称语义闭合。

### `time_phased_layering`

按时间分层（v1 → v2 → v3），而不是按本体分层（core / extended / custom）。被拒的理由：

- 时间分层会制造永久性的「上一版被这一版替换」搬迁。
- 每一个「下一版」都是一次软的 `legacy_alias` 迁移。
- 本体分层在语义上是稳定的；时间分层不是。

**正确替代**：按抽象的语义含义分层（core 对 extended 对 custom），不按它是什么时候加的分层。

### `app_local_shadow_truth`

App 局部便利状态变成隐藏的规范化真相。被拒的理由：

- App 自己的状态跟规范化的脱离同步。
- 别的 App 跟它讲不到一起。
- 审计没法重建。

**正确替代**：App 自己的状态准入为短暂、本地；任何应当作为真相持续存在的，住在 owner 域里。

### `silent_owner_cut_reopen`

在下游执行 wave 里悄悄重开 owner-domain 真相。被拒的理由：

- Owner-domain 的修改需要它自己的准入流程。
- 把它混进下游执行里，会把权威漂移藏起来。
- 审计 lineage 变得没法重建。

**正确替代**：先单独准入一个 owner-domain wave；再让下游执行去针对更新后的真相运行。

## Packet 怎么声明禁用捷径

Packet 的 `forbidden_shortcuts` 字段列出 packet 拒绝的 key：

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

Topic 也可以声明额外的 topic-local 扩展：

```yaml
forbidden_shortcuts:
  # 包拥有的 key
  - mvp_subset_contract
  - legacy_alias
  # topic-local 扩展
  - sidebar_links_to_unwritten_pages
```

Topic-local 扩展必须**显式声明**并起名字，不能是自由散文。

## 阅读场景：审计抓到一条禁用模式

某 wave 在审计中暴露出 `legacy_alias` 模式：旧路径「为了迁移」一直留着。

| 步骤 | 发生什么 |
| --- | --- |
| Auditor 识别 | 该模式命中目录里的 `legacy_alias` |
| 审计裁定 | `NEEDS_REVISION`（如果是 blocking 就是 `FAIL`） |
| Worker 处理 | 要么删掉别名，要么把它显式准入为过渡合同 |
| 重新审计 | 核对处理结果 |

目录让违反**有名有形**。一个模式能不能被接受，没有歧义。

## 来源

- [`.nimi/contracts/forbidden-shortcuts.catalog.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/forbidden-shortcuts.catalog.yaml)
- [`.nimi/contracts/packet.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/packet.schema.yaml)
