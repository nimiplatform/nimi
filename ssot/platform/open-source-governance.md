---
title: Nimi Open Source Governance SSOT
status: ACTIVE
updated_at: 2026-02-26
rules:
  - 开源边界、许可证矩阵、社区治理与发布门禁必须统一在本文件维护。
  - runtime/sdk/proto 与 apps/desktop/nimi-mods/apps/web/docs 的许可边界必须保持一致，不允许跨层漂移。
  - 发布门禁必须可脚本化并可在 CI 重放，不接受“仅口头流程”。
  - 对标审计与补齐计划必须先更新本 SSOT，再落地到仓库实现与工作流。
---

# Open Source Governance & Readiness Program

## 0. 文档定位

本文件是 `@nimiplatform/nimi` 开源治理与开源就绪度的唯一执行合同，覆盖：

- 开源/闭源边界与许可证矩阵
- 发布门禁（CI、安全、供应链、发布流水线）
- 社区治理基础设施（模板、流程、角色、运营最小面）
- 对标审计后的可执行补齐清单（按优先级与 PR 拆分）

审计输入来源：

- 本地事实核验（repo 文件与工作流）
- 外部 benchmark（OpenClaw 对标观察，作为参考基线而非真相源）

> 注：OpenClaw 的动态指标（如 stars、CI 规模）会变化。本文件只把这些信息用作“方向参考”，不把外部仓库状态当作硬性合同。

## 1. 不可变治理合同

### 1.1 开源边界（固定）

| 层 | 策略 | 说明 |
|---|---|---|
| `nimi-realm` | 闭源 | 商业护城河与持续世界真相源 |
| `runtime` / `sdk` / `proto` | 开源 | 平台基础能力，允许生态接入 |
| `apps/desktop` / `nimi-mods` / `apps/web` | 开源 | 第一方应用与生态扩展载体 |
| `docs` / `ssot` | 开源 | 协议与工程合同公开透明 |

### 1.2 许可证矩阵（固定）

| 路径 | License |
|---|---|
| `runtime/`, `sdk/`, `proto/` | Apache-2.0 |
| `apps/desktop/`, `apps/web/`, `apps/_libs/`, `nimi-mods/` | MIT |
| `docs/`, `ssot/` | CC-BY-4.0 |

### 1.3 发布门禁（固定）

1. `MUST`：所有关键门禁必须在 CI 可重放，不允许人工兜底替代。
2. `MUST`：破坏性变更必须具备显式声明与迁移路径。
3. `MUST`：安全与供应链检查结果必须可追溯（日志、报告、基线文件）。
4. `MUST`：发布产物（runtime/sdk/proto/desktop）必须可由工作流复现。
5. `MUST`：本文件先于实现变更更新；实现与文档不一致时以本文件为准并触发修正。

## 2. 当前状态快照（2026-02-26）

### 2.1 已具备基础能力

| 维度 | 现状 | 证据 |
|---|---|---|
| 仓库治理基础 | 已有 `LICENSE`、`CODEOWNERS`、`CONTRIBUTING.md`、`SECURITY.md`、`CODE_OF_CONDUCT.md`、`DCO` | 根目录对应文件 |
| Issue 模板 | 4 个模板（bug/feature/mod/security） | `.github/ISSUE_TEMPLATE/*` |
| PR 模板 | 已有标准 checklist | `.github/PULL_REQUEST_TEMPLATE.md` |
| 标签体系 | 24 个标签，覆盖组件/类型/优先级/尺寸 | `.github/labels.yml` |
| 自动化工作流 | `ci`、`security`、`release-runtime`、`release`、`dco`、`auto-labeler`、`stale`、`actionlint`、`markdownlint` | `.github/workflows/*.yml` |
| CI 门禁深度 | 主 CI 已拆分为多 job 并行拓扑（docs/static/sdk/runtime/desktop-security）+ 聚合 gate，含路径感知与 coverage gate | `.github/workflows/ci.yml` |
| 文档站 | 已有 VitePress 文档工程 | `docs/.vitepress/` |
| SSOT 机制 | frontmatter/traceability 已有自动检查 | `scripts/check-ssot-*.mjs` |

