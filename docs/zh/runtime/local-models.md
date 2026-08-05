# 本地模型

Runtime 可以通过机器本地引擎和资源提供已准入的 AI 能力。本地引擎、已安装模型 bundle、设备兼容性和实现选择都归 Runtime 所有。App 只表达 Local 能力意图，不选择 model 或 engine。

Cloud 机器配置见 [Connector 与 Provider](/zh/runtime/connectors-and-providers)。

## Runtime 拥有的选择过程

| 步骤 | 归属 |
| --- | --- |
| 安装 engine 和资源 metadata | Runtime 管理面 |
| 校验 package 完整性和设备兼容性 | Runtime |
| 判断可用实现 | Runtime |
| 调度设备资源 | Runtime |
| 为请求选择实现 | Runtime |

Bundle 的目录身份只是安装事实，不是请求 target。安装或查看 bundle 不会创建 App 可见的 binding，也不保证 Runtime 在下一次请求中使用它。

## Engine 与资源目录

Runtime 目录描述已准入的 engine family、asset kind、package 完整性、能力和兼容约束。Desktop 和 CLI 可以为机器管理呈现这些目录。

| 目录事实 | 用途 |
| --- | --- |
| Engine family 和 runtime mode | 描述 Runtime 如何托管 engine |
| Asset kind 和能力 metadata | 描述资源的已准入用途 |
| 完整性身份 | 校验准确的已安装内容 |
| 设备要求 | 拒绝不兼容的安装或执行 |
| Runtime 推荐证据 | 帮助用户选择要安装的资源 |

客户端保持 Runtime 给出的推荐顺序，不根据 tag 或 metadata 为模型打分、分级或重新排序。

## 设备兼容性

Runtime 检测 CPU、加速器、内存和存储情况，并据此校验安装和调度执行。Package 违反已准入设备约束时，会返回强类型失败原因。

设备诊断属于机器管理证据。App 不接收单模型 readiness、warming 或 health 表面，也不能通过设备探针选择执行实现。

## 安装流程

1. **浏览。** Desktop 或 CLI 读取 Runtime 的已准入目录。
2. **选择要安装的资源。** 该选择只影响机器资源清单。
3. **下载并校验。** Runtime 校验来源、内容身份和 package 结构。
4. **注册。** Runtime 记录已安装资源和所需的 engine metadata。
5. **呈现结果。** 管理界面展示强类型进度或失败。

任意 URL 和未校验文件不能直接执行。导入和下载路径必须满足 Runtime 的目录、路径准入和完整性规则。

## 能力执行

1. 对应 App 或 Agent owner 在 `AIConfig` 中为已准入能力记录 Local 意图。
2. 调用者只提交身份、场景内容和受支持的操作参数。
3. Runtime 评估已安装资源、设备状态、策略、预算和当前资源压力。
4. Runtime 选择已准入实现，或返回强类型失败。
5. Runtime 诊断可以记录实际执行情况，但调用者不能用它固定下一次请求。

SDK 规整结果不依赖 Runtime 最终选择 Local 还是 Cloud 实现。

## 读者场景：安装文本生成资源

1. 机器管理员打开本地模型中心。
2. Runtime 按自身顺序返回目录和推荐证据。
3. 管理员选择要安装的兼容资源 bundle。
4. Runtime 下载、校验并注册 bundle，或返回强类型失败原因。
5. 后续 App 请求不包含 model、engine、route、connector 或 target。
6. Local 意图和当前机器状态允许执行时，Runtime 可以选择已安装实现。

## 读者场景：设备约束

1. 所选 bundle 需要的资源超过机器能力。
2. Runtime 以强类型设备证据拒绝安装或执行。
3. Desktop 或 CLI 展示 Runtime 原因，不宣称模型已就绪。
4. 管理员可以安装其他兼容资源或修改机器配置。
5. App 请求契约保持不变。

## 读者场景：多引擎

Runtime 可以在同一台机器上管理多个 engine family，并在内部仲裁共享的加速器和内存资源。Text、image、audio 等 App 请求仍然以能力为单位；App 不把请求路由到某个 engine，也不协调 engine 并发。

## 依赖装配

部分 engine 需要额外机器依赖。Runtime 通过已准入 materializer 完成下载、校验、安装、取消和清理。Desktop 可以展示强类型操作进度和失败，但不会执行任意 shell 命令，也不会把依赖进度投影成 App execution readiness。

## 公共边界

- 本地 model 和 engine 目录属于 Runtime 机器配置。
- 安装资源不等于 model activation、warming 或 request binding。
- App 只携带 Local 能力意图，不携带 model、engine、route、connector、target、readiness、health 或 fallback 控制。
- 兼容性、调度和实现选择都归 Runtime 所有。
- 推荐和执行诊断始终是 Runtime 提供的证据。

## 来源依据

- [`.nimi/spec/runtime/local-compute.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/local-compute.authority.yaml)
- [`config/runtime-local-engine-catalog.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/runtime-local-engine-catalog.yaml)
- [`config/runtime-local-adapter-routing.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/runtime-local-adapter-routing.yaml)
- [`.nimi/spec/runtime/security-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/security-core.authority.yaml)
- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
