# 资产与绑定

Realm 把 Resource、Asset、Bundle、Binding 切成不同的类型化概念。多数平台把它们塌缩为「文件」。Nimi 让它们分开，这样 Resource 能挂到很多面而不变成 Asset，Asset 能组合进 Bundle 而不丢自己独立的所有权身份。

## Resource

最低层的类型化内容载体。

| 性质 | 值 |
| --- | --- |
| 类型 | `IMAGE`、`VIDEO`、`AUDIO`、`TEXT` |
| 身份 | 稳定 |
| 存储 | Realm 托管 |
| 投递 | 类型化 |
| 状态 | 类型化生命周期（上传准备 → finalize → 删除） |
| 隐含所有权？ | 否 |

Resource 就是带 id 和 type 的类型化字节。它**不**隐含谁拥有它；它本身**不是** asset。

## OwnableAsset

可独立拥有的形式对象。

| 性质 | 值 |
| --- | --- |
| 类型 | `WORK` 或 `ITEM` |
| 拥有者 | 跟踪 |
| 作者 | 跟踪 |
| Lineage | 跟踪 |
| 生命周期 | `DRAFT → READY → ARCHIVED → DELETED` |
| 绑定策略 | 按 asset |
| `previewResourceId` | 跟 `resourceRefs` 分开 |

OwnableAsset **跟 Resource 不同**。Asset 除了引用 resource 还有所有权、作者、lineage。`previewResourceId` 是预览图的独立字段，跟 asset 的内容 resource 分开。

## Bundle

形式组合单元 — OwnableAsset 引用的有序组。

| 性质 | 值 |
| --- | --- |
| 身份 | 稳定 |
| 拥有者 | 跟踪 |
| 成员排序 | 保留 |
| 封面 asset | 跟成员列表分开 |
| 生命周期 | 终于 `ARCHIVED`（无 `DELETED`） |

Bundle 组合 asset 但**不**吸纳它们。每个成员 asset 保留自己的所有权与作者。

注意：Bundle 生命周期终于 `ARCHIVED` — **没** `DELETED` 状态。不再要的 bundle 被归档；底层 asset 仍可拥有、可重用。

## Binding

唯一的持久对象-到-宿主关系。这是说「这个对象以这种方式挂到这个宿主」的类型化边。

| 性质 | 值 |
| --- | --- |
| 对象类型 | `RESOURCE` / `ASSET` / `BUNDLE` |
| 宿主类型 | `WORLD` / `AGENT` / `SCENE` / `WORLD_EVENT` / `WORLDVIEW` |
| 绑定种类 | `PRESENTATION` / `USE` / `IMPORT` |
| 合法性 | 矩阵治理；未声明组合被拒 |

绑定有三个自由轴（对象类型、宿主类型、种类），但**合法性矩阵只准入子集**。未声明组合 fail-close。

这就是阻止「随便绑任何 asset 到任何宿主任何方式」蔓延的原因。想把 Resource 作为 `IMPORT` 挂到 Agent 的创作者会发现那是不是准入合法组合。

## Attachment

只是跨面显示信封。跟 Binding 不同。

| 概念 | 权威 |
| --- | --- |
| Binding | Realm 规范化真相 |
| Attachment | 跨面显示信封，**不是**绑定真相 |

Attachment 让面显示「看，这跟那个相关」而**不**隐含规范化绑定。Binding 是持久规范化真相；attachment 是呈现胶水。

## 阅读场景：创作者发布一套服装

某创作者想发布服装 asset。

1. **Resource。** 创作者上传贴图 / mesh / 元数据作为 Resource（`IMAGE` 等）。
2. **OwnableAsset。** 创作者建一个 `WORK` 类型（或按用途用 `ITEM`）的 OwnableAsset。Asset 引用 resource；所有权是创作者。
3. **生命周期。** 创作者 finalize 后 asset 走 `DRAFT → READY`。
4. **可选：组成套。** 创作者把服装组成 `Bundle`，含若干相关 asset。Bundle 有自己的所有者和成员排序。
5. **绑到世界或 Scene。** 创作者绑：
   - Asset → Scene 作 `USE`（asset 在 Scene 里被用）。
   - Asset → Bundle 作 `IMPORT`（asset 是 bundle 的一部分）。
   - Bundle → World 作 `PRESENTATION`（bundle 出现在世界呈现面）。
6. **合法性矩阵。** Realm 只在合法性矩阵准入时准入每个绑定。

创作者通过类型化矩阵拿到明确合法使用权。

## 阅读场景：非法绑定组合

某 mod 试图把 Resource 作为 `IMPORT` 直接绑到 Agent。

1. **提交绑定。** Mod 发绑定请求。
2. **Realm 校验。** 查合法性矩阵：`RESOURCE` × `AGENT` × `IMPORT`。
3. **未准入。** 这个组合不在矩阵里。
4. **拒。** Fail-close；返类型化错误。
5. **Mod 看到原因。** 「这个绑定组合未准入；查合法性矩阵」。

Mod **无法**意外违反宿主类型。矩阵是声明式的、强制的。

## 阅读场景：Bundle 归档后 asset 还在

某创作者归档了一个含 asset 的 bundle。

1. **Bundle 归档。** Bundle 生命周期搬到 `ARCHIVED`。
2. **成员 asset 不受影响。** Bundle 组合的 OwnableAsset 按各自生命周期保持 `READY` 或 `ARCHIVED`。
3. **可重用。** 创作者可以把同一个 asset 组到别的 bundle。

这就是为什么 Asset 和 Bundle 是不同概念。塌缩它们意味着归档 bundle 会让其内容成孤儿；分开保留可重用性。

## 为什么是四个概念而不是一个

| 概念 | 回答什么 |
| --- | --- |
| Resource | 这些类型化字节是什么 |
| Asset | 谁作为可独立拥有对象拥有这个东西 |
| Bundle | 这个组合的 asset 组是什么 |
| Binding | 这个对象怎么挂到那个宿主 |

塌缩它们就丢了答案。「文件」抽象**无法**回答「谁拥有这个组合」或「这是不是合法附着」。

## 来源

- [`.nimi/spec/realm/asset.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/asset.md)
- [`.nimi/spec/realm/binding.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/binding.md)
- [`.nimi/spec/realm/kernel/asset-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/asset-contract.md)
- [`.nimi/spec/realm/kernel/binding-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/binding-contract.md)
- [`.nimi/spec/realm/kernel/bundle-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/bundle-contract.md)
- [`.nimi/spec/realm/kernel/resource-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/resource-contract.md)
- [`.nimi/spec/realm/kernel/attachment-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/attachment-contract.md)
- [`.nimi/spec/realm/kernel/tables/asset-contract.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/tables/asset-contract.yaml)
- [`.nimi/spec/realm/kernel/tables/binding-contract.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/tables/binding-contract.yaml)
- [`.nimi/spec/realm/kernel/tables/bundle-contract.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/tables/bundle-contract.yaml)
- [`.nimi/spec/realm/kernel/tables/resource-contract.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/tables/resource-contract.yaml)
- [`.nimi/spec/realm/kernel/tables/attachment-contract.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/tables/attachment-contract.yaml)
