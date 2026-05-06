# 本地 AI

桌面端的本地 AI 面 — 本地 Model 中心 — 是用户管理本机本地 AI 的 UI。所有 UI 都是 runtime 真相的只读视图。桌面端**永远不**为 AI 配置去读自己的本地状态；它问 Runtime。

## 本地 AI 露出什么

| 概念 | 含义 |
| --- | --- |
| Active | Runtime 校验过的可执行项（这个 model 现在可以跑） |
| Installed | 已注册，须按需 warm |
| 本地 Model 中心 | 浏览、安装、激活本地 model 的 UI |
| 引擎绑定 | 哪个引擎绑到哪个能力 |

Active 与 Installed 是真实区分。Installed model 已注册但未 warm；warm 在第一次使用时发生。Active model 当前校验通过、可以执行。

## 读 Runtime 真相、不持有状态

桌面端的本地 AI UI **永不发明真相**。屏幕上每一个状态都来自 Runtime 真相的只读读取。

| 关注 | 拥有者 |
| --- | --- |
| Model 是否 active | Runtime |
| Model 是否 installed | Runtime |
| Model 服务什么能力 | Runtime |
| 哪个引擎绑了 | Runtime |
| CUDA 依赖状态 | Runtime materializer |

如果 Runtime 说某 model 不可用，桌面端就显示「不可用」 — 它**不**静默重试，也**不**装作 model 可用。

## CUDA 依赖配置

需要 CUDA 的引擎过 runtime materializer。桌面端 UI 显示 materializer 的类型化阶段。

| 阶段 | 含义 |
| --- | --- |
| `queued` | 配置入队 |
| `downloading` | 拉依赖 |
| `verifying` | 校验 checksum / 兼容性 |
| `installing` | 装到 runtime 管理的位置 |
| `ready_system` | 在系统模式下就绪 |
| `ready_managed` | 在托管模式下就绪 |
| `failed` | 配置失败；原因被记下 |
| `repair_required` | 需要修复 |
| `cancelled` | 用户取消 |

关键：配置**永不**直接跑 PowerShell 或 bash。**单一确认 UI**；materializer 在准入合同下处理实际安装。

用户点「装 CUDA 依赖」；materializer 走阶段；桌面端把阶段呈现给用户。**没有**不透明的 shell 命令阶段。

## 阅读场景：装并激活一个本地 model

你想在自己机器上跑一个本地文本 model。

1. **打开本地 Model 中心。** 桌面端从 Runtime 读哪些 model 被准入、可用、已装、激活。
2. **浏览 / 搜。** 通过准入目录路由。
3. **装。** 你选一个 model bundle。Runtime 下载、校验、注册。
4. **Installed 状态。** Model 出现为 Installed。
5. **激活 / warm。** 你请 Runtime 激活 model。Runtime warm 它；引擎绑能力。
6. **Active。** Model 现在 Active。App 可以路由请求过去。

整个流里桌面端 UI 都在读 Runtime 状态。Runtime 说「校验失败」，桌面端就显示那个确切原因。

## 阅读场景：记忆 embedding 配置

用户想选记忆基底用哪个 embedding model。

1. **Runtime 配置 UI。** 桌面端的 Runtime 配置编辑用户选定的记忆 embedding **意图** — 用户想用哪个 model。
2. **Runtime 拥有解析。** 意图提交后，Runtime 决定绑定成功、bank 身份、迁移、cutover。
3. **桌面端永不自己决定「记忆就绪」。** 那是 Runtime 侧的判定。
4. **桌面端读 Runtime 状态。** UI 显示 embedding 绑定是否成功；失败的话为什么。

这是这一节最重要的边界纪律：桌面端**表达意图**；Runtime **拥有解析**。

## 阅读场景：CUDA 配置走阶段

带独显的用户第一次装一个需要 CUDA 的引擎。

1. **需要 CUDA。** 引擎声明 CUDA 是必需依赖。
2. **Materializer 提供配置。** 单一确认 UI：「装 CUDA 依赖？」
3. **用户确认。** Materializer 入队。
4. **阶段进度。** 桌面端 UI 显示阶段：`queued → downloading → verifying → installing → ready_managed`。
5. **引擎就绪。** 引擎现在能在 GPU 上跑。

任一阶段失败，桌面端显示类型化原因；用户在准入状态下可以重试、修复、或取消。

## Realm 离线**不**挡本地 AI

| Realm 状态 | 本地 AI 状态 |
| --- | --- |
| 在线 | 本地 AI 正常工作 |
| 离线 | 本地 AI 继续工作 |
| 双方都离线 | 降级只读 |

这就是本地优先姿态的具体落实。Realm 离线**不**阻止用户跑自己的本地 Agent。

## 本地 AI **不**做什么

| 关注 | 为什么不 |
| --- | --- |
| 为 AI 配置去读自己的本地状态 | 桌面端从 Runtime 读 |
| 直接跑 shell 命令 | Materializer 是准入路径 |
| 自己决定记忆绑定成功 | Runtime 拥有 |
| Runtime 说不可用时提供回退 | Fail-close 姿态 |

## 来源

- [`.nimi/spec/desktop/local-ai.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/local-ai.md)
- [`.nimi/spec/desktop/runtime-config.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/runtime-config.md)
- [`.nimi/spec/runtime/kernel/local-engine-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/local-engine-contract.md)
- [`.nimi/spec/runtime/kernel/local-category-capability.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/local-category-capability.md)
- [`.nimi/spec/runtime/kernel/device-profile-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/device-profile-contract.md)
- [`.nimi/spec/desktop/kernel/ai-profile-config-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/ai-profile-config-contract.md)
