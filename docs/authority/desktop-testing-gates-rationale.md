> 本文为两份旧格式 Desktop testing-gates 文档的整文存档，非规范权威；真实纪律语义由 `.nimi/spec/canonical/platform/testing-discipline.authority.yaml` 覆盖。

---

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

Before Desktop becomes a selected Simulator module, this baseline also proves:
production-entry/Nimi-host/Simulator reachability to one canonical renderer
factory; two-instance provider/store/route/query-client isolation; exact style
closure; App-owned Adapter lifecycle; no host discriminator; and no real
Runtime/Realm/native/network/storage path under the conformance fixture. These
are Desktop-owned tests consumed by app-tools and the Simulator integrated
gate, not substitute Desktop UI tests.

执行命令：

- `pnpm --filter @nimiplatform/desktop test`

## D-GATE-020 Rust / Tauri Integration Baseline

涉及 Tauri backend、资源路径、daemon 生命周期、权限、文件系统边界或 bridge 命令的变更，必须保留 Rust 集成测试与 cargo gate。

执行命令：

- `pnpm check:desktop-native-quality`

该 gate 必须只生成并校验一次 Desktop release metadata，再依次运行
product-control-core tests、Tauri clippy 与 Tauri tests；不得由两个独立 gate
重复执行同一 prepare/sync 前置链。`pnpm test:desktop:native` 保留为测试专用的
本地入口，不形成第二个 release gate。

## D-GATE-030 Complete Desktop E2E Gate

PR Linux gate 必须一次运行全部已登记的 Desktop WebDriver 场景；运行目标为真实 Tauri app，不得把 `tauri dev` 作为唯一真值。`smoke`、`journeys`、`desktop-open` 只允许作为场景分类与本地诊断选择器，不得形成独立 pass/fail gate，也不得让同一构建在同一 lane 重复执行完整 runner。

完整集合至少覆盖：

- `boot.anonymous.login-screen`
- `boot.authenticated.main-shell`
- `boot.runtime-unavailable.degraded-shell`
- `boot.fatal-error-screen`
- `shell.core-navigation`
- `offline.banner-and-recovery`
- `runtime.config-panel-load`
- `settings.release-strip-and-preferences`
- `chat.open-thread`
- `explore.panel-load`
- `explore.feed-profile-modal`
- `runtime.local-ai.panel-load`
- `runtime.external-agent.panel-load`
- `desktop-open-intent.running`

执行命令：

- `pnpm --filter @nimiplatform/desktop test:e2e`

## D-GATE-040 Risk-Tiered Feature Journey Gate

所有新增用户可见功能必须在 `tables/desktop-feature-coverage.yaml` 中登记风险等级与必测层：

- `P0`：启动、bootstrap、auth 分支、主 shell、runtime unavailable、fatal error、offline/recovery、quit/hide、release strip；必须有 smoke + failure/recovery desktop E2E。
- `P1`：chat、explore、runtime config、local-ai、external-agent 等关键路径；至少 1 个 desktop E2E happy path。若触及 IPC、网络、持久化、daemon、文件系统，再补 1 个 error/recovery 场景。
- `P2`：纯展示或低风险状态组合；默认可停留在 unit / mock integration。若新增 Tauri IPC、窗口、副作用型 bootstrap、auth/session、updater、文件系统或 runtime bridge，则自动升级为 `P1`。

完整 Desktop E2E gate 必须覆盖 `desktop-feature-coverage.yaml` 中所有 `required_layers` 含 `desktop_e2e` 的已登记场景；feature coverage checker 必须把该表与可执行场景注册表双向核对，不得用任意测试文件路径冒充 E2E coverage。

## D-GATE-050 Selector & Testability Contract

Desktop E2E 只能依赖稳定 testability surface：

- renderer 必须维护集中式 `E2E_IDS`。
- 关键 screen root、shell root、banner、nav tab、panel root、chat row 等必须有稳定 `data-testid`。
- 不得把动态 class、CSS 链式选择器、文案文本或翻译文本作为主选择器。
- 受控 fixture 只能注入外部边界返回，不得绕开业务 contract。
- Desktop E2E / macOS smoke fixture overrides that can satisfy Runtime, Realm,
  app-storage, package-readiness, auth, release, product-control, or bridge
  responses must be compiled only under `cfg(test)` or an explicit test Cargo
  feature. Default and production Desktop builds must not read
  `NIMI_E2E_FIXTURE_PATH`, install Runtime override hooks, forward fixture env
  to child processes, or return fixture-backed authority projections.

执行命令：

- `pnpm --filter @nimiplatform/desktop run check:e2e-parity`

## D-GATE-060 OS Matrix Gate

Desktop E2E OS 策略固定如下：

- Linux：PR hard gate + nightly / release gate。
- Windows：nightly / release gate。
- macOS：保留本地 / 手工 smoke，并允许 supplemental packaged-app automated smoke；它不作为阻塞式 desktop WebDriver gate，原因是 Tauri 官方桌面 WebDriver 自动化支持不与 Linux / Windows 等级对齐。

macOS supplemental automated smoke 必须满足：

