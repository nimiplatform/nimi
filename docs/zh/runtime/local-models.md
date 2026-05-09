# 本地模型

Runtime 可以在你这台机器的硬件上跑 AI 能力。本页讲本地引擎、本地模型生命周期、引擎优先的路由模型。云端路由见 [连接器与 provider](/zh/runtime/connectors-and-providers)。

## 引擎优先路由

Nimi 的本地路由是**引擎优先**。你不用先挑一个模型再期望有东西能跑它；你先挑一个引擎，引擎再把模型解析成可跑的包。

| 步骤 | 内容 |
| --- | --- |
| 1. 选引擎 | 比如某种 llama.cpp 引擎、stable-diffusion 引擎或 sidecar 引擎 |
| 2. 引擎解析模型 | 引擎按能力 + 设备挑出合适的模型包 |
| 3. 包变可跑 | 量化、运行时上下文、GPU 层全部准入 |
| 4. 注册路由 | 这条本地路由进入准入的 runtime 路由集 |

这正好是"模型优先"的反面——那种先挑名字再期望兼容的玩法。引擎优先意味着兼容决定归引擎所有。

## 本地引擎目录

准入的引擎类型列在 `runtime/kernel/tables/local-engine-catalog.yaml`。常见的有文本引擎（如 llama.cpp 系）、图像引擎（如 stable-diffusion 系）、音频引擎，以及处理特殊工作的 sidecar 引擎。

每个引擎含：

| 字段 | 用途 |
| --- | --- |
| 引擎 id | 稳定身份 |
| 引擎类型 | 文本 / 图像 / 音频 / sidecar 等 |
| 运行模式 | 引擎怎么跑（inline、daemon 等） |
| 配置优先级 | 哪些配置层适用 |
| 能力面 | 这个引擎能干什么 |

引擎要先准入。新增引擎类型需通过 kernel 准入。

## 设备画像

Runtime 的设备画像系统描述这台硬件能撑什么。画像由设备探测得出，按兼容性准入或拒收模型包。

| 字段 | 用途 |
| --- | --- |
| GPU 在场 | 是否有独立 GPU |
| GPU 显存 | 可用 VRAM |
| CPU 画像 | 核数、架构 |
| 设备档位 | 准入的兼容档位 |

需要的 VRAM 超过设备画像准入档的模型包，会在准入阶段 fail-closed。平台不会静默加载一种设备根本跑不了的量化。

## 本地适配器路由

引擎被准入、模型解析完成后，应用发来的请求经**本地适配器路由**层走。适配器把调用形态规整化，应用看不出这次生成是来自本地引擎还是云端 provider——同一种流式形态、同一种错误模型、同一种元数据。

| 路由规则 | 来源 |
| --- | --- |
| 能力 → 适配器 | `tables/local-adapter-routing.yaml` |
| 引擎 → 模型包 | `tables/local-engine-catalog.yaml` |

## HuggingFace 目录搜索

本地模型安装支持 HuggingFace 目录搜索。CLI / 桌面端的 runtime 配置允许搜索准入的模型族，安装与你引擎期望相符的包。

| 步骤 | 内容 |
| --- | --- |
| 1. 搜索 | 查询准入的目录源 |
| 2. 过滤 | 只保留引擎兼容的包 |
| 3. 安装 | 下载 + 校验 + 在引擎下注册 |
| 4. 激活 | 标记为该引擎的当前模型 |

目录搜索受准入的目录路由约束。随便一个 URL 装不进来，只有准入的目录路由能装模型。

## 读者场景：装一个本地文本模型

你想在自己机器上跑一个本地文本模型。

1. **选引擎。** 选一款准入的文本引擎（比如某个 llama.cpp 引擎），它有清晰的能力面。
2. **搜索。** 经 CLI 或桌面端 runtime 配置，在准入的目录路由里搜兼容模型。
3. **过滤。** 搜索结果按引擎可跑、设备可承载收窄。VRAM 不够的包要么直接被过滤，要么标"device-too-small"。
4. **安装。** 选中的包被下载、校验（checksum），在引擎下注册。
5. **激活。** 把它设为该引擎的当前模型。本地文本生成能力就绪。
6. **使用。** 应用经 `sdk/runtime` 发文本请求。Runtime 把请求路由到本地引擎，按规整的流式形态把结果回传。

应用代码在云端路由和本地路由之间没改一行。本地适配器把形态规整了。

## 读者场景：安装命中设备约束

你想装一个比 VRAM 还大的模型包。

1. **搜索结果里**这个包带 "device-too-small" 标记，或者直接被过滤掉，看你 CLI 过滤怎么设的。
2. **如果你硬装**，准入阶段 fail-closed。设备画像说放不下。
3. **审计链路。** 本次失败安装带原因被记下。
4. **补救。** 你换更小的包（或不同量化），或者换个引擎。

平台不会静默加载一份会 OOM 的量化。fail-closed 是契约。

## 读者场景：同机多引擎

你想在本地同时跑文本引擎和图像引擎。

1. **两个引擎都准入。** 各自跑在自己的引擎实例下。
2. **GPU 仲裁。** Runtime 按准入的 GPU 策略在引擎之间仲裁 GPU 访问，并发生成受 GPU 预算约束。
3. **能力面。** 应用可以发文本请求路由到文本引擎、图像请求路由到图像引擎，两条都经本地适配器。
4. **审计。** 每次生成按服务它的那个引擎记账。

多引擎是常态。引擎优先路由正是让多引擎好管的关键——能力解析到引擎，而不是去碰一个全局模型命名空间。

## CUDA 依赖安装

需要 CUDA 的引擎通过基于 materializer 的安装路径，分阶段明确：

| 阶段 | 含义 |
| --- | --- |
| `queued` | 已排队 |
| `downloading` | 下载依赖中 |
| `verifying` | 校验 / 兼容性核对 |
| `installing` | 安装到 runtime 受管位置 |
| `ready_system` / `ready_managed` | 系统模式或受管模式就绪 |
| `failed` | 失败，原因被记下 |
| `repair_required` | 需要修复 |
| `cancelled` | 用户取消 |

整个过程不会直接跑 PowerShell 或 bash，所有动作都过 materializer，配单一确认 UI。

## 来源依据

- [`.nimi/spec/runtime/local-model.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/local-model.md)
- [`.nimi/spec/runtime/kernel/local-category-capability.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/local-category-capability.md)
- [`.nimi/spec/runtime/kernel/local-engine-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/local-engine-contract.md)
- [`.nimi/spec/runtime/kernel/device-profile-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/device-profile-contract.md)
- [`.nimi/spec/runtime/kernel/tables/local-engine-catalog.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/local-engine-catalog.yaml)
- [`.nimi/spec/runtime/kernel/tables/local-adapter-routing.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/local-adapter-routing.yaml)
- [`.nimi/spec/runtime/kernel/endpoint-security.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/endpoint-security.md)
- [`.nimi/spec/runtime/kernel/scheduling-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/scheduling-contract.md)
