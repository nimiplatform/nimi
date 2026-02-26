# Nimi Platform Audit Evidence Index R2

- Date: 2026-02-26
- Workspace: `/Users/snwozy/nimi-realm/nimi`
- Evidence policy: in-repo reproducible only
- Raw artifacts:
  - `/tmp/nimi_audit_static_results.json`
  - `/tmp/nimi_audit_perf_results.json`
  - `/tmp/nimi_audit_targeted_results.txt`

## 1. Baseline Inputs (read-only)

1. `ssot/platform/open-source-governance.md`
2. `AGENTS.md`
3. `docs/dev/mod-runtime-layout-contract.md`
4. `dev/report/nimi-platform-audit-2026-02-26.md`（历史对照，不继承结论）

## 2. Static Gate Results

| ID | Command | Exit | Duration (ms) | Verdict |
|---|---|---:|---:|---|
| GATE-01 | `pnpm -C /Users/snwozy/nimi-realm/nimi lint` | 0 | 19249 | PASS |
| GATE-02 | `pnpm -C /Users/snwozy/nimi-realm/nimi check:markdown` | 0 | 1033 | PASS |
| GATE-03 | `pnpm -C /Users/snwozy/nimi-realm/nimi check:ssot-frontmatter` | 0 | 273 | PASS |
| GATE-04 | `pnpm -C /Users/snwozy/nimi-realm/nimi check:ssot-traceability` | 0 | 259 | PASS |
| GATE-05 | `pnpm -C /Users/snwozy/nimi-realm/nimi check:ssot-links` | 0 | 270 | PASS |
| GATE-06 | `cd /Users/snwozy/nimi-realm/nimi && "$(go env GOPATH)/bin/actionlint" -color` | 0 | 48 | PASS |
| GATE-07 | `pnpm -C /Users/snwozy/nimi-realm/nimi/nimi-mods run verify` | 0 | 5715 | PASS |
| GATE-08 | `cd /Users/snwozy/nimi-realm/nimi/runtime && go test ./...` | 0 | 1726 | PASS |

关键输出摘要：

- `GATE-07`：`[check-mods] all 4 mod(s) valid`，`build-mod` 覆盖 `kismet/local-chat/re-life/world-studio`。
- `GATE-08`：runtime 包测试通过，无失败用例。

## 3. Targeted Scenario Evidence

### 3.1 Env Fail-Fast Contract

来源：`/tmp/nimi_audit_targeted_results.txt`

| Case | Command | Exit | Output snippet |
|---|---|---:|---|
| CASE_ENV_NO_MODS_ROOT | `env -u NIMI_MODS_ROOT node desktop/scripts/dev-env-check.mjs --require-mods-root` | 1 | `Missing required env NIMI_MODS_ROOT.` |
| CASE_ENV_NO_RUNTIME_MODS_DIR | `env -u NIMI_RUNTIME_MODS_DIR NIMI_MODS_ROOT=... node desktop/scripts/dev-env-check.mjs --require-mods-root --require-runtime-mods-dir --expect-runtime-equals-root` | 1 | `Missing required env NIMI_RUNTIME_MODS_DIR.` |
| CASE_ENV_VALID | `env NIMI_MODS_ROOT=... NIMI_RUNTIME_MODS_DIR=... node desktop/scripts/dev-env-check.mjs ...` | 0 | 输出两个生效路径 |

关联代码证据：

- `desktop/scripts/dev-env-check.mjs`：`--require-mods-root`/`--require-runtime-mods-dir`/`--expect-runtime-equals-root`
- `desktop/scripts/mod-paths.mjs`：绝对路径 + 目录存在性强校验
- `desktop/src-tauri/src/runtime_mod/store.rs`：debug 模式下强制 `NIMI_RUNTIME_MODS_DIR`，并要求与 `NIMI_MODS_ROOT` 一致

### 3.2 Path Escape Rejection

命令：

- `cargo test normalize_local_mod_entry_path_rejects_relative_escape --manifest-path desktop/src-tauri/Cargo.toml`

结果：exit=0，测试通过。

