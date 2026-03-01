# Mod Codegen Domain Spec

> Status: Active
> Date: 2026-03-01
> Scope: AI 驱动的本地 Mod 生成——codegen 生命周期、产物合同、capability 分级、build/preflight、治理链对齐。
> Normative Imports: `spec/desktop/kernel/*`

## 0. 权威导入

本文件不再重复定义跨域通用契约，统一导入 kernel 规则：

- Mod 治理：`kernel/mod-governance-contract.md`（`D-MOD-*`）
- Hook 能力模型：`kernel/hook-capability-contract.md`（`D-HOOK-*`）

## 1. 领域不变量

`CODEGEN-*` 为 Mod Codegen 领域增量规则（非 kernel 通用规则）。

- `CODEGEN-001`: Codegen mod 不得绕过 `D-MOD-001` 至 `D-MOD-008` 的 8 阶段执行内核。
- `CODEGEN-002`: Codegen 是"受约束填空题"，不是通用任意代码生成——生成空间受 import 白名单、capability 白名单、runtime contract 三类约束。
- `CODEGEN-003`: 默认最小权限，所有越权调用 fail-close，并写审计（对齐 `D-MOD-008` 审计阶段）。
- `CODEGEN-004`: Codegen mod 不复用 `sideload` 默认放权，使用 `codegen` sourceType 绑定独立 allowlist（对齐 `D-HOOK-007` source-type 权限网关中 `codegen` 级别）。

## 2. 核心价值

| # | 支柱 | 意义 |
|---|------|------|
| 1 | `nimi-runtime` 访问 | 生成 mod 可直接消费 AI 推理能力 |
| 2 | `nimi-realm` 访问 | 通过受控数据能力接入社交/世界等域数据 |
| 3 | 权限与沙箱治理 | 声明上限 + 用户授权子集 + 运行时强制检查（对齐 `D-MOD-005` sandbox/policy） |

## 3. 端到端流程

```
用户输入自然语言描述
    |
[Mod Generator Skill]
    |- 解析需求 -> 选择模板 -> 产出源码
    +- 产出: mod.manifest.yaml + index.ts + src/*
    |
[Local Build + Preflight]
    |- esbuild bundle -> dist/index.js
    |- manifest schema/compat 校验（D-MOD-002）
    |- capability catalog 校验（CODEGEN-020 T0/T1/T2）
    |- 静态扫描（CODEGEN-040 禁用模式）
    +- 生成 hash + .codegen-meta.json
    |
[Install Transaction]
    |- 进入 D-MOD-001 至 D-MOD-008 完整 8 阶段治理链
    |- 在 D-MOD-005 sandbox/policy 阶段触发 T1 授权
    +- codegen sourceType（D-HOOK-007）生效
    |
[Runtime Register + UI Sync]
    |- setup() 注册 data/ui/event/llm
    +- 出现在 sidebar / mod 管理列表
    |
用户迭代描述 -> 增量修改 -> rebuild -> reload
```

## 4. 生成产物合同

### 4.1 目录结构

```
{runtime_mods_root}/user/{slug}/
|- mod.manifest.yaml
|- index.ts
|- src/
|   |- index.ts
|   |- view.tsx
|   |- logic.ts
|   +- types.ts
|- dist/
|   +- index.js
+- .codegen-meta.json
```

### 4.2 Manifest 规则（V1）

- `CODEGEN-010`: `id` 必须匹配现有校验 regex，强制前缀 `world.nimi.user.`。
- `CODEGEN-011`: `entry` 固定 `./dist/index.js`。
- `CODEGEN-012`: `capabilities` 必填。
- `CODEGEN-013`: `nimi.minVersion/maxVersion` 必填（对齐 `D-MOD-002` manifest/compat）。
- `CODEGEN-014`: `hash` 必填（由 build 产出回填）。
- `CODEGEN-015`: 禁止 wildcard capability（`*` / `:*` / `.*`）。

### 4.3 Runtime Registration 规则（V1）

- `CODEGEN-016`: 生成 `src/index.ts` 必须导出 `createRuntimeMod`，`capabilities` 必须是 `manifest.capabilities` 子集。
- `CODEGEN-017`: `setup` 只通过 `@nimiplatform/sdk/mod/*` 暴露的稳定导入面调用 host 能力。

