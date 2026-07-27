# 本地 AI

桌面端的本地 AI 面，也就是「本地模型中心」，是用户在本机管理本地 AI 的 UI。所有 UI 显示的状态都是 Runtime 真相的呈现。桌面端不读取自己关于 AI 配置的本地状态，它只问 Runtime。

## 本地 AI 呈现的内容

| 概念 | 含义 |
| --- | --- |
| Active | 经过 Runtime 验证可执行（这一刻可用） |
| Installed | 已注册，但首次调用时才热加载 |
| 本地模型中心 | 浏览、安装、激活本地模型的 UI |
| 引擎绑定 | 哪一类能力绑了哪一个引擎 |

Active 与 Installed 的区分是真实的：Installed 表示注册过、未热加载，第一次使用时才会完成加载；Active 表示这一刻已经验证为可执行。

## 真相呈现，不持有状态

桌面端的本地 AI UI **不会自己造真相**。屏幕上的每个状态都是 Runtime 真相的一次呈现。

| 关注点 | 归属 |
| --- | --- |
| 模型是否激活 | Runtime |
| 模型是否安装 | Runtime |
| 模型服务于哪类能力 | Runtime |
| 引擎绑在哪一项 | Runtime |
| CUDA 依赖状态 | Runtime materializer |

Runtime 说不可用，桌面端就显示「不可用」，不会偷偷重试，也不会装作可用。

## CUDA 依赖装配

需要 CUDA 的引擎走 Runtime materializer。桌面端 UI 呈现 materializer 的强类型阶段。

| 阶段 | 含义 |
| --- | --- |
| `queued` | 已排队 |
| `downloading` | 正在拉取依赖 |
| `verifying` | 校验校验和与兼容性 |
| `installing` | 装入 Runtime 管理的目录 |
| `ready_system` | 在系统模式下就绪 |
| `ready_managed` | 在受管模式下就绪 |
| `failed` | 装配失败，记录原因 |
| `repair_required` | 需要修复 |
| `cancelled` | 用户取消 |

关键一点：装配过程不直接执行 PowerShell 或 bash。**仅弹出一次确认对话框**；真正的安装由 materializer 在准入契约下完成。

用户点「安装 CUDA 依赖」，materializer 走完整套阶段，桌面端把当前阶段呈现给用户。中间不存在不透明的 shell 命令环节。

## 场景：安装并激活一个本地模型

你想在本机跑一个本地文本模型。

1. **打开本地模型中心**。桌面端从 Runtime 读取哪些模型已准入、可用、已安装、已激活。
2. **浏览或搜索**。走的是准入的目录路由。
3. **安装**。你选中一个模型包，Runtime 拉取、校验、注册。
4. **进入 Installed**。模型呈现为 Installed 状态。
5. **激活并热加载**。你向 Runtime 请求激活，Runtime 完成热加载，引擎绑定能力。
6. **进入 Active**。模型成为 Active，App 可以把请求路由过去。

整个过程里，桌面端 UI 都是 Runtime 状态的呈现。Runtime 说「校验失败」，桌面端就把这个原因原样显示出来。

## 场景：配置内存 embedding

用户想选定 memory 子层使用的 embedding 模型。

1. **Runtime Config UI**。桌面端的 Runtime Config 编辑的是用户**意图** —— 想用哪一个模型。
2. **由 Runtime 完成解析**。意图提交之后，绑定是否成功、bank 身份、迁移、切换，都由 Runtime 决定。
3. **桌面端不会自行宣布「memory 就绪」**。这是 Runtime 的判断。
4. **桌面端只呈现**。embedding 绑定成功与否，失败的原因是什么，UI 都从 Runtime 取。

这是这一节最重要的边界：桌面端**表达意图**，Runtime**完成解析**。

## 场景：CUDA 装配走完阶段

某用户用独显，第一次安装一个需要 CUDA 的引擎。

1. **声明 CUDA 需求**。引擎声明 CUDA 是必需依赖。
2. **materializer 提供装配**。一次确认 UI：「安装 CUDA 依赖？」
3. **用户确认**。materializer 排队。
4. **阶段进展**。桌面端 UI 呈现：`queued → downloading → verifying → installing → ready_managed`。
5. **引擎就绪**。引擎现在可以在 GPU 上运行。

任何阶段失败，桌面端会呈现强类型的失败原因。用户在准入状态下选择重试、修复或取消。

## Realm 离线不阻断本地 AI

| Realm 状态 | 本地 AI 状态 |
| --- | --- |
| 在线 | 本地 AI 正常 |
| 离线 | 本地 AI 仍可工作 |
| 都离线 | 退化为只读 |

这是「本地优先」姿态在 UI 上的具体体现。Realm 不可达，并不会让本地 Agent 跑不起来。

## 本地 AI 不做的事

| 关注点 | 原因 |
| --- | --- |
| 自己读本地状态作为 AI 配置真相 | 桌面端只呈现 Runtime 真相 |
| 直接执行 shell 命令 | 准入路径是 materializer |
| 自行宣布 memory 绑定成功 | 这是 Runtime 的归属 |
| Runtime 说不可用时给一个回退 | fail-closed 姿态 |

## 来源依据

- [`.nimi/spec/desktop/ai-consumption.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/ai-consumption.authority.yaml)
- [`.nimi/spec/desktop/shell-runtime.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/shell-runtime.authority.yaml)
- [`.nimi/spec/runtime/local-compute.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/local-compute.authority.yaml)