### 2.2 关键缺口（本地可验证）

| ID | 缺口 | 当前状态 | 优先级 |
|---|---|---|---|
| OSG-P0-01 | Dependabot 自动依赖升级 | 已新增 `.github/dependabot.yml`（待首轮 PR 验证） | P0 |
| OSG-P0-02 | 机密与供应链安全基线（可复现） | 已新增 `security.yml` + `.secrets.baseline` + `cargo audit`（待首轮 PR 验证） | P0 |
| OSG-P0-03 | 发布流水线自动化 | 已新增 `release.yml` + `release-runtime.yml`（待首轮 tag 验证） | P0 |
| OSG-P0-04 | Go 二进制发布配置 | 已新增 `.goreleaser.yml` + `release-runtime.yml`（待首个 tag 验证） | P0 |
| OSG-P0-05 | 覆盖率门槛与可视化 | 已新增 `check:sdk-coverage` + `check:runtime-go-coverage` 并接入 CI 阻断 | P0 |
| OSG-P0-06 | CI 拓扑优化（并发/按变更范围执行） | 已完成多 job 并发 + `changes` 路径感知 + `js-contract` 聚合 gate | P0 |
| OSG-P0-07 | 发布物签名与 SBOM | 已为 runtime/desktop 发布链路接入 keyless cosign 签名 + SBOM 生成 + verify/upload | P0 |
| OSG-P1-01 | pre-commit hooks | 已新增 `.pre-commit-config.yaml` | P1 |
| OSG-P1-02 | PR 安全影响评估模板 | 已补齐安全影响评估与回滚计划段落 | P1 |
| OSG-P1-03 | Markdown lint 基线 | 已新增 `.markdownlint-cli2.jsonc` + `markdownlint.yml` workflow | P1 |
| OSG-P1-04 | 开发环境变量样例 | 已新增根级 `.env.example` | P1 |
| OSG-P1-05 | Workflow 自检（actionlint） | 已新增 `actionlint.yml` workflow | P1 |
| OSG-P2-01 | 社区引导与资金页面 | 已新增 `.github/FUNDING.yml`、`.github/ISSUE_TEMPLATE/config.yml` | P2 |
| OSG-P2-02 | 治理外显文档 | 已新增 `VISION.md`、`GOVERNANCE.md` | P2 |
| OSG-P2-03 | 品牌与分发运营面 | 已补齐首轮自动欢迎（`first-interaction.yml`）；social preview/topics 仍待补齐 | P2 |

## 3. 对标 OpenClaw 的归一化结论

### 3.1 结论摘要

1. Nimi 在“协议门禁、DCO、License 分层、SSOT 追踪”上具备明显结构化优势。
2. Nimi 的主要短板不在“基础工程意识”，而在“开源运营工业化”能力：依赖治理、安全扫描、自动发布、CI 拓扑。
3. 当前仓库已完成 P0 与 P1 基线；P2 主要剩余品牌运营面，可在社区增长期持续补齐。

### 3.2 归一化矩阵

| 维度 | Benchmark 信号（OpenClaw） | Nimi 现状 | 判定 |
|---|---|---|---|
| CI 结构 | 多 job + 矩阵 + scope 化 | 已完成多 job 并发与 path-aware 执行 | 已收敛（P0） |
| 依赖治理 | 多生态 Dependabot | 已新增基础配置（待首轮 PR 验证） | 推进中（P0） |
| 安全扫描 | secret/action 安全链路完备 | 已新增 detect-secrets + zizmor + cargo audit（待首轮 PR 验证） | 推进中（P0） |
| 发布自动化 | npm/容器/客户端自动发布 | runtime/sdk/proto/desktop 自动发布工作流均已落地（待首轮 tag 验证） | 已落地（P0） |
| 覆盖率治理 | 有阈值与趋势 | 已接入 runtime + sdk coverage 阻断 | 已收敛（P0） |
| 社区模板 | issue/PR 与治理指南完整 | issue 强、PR 中等 | 可补齐（P1） |
| 贡献者体验 | pre-commit + lint 体系 | pre-commit/markdownlint/actionlint 已接入 | 已收敛（P1） |
| 社区运营 | funding/引导/自动回复 | funding、issue 引导与首轮自动欢迎已补齐；品牌展示项仍待补齐 | 推进中（P2） |

