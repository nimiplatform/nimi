# Nimi 发布前全量审计报告 R2（AI Runtime & Developer Platform）

- 审计日期：2026-02-26
- 审计仓库：`/Users/snwozy/nimi-realm/nimi`
- 证据边界：仅仓内可复现证据（本地命令 + 仓库文件）
- 证据索引：`/Users/snwozy/nimi-realm/nimi/dev/report/nimi-platform-audit-2026-02-26-r2.evidence.md`

## 决策摘要（Release Review 1 页）

**发布决策：`GO`（抢修后）**

关键原因（最多 5 条）：

1. **P0 已关闭**：`release-desktop` 已补齐 `NIMI_MODS_ROOT/NIMI_RUNTIME_MODS_DIR` 注入、external `nimi-mods` pinned checkout、构建前 env fail-fast 校验。
2. **P1 已关闭（输入源一致性）**：release 与 CI 均采用 external `nimi-mods` pinned source 策略，消除输入漂移。
3. **P1 已关闭（发布契约文档）**：`docs/dev/release.md` 已补 desktop release 的 mods 契约与本地 dry-run。
4. **发布链路本地可复现**：`pnpm build:sdk` + `desktop build:renderer:with-mods` 在契约环境下通过。
5. **剩余项仅 P2 运营治理**：`OSG-P2-03`（topics/social preview）不阻塞工程发布。

发布前最后门禁建议：执行一次 `workflow_dispatch(target=desktop, publish=false)` 并归档 run 证据。
当前状态说明：已尝试触发远端演练，但 `nimiplatform/nimi` 默认分支当前不含 workflow 文件（仅 `README.md`），因此该项暂时被仓外环境阻断。

---

## 1. 审计结论（GO/NO-GO）

- 当前结论：`GO`
- 判定说明：未存在未闭环 P0；未闭环 P1 不超过阈值且无高风险安全/供应链缺口。

## 2. 评分总览（5 分制）

| 维度 | 分数 | 结论 |
|---|---:|---|
| 架构一致性 | 4.6 | No-Legacy 与 external mods 契约在 desktop/runtime/nimi-mods 一致 |
| 发布可复现性 | 4.6 | release-desktop 关键缺口已补，链路可复现 |
| 开发者联调闭环 | 4.8 | 双终端流程、fail-fast、watch/build/check 契约清晰 |
| AI Coding 友好度 | 4.6 | 边界明确、门禁脚本化、错误提示可操作 |
| 治理与社区可运营性 | 4.1 | 工程治理达标，品牌分发面仍有 P2 待办 |

## 3. 风险与状态清单（按严重度）

### P0-01：desktop release mods 环境契约缺口

- 风险级别：`P0`
- 当前状态：`CLOSED`
- 修复证据：
  - `.github/workflows/release.yml` 已设置 `NIMI_MODS_ROOT`、`NIMI_RUNTIME_MODS_DIR`
  - `release-desktop` 已新增 external `nimiplatform/nimi-mods` pinned checkout
  - 构建前已新增 `pnpm --filter @nimiplatform/desktop run env:check:mods-root`
- 验收结果：本地 `build:renderer:with-mods` 在契约环境下通过。

### P1-01：release 与 CI 的 external mods 输入源不一致

- 风险级别：`P1`
- 当前状态：`CLOSED`
- 修复证据：
  - CI 与 release 都使用 external `nimi-mods` pinned 策略（`NIMI_MODS_REF`）
- 验收结果：策略已在 workflow 中同源可审计。

### P1-02：release runbook 缺失 desktop mods 契约

- 风险级别：`P1`
- 当前状态：`CLOSED`
- 修复证据：
  - `docs/dev/release.md` 已补 desktop 发布前置契约与 dry-run 命令
- 验收结果：`check:markdown` 通过。

### P2-01：开源品牌/分发运营面未闭环

- 风险级别：`P2`
- 当前状态：`OPEN`
- 证据：`ssot/platform/open-source-governance.md` 标记 `OSG-P2-03`（topics/social preview）待补齐。
- 影响：不阻塞发布，但影响开源发现度和社区转化效率。

## 4. 证据矩阵（摘要）

| 主题 | 结果 | 证据 |
|---|---|---|
| 静态门禁 8 项 | PASS | `lint`、`check:markdown`、`check:ssot-*`、`actionlint`、`nimi-mods verify`、`runtime go test` 全通过 |
| No-Legacy 深扫 | PASS | legacy 关键字未在业务行为路径发现残留（仅 guard/test 语境） |
| 非 MVP 深扫 | PASS | 未发现 `TODO/FIXME/TBD/Coming soon` 用户可见伪能力 |
| 联调 fail-fast 场景 | PASS | 缺失 `NIMI_MODS_ROOT`/`NIMI_RUNTIME_MODS_DIR` 均立即失败 |
| 路径安全 | PASS | `normalize_local_mod_entry_path_rejects_relative_escape` 测试通过 |
| SDK consumer smoke | PASS | `pnpm check:sdk-consumer-smoke` 成功 |
| release 供应链链路 | PASS | `release.yml` / `release-runtime.yml` 含 SBOM + cosign sign/verify |
| desktop release 可复现性 | PASS | release-desktop 已补 external mods + env 契约，且本地关键构建通过 |

