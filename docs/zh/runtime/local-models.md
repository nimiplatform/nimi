# 本地 Model

Runtime 可以在你的硬件上跑 AI 能力。这页讲本地引擎、本地 Model 生命周期、引擎优先的路由模型。云路由见 [Connector 与 Provider](/zh/runtime/connectors-and-providers)。

## 引擎优先的路由

Nimi 的本地路由是**引擎优先**。你不是挑一个 Model 然后指望某个引擎能跑；你先挑引擎，引擎再把 Model 解析成可跑的 bundle。

| 步骤 | 发生什么 |
| --- | --- |
| 1. 选引擎 | 比如某个 llama.cpp 引擎、某个 stable-diffusion 引擎、某个 sidecar 引擎 |
| 2. 引擎解析 Model | 引擎按能力 + 设备挑合适的 Model bundle |
| 3. Bundle 变可跑 | 量化、运行时上下文、GPU layer 都被准入 |
| 4. 路由注册 | 这条本地路由变成 Runtime 准入路由 |

跟"挑个 Model 名字看兼容性"那种 Model 优先方向相反。引擎优先意味着兼容性决策归引擎。

## 本地引擎目录

准入的引擎类型在 `runtime/kernel/tables/local-engine-catalog.yaml`。常见引擎类型有：文本引擎（如 llama.cpp 各变体）、图像引擎（如 stable-diffusion 各变体）、音频引擎、专用 sidecar 引擎。

每个引擎有：

| 字段 | 用途 |
| --- | --- |
| 引擎 id | 稳定身份 |
| 引擎类型 | 文本 / 图像 / 音频 / sidecar / ... |
| Runtime 模式 | 引擎怎么跑（inline、daemon 等） |
| 配置优先级 | 哪几层配置生效 |
| 能力面 | 这个引擎能干什么 |

引擎是被准入的；新引擎类型需要 kernel 准入。

## 设备 Profile

Runtime 的设备 profile 系统描述你的硬件能跑什么。Profile 由设备探测生成，按兼容性准入或拒绝 Model bundle。

| 字段 | 用途 |
| --- | --- |
| GPU 是否可用 | 是否有独显 |
| GPU 显存 | 可用 VRAM |
| CPU profile | 核心数、架构 |
| 设备 tier | 准入的兼容 tier |

需要的 VRAM 比设备 profile 准入的多的 Model bundle，准入时 fail-close。平台不会静默地装一个会 OOM 的量化。

## 本地适配器路由

引擎被准入、Model 被解析之后，App 来的请求经 **本地适配器路由** 层。适配器把调用形状规范化，让 App 分不出生成是来自本地引擎还是云 Provider — 一样的流式形状、一样的错误模型、一样的元数据。

| 路由规则 | 来源 |
| --- | --- |
| 能力 → 适配器 | `tables/local-adapter-routing.yaml` |
| 引擎 → Model bundle | `tables/local-engine-catalog.yaml` |

## HuggingFace 目录搜索

本地 Model 安装支持 HuggingFace 目录搜索。CLI / 桌面端的 Runtime 配置让你搜准入的 Model 家族，安装一个跟你的引擎期望匹配的 bundle。

| 步骤 | 发生什么 |
| --- | --- |
| 1. 搜索 | 查询准入的目录来源 |
| 2. 过滤 | 只看引擎兼容的 bundle |
| 3. 安装 | 下载 + 校验 + 在引擎下注册 |
| 4. 激活 | 把这个 Model 标为该引擎的活跃 Model |

目录搜索受准入目录路由约束。任意 URL 不可加载；只有准入的目录路由能装 Model。

## 阅读场景：装一个本地文本 Model

你想在自己机器上跑一个本地文本 Model。

1. **选引擎。** 选一个准入的文本引擎（比如 llama.cpp 引擎），它有已知的能力面。
2. **搜索。** 通过 CLI 或桌面端 Runtime 配置，从准入目录路由搜兼容 Model。
3. **过滤。** 搜索结果过滤到你的引擎能在你设备上跑的 bundle。超出 VRAM profile 的 bundle 要么过滤掉、要么标"设备容量不够"。
4. **安装。** 选中的 bundle 被下载、校验（checksum）、在引擎下注册。
5. **激活。** Model 成为该引擎的活跃 Model。本地文本生成能力可用了。
6. **使用。** App 通过 `sdk/runtime` 发文本请求。Runtime 路由到本地引擎，结果按规范化流式形状回来。

App 代码在云路由和本地路由之间没有改一行。本地适配器把形状规范化了。

## 阅读场景：碰上设备约束的安装

你试图安装一个比你 VRAM 大的 Model bundle。

1. **搜索返回那个 bundle**，带"设备容量不够"的标记，或者按你的 CLI 过滤被过滤掉。
2. **如果你硬装**，安装会在准入时 fail-close。设备 profile 说这个 bundle 装不下。
3. **审计 lineage。** 失败的安装带原因被记下。
4. **补救。** 你换一个更小的 bundle（或不同量化），或者换一个引擎。

平台不会静默地装一个会 OOM 的量化。Fail-close 是合同。

## 阅读场景：同一台机器多引擎

你想本地同时跑文本引擎和图像引擎。

1. **两个引擎都被准入。** 各自跑在自己的引擎实例下。
2. **GPU 仲裁。** Runtime 按准入的 GPU 策略仲裁两个引擎之间的 GPU 访问。并发生成受 GPU 预算约束。
3. **能力面。** App 发的文本请求路由到文本引擎、图像请求路由到图像引擎。每条都过本地适配器。
4. **审计。** 每次生成按服务它的引擎被记下。

多引擎是正常情况。引擎优先路由让这个变得可管 — 能力解析到引擎，不是解析到全局 Model 命名空间。

## CUDA 依赖配置

需要 CUDA 的引擎，Runtime 提供基于 materializer 的配置流程，阶段明确：

| 阶段 | 含义 |
| --- | --- |
| `queued` | 配置入队 |
| `downloading` | 拉依赖 |
| `verifying` | 校验 checksum / 兼容性 |
| `installing` | 安装到 Runtime 管理的位置 |
| `ready_system` / `ready_managed` | 在系统模式或托管模式下就绪 |
| `failed` | 配置失败；原因被记下 |
| `repair_required` | 需要修复 |
| `cancelled` | 用户取消 |

整个过程不直接跑 PowerShell 或 bash；所有事都过 materializer，用一个统一的确认 UI。

## 来源

- [`.nimi/spec/runtime/local-model.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/local-model.md)
- [`.nimi/spec/runtime/kernel/local-category-capability.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/local-category-capability.md)
- [`.nimi/spec/runtime/kernel/local-engine-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/local-engine-contract.md)
- [`.nimi/spec/runtime/kernel/device-profile-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/device-profile-contract.md)
- [`.nimi/spec/runtime/kernel/tables/local-engine-catalog.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/local-engine-catalog.yaml)
- [`.nimi/spec/runtime/kernel/tables/local-adapter-routing.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/local-adapter-routing.yaml)
- [`.nimi/spec/runtime/kernel/endpoint-security.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/endpoint-security.md)
- [`.nimi/spec/runtime/kernel/scheduling-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/scheduling-contract.md)
