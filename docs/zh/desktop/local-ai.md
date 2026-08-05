# 本地 AI

Desktop 的本地模型中心是 Runtime 本地 AI 资源的机器管理界面。用户可以在这里浏览、安装、导入、删除和查看资源，但不能为 App 请求选择具体实现。

## 界面边界

| 概念 | 含义 |
| --- | --- |
| 本地资源目录 | Runtime 提供的可安装资源清单 |
| 已安装资源 | 已在本机注册的资源 |
| 安装进度 | Runtime 提供的下载、校验和装配状态 |
| 推荐列表 | Runtime 排好顺序的安装建议及证据 |
| 能力意图 | Owner 在 `AIConfig` 中表达的 Local 或 Cloud 偏好 |

资源目录属于机器配置。在本地模型中心选择 bundle，表示选择要安装或删除的资源，不表示为后续 App 调用固定 model、engine 或 route。

## 呈现 Runtime 真相

Desktop 只呈现 Runtime 真相，不在本地重建另一套判断。

| 关注点 | 归属 |
| --- | --- |
| 目录和已安装资源清单 | Runtime |
| 下载、校验和装配状态 | Runtime |
| 推荐顺序和推荐证据 | Runtime |
| 设备及依赖诊断 | Runtime |
| 每次请求的实现选择 | Runtime |

Desktop 保持 Runtime 提供的推荐顺序。界面可以展示 Runtime 给出的原因或兼容性证据，但不会在客户端为模型打分、分级、分组或重新排序。

## 依赖装配

需要系统依赖的引擎通过 Runtime materializer 完成装配。Desktop 展示强类型的安装进度和失败，不直接执行任意 PowerShell 或 shell 命令。用户确认后，下载、校验、安装和清理由 Runtime 管理的准入操作完成。

依赖安装状态只是机器管理证据，不是 App 可以用来选择实现的模型 readiness 信号。

## 读者场景：安装本地资源

1. **打开本地模型中心。** Desktop 从 Runtime 读取资源目录和已安装清单。
2. **浏览。** 用户查看 Runtime 提供的元数据和推荐证据。
3. **安装。** 用户选择要安装的资源 bundle；Runtime 负责下载、校验和注册。
4. **查看结果。** Desktop 呈现强类型安装结果或失败。
5. **使用能力。** 具有 Local 能力意图的 App 发起普通请求，不携带 model、route、connector 或 target。Runtime 判断已安装资源中是否存在可用的已准入实现。

安装资源不会创建 App 可见的 binding，也不保证下一次请求由某个指定实现处理。

## 读者场景：本地记忆能力

Owner 可以为已准入的记忆或 embedding 能力表达 Local 意图。配置只包含 owner 身份、能力和 Local 意图。具体 embedding 实现以及机器配置所需的 bank 迁移或切换都由 Runtime 管理。Desktop 不提供 embedding model picker，也不计算客户端 readiness。

## Realm 连通性

Realm 连通性和本地 Runtime 连通性是两个独立问题。Realm 中断本身不会禁用本地 AI。本地执行仍要求 Runtime 可达、owner 意图允许 Local，并且 Runtime 能找到有效实现。缺少条件时返回强类型失败，客户端不会伪造 fallback 成功。

## 公共边界

- 本地模型中心管理 Runtime 拥有的机器资源。
- `AIConfig` 表达 owner 范围内的 Local 或 Cloud 能力意图。
- App 不接收模型激活、热加载、引擎绑定、route readiness 或单模型 health 控制。
- 每次请求的具体实现只由 Runtime 选择。
- Runtime 诊断和推荐证据不会成为请求输入。

## 来源依据

- [`.nimi/spec/desktop/ai-consumption.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/ai-consumption.authority.yaml)
- [`.nimi/spec/desktop/shell-runtime.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/shell-runtime.authority.yaml)
- [`.nimi/spec/runtime/local-compute.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/local-compute.authority.yaml)
