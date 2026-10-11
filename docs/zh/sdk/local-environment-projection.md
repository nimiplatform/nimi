# 本地环境状态投射

> 规范状态：核心能力契约已标准化；对外能力以 SDK 官方发布的导出接口为准。

本地环境状态投射规范了**应用程序如何通过 SDK 安全读取底层 Runtime 判定的本地运行环境与依赖就绪状态**，并明确禁止应用通过旁路探测进行盲目猜测或越权穿透。

## 规范导出边界

所有受支持的公开能力必须通过 SDK 明确声明的包导出（Package Exports）与强类型的客户端接口提供。其产品语义严格遵循平台核心规范，应用不得通过非正式的路径约定发明未经支持的私有导出。

## 核心禁止访问路径

| 禁止访问的路径 | 限制原因与安全考量 |
| --- | --- |
| `runtime/internal/**` | Runtime 私有内部实现；应用必须通过标准 SDK 客户端交互 |
| `kit/internal/**` | Kit 内部私有实现，不提供跨版本向后兼容保证 |
| 其他 App 的业务源码 (`apps/**`) | 应用之间保持松耦合，严禁跨项目依赖其他 App 的业务层内部实现 |

## 典型场景：应用查询本地环境依赖计划

应用希望向用户展示当前环境的模型与运行时就绪计划：

1. **初始化客户端**：使用标准 SDK 客户端或 `@nimiplatform/sdk/runtime` 模块。
2. **查询投射状态**：通过规范的本地环境查询辅助函数读取环境安装计划、依赖资源项、激活状态门禁以及前置 Job 进度。
3. **维护权威单一可信源**：SDK 忠实返回 Runtime 判定的强类型状态；严禁在前端绕过平台，通过探测本地文件目录、Python 解释器路径、`PATH` 环境变量或私自轮询引擎端口来猜测就绪状态。
4. **废弃兼容路径拦截**：未在当前版本正式发布的旧版实验性子路径（如私有 `local-env` 路径）将被构建工具与拦截器直接阻断。

若应用试图编写类似 `import { internal } from '@nimiplatform/sdk/runtime/internal'` 的代码，静态检查与运行时防护将直接阻断构建。

## 核心设计红线

- 严禁业务应用直接侵入 `runtime/internal/**`。
- 严禁绕过 SDK 私自穿透 Runtime 底层接口。
- 严禁在应用层代码中私自维护并行的本地依赖安装器与状态机。
- 严禁脱离官方规范通过临时路径约定私加接口。

## Source Basis

- [`.nimi/spec/sdks/feature-clients.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/feature-clients.authority.yaml)
- [`.nimi/spec/sdks/client-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/client-core.authority.yaml)