关联代码证据：

- `desktop/src-tauri/src/runtime_mod/store.rs`：`normalize_local_mod_entry_path_from_base` 使用 `canonicalize` 且 `starts_with(base)`，越界报错 `拒绝访问 mods 目录外的路径`
- 同文件测试：
  - `normalize_local_mod_entry_path_rejects_relative_escape`
  - `normalize_local_mod_entry_path_rejects_absolute_outside_path`

### 3.3 SDK Consumer Smoke

命令：

- `pnpm -C /Users/snwozy/nimi-realm/nimi check:sdk-consumer-smoke`

结果：exit=0。

输出证据：脚本打包 `@nimiplatform/sdk-*` tarball 并完成消费验证。

## 4. No-Legacy Deep Scan Evidence

执行：

1. `rg -n "NIMI_MODS_DIR|\.\./\.\./nimi-mods|desktop/mods|local-default|ai.modelPacks|<legacy-core-api-scope>|nimi grant" ...`
2. `rg -n "NIMI_MODS_DIR|\.\./\.\./nimi-mods|desktop/mods|\blocal-default\b|\bai\.modelPacks\b" runtime sdk desktop nimi-mods docs ssot ...`
3. `rg -n "cmd/nimid|\bnimid\b" runtime sdk ssot README.md CHANGELOG.md`

结果：

- legacy 命中仅出现在 guard/test/policy 语境（例如 `scripts/check-no-legacy-doc-contracts.mjs`、`package.json` 检查脚本定义）。
- 业务路径（runtime/sdk/desktop/nimi-mods/docs/ssot）未发现违规行为语义残留。

关键 guard 证据：

- `scripts/check-no-legacy-doc-contracts.mjs` 显式封禁：`NIMI_MODS_DIR`、`desktop/mods`、`../../nimi-mods`、`local-default`、`ai.modelPacks`、`nimi-public`、`sync-from-realm.sh`。

## 5. Non-MVP Audit Evidence

执行：

- `rg -n "TODO|FIXME|TBD|Coming soon|coming soon" runtime sdk desktop nimi-mods web docs ssot --glob '!runtime/gen/**' --glob '!sdk/**/generated/**'`

结果：无输出（未发现用户可见 MVP 占位条目）。

说明：

- `Unimplemented*Server` 命中主要来自 gRPC 正常嵌入模式，不构成对外伪能力。

## 6. Release Engineering Evidence

### 6.1 Supply Chain / Security / Governance Positive Evidence

- `security.yml` 包含 `detect-secrets` + `zizmor` 高危门禁。
- `release-runtime.yml` 包含 `cosign sign-blob + verify-blob` + SBOM 生成与上传。
- `release.yml` 的 `release-desktop` 包含 SBOM+签名流程 (`scripts/release/sign-and-sbom-artifacts.mjs`)。
- `ci.yml` 包含 `check:sdk-consumer-smoke`、coverage gate、path-aware 并行拓扑。

### 6.2 Historical P0 Evidence: Desktop Release Reproducibility Gap (pre-fix)

证据链：

1. `desktop/src-tauri/tauri.conf.json`：`beforeBuildCommand` 为 `pnpm --filter @nimiplatform/desktop run build:renderer:with-mods`。
2. `desktop/package.json`：`build:mods` -> `env:check:mods-root` -> 强制 `NIMI_MODS_ROOT`。
3. `release.yml`：`release-desktop` job 未设置 `NIMI_MODS_ROOT/NIMI_RUNTIME_MODS_DIR`。
4. 本地复现：
   - `env -u NIMI_MODS_ROOT pnpm -C /Users/snwozy/nimi-realm/nimi/desktop run build:renderer:with-mods`
   - 输出：`[dev-env-check] Missing required env NIMI_MODS_ROOT.`

判定（修复前）：desktop release 关键链路不可保证可复现。

### 6.3 Historical P1 Evidence: External Mods Source Drift in Release Path (pre-fix)

