# Runtime 集成者指南

如果你正在将 `nimi-runtime` 集成到宿主应用、启动器或托管环境中，请参照本指南。

## 核心集成点

- 进程生命周期：启动/停止/健康检查
- 端点接入：gRPC + HTTP 健康检查
- 路由策略和 Provider 密钥配置
- 审计和错误可观测性

## 最小宿主检查项

1. Runtime 进程在 gRPC 端点上可达。
2. `/v1/runtime/health` 返回健康状态。
3. `nimi doctor --json` 报告 daemon、Provider 和模型状态均正常。
4. 首次 AI 调用通过 `nimi run "<prompt>"` 或等效的 SDK 调用成功完成。

## 推荐运维实践

- 按部署环使用固定的 runtime 版本。
- 保持模型/Provider 配置声明式管理。
- 优先使用 `nimi provider set` 或环境变量支持的凭据，避免应用级密钥分散。
- 通过 `traceId` 传播聚合日志。

如果你是从源码检出进行集成而非使用已安装的二进制文件，请在 `runtime/` 目录下通过 `go run ./cmd/nimi ...` 运行相同的命令。

参见 [Runtime 参考](../reference/runtime.md) 和 [Provider 矩阵](../reference/provider-matrix.md)。