- 仅作为 supplementary evidence，不提升为 PR / release blocking gate。
- 执行器必须是 packaged Desktop app 自驱 smoke；不得伪装成 WebDriver parity。
- 必须复用 admitted fixture、stable `data-testid` 与 private bridge surface，不得直接绕开业务 contract 改 store。
- 证据必须进入 local execution report route patterns（如 `.local/report/**`）。
- macOS manual smoke 保留 menu-bar hide/quit、packaged shell、independently
  installed Runtime service trust/compatibility/repair 与 self-update
  supplemental checklist；manual evidence 不替代 Linux/Windows blocking E2E。

## D-GATE-070 Release Parity Gate

release / nightly 不得使用低于 PR 的 desktop E2E 标准，也不得通过 release 专属豁免跳过完整 gate。nightly / release 必须在 Linux / Windows 各执行一次相同的完整场景集合；macOS 手工 smoke 与 supplemental automated smoke 都只能作为补充，不得伪装成 blocking desktop E2E coverage。release parity 必须以 Linux / Windows CI 真实运行结果与 evidence report 为准，不接受“本地脚本已存在”或“workflow 已配置”作为替代证据。

执行命令：

- `pnpm --filter @nimiplatform/desktop test:e2e`

Desktop self-update release dry-run covers Desktop update bytes/signature,
release-root public key, endpoint, Desktop release metadata, installed Runtime
service trust record, mutual peer-release compatibility, and signed
installer/service-updater handoff. Desktop-bundled Runtime staging is forbidden;
any missing prerequisite fails the dry-run.

## D-GATE-080 Spec Consistency & Docs Drift Gate

Desktop testing gate、feature coverage 与 rule evidence 必须作为 kernel 事实源统一检查：

- `desktop-testing-gates.yaml` 必须列出 gate 集合
- `desktop-feature-coverage.yaml` 必须把 `P0/P1` 功能映射到 desktop E2E 场景
- `rule-evidence.yaml` 必须把 `D-GATE-*` 和高风险 `D-*` 规则映射到真实 gate / spec / 测试文件
- Simulator selection additionally requires the current `P-SIM-*` authority,
  `nimi-app doctor --conformance simulator --json`, and the Simulator final
  graph gate. The structural `pnpm check:simulator-authority` gate proves only
  the authority/owner wiring and cannot substitute those executable tests.

执行命令：

- `pnpm exec nimicoding validate-spec-governance --profile nimi --scope desktop-consistency`
- `pnpm exec nimicoding generate-spec-derived-docs --profile nimi --scope desktop --check`

## D-GATE-090 Desktop Design Contract Gate

Desktop baseline design consistency 必须有独立 hard gate：

- `chat`、`explore` 的试点 baseline surface 必须阻止 raw brand hex、token bypass、未登记 arbitrary radius/z、以及未走 shared overlay shell 的本地 dialog/popover family。
- baseline visual hard gate 只针对 `renderer-design-surfaces.yaml` 中声明为 `baseline` 的试点 surface；secondary/admin 与 exception surface 不在首批 raw token/arbitrary-value hard gate 范围内。
- 同一个 hard gate 还必须验证 design registry 完整性：已登记的 governed surface/overlay 必须满足 module 可解析、required testability 可验证、overlay consumer 走 shared overlay primitive。
- 同一个 hard gate 还必须验证 governed sidebar family 完整性：`renderer-design-sidebars.yaml` 中登记的 `runtime-config`、`settings` sidebar 必须导入 shared sidebar primitive，并满足 sections/resizeHandle 与 item kind 声明。
- 任何 hard gate 例外必须进入 `renderer-design-allowlists.yaml`，不得只靠 reviewer 口头记忆放行。

执行命令：

- `pnpm check:desktop-design-contract`

## D-GATE-091 Desktop Design Adoption Gate

Desktop design primitive adoption 以 advisory/soft gate 方式跟踪：

- 同一个 `check:desktop-design-contract` 命令必须输出 remaining local `Button` / `IconButton` 族与 baseline / governed secondary file adoption 覆盖率。
- `runtime-config`、`settings` 的 sidebar family 不再停留在 adoption advisory；这两个内部左侧栏必须直接满足 `D-GATE-090` 的 hard compliance。
- 尚未进入 hard compliance 的 adoption debt 必须可观测、可计数；任何升级为 hard gate 的决定都必须先进入当前 Desktop design authority，不得依赖阶段标签。
- adoption gate 不得削弱 `D-GATE-090` 的 hard gate 条件。

执行命令：

- `pnpm check:desktop-design-contract`

---

# Testing Gates

> Normative Imports: `.nimi/spec/desktop/kernel/*`

## Scope

This guide points to the desktop authority surfaces for testing-gates. It does not define product rules.

## Reading Path

- `.nimi/spec/desktop/kernel/index.md`
- `.nimi/spec/canonical/desktop/agent-projection.authority.yaml`
- `.nimi/spec/canonical/desktop/ai-consumption.authority.yaml`
- `.nimi/spec/canonical/desktop/shell-runtime.authority.yaml`

## Tables

- `.nimi/spec/desktop/kernel/tables/app-tabs.yaml`
- `.nimi/spec/desktop/kernel/tables/build-chunks.yaml`