## 4. 可执行补齐清单（按优先级）

### 4.1 Phase A（发布前必须完成，P0）

- [x] `OSG-P0-01` 依赖自动化：已新增 `.github/dependabot.yml`，覆盖 `npm`、`gomod`、`github-actions`、`docker`。
- [x] `OSG-P0-02` 安全基线：已新增 secret scanning 与 workflow 安全审计（`detect-secrets` + `zizmor`），并把 `cargo audit` 纳入 CI。
- [x] `OSG-P0-03` 发布流水线：已新增 `.github/workflows/release.yml`，覆盖 sdk/proto/desktop；runtime 由 `release-runtime.yml` 覆盖（待首轮 tag 验证）。
- [x] `OSG-P0-04` Runtime 发布配置：已新增 `.goreleaser.yml` 与 `.github/workflows/release-runtime.yml`，支持多平台二进制产物（待首个 tag 验证）。
- [x] `OSG-P0-05` 覆盖率门禁：已为 runtime + sdk 核心包定义最低阈值并在 CI 阻断不达标变更（`check:sdk-coverage`, `check:runtime-go-coverage`）。
- [x] `OSG-P0-06` CI 拓扑重构：已拆分为多 job，增加 `concurrency` 与路径感知，docs-only 变更默认跳过重型链路。
- [x] `OSG-P0-07` 供应链发布门禁：runtime/desktop 发布产物已接入 `SBOM + keyless signature + verify + release upload`。

### 4.2 Phase B（发布后 30 天，P1）

- [x] `OSG-P1-01` pre-commit：已新增 `.pre-commit-config.yaml`（空白字符、YAML、secret、基本 lint）。
- [x] `OSG-P1-02` PR 模板增强：已增加安全影响评估、风险等级、失败恢复计划。
- [x] `OSG-P1-03` Markdown lint：已新增 `.markdownlint-cli2.jsonc` 和 CI 校验（`markdownlint.yml`）。
- [x] `OSG-P1-04` 环境样例：已新增 `.env.example`（变量说明与安全注释）。
- [x] `OSG-P1-05` workflow lint：已新增 `actionlint.yml`。

### 4.3 Phase C（社区增长期，P2）

- [x] `OSG-P2-01` 社区入口：已新增 `.github/FUNDING.yml` 与 `.github/ISSUE_TEMPLATE/config.yml`。
- [x] `OSG-P2-02` 治理外显：已新增 `VISION.md` 与 `GOVERNANCE.md`。
- [ ] `OSG-P2-03` 品牌运营：已完成自动回复/欢迎流程，待补齐 GitHub topics 与社交预览图。

## 5. 8-PR 落地路线（可直接执行）

| PR | 目标 | 主要变更文件 | 完成判据 |
|---|---|---|---|
| PR-01 | Dependabot 全覆盖 | `.github/dependabot.yml` | Dependabot 能按周生成分组 PR |
| PR-02 | 安全扫描与机密基线 | `.github/workflows/security.yml`, `.secrets.baseline`, CI 增加 `cargo audit` | PR/Push 均执行 secret + action 安全检查 |
| PR-03 | Runtime 发布自动化 | `.goreleaser.yml`, `.github/workflows/release-runtime.yml` | 打 tag 可生成多平台 runtime 二进制 |
| PR-04 | 全量发布流水线 | `.github/workflows/release.yml`, `docs/dev/release.md` | SDK 发布、proto push、desktop 构建可自动化触发 |
| PR-05 | 覆盖率门禁 | `ci.yml` + 各子包测试配置 | 覆盖率低于阈值时 CI fail |
| PR-06 | CI 拓扑与并发治理 | `.github/workflows/ci.yml`（拆 job + `concurrency` + path filter） | docs-only 变更不再触发重型 job |
| PR-07 | 开发者质量工具链 | `.pre-commit-config.yaml`, `.markdownlint-cli2.jsonc`, `.env.example`, actionlint workflow | 本地提交与 CI 的基础规范一致 |
| PR-08 | 社区治理补齐 | `VISION.md`, `GOVERNANCE.md`, `.github/FUNDING.yml`, PR/Issue 模板增强 | 外部贡献者可按文档自助完成贡献闭环 |

