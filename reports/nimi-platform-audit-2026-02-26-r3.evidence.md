# Nimi 发布前审计证据索引 R3

- Date: 2026-02-26
- Workspace: `/Users/snwozy/nimi-realm/nimi`
- Evidence policy: in-repo reproducible only
- Report: `/Users/snwozy/nimi-realm/nimi/reports/nimi-platform-audit-2026-02-26-r3.md`

## 1. 关键命令与结果

### 1.1 覆盖率

1. `pnpm check:runtime-go-coverage`
   - 结果：`total statements coverage: 34.4%`
   - 门限来源：`scripts/check-runtime-go-coverage.mjs` 默认 `30%`
2. `pnpm check:sdk-coverage`
   - 结果：`lines 91.05% / branches 70.83% / functions 90.63%`
   - 门限来源：`scripts/check-sdk-coverage.mjs` 默认 `90/70/90`

### 1.2 测试体系与 CI

1. Desktop/Web 本地脚本存在 test：
   - `apps/desktop/package.json`：`test`、`test:unit`
   - `apps/web/package.json`：`test`
2. CI `desktop-web-quality` 未执行 Desktop/Web TS 测试：
   - 仅执行 mods smoke、Rust tests、typecheck、web build
3. 未检出浏览器 E2E 依赖/执行链路：
   - 未发现 `playwright` / `cypress` / `@testing-library/*`

### 1.3 可观测性

1. Runtime HTTP 端点：
   - `/livez` `/readyz` `/healthz` `/v1/runtime/health`
2. `runtime/go.mod` 未包含 OTel/Prometheus 运行时依赖。

## 2. 文件证据锚点

### 2.1 覆盖率门禁脚本

1. `scripts/check-runtime-go-coverage.mjs`
   - 默认门限：`NIMI_RUNTIME_MIN_STATEMENTS_COVERAGE || '30'`
2. `scripts/check-sdk-coverage.mjs`
   - 默认门限：`lines 90 / branches 70 / functions 90`

### 2.2 CI 结构

1. `.github/workflows/ci.yml`
   - `sdk-quality`：包含 SDK test + coverage gate
   - `runtime-quality`：包含 go coverage gate
   - `desktop-web-quality`：未见 desktop/web test 执行步骤

### 2.3 文档与 SDK 入口

1. `sdk/README.md`
   - 包根 README 主要为中文约束说明
2. `docs/sdk/README.md`
   - docs 站英文 SDK 指南与示例

### 2.4 可观测性与健康状态

1. `runtime/internal/httpserver/server.go`
   - 仅健康与运行状态 JSON 接口
2. `runtime/go.mod`
   - 无 OTel/Prometheus 导出依赖
3. `runtime/internal/health/state.go`
   - Runtime health 状态机定义
4. `runtime/internal/daemon/daemon.go`
   - STARTING/READY/DEGRADED/STOPPING 生命周期与采样逻辑

### 2.5 发布与治理

1. `apps/desktop/src-tauri/tauri.conf.json`
   - 当前无 updater 配置
2. `.gitignore`
   - 未显式包含 `.env*`
3. `CODEOWNERS`
   - 单 owner（`@hallida`）

## 3. 校正点证据

1. “无 GoDoc”校正：
   - `runtime/internal/health/state.go` 等文件存在导出注释。
2. “无 Troubleshooting 文档”校正：
   - `docs/dev/setup.md`、`docs/mods/README.md` 均有 Troubleshooting 章节。
3. “main-layout-view 823 行”校正：
   - 当前 `apps/desktop/src/shell/renderer/app-shell/layouts/main-layout-view.tsx` 实际行为 844 行。
