# App 互联

`app-interconnect-model.md` 与 `realm-interop-mapping.md` 描述 App 怎么接进 Realm，以及 realm 基础协议互操作映射怎么工作。这页是「App 怎么跨进 Realm」的读者视角。

## App 怎么连到 Realm

| 路径 | 用途 |
| --- | --- |
| REST | 准入合同下的类型化 Realm 读 / 改 |
| WebSocket | 规范化事件的实时投递 |

App 通过准入 REST + WS 面连到 Realm；它们**不**自己发明协议。授权是在准入 token 颁发流下颁发的 bearer token。

## App 模式与 Realm 权威

Render-app 读 Realm；extension-app 在准入绑定范围内读写 Realm。

| 模式 | Realm 读 | Realm 写 | 每个世界并发数 |
| --- | --- | --- | --- |
| `render-app` | 是 | 否 | 多个 |
| `extension-app` | 是 | 是 | 每个世界至多一个活跃 |

世界的「至多一个活跃 extension-app」规则就来自这个：如果两个 extension-app 能同时为同一个世界写 Realm 规范化状态，规范化状态就 race。

## 互操作映射

Realm 互操作映射在 Realm 概念与外部 open-spec 锚（跨协议映射）之间翻译。它桥接：

| 桥 | 用途 |
| --- | --- |
| 世界状态合同 ↔ 外部状态表征 | Realm 世界状态需要对外可见时 |
| 世界历史合同 ↔ 外部历史表征 | 跨平台历史兼容 |
| Runtime 记忆 ↔ Realm 记忆 | 复制语义 |
| Runtime Agent ↔ Realm Agent | 身份桥接 |
| 通行合同 ↔ 外部通行形状 | 跨协议通行兼容 |

互操作映射是形式翻译层。它**不**改 Realm；它把 Realm 投到别的系统能消费的形状上。

## 阅读场景：App 先读再动

某 render-app 想显示一个世界；后来用户升级到 extension-app 改状态。

1. **render-app 启动。** App 在 render 模式下读 Realm。
2. **用户想要更多。** 用户把关系升级到 extension-app 模式。
3. **App-世界绑定。** Extension-app 绑定到世界（同一时刻一个活跃）。
4. **修改。** Extension-app 提交类型化 commit 信封做状态修改。
5. **Realm 准入。** 每次修改过准入授权矩阵。
6. **审计 lineage。** 每次修改被记下。

从只读到带写的扩展的转换需要显式绑定。**没**静默特权升级。

## 阅读场景：实时事件流

某 App 想响应规范化事件发生时。

1. **订阅。** App 在准入订阅面下打开到 Realm 的 WebSocket 订阅。
2. **实时投递。** 事件 commit 时到达。
3. **App 响应。** 准入形状下的类型化事件处理器。
4. **连接生命周期。** 重连、backpressure 等在准入连接合同下。

实时是被准入的；实时可用时 App **不**自己发明 polling 协议。

## 阅读场景：外部系统桥 Realm

某外部系统想镜像 Realm 世界历史。

1. **经互操作映射读。** 外部系统在准入互操作映射下读 Realm 历史。
2. **翻成外部形状。** 映射把 Realm 概念投到外部 open-spec 表征。
3. **外部系统消费。** 默认无修改回流，除非准入。

桥默认是单向读。双向桥需要准入双向合同 — **不**隐式。

## 边界总结

| 关注 | 拥有者 |
| --- | --- |
| Realm 规范化真相 | Realm kernel |
| App 访问 Realm | 准入 REST + WS 面 |
| App-世界绑定 | App 授权预设 + 绑定合同 |
| 实时投递 | 准入订阅面 |
| 外部系统桥 | Realm 互操作映射 |
| 跨协议形状 | 互操作映射桥 |

## 来源

- [`.nimi/spec/realm/app-interconnect-model.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/app-interconnect-model.md)
- [`.nimi/spec/realm/realm-interop-mapping.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/realm-interop-mapping.md)
- [`.nimi/spec/realm/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/index.md)
- [`.nimi/spec/realm/kernel/binding-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/binding-contract.md)
- [`.nimi/spec/realm/kernel/world-state-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/world-state-contract.md)
- [`.nimi/spec/realm/kernel/transit-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/transit-contract.md)
- [`.nimi/spec/platform/kernel/architecture-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/architecture-contract.md)
- [`.nimi/spec/sdk/kernel/realm-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/realm-contract.md)