## 5. Capability 模型（Codegen 专用）

### 5.1 分级

对齐 `D-HOOK-007` source-type 权限网关中 `codegen` 为最小权限级别：

- `CODEGEN-020`: T0（自动授权）：`llm.text.generate`、`llm.text.stream`、`ui.register.ui-extension.app.*`、`data.{register|query}.data-api.user-{slug}.{resource}.{action}`。
- `CODEGEN-021`: T1（需用户同意）：`llm.image.generate`、`llm.video.generate`、`llm.embedding.generate`、`llm.speech.*`（对齐 `D-HOOK-008` LLM capability 域）、受控只读 core data capability。
- `CODEGEN-022`: T2（硬拒绝）：高风险本地能力、平台受保护写能力、`audit.read.all`（对齐 `D-HOOK-010` 仅 builtin 可用）、`meta.read.all`、turn/inter-mod/action（对齐 `D-HOOK-003` codegen 不允许 turn hook / `D-HOOK-009` codegen 无 action）、未登记 capability。

### 5.2 授权执行

- `CODEGEN-023`: 运行时使用 `D-MOD-005` sandbox/policy 阶段语义：manifest.capabilities 作为 baseline 上限，用户同意写入 grant，拒绝写入 denial，每次调用由 `D-HOOK-006` capability 匹配实时判定。

## 6. 导入约束（SDK 投影）

### 6.1 允许导入（V1）

- `CODEGEN-030`: `@nimiplatform/sdk/mod/ai`、`@nimiplatform/sdk/mod/hook`、`@nimiplatform/sdk/mod/types`、`@nimiplatform/sdk/mod/ui`、`@nimiplatform/sdk/mod/logging`、`@nimiplatform/sdk/mod/i18n`、`@nimiplatform/sdk/mod/settings`、`@nimiplatform/sdk/mod/utils`、`react`/`react/jsx-runtime`。

### 6.2 禁止导入（V1）

- `CODEGEN-031`: `@nimiplatform/sdk/mod` root import、`@nimiplatform/sdk/mod/host`、`@nimiplatform/sdk/mod/internal/*`、`@nimiplatform/sdk/mod/model-options`、`@nimiplatform/sdk/mod/runtime-route`、任意第三方 npm 新依赖。

### 6.3 V1 不开放（硬约束）

- `CODEGEN-032`: `turn.register.*`、`inter-mod.*`、`action.*`（对齐 `D-HOOK-003`/`D-HOOK-005`/`D-HOOK-009` codegen 限制）。
- `CODEGEN-033`: 任何 `network/filesystem/process/economy-write/identity-write/platform-cloud-write`、`eval`/`new Function`/动态执行、直接 `fetch/XMLHttpRequest/WebSocket` 访问外部网络。

## 7. Build + Preflight

### 7.1 esbuild 方案

- `CODEGEN-040`: esbuild 核心配置：`format: 'esm'`、`platform: 'browser'`、`target: 'es2022'`、`jsx: 'automatic'`、`external: ['react', 'react-dom', 'react/jsx-runtime', '@nimiplatform/sdk/mod', '@nimiplatform/sdk/mod/*']`。

### 7.2 Preflight 检查

- `CODEGEN-041`: manifest schema 校验（含 id/version/nimi/hash/entry/capabilities）。
- `CODEGEN-042`: capability catalog 校验（T0/T1/T2 分级，`CODEGEN-020` 至 `CODEGEN-022`）。
- `CODEGEN-043`: bundle 静态扫描（`CODEGEN-044` 禁用模式）。
- `CODEGEN-044`: 静态扫描禁用模式：`eval(`、`new Function(`、`fetch(`、`XMLHttpRequest`、`WebSocket(`、`importScripts(`、`process.env`、`require(`、直接 `localStorage` 读写、`import ... from '@nimiplatform/sdk/mod/host'`。
- `CODEGEN-045`: 体积阈值校验（默认 512KB，可配置）。

## 8. 治理链对齐

