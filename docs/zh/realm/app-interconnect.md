# 应用互联

`app-interconnect-model.md` 与 `realm-interop-mapping.md` 描述应用如何接入 Realm，以及 Realm 基础协议在跨协议互操作上的映射方式。这一页从读者视角讲清楚一个应用如何跨进 Realm。

## 应用怎么连到 Realm

| 通道 | 用途 |
| --- | --- |
| REST | 在已准入契约下对 Realm 做强类型读取与变更 |
| WebSocket | 实时分发规范事件 |

应用通过已准入的 REST + WS 接入面连到 Realm，不能自定义协议。授权用 bearer token，由已准入的 token 颁发流程发出。

## 应用模式与 Realm 权威

render-app 只读 Realm；extension-app 在已准入的绑定作用域内既读也写。

| 模式 | 读 Realm | 写 Realm | 同一世界并发数 |
| --- | --- | --- | --- |
| `render-app` | 是 | 否 | 多个 |
| `extension-app` | 是 | 是 | 同一世界至多一个活跃 |

"同一世界至多一个活跃 extension-app"的限制原因很直接：如果同一世界有两个 extension-app 同时写规范状态，规范状态就会发生竞争。

## 互操作映射

Realm 互操作映射在 Realm 概念与外部开放规范锚点之间做翻译，桥接以下几对：

| 桥接 | 用途 |
| --- | --- |
| 世界状态契约 ↔ 外部状态表示 | Realm 世界状态需要对外可见时 |
| 世界历史契约 ↔ 外部历史表示 | 跨平台的历史兼容 |
| Runtime 记忆 ↔ Realm 记忆 | 复制语义 |
| Runtime Agent ↔ Realm Agent | 身份桥接 |
| Transit 契约 ↔ 外部 transit 形态 | 跨协议的 transit 兼容 |

互操作映射是一层正式翻译。它不修改 Realm，只把 Realm 渲染成其他系统能消费的形态。

## 场景：一个应用先读后写

一个 render-app 想展示某个世界；之后用户把它升级成一个会修改状态的 extension-app。

1. **render-app 启动**。应用以 render 模式读 Realm。
2. **用户想做更多**。用户把这层关系升级成 extension-app 模式。
3. **应用与世界绑定**。这个 extension-app 与世界建立绑定（同一时刻只有一个活跃）。
4. **变更**。extension-app 提交强类型 commit envelope 来修改状态。
5. **Realm 准入**。每次变更都过一遍已准入的授权矩阵。
6. **审计血缘**。每次变更都登记入账。

从只读升级到可写，必须显式建立绑定。没有静默的权威提升。

## 场景：实时事件流

一个应用想实时响应规范事件。

1. **订阅**。应用在已准入的订阅面打开 WebSocket。
2. **实时分发**。事件提交后即送达。
3. **应用响应**。事件处理器按已准入的形态处理强类型事件。
4. **连接生命周期**。重连、背压等都按已准入的连接契约进行。

实时是已准入能力。实时可用时，应用不需要自己设计轮询协议。

## 场景：外部系统桥接 Realm

一个外部系统想镜像 Realm 的世界历史。

1. **通过互操作映射读取**。外部系统在已准入的互操作映射下读 Realm 历史。
2. **翻译成外部形态**。映射把 Realm 概念渲染成外部开放规范的表示。
3. **外部系统消费**。除非另有准入，不会有变更回流。

桥接默认是单向读。要双向，必须有已准入的双向契约，不会隐式启用。

## 边界归属

| 关注点 | 归属 |
| --- | --- |
| Realm 规范真相 | Realm 内核 |
| 应用接入 Realm | 已准入的 REST + WS 面 |
| 应用与世界绑定 | 应用授权预设 + 绑定契约 |
| 实时分发 | 已准入的订阅面 |
| 外部系统桥接 | Realm 互操作映射 |
| 跨协议形态 | 互操作映射桥接 |

## 来源依据

- [`.nimi/spec/realm/README.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/README.md)
- [`.nimi/spec/realm/external-realm.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/external-realm.md)
- [`.nimi/spec/sdks/kernel/realm-api-consumer-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/realm-api-consumer-contract.md)
- [`.nimi/spec/sdks/kernel/realm-core-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/realm-core-contract.md)
- [`.nimi/spec/sdks/kernel/realm-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/realm-contract.md)
- [`.nimi/spec/platform/kernel/architecture-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/architecture-contract.md)
- [`.nimi/spec/sdks/kernel/realm-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/realm-contract.md)
