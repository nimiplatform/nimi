# 使用 Nimi Lab

`apps/lab/` 是 Nimi 官方的能力实验台（Capability Workbench）。作为一个完整的 Nimi App，它集成了 SDK、Kit、Runtime、Realm 与 App Tools 的最新能力，方便开发者在新特性正式纳入项目模板前，先行体验端到端流程并验证集成方案。

Nimi Lab 可作为平台能力集成的参考实现。其中涉及的权限校验、会话令牌、模型调度与数据持久化等核心机制，均严格遵循平台统一的架构边界与安全契约。

## 运行与调试

按[开发环境安装](/zh/start/install)完成准备，启动 Runtime 和 Nimi Home 并登录后，在仓库根目录的另一个终端执行：

```bash
pnpm dev:lab
```

若在 `apps/lab/` 目录下操作，可使用以下常用工程脚本：

```bash
pnpm dev:shell      # 在官方 Electron 宿主容器中启动应用
pnpm run validate   # 校验 App 清单与访问声明
pnpm run typecheck  # 运行 TypeScript 类型检查
pnpm run test       # 运行单元测试与集成测试
```

在 Windows 和 macOS 上，Nimi Lab 运行在桌面端监管的 Electron 开发环境中。本地开发构建可通过 Nimi Home 的开发者模式（Developer Mode）完成注册并检查访问就绪状态。Lab 直接在根工作区维护，不运行脚手架 init/sync，也没有公开发布流程。

## 关键代码与架构参考

| 探索方向 | 对应源码路径 |
| --- | --- |
| 工作区脚本与本地检查 | `apps/lab/package.json` |
| 受保护的 Shell 宿主通信与路由 | `apps/lab/README.md` 与 shell 路由模块 |
| AIConfig 存储与应用数据隔离 | `apps/lab/src/lab/lab-ai-config-store.ts` |
| 基于能力意图（Capability Intent）的 Runtime AI 调度 | `apps/lab/src/lab/lab-runtime.ts` |
| 结构化错误处理与异常状态映射 | `apps/lab/src/lab/lab-non-success.ts` |
| AI 配置面板 UI 组件设计 | `apps/lab/src/lab/workbench/lab-ai-config-settings-panel.tsx` |
| 平台契约一致性测试套件 | `apps/lab/test/lab-contract/` |

## 实践要点

- **保持应用身份独立**：应用标识 `nimi.lab` 专属于 Nimi Lab；开发自定义应用时必须声明独立的唯一 App ID。
- **隔离测试数据与夹具**：Lab 中的测试夹具（fixtures）、模拟数据与诊断信息仅用于探索与调试，自研应用应根据业务需求设计独立的数据模型。
- **按需渐进式引入**：建议先在 Lab 中评估和验证新能力，再结合自身产品场景，将成熟的实现模式迁移到自己的应用中。
- **提供可操作的状态引导**：参考 Lab 的交互方式，向用户展示结构化的运行状态（例如提示启动服务或检查访问状态），在流程受阻时给出明确的下一步操作指引。

## 常见状态反馈对照

| 状态码 | 业务含义 | 推荐提示方案 |
| --- | :--- | :--- |
| `runtime-unavailable` | 本地 Runtime 服务未响应。 | 检查本地 Runtime 与 Nimi Home 是否已启动。 |
| `principal-unauthorized` | 当前会话或调用主体未获准执行该操作。 | 检查 Nimi Home 的登录与该应用的 Nimi Access 状态，并核对 `nimi.app.yaml` 中所需的访问声明；AI 调用需要 `runtime.consume`。 |
| `input-invalid` | 输入参数或提示词缺失、格式不合规。 | 提示用户检查必填参数与输入格式。 |
| `sdk-method-unavailable` | 当前构建版本未暴露该能力。 | 提示更新 SDK 依赖包版本。 |
| `runtime-call-failed` | 请求处理过程中发生底层错误。 | 展示清晰的错误说明，并保留诊断日志供排查。 |

## Source Basis

- [`apps/lab/README.md`](https://github.com/nimiplatform/nimi/blob/main/apps/lab/README.md)
- [`apps/lab/src/lab/lab-runtime.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/lab/src/lab/lab-runtime.ts)
- [`apps/lab/src/lab/lab-ai-config-store.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/lab/src/lab/lab-ai-config-store.ts)
- [`apps/lab/src/lab/lab-non-success.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/lab/src/lab/lab-non-success.ts)
