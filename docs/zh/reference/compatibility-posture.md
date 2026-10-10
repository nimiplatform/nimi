# 兼容性与版本变化

使用相互匹配的 Runtime、SDK、Kit 和原生载体。TypeScript 对某版 SDK 编译通过，不代表更旧的宿主或原生包承载相同契约。

## 当前开发

本指南描述当前工作区。预发布开发阶段直接删除被替代的内部接口，不保留隐藏兼容层、双路径或启动时自动迁移。旧本地测试数据需要处置时，使用对应 owner 或一次性修复流程，不能删除无关用户状态。

当前开发包可以通过完整本地归档交付。保留版本声明，使用明确的包管理器 override，再完成 App 同步、安装和检查。见 [开发环境](/zh/start/install)。

## 已发布组件

已发布包和 release tag 不可变。公开破坏性变更需要对应组件版本及升级说明；内部预发布硬切规则不会取消已发布约束。SDK、Kit、App Tools 与 shell 组件各自独立发布。

## 契约失败

无效输入、不支持的操作组合、缺少授权或非法返回数据，均以强类型错误拒绝。重试和重连不能修复契约违例、保证生成重放，或在外部结果不确定时授权重新提交。

异步恢复保留并观察原 Job 及其完整结果。需要新能力时更新匹配的载体组合，不新增私有传输或 Provider 直连。

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/platform/governance-release.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/governance-release.authority.yaml)
- [`.nimi/spec/platform/product-lifecycle.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/product-lifecycle.authority.yaml)
- [`.nimi/spec/runtime/service-operations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/service-operations.authority.yaml)
- [`.nimi/spec/runtime/model-catalog.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/model-catalog.authority.yaml)
- [`.nimi/spec/runtime/ai-provider.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/ai-provider.authority.yaml)