执行约束：

1. P0 七项必须在仓库公开发布前完成并在主分支稳定运行。
2. PR-03/04 与 PR-05/06 可以并行，但合并前必须通过交叉验证。
3. 若任一 P0 失败，发布决策自动回退为 `NO-GO`。

## 6. Go/No-Go 发布门禁

### 6.1 Go（全部满足）

1. Dependabot 生效并有首轮升级 PR 记录。
2. Secret/Action 安全扫描在默认分支持续通过。
3. Runtime 发布可由 tag 自动生成多平台产物。
4. SDK/proto/desktop 至少一次 staging 发布演练成功。
5. 覆盖率门禁已启用且阈值写入仓库配置。
6. CI 已拆分为多 job 并启用并发控制。
7. PR 模板含安全影响与回滚说明。
8. 发布 runbook 可由新人在一次演练中复现。

### 6.2 No-Go（任一命中）

1. 发布依赖人工本地脚本且无 CI 可重放证据。
2. 机密扫描或依赖漏洞门禁缺失。
3. 关键产物（runtime/sdk/proto/desktop）存在不可复现发布路径。
4. 文档声明与工作流行为不一致且无已登记例外。

## 7. 验收命令基线

以下命令是开源发布前的最小本地回归：

```bash
pnpm lint
pnpm check:markdown
pnpm test
pnpm proto:lint
pnpm proto:breaking
pnpm proto:drift-check
cd runtime && go test ./... && go vet ./...
cd runtime && govulncheck ./...
pnpm audit --prod --audit-level=high
$(go env GOPATH)/bin/actionlint -color
```

> 若引入新增安全/发布工作流，必须同步把对应本地 dry-run 命令写入 `docs/dev/release.md`。

## 8. 追溯与维护

### 8.1 Source Promotion

This SSOT is continuously maintained from:

- `LICENSE`
- `licenses/README.md`
- `.github/workflows/ci.yml`
- `docs/dev/release.md`

### 8.2 维护规则

1. 新增或变更开源治理能力时，先改本文件，再改实现。
2. P0/P1/P2 清单状态变更必须附带“证据文件或 workflow 链接”。
3. 本文件与 `docs/dev/release.md` 出现冲突时，以本文件为准并立即修正文档漂移。

### 8.3 Promotion Notes

- REF-ERRATA (2026-02-25): consolidated strategy/checklist into one executable SSOT.
- REF-ERRATA (2026-02-25): added benchmark-normalized, PR-based open-source readiness backlog (P0/P1/P2).
- REF-ERRATA (2026-02-25): completed PR-03 baseline by adding `.goreleaser.yml` and `.github/workflows/release-runtime.yml` (tag-triggered runtime release).
- REF-ERRATA (2026-02-25): completed PR-04 baseline by adding `.github/workflows/release.yml` and SDK/proto/desktop release automation runbook updates.
- REF-ERRATA (2026-02-25): completed PR-05 by adding `check:sdk-coverage` + `check:runtime-go-coverage` and wiring both into CI hard gates.
- REF-ERRATA (2026-02-25): completed PR-06 by splitting CI into parallel jobs with `changes` path detection and `js-contract` aggregate gate.
- REF-ERRATA (2026-02-25): added runtime/desktop release supply-chain hard gate (`SBOM + keyless signature + verify + upload`).
- REF-ERRATA (2026-02-26): completed PR-07 baseline by adding `.pre-commit-config.yaml`, `.markdownlint-cli2.jsonc`, `.env.example`, `.github/workflows/actionlint.yml`, `.github/workflows/markdownlint.yml`.
- REF-ERRATA (2026-02-26): completed PR-08 baseline by adding `VISION.md`, `GOVERNANCE.md`, `.github/FUNDING.yml`, `.github/ISSUE_TEMPLATE/config.yml`, and PR template security/rollback sections.
- REF-ERRATA (2026-02-26): added `.github/workflows/first-interaction.yml` as baseline contributor welcome automation (P2 partial closure).
