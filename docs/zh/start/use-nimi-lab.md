# 使用 Nimi Lab

`apps/lab/` 是 Nimi 官方的能力实验台（Capability Workbench）。它作为一个完整的真实 Nimi App，集成了 SDK、Kit、Runtime、Realm 与 App Tools 的最新能力特性，供开发者在功能正式纳入脚手架推荐前进行端到端体验与集成验证。

Nimi Lab 展现了平台能力的集成范式。对于权限控制、会话管理、模型调度及数据持久化，各层依旧严格遵循平台统一的职责边界与安全契约。

## 运行与调试

在源码仓库根目录下执行：

```bash
pnpm dev:lab
```

`apps/lab/` 中提供的常用工作流命令包括：

```bash
pnpm run init       # 初始化项目与受管配置
pnpm dev:shell      # 启动官方 Electron 开发容器
pnpm run validate   # 检查 App 清单与访问声明
pnpm run typecheck  # 检查 TypeScript 类型
pnpm run test       # 运行单元测试与集成测试
```

在 Windows 和 macOS 上，Nimi Lab 默认在受桌面端托管的 Electron 调试环境中运行。本地开发版本可通过 Nimi Home 的开发者模式（Developer Mode）进行注册与权限授予。

## 关键代码与架构参考

| 探索方向 | 对应源码路径 |
| --- | --- |
| 脚手架脚本与本地检查配置 | `apps/lab/package.json` |
| 受保护的 Shell 容器交互与路由 | `apps/lab/README.md` 与 shell 路由文件 |
| AI 配置存储与应用归属隔离 | `apps/lab/src/lab/lab-ai-config-store.ts` |
| 基于能力意图（Capability Intent）的 Runtime AI 调度 | `apps/lab/src/lab/lab-runtime.ts` |
| 结构化错误处理与异常状态映射 | `apps/lab/src/lab/lab-non-success.ts` |
| AI 配置面板组件设计 | `apps/lab/src/lab/workbench/lab-ai-config-settings-panel.tsx` |
| 平台契约一致性测试用例 | `apps/lab/test/lab-contract/` |

## 实践要点

- **应用身份独立**：Nimi Lab 使用的应用标识（`nimi.lab`）专属于该实验台，自定义应用应使用唯一的独立 App ID。
- **配置与数据隔离**：Lab 中的测试数据、模拟夹具（Fixtures）与诊断信息仅用于演示，开发自己的应用时请建立独立的领域模型。
- **循序渐进集成**：在 Lab 中探索新技术特性后，可结合业务场景，参考其模式在自己的应用中逐步落地。
- **结构化状态反馈**：建议借鉴 Lab 中的做法，为用户呈现清晰具体的环境状态（如提示启动 Runtime、引导授权），提升应用体验。

## 常见状态反馈对照

| 状态码 | 业务含义 | 推荐提示方案 |
| --- | --- | --- |
| `runtime-unavailable` | 本地 Runtime 服务不可用。 | 提示用户启动或重启 Nimi 桌面端服务。 |
| `permission-required` | 当前功能所需的权限未被授予。 | 引导用户在 Nimi 桌面端授权窗口中点击同意。 |
| `input-invalid` | 输入参数或提示词缺失/不合规。 | 提示用户检查输入内容。 |
| `sdk-method-unavailable` | 当前构建版本未包含该能力。 | 提示检查 SDK 版本更新。 |
| `runtime-call-failed` | 底层服务处理失败。 | 提供友好的错误反馈并记录调试日志。 |

## Source Basis

- [`apps/lab/README.md`](https://github.com/nimiplatform/nimi/blob/main/apps/lab/README.md)
- [`apps/lab/src/lab/lab-runtime.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/lab/src/lab/lab-runtime.ts)
- [`apps/lab/src/lab/lab-ai-config-store.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/lab/src/lab/lab-ai-config-store.ts)
- [`apps/lab/src/lab/lab-non-success.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/lab/src/lab/lab-non-success.ts)
