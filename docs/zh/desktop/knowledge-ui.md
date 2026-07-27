# Knowledge UI

Desktop 持有面向用户的 Knowledge 体验：导航、搜索与整理控制、loading 与 error
呈现，以及短暂 UI 状态。

Runtime 持有 LocalAgent 运行态 Knowledge。Desktop 通过标准 SDK 与已授权的
Runtime surface 访问它；Desktop 不会定义第二套 Knowledge service，也不会
在本地维护 canonical Knowledge 数据。

## 边界

| Desktop 持有 | Runtime 持有 |
| --- | --- |
| 浏览、搜索与整理 UX | Knowledge ingestion、retrieval、isolation 与 lifecycle |
| 输入草稿与本地呈现状态 | 从 session 推导的 authorization 与 LocalAgent scope |
| 强类型 unavailable 与 failure 呈现 | 已准入结果与失败语义 |

Desktop 提交强类型 user intent 并渲染返回的投影。本地 cache 不能成为
Knowledge、Conversation、Memory、source 或 authorization 真相。

当请求处于 unauthorized、unavailable、pending 或 failed 时，UI 保留强类型
结果，不会通过 private store、Provider call 或 app-local service 绕过 Runtime。

## 来源依据

- [`.nimi/spec/desktop/product-surfaces.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/product-surfaces.authority.yaml)
- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
- [`.nimi/spec/runtime/app-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/app-surface.authority.yaml)
