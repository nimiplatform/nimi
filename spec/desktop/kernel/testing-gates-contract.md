# Desktop Testing Gates Contract

> Owner Domain: `D-GATE-*`

## D-GATE-001 Layered Test Policy

Desktop 测试必须按四层治理，而不是用单一门禁替代全部风险面：

- unit / contract / hard-cut
- renderer Tauri-mock integration
- Rust / Tauri integration
- desktop E2E（真实 Tauri app + WebView + IPC）

Desktop E2E 的职责是覆盖真实桌面壳、启动时序、bridge、窗口与打包产物风险；它不替代单测或 Rust 集成测试。

## D-GATE-010 Unit, Contract & Mock Baseline

新增或修改 desktop 用户可见功能时，必须先具备单测、契约测试或 renderer Tauri-mock 覆盖；纯逻辑、状态机、映射与 hard-cut 不得只依赖 desktop E2E 覆盖。

执行命令：

- `pnpm --filter @nimiplatform/desktop test`

## D-GATE-020 Rust / Tauri Integration Baseline

涉及 Tauri backend、资源路径、daemon 生命周期、权限、文件系统边界或 bridge 命令的变更，必须保留 Rust 集成测试与 cargo gate。

执行命令：

- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`
- `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets`

## D-GATE-030 Desktop E2E Smoke Gate

PR Linux gate 必须运行 desktop E2E smoke 集合；运行目标为真实 Tauri app，不得把 `tauri dev` 作为唯一真值。

smoke 集合至少覆盖：

- `boot.anonymous.login-screen`
- `boot.authenticated.main-shell`
- `boot.runtime-unavailable.degraded-shell`
- `boot.fatal-error-screen`
- `shell.core-navigation`
- `offline.banner-and-recovery`
- `runtime.config-panel-load`

执行命令：

- `pnpm check:desktop-e2e-smoke`

## D-GATE-040 Risk-Tiered Feature Journey Gate

所有新增用户可见功能必须在 `tables/desktop-feature-coverage.yaml` 中登记风险等级与必测层：

- `P0`：启动、bootstrap、auth 分支、主 shell、runtime unavailable、fatal error、offline/recovery、quit/hide、release strip；必须有 smoke + failure/recovery desktop E2E。
- `P1`：chat、contacts、explore、runtime config、mods、local-ai、external-agent 等关键路径；至少 1 个 desktop E2E happy path。若触及 IPC、网络、持久化、daemon、文件系统，再补 1 个 error/recovery 场景。
- `P2`：纯展示或低风险状态组合；默认可停留在 unit / mock integration。若新增 Tauri IPC、窗口、副作用型 bootstrap、auth/session、updater、文件系统或 runtime bridge，则自动升级为 `P1`。

journeys gate 必须覆盖 `desktop-feature-coverage.yaml` 中所有 `required_layers` 含 `desktop_e2e_*` 的场景。

执行命令：

- `pnpm check:desktop-e2e-journeys`

## D-GATE-050 Selector & Testability Contract

Desktop E2E 只能依赖稳定 testability surface：

- renderer 必须维护集中式 `E2E_IDS`。
- 关键 screen root、shell root、banner、nav tab、panel root、chat row 等必须有稳定 `data-testid`。
- 不得把动态 class、CSS 链式选择器、文案文本或翻译文本作为主选择器。
- 受控 fixture 只能注入外部边界返回，不得绕开业务 contract。

## D-GATE-060 OS Matrix Gate

Desktop E2E OS 策略固定如下：

- Linux：PR hard gate + nightly / release gate。
- Windows：nightly / release gate。
- macOS：保留本地 / 手工 smoke，不作为阻塞式 desktop WebDriver gate；原因是 Tauri 官方桌面 WebDriver 自动化支持不与 Linux / Windows 等级对齐。

## D-GATE-070 Release Parity Gate

release / nightly 不得使用低于 PR 的 desktop E2E 标准，也不得通过 release 专属豁免跳过 Linux smoke 或 journey gate。nightly / release 需要执行完整 journey 集合；macOS 手工 smoke 只能作为补充，不得伪装成自动化 coverage。

## D-GATE-080 Spec Consistency & Docs Drift Gate

Desktop testing gate、feature coverage 与 rule evidence 必须作为 kernel 事实源统一检查：

- `desktop-testing-gates.yaml` 必须列出 gate 集合
- `desktop-feature-coverage.yaml` 必须把 `P0/P1` 功能映射到 desktop E2E 场景
- `rule-evidence.yaml` 必须把 `D-GATE-*` 和高风险 `D-*` 规则映射到真实 gate / spec / 测试文件

执行命令：

- `pnpm check:desktop-spec-kernel-consistency`
- `pnpm check:desktop-spec-kernel-docs-drift`
