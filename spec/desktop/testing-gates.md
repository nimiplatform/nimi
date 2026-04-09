# Desktop Testing Gates

> Normative Imports: `spec/desktop/kernel/*`

## 0. 权威导入

- `kernel/testing-gates-contract.md`（D-GATE-001, D-GATE-010, D-GATE-020, D-GATE-030, D-GATE-040, D-GATE-050, D-GATE-060, D-GATE-070, D-GATE-080）
- `kernel/bootstrap-contract.md`（D-BOOT-001, D-BOOT-008, D-BOOT-012）
- `kernel/ui-shell-contract.md`（D-SHELL-001, D-SHELL-006, D-SHELL-008）
- `kernel/bridge-ipc-contract.md`（D-IPC-001, D-IPC-002, D-IPC-009, D-IPC-014, D-IPC-015）
- `kernel/offline-degradation-contract.md`（D-OFFLINE-001, D-OFFLINE-004）
- `kernel/tables/desktop-testing-gates.yaml`
- `kernel/tables/desktop-feature-coverage.yaml`
- `kernel/tables/rule-evidence.yaml`

## 1. 文档定位

Desktop 规范验收门禁与执行证据契约，覆盖 kernel 规则集合 `D-*` 的可追踪性与发布前强制检查。

本文件是 desktop testing gate 的 thin guide。真正的 gate 分层、风险规则、OS matrix 与 release parity 由 `kernel/testing-gates-contract.md` 定义；功能覆盖矩阵由 `kernel/tables/desktop-feature-coverage.yaml` 定义。

## 2. Kernel References

### Rule Traceability (D-GATE-080, D-BOOT-001, D-ERR-007, D-STATE-001, D-NET-002)

- 全量 `D-*` 规则必须在 `spec/desktop/kernel/tables/rule-evidence.yaml` 中存在唯一证据条目。
- `status=covered` 必须绑定可执行门禁（`command`）且证据路径可解析到真实文件。
- `status=na` 必须提供可校验 `na_reason`。

### Gate Set & Feature Coverage (D-GATE-001, D-GATE-040, D-GATE-080)

- desktop gate 集合的唯一事实源为 `kernel/tables/desktop-testing-gates.yaml`。
- 用户可见功能的 risk-tiered coverage 唯一事实源为 `kernel/tables/desktop-feature-coverage.yaml`。
- `P0/P1` 功能若声明 `desktop_e2e_*` 层，必须映射到真实 E2E 场景文件。

### Consistency Gate (D-GATE-080, D-BOOT-003)

- `pnpm check:desktop-spec-kernel-consistency` 必须校验：
  - kernel 规则全集
  - `rule-evidence.yaml` 证据映射
  - `desktop-testing-gates.yaml` gate 集合
  - `desktop-feature-coverage.yaml` 功能风险矩阵
  - 证据路径文件存在性

### Drift Gate (D-GATE-080, D-BOOT-002)

- `pnpm check:desktop-spec-kernel-docs-drift` 必须覆盖 `rule-evidence.yaml` 对应生成视图漂移。

### Desktop E2E Gate (D-GATE-030, D-GATE-040, D-GATE-060, D-GATE-070)

- Linux PR 必须运行 desktop E2E smoke gate。
- nightly / release 必须运行完整 journey 集合，并保持不低于 PR 的标准。
- macOS 的 `menu-bar hide vs quit` 只作为本地 / 手工 smoke，不计入阻塞式 desktop WebDriver gate。
- macOS manual smoke checklist:
  - packaged app 首次启动可进入主壳或登录页，无白屏、无 crash loop
  - menu-bar `Hide` 不得触发进程退出，`Quit` 必须彻底退出
  - runtime unavailable strip 与 settings 跳转路径可见
  - bundled runtime/version strip 在 release 包上可读且无明显错配
  - failure evidence 必须记录到 `nimi-coding/.local/report/**`，不伪装成自动化覆盖

### Supplementary Hard-Cut Gates (D-BOOT-001, D-HOOK-009, D-IPC-011, D-IPC-012, D-MOD-002, D-CODEGEN-010)

- `rule-evidence.yaml` 可为 canonical runtime config path、runtime-only cloud routing、runtime-aligned mod/hook surface、local-ai bridge 命令边界、manifest capabilities-only policy 绑定额外静态 gate。
- 这些 hard-cut gate 不替代 lint/test/e2e，只负责阻断 legacy surface 回流。

### Self-Update Hard-Cut Coverage (D-BOOT-001, D-IPC-002, D-IPC-014, D-IPC-015)

- desktop self-update 必须覆盖三类验证：
  - Rust/Tauri：release info fail-close、bundled runtime `nimi version --json` 真值校验、running/not-running version probe 优先级、download/install 两阶段 updater 状态机、stop/update 前后的 channel invalidation。
  - Renderer/Web adapter：packaged desktop exact-match gate、`desktopReleaseError` 在 strip 与设置页可见、web adapter unsupported fail-close、update banner/status i18n。
  - Release scripts/CI：`check:version-sync`、`check:desktop-release-sync`、updater artifacts `latest.json` / `.sig` / 平台 bundle 类型校验。
- release workflow 若缺少 runtime archive、release manifest、updater signature、public key、endpoint，必须 fail-close。
- desktop dry-run CI 必须在 Linux / macOS / Windows 三平台执行 bundled runtime 准备、release resource 校验、updater 产物校验，并上传 dry-run 产物供审计。

### Offline / Degradation Coverage (D-OFFLINE-001, D-OFFLINE-004)

- 离线降级与重连冲突策略的规范源为 `kernel/offline-degradation-contract.md`。
- 其 formal evidence 仍统一登记在 `spec/desktop/kernel/tables/rule-evidence.yaml`，不在 domain 文档复制第二套 gate 清单。

## 3. Verification Coverage

- `pnpm check:desktop-spec-kernel-consistency`
- `pnpm check:desktop-spec-kernel-docs-drift`
- `pnpm check:desktop-e2e-smoke`
- `pnpm check:desktop-e2e-journeys`
- `pnpm --filter @nimiplatform/desktop run check:version-sync`
- `pnpm --filter @nimiplatform/desktop run check:desktop-release-sync`
- `pnpm --filter @nimiplatform/desktop lint`
- `pnpm --filter @nimiplatform/desktop test`
- `pnpm check:desktop-mods-smoke --all`
- `pnpm check:runtime-mod-hook-hardcut`
- `pnpm check:desktop-cloud-runtime-only`
- `pnpm check:desktop-no-legacy-runtime-config-path`
- `pnpm check:no-local-ai-private-calls`
- `pnpm check:no-local-ai-tauri-commands`
- `pnpm check:no-legacy-mod-permissions-field`

Mod-specific deterministic/live E2E 应位于各自 mod 仓，不属于 desktop 发布门禁。