详见完整证据：`/Users/snwozy/nimi-realm/nimi/dev/report/nimi-platform-audit-2026-02-26-r2.evidence.md`

## 5. 运行基线（3 次中位数 P50）

阈值定义（本轮发布门禁）：

- `pnpm lint` ≤ 30s
- `desktop typecheck` ≤ 10s
- `desktop cargo test` ≤ 90s
- `nimi-mods verify` ≤ 20s
- `runtime go test ./...` ≤ 8s

| 命令 | P50 | 波动区间（min-max） | 阈值 | 判定 |
|---|---:|---:|---:|---|
| `pnpm lint` | 18.276s | 17.924s - 18.791s | 30s | PASS |
| `pnpm -C desktop run typecheck` | 3.238s | 3.231s - 3.268s | 10s | PASS |
| `cargo test --manifest-path desktop/src-tauri/Cargo.toml` | 0.240s | 0.226s - 0.363s | 90s | PASS |
| `pnpm -C nimi-mods run verify` | 5.518s | 5.517s - 5.598s | 20s | PASS |
| `cd runtime && go test ./...` | 0.578s | 0.540s - 1.209s | 8s | PASS |

## 6. 修复路线图

### 0-7 天（发布前）

1. [BLOCKED] 执行 `release.yml` 的 `workflow_dispatch(target=desktop, publish=false)` 并归档 run 链接与产物清单。
说明：远端 `nimiplatform/nimi` 默认分支当前不存在 workflow（API 仅返回 `README.md`），需先完成远端仓库内容同步。
2. [DONE] `NIMI_MODS_REF` 升级策略已写入 `docs/dev/release.md`（审批、节奏、门禁、回滚）。

### 7-30 天（稳定期）

1. 将 release 演练纳入固定 cadence（建议周节奏）。
2. 固化 SBOM/签名校验报告模板，减少人工判断歧义。

### 30+ 天（增长期）

1. 完成 `OSG-P2-03`（GitHub topics + social preview）。
2. 统一开源首页、文档与发布资产的品牌叙事。

## 7. 附录

### 7.1 命令清单（本轮执行）

1. `pnpm -C /Users/snwozy/nimi-realm/nimi lint`
2. `pnpm -C /Users/snwozy/nimi-realm/nimi check:markdown`
3. `pnpm -C /Users/snwozy/nimi-realm/nimi check:ssot-frontmatter`
4. `pnpm -C /Users/snwozy/nimi-realm/nimi check:ssot-traceability`
5. `pnpm -C /Users/snwozy/nimi-realm/nimi check:ssot-links`
6. `cd /Users/snwozy/nimi-realm/nimi && "$(go env GOPATH)/bin/actionlint" -color`
7. `pnpm -C /Users/snwozy/nimi-realm/nimi/nimi-mods run verify`
8. `cd /Users/snwozy/nimi-realm/nimi/runtime && go test ./...`
9. `pnpm -C /Users/snwozy/nimi-realm/nimi check:sdk-consumer-smoke`
10. `cargo test normalize_local_mod_entry_path_rejects_relative_escape --manifest-path /Users/snwozy/nimi-realm/nimi/desktop/src-tauri/Cargo.toml`
11. `env -u NIMI_MODS_ROOT node /Users/snwozy/nimi-realm/nimi/desktop/scripts/dev-env-check.mjs --require-mods-root`
12. `env -u NIMI_RUNTIME_MODS_DIR NIMI_MODS_ROOT=/Users/snwozy/nimi-realm/nimi/nimi-mods node /Users/snwozy/nimi-realm/nimi/desktop/scripts/dev-env-check.mjs --require-mods-root --require-runtime-mods-dir --expect-runtime-equals-root`
13. `pnpm -C /Users/snwozy/nimi-realm/nimi build:sdk`
14. `NIMI_MODS_ROOT=/Users/snwozy/nimi-realm/nimi/nimi-mods NIMI_RUNTIME_MODS_DIR=/Users/snwozy/nimi-realm/nimi/nimi-mods pnpm -C /Users/snwozy/nimi-realm/nimi/desktop run build:renderer:with-mods`

### 7.2 证据索引

见：`/Users/snwozy/nimi-realm/nimi/dev/report/nimi-platform-audit-2026-02-26-r2.evidence.md`

### 7.3 审计边界与不可验证项

1. 未使用仓外不可复现实证（GitHub UI 状态、组织配置等）。
2. 若存在仓外注入（例如 workflow 运行时额外环境变量），本报告不采信为硬证据。
3. 本轮仅产出审计结论与整改建议；实现抢修仅限发布契约与构建可复现性相关文件。
