# 凭据来源解析

> 状态：Runtime 管理的凭据保管。

Runtime 只会在调用者和请求能力通过准入后解析 provider 凭据。普通 App 请求不选择凭据来源，也不携带 connector id、provider id、endpoint、API key 或凭据 metadata。

## 保管边界

| 关注点 | 归属 |
| --- | --- |
| Provider 凭据或凭据引用 | Runtime 配置 |
| Connector 身份和生命周期 | Runtime |
| 凭据解密及 Driver 注入 | Runtime |
| 调用者和能力准入 | Runtime protected session |
| App 请求内容 | 调用者身份、场景内容、受支持参数 |

Desktop 和 CLI 可以通过已准入的机器管理命令配置凭据。该管理流程与能力执行相互独立，不会向 renderer 返回 secret，也不会向 App 提供 connector selector。

## Runtime 解析过程

对于已准入的 Cloud 能力，Runtime 按固定的内部顺序处理：

1. 校验 protected caller identity 和 App authorization。
2. 校验规范能力请求。
3. 读取 Runtime 拥有的机器配置和已准入 provider 目录。
4. 选择可用实现及其凭据记录。
5. 在 Runtime 内部校验 endpoint 和凭据策略。
6. 通过内部执行上下文把凭据交给所选 Driver。
7. 从诊断和审计输出中删除 secret 信息。

下游 Driver 只接收 Runtime 选定的凭据。App 和 SDK adapter 不能读取凭据存储，也不能覆盖所选记录。

## 管理输入

凭据管理命令可以接收 secret，或接收宿主 secret store 的引用。该命令必须经过受保护的管理表面，校验准确 owner，并且只返回不含 secret 的状态。这些输入不会成为 text、embedding、image、video、speech 或 Agent 执行请求的字段。

Generated transport type 仍可能包含已退休的 connector 或 inline key 字段。手写 SDK 和 App 调用层会省略它们。通过无类型对象传入这些字段时，调用应被拒绝，不能将其当作兼容路径。

## 读者场景：配置 Cloud 执行

1. 机器管理员在 Desktop 或 CLI 中打开 Runtime 配置。
2. 管理员配置已准入的 provider 凭据。
3. Runtime 校验凭据并按自身保管边界保存。
4. App owner 在 `AIConfig` 中记录 Cloud 能力意图，不指定 provider 或 connector。
5. App 只携带身份、场景内容和受支持参数调用能力。
6. Runtime 在内部选择实现和凭据，并返回强类型结果或失败。

App 不会收到原始 key，也不会获得本次执行使用的 connector 身份。

## 读者场景：凭据缺失

1. App 发起不含执行控制项的 Cloud 能力请求。
2. Runtime 找不到可供已准入实现使用的有效凭据记录。
3. Runtime 返回强类型配置或 authorization failure。
4. App 保留该失败，不注入 inline key，不选择 connector，也不伪造 Local fallback。
5. 机器管理员通过独立管理界面修复 Runtime 配置。

## 公共边界

- 普通 App 和 Agent 请求不包含 credential-source metadata。
- Connector id、provider id、endpoint、API key 和 provider 原生句柄都属于 Runtime 配置。
- `AIConfig` 的 Cloud 意图不标识凭据或具体实现。
- 凭据解析和 Driver 注入只由 Runtime 完成。
- Secret 或凭据相关数据不得进入规整结果、诊断、日志或 App 存储。

## 来源依据

- [`.nimi/spec/runtime/security-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/security-core.authority.yaml)
- [`.nimi/spec/runtime/app-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/app-surface.authority.yaml)
