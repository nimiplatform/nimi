# 本地环境信息与安装进度

Nimi Home 需要知道模型下载到了哪里、依赖任务是否完成、下一步是否需要用户确认。SDK 的本地环境客户端把这些 Runtime 结果带到宿主界面，保留原有标识、顺序与失败原因，避免界面靠猜测判断安装进度。

## 谁可以使用

`@nimiplatform/sdk/runtime` 中的 `createNimiRuntimeLocalEnvironmentClient` 面向具备相应访问权限的宿主与系统集成。普通 App 的 `NimiLocalAppClient` 不提供通用环境安装或管理接口；导入类型或另建直连客户端不会赋予这些权限。

App 应使用既有宿主客户端的 AI 配置与调用结果，引导用户在 Nimi Home 中准备所需资源。不要在 App 中另建平台模型安装器，或扫描文件、Python 环境和引擎端口来猜测平台状态。

## 宿主可以呈现什么

- Runtime 返回的模型资产、完整性检查、下载与依赖任务进度。
- 环境安装计划、用户确认要求，以及契约允许的取消、重试与修复动作。
- 已保存候选 Loadout 的环境计划和版本条件；发生冲突时按返回状态重新读取。

这些信息不等于模型已被选中，也不替代 AIConfig 路由、Loadout 选择、执行绑定或能力准入。看到文件已经下载，仍不能据此承诺一次推理会成功。

## 保持集成边界

使用公开导出和对应的类型化客户端，不导入 `runtime/internal/**`、`kit/internal/**` 或其他 App 的业务源码。安装失败、状态未知与资源不可用应各自如实显示，不能合成为“已就绪”。

## Source Basis

- [`.nimi/spec/sdks/feature-clients.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/feature-clients.authority.yaml)
- [`.nimi/spec/sdks/client-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/client-core.authority.yaml)
