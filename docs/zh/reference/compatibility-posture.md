# 兼容性准则与版本发布策略（Compatibility & Versioning）

为了保证分布式系统长期演进的稳定性与可维护性，Nimi 制定了清晰的组件兼容性矩阵与语义化版本发布准则。

## 开发期依赖与版本匹配

在日常应用开发中，建议统一使用官方验证过的依赖组合（如 App Tools、SDK、Kit 及对应的 Runtime 版本）：
- **工具链协同**：TypeScript 编译通过仅验证了前端类型匹配；运行时行为的稳定还依赖于本地 Runtime 服务与原生扩展包保持版本一致。
- **本地包覆盖机制**：在源码开发或预发布阶段，推荐使用 `pnpm-workspace.yaml` 中的 overrides 指向配套的本地交付包，确保各组件处于同一测试基准线。

## 正式发布包的不可变性

- **语义化版本（SemVer）**：一旦包正式发布至公共仓库或打上 Git 发布标签（Release Tag），该版本产物严格不可变。
- **破坏性变更指引**：在 0.x 阶段（当前 SDK 与 Kit 所处周期），不兼容的架构调整通过递增次版本号（Minor，如 0.18 -> 0.19）发布并附带详细迁移指引，1.0.0 需待平台正式成熟度决议后单独发布；在 1.0+ 阶段，破坏性变更严格按照语义化版本（SemVer）递增主版本号。
- **组件独立演化**：SDK、Kit、App Tools 与桌面端 Shell 拥有独立的发布节奏，通过显式的依赖契约保持解耦。

## 严格契约校验与错误排查

- **参数显式校验**：当传入非法输入、未获授权或不支持的参数组合时，系统直接返回类型安全的错误代码与诊断详情。
- **故障恢复最佳实践**：网络临时波动在幂等操作前提下可通过传输重试恢复；对于外部副作用未确认的操作，须先行核实已有任务或调用状态，严禁盲目循环重试。参数或 Schema 校验失败等契约错误默认阻断（fail-closed），必须在代码层面修正入参或契约。

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/platform/governance-release.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/governance-release.authority.yaml)
- [`.nimi/spec/platform/product-lifecycle.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/product-lifecycle.authority.yaml)
