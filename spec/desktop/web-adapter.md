# Web Adapter Domain Spec

> Normative Imports: `spec/desktop/kernel/*`
> Status: Draft
> Date: 2026-03-01

## Scope

Web 适配器功能域 — Web 环境下的 shell 降级策略、feature flag 差异、存储适配。

## Module Map

- `apps/web/` — Web 适配器入口
- `apps/_libs/shell-core/src/shell-mode.ts` — Shell 模式检测与 feature flags

## Kernel References

### Shell (D-SHELL-001)

Web 模式下以下 Tab 不可见：
- `runtime`（`enableRuntimeTab = false`）
- `marketplace`（`enableMarketplaceTab = false`）

### Shell (D-SHELL-002)

Web 模式下以下功能禁用：
- `enableModUi = false` — Mod UI 渲染
- `enableModWorkspaceTabs = false` — Mod workspace tabs
- `enableSettingsExtensions = false` — Settings 扩展区域

### Shell (D-SHELL-003)

Web 模式下窗口管理禁用：
- `enableTitlebarDrag = false`

### Bootstrap (D-BOOT-004)

Web 模式下 `enableRuntimeBootstrap = false`：
- 跳过 runtime host 装配。
- 跳过 mod 注册。
- 跳过 external agent 桥接。
- 设置空的 manifest summaries 和 mod IDs。

### Auth (D-AUTH-003)

Web 模式 token 存储使用 localStorage 而非 Tauri backend。

### IPC (D-IPC-009)

Web 模式下 `hasTauriInvoke()` 返回 `false`，所有 IPC 命令不可用。

**Fetch 替代策略**：Web 模式使用浏览器原生 `fetch()` 替代 `createProxyFetch()`（`D-NET-004`）。Realm backend 必须配置正确的 CORS 头（`Access-Control-Allow-Origin`）以支持跨域请求。DataSync 在 `initApi()` 时根据 shell 模式选择 fetch 实现。

### Web Bootstrap 序列 (D-BOOT-001~011 投影)

Web 模式的 bootstrap 序列是 Desktop bootstrap 的子集，跳过所有 Runtime/IPC 依赖的步骤：

| Desktop 阶段 | Web 行为 | 说明 |
|---|---|---|
| D-BOOT-001 Runtime Defaults | **替换** — 从环境变量/构建时配置获取 `realmBaseUrl`、`realtimeUrl` | 无 daemon，不调用 `runtime_defaults` IPC |
| D-BOOT-002 Platform Client 初始化 | **保留** — 使用构建时配置初始化 | 与 Desktop 等价 |
| D-BOOT-003 DataSync 初始化 | **保留** — `fetchImpl` 使用浏览器原生 `fetch()`（非 proxy fetch） | CORS 由 Realm backend 头控制 |
| D-BOOT-004 Runtime Host | **跳过** — `enableRuntimeBootstrap=false` | 无 Runtime |
| D-BOOT-005 Mods 注册 | **跳过** | 无 mod 支持 |
| D-BOOT-006 External Agent | **跳过** | 无 agent 桥 |
| D-BOOT-007 Auth Session | **保留** — token 存储使用 localStorage（D-AUTH-003） | 与 Desktop 等价（存储后端不同） |
| D-BOOT-008 完成/错误 | **保留** | 与 Desktop 等价 |
| D-BOOT-009 幂等性守卫 | **保留** | 与 Desktop 等价 |
| D-BOOT-010 初始数据加载 | **保留** | 与 Desktop 等价 |
| D-BOOT-012 Realm 可达性 | **保留** — 同 Desktop 隐式验证策略 | 与 Desktop 等价 |

**Web 有效 bootstrap 路径**：`D-BOOT-001(替换)` → `D-BOOT-002` → `D-BOOT-003` → `D-BOOT-007` → `D-BOOT-008` → `D-BOOT-010`。

**Web 特有约束**：
- 无 SSR 支持——bootstrap 仅在客户端执行。
- 无 service worker 缓存——所有请求直接发出。
- Auth 流差异：Web 使用浏览器 redirect OAuth（非 Tauri deep link），token 存储在 localStorage（非 Tauri secure storage）。

### Shell Mode Detection (D-SHELL-008)

Shell 模式检测规则（检测优先级见 `D-SHELL-008`）。

## CI 门禁引用

本域涉及的 CI 门禁：`pnpm check:desktop-spec-kernel-consistency`。
