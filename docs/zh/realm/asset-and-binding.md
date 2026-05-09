# 资产与绑定

Realm 把 Resource、Asset、Bundle、Binding 拆成四个不同的强类型概念。多数平台把它们都揉成"文件"，Nimi 选择拆开：一个 Resource 可以挂到多个表面而不变成 Asset；一个 Asset 可以组合进 Bundle 而不丢失自己的所有权身份。

## Resource

最底层的强类型内容载体。

| 属性 | 值 |
| --- | --- |
| 类型 | `IMAGE`、`VIDEO`、`AUDIO`、`TEXT` |
| 标识 | 稳定 |
| 存储 | Realm 托管 |
| 分发 | 强类型 |
| 状态 | 强类型生命周期（上传准备 → 终态化 → 删除） |
| 是否带所有权 | 否 |

Resource 就是带 id 和类型的强类型字节流。它本身不带"谁拥有"的语义，也不是 Asset。

## OwnableAsset

可独立拥有的正式对象。

| 属性 | 值 |
| --- | --- |
| 类型 | `WORK` 或 `ITEM` |
| 所有者 | 记录在册 |
| 作者 | 记录在册 |
| 血缘 | 记录在册 |
| 生命周期 | `DRAFT → READY → ARCHIVED → DELETED` |
| 绑定策略 | 按 asset 决定 |
| `previewResourceId` | 与 `resourceRefs` 分开 |

OwnableAsset **和 Resource 是两个东西**。除了引用一组 resource，asset 还带所有权、作者、血缘。`previewResourceId` 是预览图字段，独立于 asset 的内容 resource。

## Bundle

正式的组合单位——一组按顺序排列的 OwnableAsset 引用。

| 属性 | 值 |
| --- | --- |
| 标识 | 稳定 |
| 所有者 | 记录在册 |
| 成员顺序 | 保留 |
| 封面资产 | 与成员列表分开 |
| 生命周期 | 终态止于 `ARCHIVED`（无 `DELETED`） |

Bundle 把 asset 组合在一起，但不吞并它们。每个成员 asset 保留自己的所有权和作者。

注意：Bundle 生命周期止于 `ARCHIVED`，没有 `DELETED` 态。不再需要的 bundle 归档即可，底层 asset 仍然可拥有、可复用。

## Binding

唯一一种持久的对象-宿主关系。它是强类型的边："这个对象按这种方式挂在那个宿主上"。

| 属性 | 值 |
| --- | --- |
| 对象类型 | `RESOURCE` / `ASSET` / `BUNDLE` |
| 宿主类型 | `WORLD` / `AGENT` / `SCENE` / `WORLD_EVENT` / `WORLDVIEW` |
| 绑定种类 | `PRESENTATION` / `USE` / `IMPORT` |
| 合法性 | 由矩阵裁定，未声明组合直接拒收 |

Binding 有三个自由轴（对象类型、宿主类型、种类），但**合法性矩阵只准入其中一部分组合**。未声明的组合 fail-closed。

这就是为什么不存在"任意 asset 任意挂法"的乱象。一个想把 Resource 以 `IMPORT` 挂到 Agent 的创作者，会立刻知道这个组合是不是合法。

## Attachment

只是跨表面的展示包装，**与 Binding 不同**。

| 概念 | 权威 |
| --- | --- |
| Binding | Realm 规范真相 |
| Attachment | 跨表面展示包装，不是绑定真相 |

Attachment 让表面可以展示"这两个有关联"，但不暗示存在规范绑定。Binding 是持久的规范真相；Attachment 是展示侧的粘合剂。

## 场景：创作者发布一套服饰

一位创作者要发布一套服饰资产。

1. **Resource**。创作者把贴图、网格、元数据上传为 Resource（`IMAGE` 等）。
2. **OwnableAsset**。创作者创建一个 `WORK` 类型（或按用途选 `ITEM`）的 OwnableAsset，引用上述 resource，所有者是创作者本人。
3. **生命周期**。创作者定稿后，asset 从 `DRAFT` 走到 `READY`。
4. **可选：组合成一套**。创作者把整套衣服组进一个 `Bundle`，包含若干相关 asset。Bundle 有自己的所有者和成员顺序。
5. **绑定到世界或场景**：
   - Asset → Scene 用 `USE`（asset 在某个场景里被使用）。
   - Asset → Bundle 用 `IMPORT`（asset 是 bundle 的一部分）。
   - Bundle → World 用 `PRESENTATION`（bundle 出现在世界的展示面）。
6. **合法性矩阵**。Realm 只准入矩阵里允许的绑定。

创作者通过强类型矩阵拿到明确的合法使用权。

## 场景：一次非法绑定

一个 mod 想把 Resource 直接以 `IMPORT` 绑到 Agent 上。

1. **提交绑定**。Mod 发出绑定请求。
2. **Realm 校验**。检查合法性矩阵：`RESOURCE` × `AGENT` × `IMPORT`。
3. **未准入**。这个组合不在矩阵里。
4. **拒收**。fail-closed，返回强类型错误。
5. **Mod 看到原因**："此绑定组合未准入，请查阅合法性矩阵。"

Mod 不会无意中违反宿主类型。矩阵是声明式的，并强制执行。

## 场景：Bundle 归档但 asset 还活着

一位创作者归档了一个 bundle，里面引用过一个 asset。

1. **Bundle 归档**。Bundle 生命周期进入 `ARCHIVED`。
2. **成员 asset 不受影响**。bundle 引用过的 OwnableAsset 仍按自己的生命周期保持 `READY` 或 `ARCHIVED`。
3. **可以复用**。创作者可以把同一个 asset 组进另一个 bundle。

这就是 Asset 与 Bundle 必须是两个概念的原因。如果合并成一个，归档 bundle 就会让里面的内容变成孤儿；分开则保住了复用性。

## 为什么是四个概念，不是一个

| 概念 | 它回答的问题 |
| --- | --- |
| Resource | 这堆强类型字节是什么？ |
| Asset | 谁拥有这个可独立拥有的对象？ |
| Bundle | 这是一组怎样组合在一起的 asset？ |
| Binding | 这个对象按什么方式挂在那个宿主上？ |

合并这些概念会丢掉这些回答。"文件"这一层抽象答不出"谁拥有这个组合体"或"这个挂法是否合法"。

## 来源依据

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
