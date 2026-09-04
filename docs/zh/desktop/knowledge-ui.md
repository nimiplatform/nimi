# Knowledge UI

Knowledge 页是你查看和整理 Agent 知识的地方。在桌面端，整个使用体验由 Desktop 负责：导航、搜索与整理、加载与错误提示，以及临时的界面状态。

知识数据本身由 Runtime 管理。桌面端通过标准 SDK 和已授权的 Runtime 界面访问它，不会另起一套 Knowledge 服务，也不会在本地保存正式数据。

## 边界

| Desktop 持有 | Runtime 持有 |
| --- | --- |
| 浏览、搜索与整理 UX | Knowledge ingestion、retrieval、isolation 与 lifecycle |
| 输入草稿与本地呈现状态 | 从 session 推导的 authorization 与 LocalAgent scope |
| 强类型 unavailable 与 failure 呈现 | 已准入结果与失败语义 |

桌面端把你的操作提交上去，再呈现 Runtime 返回的结果。本地缓存永远只是缓存，不会变成 Knowledge、Conversation、Memory、来源或授权状态的正式记录。

请求未授权、不可用、处理中或失败时，界面会如实显示对应状态。桌面端不会绕过 Runtime，用私有存储、额外的 Provider 调用或应用内服务另搞一套。

## 来源依据

- [`.nimi/spec/desktop/product-surfaces.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/product-surfaces.authority.yaml)
- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
- [`.nimi/spec/runtime/app-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/app-surface.authority.yaml)