Codegen mod 必须进入与其他 mod 同一治理链事务（`D-MOD-001` 至 `D-MOD-008`），不允许旁路：

| 阶段 | Kernel 规则 | Codegen 增量 |
|------|-------------|-------------|
| Discovery | `D-MOD-001` | 新增 `HookSourceType='codegen'`（`D-HOOK-007`） |
| Manifest/Compat | `D-MOD-002` | 与现有 manifest validator 一致 |
| Signature/Auth | `D-MOD-003` | `ALLOW_WITH_WARNING`（本地用户生成） |
| Dependency/Build | `D-MOD-004` | 使用 build 产物与依赖图结果 |
| Sandbox/Policy | `D-MOD-005` | capability 分级 + 用户授权结果 |
| Load | `D-MOD-006` | 仅加载通过 preflight 的 bundle |
| Lifecycle | `D-MOD-007` | `setup` 成功后才标记启用 |
| Audit | `D-MOD-008` | 全链路写入本地审计 |

## 9. Hot-Reload 与生命周期

- `CODEGEN-050`: Reload 流程：修改描述 -> 重新生成源码 -> rebuild/preflight -> disable/unload(old) -> install/load(new) -> setup(new) -> UI sync。
- `CODEGEN-051`: 在现有 `setup` 基础上补充可选 teardown 合同（对齐 `D-MOD-007` lifecycle 阶段），确保定时器/后台任务可回收、事件/UI/data 注册可完整释放、reload 不累积幽灵副作用。

## 10. 验收门禁

- `CODEGEN-060`: 端到端：描述 -> 生成 -> build -> install -> 可交互。
- `CODEGEN-061`: codegen mod 不走旁路注册，必须完整进入 8 阶段治理链（`D-MOD-001` 至 `D-MOD-008`）。
- `CODEGEN-062`: capability catalog 生效：T2 必拒绝，T1 必确认。
- `CODEGEN-063`: 权限拒绝后运行时调用 fail-close 且可审计（`D-MOD-008`）。
- `CODEGEN-064`: 静态扫描可拦截禁用模式（`CODEGEN-044`）。
- `CODEGEN-065`: reload 无重复注册与资源泄漏。
- `CODEGEN-066`: 至少 3 个场景稳定可用。
- `CODEGEN-067`: 执行结果与证据归档必须写入 `dev/report/*`。

回归命令：

1. `pnpm -C apps/desktop run typecheck`
2. `pnpm -C apps/desktop run test:unit`
3. `pnpm -C apps/desktop run test`

## 11. 风险闸门与回滚策略

- `CODEGEN-070`: 权限闸门：T2 永不放行；T1 无用户同意绝不放行。
- `CODEGEN-071`: 治理闸门：codegen mod 审计记录必须包含完整 8 阶段（`D-MOD-008`）。
- `CODEGEN-072`: 生命周期闸门：连续 30 次 reload 不出现注册泄漏或重复副作用。
- `CODEGEN-073`: 安全闸门：静态扫描 + import 白名单双重通过后才允许 install。
- `CODEGEN-074`: 功能开关回滚：关闭 codegen 入口，仅保留现有 sideload/marketplace 能力。
- `CODEGEN-075`: 事务回滚：install 任一阶段失败则不写入已启用状态，不污染 `registeredMods`。

## 12. 本文件非目标

- 不定义 8 阶段执行内核（见 kernel `D-MOD-001` 至 `D-MOD-008`）
- 不定义 5 个 hook 子系统（见 kernel `D-HOOK-001` 至 `D-HOOK-005`）
- 不定义 source-type 权限网关完整白名单（见 kernel `D-HOOK-007`）
- 不定义 capability key 格式与匹配语义（见 kernel `D-HOOK-006`）
- 不定义通用代码生成平台，不覆盖第三方 App 生成

## 13. 变更规则

修改 mod codegen 领域时必须同时满足：

1. 若触及 8 阶段治理链规则，先改 `spec/desktop/kernel/mod-governance-contract.md`
2. 若触及 hook 能力模型规则，先改 `spec/desktop/kernel/hook-capability-contract.md`
3. 再改本文件的领域增量规则
4. 禁止在本文件新增 kernel 规则副本
