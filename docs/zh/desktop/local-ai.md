# 本地 AI

本地模型中心是你管理这台机器上本地 AI 的地方。你可以浏览、安装、导入、删除和查看 Runtime 的本地资源；但在这里装了什么，都不会替 App 的请求选定具体实现。

## 界面边界

| 概念 | 含义 |
| --- | --- |
| 本地资源目录 | Runtime 提供的可安装资源清单 |
| 已安装资源 | 已在本机注册的资源 |
| 安装进度 | Runtime 提供的下载、校验和装配状态 |
| 推荐列表 | Runtime 排好顺序的安装建议及证据 |
| 能力意图 | Owner 在 `AIConfig` 中表达的 Local 或 Cloud 偏好 |

资源目录只是机器配置。在本地模型中心选一个 bundle，意思是「装上它」或「删掉它」，不是为之后的 App 调用钉死某个 model、engine 或 route。

## 呈现 Runtime 真相

这个页面上的一切都来自 Runtime，桌面端不在本地另做一套判断。

| 关注点 | 归属 |
| --- | --- |
| 目录和已安装资源清单 | Runtime |
| 下载、校验和装配状态 | Runtime |
| 推荐顺序和推荐证据 | Runtime |
| 设备及依赖诊断 | Runtime |
| 每次请求的实现选择 | Runtime |

推荐按 Runtime 给出的顺序排列，理由和兼容性证据也是 Runtime 的。桌面端不会在客户端给模型打分、分级、分组或重新排序。

## 依赖装配

需要系统依赖的引擎，由 Runtime 的 materializer 来装。你确认之后，下载、校验、安装、清理整个流程都由 Runtime 完成。桌面端沿途显示类型化的进度和失败信息，自己绝不执行任意的 PowerShell 或 shell 命令。

依赖装完，说明机器配置到位了；它不代表某个模型已就绪，App 也不能拿它去挑选实现。

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

Realm 连接和本地 Runtime 是两回事。Realm 断了，本地 AI 不一定受影响。本地执行仍需要：Runtime 可达、你的意图设置允许 Local、Runtime 能找到可用的实现。条件缺了，你会收到明确的失败信息，而不是一个假装的「成功」。

## 记住这几点

- 本地模型中心管理的是 Runtime 的机器资源。
- `AIConfig` 记录你对每项能力的 Local 或 Cloud 偏好。
- App 拿不到模型激活、预热、引擎绑定、路由就绪或单模型健康这类开关。
- 每个请求由哪个实现处理，只有 Runtime 能定。
- Runtime 的诊断和推荐证据不会变成请求的输入。

## 来源依据

- [`.nimi/spec/desktop/ai-consumption.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/ai-consumption.authority.yaml)
- [`.nimi/spec/desktop/shell-runtime.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/shell-runtime.authority.yaml)
- [`.nimi/spec/runtime/local-compute.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/local-compute.authority.yaml)
