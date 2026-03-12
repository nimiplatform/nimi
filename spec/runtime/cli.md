# Runtime CLI Onboarding Spec

> Scope: `nimi` 首次安装、首次运行、provider-first cloud setup 与 author tooling 边界导引。
> Normative Imports: `spec/runtime/kernel/*`

## 0. 权威导入

- `kernel/cli-onboarding-contract.md`（K-CLI-001, K-CLI-002, K-CLI-003, K-CLI-005, K-CLI-007, K-CLI-008, K-CLI-009, K-CLI-009a, K-CLI-010, K-CLI-011, K-CLI-012, K-CLI-013, K-CLI-014, K-CLI-015）
- `kernel/daemon-lifecycle.md`（K-DAEMON-001, K-DAEMON-003, K-DAEMON-008）
- `kernel/model-service-contract.md`（K-MODEL-001, K-MODEL-006）
- `kernel/provider-health-contract.md`（K-PROV-001, K-PROV-005）
- `kernel/config-contract.md`（K-CFG-001, K-CFG-005, K-CFG-006）
- `kernel/error-model.md`（K-ERR-001, K-ERR-004）

## 1. 文档定位

本文件只负责 `nimi` CLI 首次使用主题导航与 runtime / author tooling 边界导引。命令集合、错误语义、prompt-first `run`、default local / provider default targeting、provider-first cloud setup 与作者入口边界以 kernel 规则为准。

background runtime management surface 的权威语义也在 `kernel/cli-onboarding-contract.md`：`serve` 为 foreground canonical command；`start/stop/status/logs` 为 background management surface；`health` 保持详细健康投影。

## 2. 关键阅读路径

1. 首次使用命令与 happy path：`kernel/cli-onboarding-contract.md`。
2. daemon 生命周期与健康语义：`kernel/daemon-lifecycle.md`。
3. local model 安装 / 状态：`kernel/model-service-contract.md`。
4. provider 探测与 canonical 命名：`kernel/provider-health-contract.md`。
5. 配置路径与 secret policy：`kernel/config-contract.md`。
6. public surface 错误映射：`kernel/error-model.md`。
7. author scaffolding / build flow：`pnpm dlx @nimiplatform/dev-tools nimi-app create` 与 `pnpm dlx @nimiplatform/dev-tools nimi-mod ...`，不属于 runtime public surface。

## 3. 模块映射

- CLI entrypoints：`runtime/cmd/nimi/`
- 配置与写入：`runtime/internal/config/`
- daemon / gRPC bridge：`runtime/internal/entrypoint/`

## 4. 非目标

- 不在 domain 层定义命令 flag 细节或模板文件逐行内容。
- 不在本文件记录安装脚本或 npm 发布的执行态结果。
