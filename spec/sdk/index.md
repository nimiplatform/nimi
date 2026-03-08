# SDK Specification

> Scope: `@nimiplatform/sdk` 全量规范索引。

## 1. 范围

本目录定义 Nimi SDK 的领域规则与跨域治理契约。SDK 是 Desktop/Web 与 Runtime/Realm 之间的唯一调用通道。

## 2. Domain Documents

| 文档 | 包子路径 | 说明 |
|---|---|---|
| [runtime.md](runtime.md) | `@nimiplatform/sdk/runtime` | Runtime SDK 投影（初始化、模块编排、gRPC/Tauri IPC 传输） |
| [ai-provider.md](ai-provider.md) | `@nimiplatform/sdk/ai-provider` | AI Provider SDK 投影（AI SDK v3 适配与 runtime 调用映射） |
| [realm.md](realm.md) | `@nimiplatform/sdk/realm` | Realm SDK 投影（REST/WS facade、OpenAPI codegen） |
| [scope.md](scope.md) | `@nimiplatform/sdk/scope` | Scope SDK 投影（catalog 生命周期与授权前置联动） |
| [mod.md](mod.md) | `@nimiplatform/sdk/mod` | Mod SDK 投影（host 注入、hook 聚合、UI/i18n/settings facade） |
| [types.md](types.md) | `@nimiplatform/sdk/types` | 共享类型导出（错误、scope、external principal 等） |

## 3. Kernel 治理层

跨域契约定义在 [kernel/](kernel/index.md)，包含：

- `S-SURFACE-*` — SDK 子路径、导出面、Runtime 方法投影分组
- `S-TRANSPORT-*` — Runtime/Realm 传输模型、metadata 映射、流行为边界
- `S-ERROR-*` — Runtime/Realm 错误投影、SDK 本地错误码与重试语义
- `S-BOUNDARY-*` — 跨包导入边界与禁止路径

结构化事实源：`kernel/tables/*.yaml`；生成视图：`kernel/generated/*.md`。

## 4. 跨域依赖关系

```
ai-provider → runtime   (继承 runtime transport，并通过 runtime 实例发起调用)
scope → runtime          (通过公开 runtime SDK 接口联动授权)
realm                    (独立，仅依赖 kernel 规则)
mod                      (独立，通过 host 注入获取能力)
```

- `ai-provider` 必须持有 `runtime` 实例才能发起 RPC；transport 与 metadata 语义继承自 runtime。
- `scope` 与 runtime 授权调用的联动仅通过公开 runtime SDK 接口，不引入私有依赖。
- `realm` 与 `mod` 各自独立，不依赖其他 domain SDK。

## 5. 服务阶段概览

| 阶段 | Domain | 说明 |
|---|---|---|
| Phase 1 (Active) | runtime, realm, ai-provider | 核心调用链已实现（含 ConnectorService 7 方法），spec 达到冻结就绪 |
| Phase 2 (Active) | scope, mod | 领域约束已定义，API 面待补充 |

> 此处 Phase 指 SDK 域级激活阶段。runtime 域内各服务有独立的服务级 phase 分类，见 `kernel/tables/runtime-method-groups.yaml`。
