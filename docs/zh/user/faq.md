# 常见问题

## 通用

### Nimi 是什么？

Nimi 是一个开源 AI 运行时，为本地和云端 AI 提供统一的操作界面。安装后启动运行时，即可使用相同的命令调用本地模型或云端 Provider 进行生成。

### Nimi 是免费的吗？

是的。运行时、SDK、桌面应用、Web 客户端和文档全部开源。Realm（云端状态后端）是托管服务。

### Nimi 支持哪些平台？

运行时 CLI 支持 macOS 和 Linux。桌面应用支持 macOS、Windows 和 Linux。

### 需要联网吗？

不需要。本地模型完全在你的机器上运行。云端 Provider 需要互联网连接。

## 运行时

### 如何启动运行时？

运行 `nimi start` 以后台模式启动，或运行 `nimi serve` 以前台模式启动并查看日志。

### 如何检查运行时是否健康？

运行 `nimi doctor` 进行完整的环境检查，或运行 `nimi status` 查看进程和连接状态。

### 可以只使用云端 Provider 而不安装本地模型吗？

可以。使用 `nimi run "..." --provider gemini` 直接将请求发送到云端 Provider，无需安装任何本地模型。

## Provider

### 如何添加云端 Provider？

运行 `nimi provider set <provider> --api-key-env <ENV_VAR> --default`，通过环境变量保存 Provider 的 API key。然后使用 `nimi run "..." --cloud` 调用已保存的默认 Provider。

### 支持哪些云端 Provider？

完整列表请参阅 [Provider 矩阵](../reference/provider-matrix.md)。主要 Provider 包括 OpenAI、Anthropic、Gemini、DeepSeek、DashScope 等。

## 开发

### 可以不使用 realm 而单独使用 runtime 吗？

可以。Runtime 和 realm 是独立的，你可以单独集成其中一个或同时使用两者。

### 可以开发自己的客户端代替桌面应用吗？

可以。Desktop 是第一方应用，而非特权平台路径。你可以使用 SDK 构建自己的客户端。

### 可运行的示例在哪里？

所有示例位于 `/examples` 目录下，并在 CI 中进行编译检查。

### Realm 是开源的吗？

Runtime、SDK、Proto、Desktop、Web 和文档均为开源。Realm 后端是托管/闭源的。

### 权威的规则文档在哪里？

参考 `spec/` 获取规范性合约，参考本文档站点获取面向开发者的指导。