- `ci.yml` 的 `desktop-web-quality` 明确 checkout external `nimiplatform/nimi-mods` pinned `ref`。
- `release.yml` 未出现 `nimi-mods` checkout 与 pin 语句。
- `docs/dev/release.md` 未记录 `NIMI_MODS_ROOT/NIMI_RUNTIME_MODS_DIR` desktop release 契约。

### 6.4 Hotfix Closure Evidence (post-fix)

1. `release.yml` 已补 `NIMI_MODS_REF` 与 `release-desktop` external `nimi-mods` pinned checkout。
2. `release-desktop` 已注入：
   - `NIMI_MODS_ROOT=${{ github.workspace }}/nimi-mods`
   - `NIMI_RUNTIME_MODS_DIR=${{ github.workspace }}/nimi-mods`
3. `release-desktop` 已增加 `pnpm --filter @nimiplatform/desktop run env:check:mods-root`。
4. `release-desktop` 已增加 `pnpm build:sdk`（desktop bundling 依赖）。
5. `docs/dev/release.md` 已补 desktop 发布前置契约与本地 dry-run 命令。
6. `sdk/packages/realm/package.json` 已补 `exports["./*.js"]`，兼容 `.js` 深层导入。
7. 本地复现通过：
   - `pnpm -C /Users/snwozy/nimi-realm/nimi build:sdk`
   - `NIMI_MODS_ROOT=/Users/snwozy/nimi-realm/nimi/nimi-mods NIMI_RUNTIME_MODS_DIR=/Users/snwozy/nimi-realm/nimi/nimi-mods pnpm -C /Users/snwozy/nimi-realm/nimi/desktop run build:renderer:with-mods`
   - `pnpm -C /Users/snwozy/nimi-realm/nimi lint`

### 6.5 Remote workflow_dispatch rehearsal status (external blocker)

已执行命令：

1. `gh repo view nimiplatform/nimi --json name,defaultBranchRef,isPrivate,url,viewerPermission`
2. `gh api 'repos/nimiplatform/nimi/contents?ref=main' --jq '.[].name'`
3. `gh workflow run release.yml --repo nimiplatform/nimi --ref main -f target=desktop -f version=0.1.0 -f publish=false`

结果：

- 远端默认分支：`main`
- 远端 `main` 内容仅返回：`README.md`
- 触发 workflow 返回：`HTTP 404: workflow release.yml not found on the default branch`

结论：`workflow_dispatch` 演练在当前阶段被仓外环境阻断（远端仓库内容尚未同步到含 workflow 状态）。

## 7. Performance Baseline (P50 from 3 runs)

| ID | Command | min (ms) | p50 (ms) | max (ms) | spread (ms) | Verdict |
|---|---|---:|---:|---:|---:|---|
| PERF-01 | `pnpm -C /Users/snwozy/nimi-realm/nimi lint` | 17924 | 18276 | 18791 | 867 | PASS |
| PERF-02 | `pnpm -C /Users/snwozy/nimi-realm/nimi/desktop run typecheck` | 3231 | 3238 | 3268 | 37 | PASS |
| PERF-03 | `cargo test --manifest-path /Users/snwozy/nimi-realm/nimi/desktop/src-tauri/Cargo.toml` | 226 | 240 | 363 | 137 | PASS |
| PERF-04 | `pnpm -C /Users/snwozy/nimi-realm/nimi/nimi-mods run verify` | 5517 | 5518 | 5598 | 81 | PASS |
| PERF-05 | `cd /Users/snwozy/nimi-realm/nimi/runtime && go test ./...` | 540 | 578 | 1209 | 669 | PASS |

## 8. Finding-to-Evidence Map

| Finding ID | Level | Status | Direct Evidence |
|---|---|---|---|
| P0-01 | P0 | CLOSED | historical gap + `release.yml` hotfix + local successful build evidence |
| P1-01 | P1 | CLOSED | `release.yml` now aligned with CI external pinned mods strategy |
| P1-02 | P1 | CLOSED | `docs/dev/release.md` now includes desktop mods release contract |
| P2-01 | P2 | OPEN | `ssot/platform/open-source-governance.md` OSG-P2-03 pending |
