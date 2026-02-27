---
title: Nimi Mod Codegen — AI-Driven Local Mod Generation
status: DRAFT
created_at: 2026-02-24
updated_at: 2026-02-25
parent: INDEX.md
references:
  - ssot/mod/governance.md
  - ssot/platform/protocol.md
  - ssot/platform/architecture.md
  - ssot/runtime/service-contract.md
  - ssot/runtime/workflow-dag.md
rules:
  - This SSOT is maintained in @nimiplatform/nimi and follows no-legacy mode.
  - Changes must preserve traceability to source and contract-level acceptance gates.
---
---

# Mod Codegen — 用户描述驱动的本地 Mod 生成（实现对齐版）

## 0. 文档定位

本文件定义 `@nimiplatform/nimi/desktop` 中“用户自然语言描述需求，AI 自动生成并加载本地 mod”的能力设计。

- 当前状态：`DRAFT`
- 用途：可行性论证 + 架构设计 + 实现路径（对齐当前代码基线）
- 非目标：
  - 不定义通用代码生成平台
  - 不覆盖第三方 App 生成
  - 不在 V1 引入独立 `@nimiplatform/sdk/realm` / `@nimiplatform/sdk/runtime` 直连调用面

## 1. 核心价值

Mod Codegen 的核心价值仍是三大支柱：

| # | 支柱 | 意义 |
|---|------|------|
| 1 | `nimi-runtime` 访问 | 生成 mod 可直接消费 AI 推理能力 |
| 2 | `nimi-realm` 访问 | 通过受控数据能力接入社交/世界等域数据 |
| 3 | 权限与沙箱治理 | 声明上限 + 用户授权子集 + 运行时强制检查 |

重点：Codegen 不是“生成一个 UI demo”，而是“生成一个可被治理链约束的可运行 mod”。

## 2. 当前基线（As-Is）

### 2.1 已具备

| 能力 | 当前状态 | 说明 |
|------|---------|------|
| sideload 清单扫描 | 已有 | `runtime_mod_list_local_manifests` + `discoverSideloadRuntimeMods` |
| 运行时注册/卸载 | 已有 | `registerRuntimeMods` / `unregisterRuntimeMods` |
| Hook 权限网关 | 已有 | baseline/grant/denial + 默认 source allowlist |
| 本地 mod 存储 | 已有 | 开发态强制 `NIMI_RUNTIME_MODS_DIR`（绝对路径）；release: `app_data_dir/mods` |
| mod 编译实践 | 部分已有 | 现有 mod（如 kismet）已用 esbuild 打包 |

### 2.2 未闭环（必须补齐）

| 缺口 | 影响 |
|------|------|
| Codegen 产物加载路径当前未强制走 execution-kernel `install` 事务 | 与 L0/SSOT 的 8 阶段治理链口径不一致 |
| 缺少 codegen 专用 sourceType 与最小默认权限 | 复用 `sideload` 默认 allowlist 会过宽 |
| 缺少“生成前/加载前”静态扫描与 capability catalog 校验 | 无法阻断高风险代码模式 |
| 缺少面向 codegen 的权限授权 UX（T1 选择性授权） | 用户无法精细控制授予子集 |
| mod 生命周期仅有 `setup`，缺少显式 `teardown` 合同 | hot-reload 时后台资源回收不完整 |

## 3. 约束原则（必须遵守）

1. 治理链固定 8 环节：
`discovery -> manifest/compat -> signature/auth -> dependency/build -> sandbox/policy -> load -> lifecycle -> audit`。
2. Codegen mod 不得绕过 `execution-kernel + hook + llm-adapter`。
3. 默认最小权限，所有越权调用 fail-close，并写审计。
4. 与 `docs/INTENT.md` 对齐：聊天域仍是 DIRECT 口径，不引入群聊语义作为默认生成目标。

## 4. 目标架构（To-Be）

### 4.1 端到端流程

```
用户输入自然语言描述
    ↓
[Mod Generator Skill]
    ├── 解析需求 -> 选择模板 -> 产出源码
    └── 产出: mod.manifest.yaml + index.ts + src/*
    ↓
[Local Build + Preflight]
    ├── esbuild bundle -> dist/index.js
    ├── manifest schema/compat 校验
    ├── capability catalog 校验 (T0/T1/T2)
    ├── 静态扫描 (禁用模式)
    └── 生成 hash + .codegen-meta.json
    ↓
[Install Transaction]
    ├── 进入 execution-kernel 安装事务
    ├── 走完整治理链 8 阶段
    └── 在 sandbox/policy 阶段触发 T1 授权
    ↓
[Runtime Register + UI Sync]
    ├── setup() 注册 data/ui/event/llm
    └── 出现在 sidebar / mod 管理列表
    ↓
用户迭代描述 -> 增量修改 -> rebuild -> reload
```

### 4.2 设计边界

- Codegen 是“受约束填空题”，不是通用任意代码生成。
- 生成空间受以下三类约束：
  1. import 白名单
  2. capability 白名单
  3. runtime contract（manifest + registration + hook contracts）

## 5. 生成产物合同

### 5.1 目录结构（对齐当前 runtime mods root）

```
{runtime_mods_root}/user/{slug}/
├── mod.manifest.yaml
├── index.ts
├── src/
│   ├── index.ts
│   ├── view.tsx
│   ├── logic.ts
│   └── types.ts
├── dist/
│   └── index.js
└── .codegen-meta.json
```

`runtime_mods_root` 解析规则：
1. 开发态：`NIMI_RUNTIME_MODS_DIR`（必填）
2. 本地联调默认：`NIMI_RUNTIME_MODS_DIR == NIMI_MODS_ROOT`
3. release：`app_data_dir/mods`

### 5.2 manifest 规则（V1）

- `id` 必须匹配现有校验 regex，且强制前缀：`world.nimi.user.`
- `entry` 固定 `./dist/index.js`
- `capabilities` 必填
- `nimi.minVersion/maxVersion` 必填
- `hash` 必填（由 build 产出回填）
- 禁止 wildcard capability（`*` / `:*` / `.*`）

### 5.3 runtime registration 规则（V1）

生成 `src/index.ts` 必须导出 `createRuntimeMod`，返回：

```ts
{
  modId: string,
  capabilities: string[],
  setup: async (ctx) => { ... }
}
```

并满足：
- `capabilities` 必须是 `manifest.capabilities` 子集
- `setup` 只通过 `@nimiplatform/sdk/mod/*` 暴露的稳定导入面调用 host 能力

## 6. API 约束（SDK 投影，非 SDK 规范真相源）

说明：
1. 本节仅描述 Mod 打包与运行时生成代码对 SDK 的消费约束。
2. `@nimiplatform/sdk/*` 的规范真相源固定为 `ssot/sdk/*`（特别是 `ssot/sdk/mod-contract.md` 与 `ssot/sdk/package-surface.md`）。
3. 若本节与 `ssot/sdk/*` 冲突，以 `ssot/sdk/*` 为准。

### 6.1 允许导入（V1）

- `@nimiplatform/sdk/mod/ai`
- `@nimiplatform/sdk/mod/hook`
- `@nimiplatform/sdk/mod/types`
- `@nimiplatform/sdk/mod/ui`
- `@nimiplatform/sdk/mod/logging`
- `@nimiplatform/sdk/mod/i18n`
- `@nimiplatform/sdk/mod/settings`
- `@nimiplatform/sdk/mod/utils`
- `react` / `react/jsx-runtime`

### 6.2 禁止导入（V1）

- `@nimiplatform/sdk/mod` root import
- `@nimiplatform/sdk/mod/host`（虽有导出，但仅 runtime 装配层可用）
- `@nimiplatform/sdk/mod/internal/*`
- `@nimiplatform/sdk/mod/model-options`
- `@nimiplatform/sdk/mod/runtime-route`
- `@nimiplatform/*`（旧命名）
- 任意第三方 npm 新依赖

### 6.3 允许调用（示例）

```ts
// hook
await hook.data.register({ capability, handler });
await hook.data.query({ capability, query });
await hook.ui.register({ slot, priority, extension });
await hook.event.subscribe({ topic, handler });
await hook.event.publish({ topic, payload });
await hook.llm.text.generate({ provider, prompt });
await hook.llm.text.stream({ provider, prompt });
await hook.llm.image.generate({ provider, prompt });
await hook.llm.video.generate({ provider, prompt });
await hook.llm.embedding.generate({ provider, input });
await hook.llm.speech.listProviders();
await hook.llm.speech.listVoices({ providerId });
await hook.llm.speech.synthesize({ text, voiceId });
await hook.llm.speech.stream.open({ text, voiceId });
await hook.llm.speech.stream.control({ streamId, action: 'pause' });
await hook.llm.speech.stream.close({ streamId });
await hook.llm.speech.transcribe({ provider, audioUri });
await hook.llm.checkHealth({ provider });
await hook.llm.checkRouteHealth({ routeHint });

// ai client
await ai.resolveRoute({ routeHint });
await ai.checkRouteHealth({ routeHint });
await ai.generateText({ routeHint, prompt });
for await (const chunk of ai.streamText({ routeHint, prompt })) { ... }
await ai.generateObject({ routeHint, prompt });
await ai.generateImage({ routeHint, prompt });
await ai.generateVideo({ routeHint, prompt });
await ai.generateEmbedding({ routeHint, input });
await ai.synthesizeSpeech({ routeHint, text, voiceId });
await ai.transcribeAudio({ routeHint, audioUri });
```

说明：完整签名以 `sdk/src/mod/types/runtime-hook/llm.ts` 与 `sdk/src/mod/ai/types.ts` 为准；本节仅给出 codegen 常用集合。

### 6.4 V1 不开放（硬约束）

- `turn.register.*`
- `inter-mod.*`
- `action.*`
- 任何 `network/filesystem/process/economy-write/identity-write/platform-cloud-write`
- `eval` / `new Function` / 动态执行
- 直接 `fetch/XMLHttpRequest/WebSocket` 访问外部网络

说明：以上能力在平台层存在，但 codegen V1 为最小风险闭环，先不开放。

## 7. Capability 模型（Codegen 专用）

> 目标：codegen mod 不复用 `sideload` 默认放权，而是最小权限起步。
> 现状：当前 `HookSourceType` 仅有 `builtin|injected|sideload|core`；V1 需新增 `codegen` 并绑定独立 allowlist。

### 7.1 分级

| 级别 | 策略 | 示例 |
|------|------|------|
| T0 | 自动授权 | `llm.text.generate`, `llm.text.stream`, `ui.register.ui-extension.app.*`, `data.{register|query}.data-api.user-{slug}.{resource}.{action}` |
| T1 | 需用户同意 | `llm.image.generate`, `llm.video.generate`, `llm.embedding.generate`, `llm.speech.*`, 受控只读 core data capability |
| T2 | 硬拒绝 | 高风险本地能力、平台受保护写能力、`audit.read.all`、`meta.read.all`、turn/inter-mod/action、未登记 capability |

data capability 命名约定（V1）：
- `data.{register|query}.data-api.{domain}.{resource}.{action}`
- codegen 默认 domain：`user-{slug}`

### 7.2 授权执行

运行时使用现有权限网关语义：
- `manifest.capabilities` 作为 baseline 上限
- 用户同意写入 grant
- 用户拒绝写入 denial
- 每次调用由 permission gateway 实时判定

## 8. Build + Preflight 设计

### 8.1 esbuild 方案

沿用当前 mod 构建实践，核心配置：

```ts
await esbuild.build({
  entryPoints: [path.join(modDir, 'index.ts')],
  bundle: true,
  outfile: path.join(modDir, 'dist/index.js'),
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  external: ['react', 'react-dom', 'react/jsx-runtime', '@nimiplatform/sdk/mod', '@nimiplatform/sdk/mod/*'],
  splitting: false,
});
```

### 8.2 preflight 检查

1. manifest schema 校验（含 id/version/nimi/hash/entry/capabilities）
2. capability catalog 校验（T0/T1/T2）
3. bundle 静态扫描（禁用模式）
4. 体积阈值校验（默认 512KB，可配置）
5. 生成 hash 并回写 manifest

### 8.3 静态扫描禁用模式（V1）

- `eval(`
- `new Function(`
- `fetch(`
- `XMLHttpRequest`
- `WebSocket(`
- `importScripts(`
- `process.env`
- `require(`
- 直接 `localStorage` 读写（应走受控数据能力）
- `import ... from '@nimiplatform/sdk/mod/host'`

## 9. 治理链对齐要求

Codegen mod 必须进入与其他 mod 同一治理链事务，不允许“只 discover+register+setup”的旁路。

| 阶段 | Codegen 要求 |
|------|--------------|
| discovery | 新增 `HookSourceType='codegen'` 并写入注册源（当前代码基线尚未存在该枚举值） |
| manifest/compat | 与现有 manifest validator 一致 |
| signature/auth | `ALLOW_WITH_WARNING`（本地用户生成）|
| dependency/build | 使用 build 产物与依赖图结果 |
| sandbox/policy | capability 分级 + 用户授权结果 |
| load | 仅加载通过 preflight 的 bundle |
| lifecycle | `setup` 成功后才标记启用 |
| audit | 全链路写入本地审计 |

## 10. Hot-Reload 与生命周期

### 10.1 Reload 流程

```
修改描述 -> 重新生成源码 -> rebuild/preflight
    -> disable/unload(old)
    -> install/load(new)
    -> setup(new)
    -> UI sync
```

### 10.2 生命周期补强（V1 必需）

在现有 `setup` 基础上补充可选 teardown 合同（或等价回收机制），确保：
- 定时器/后台任务可回收
- 事件/UI/data 注册可完整释放
- reload 不累积幽灵副作用

## 11. 用户 mod 管理

### 11.1 .codegen-meta.json（建议字段）

```json
{
  "createdAt": "2026-02-24T10:30:00Z",
  "updatedAt": "2026-02-24T11:15:00Z",
  "template": "quiz",
  "originalPrompt": "给我三年级孩子做一个每日数学题测试",
  "revisionHistory": [
    {
      "prompt": "加入乘除法，而且每次 10 道题",
      "timestamp": "2026-02-24T10:45:00Z"
    }
  ],
  "modelUsed": "deepseek-v3",
  "routePolicy": "token-api",
  "lastBuildHash": "sha256:...",
  "grantedCapabilities": [
    "llm.text.generate",
    "data.register.data-api.user-math-quiz.records.upsert",
    "data.query.data-api.user-math-quiz.records.list"
  ]
}
```

### 11.2 用户操作

| 操作 | 入口 | 说明 |
|------|------|------|
| 创建 | “创建工具”入口 | 进入 codegen 对话流 |
| 迭代 | mod 管理页 -> 编辑 | 增量修改并 reload |
| 删除 | mod 管理页 -> 删除 | 删除目录 + 卸载 |
| 导出 | mod 管理页 -> 导出 | 打包 `src + manifest + meta` |
| 分享 | FUTURE | 进入 Mod Circle 审核 |

## 12. 版本策略

### V1（可上线最小闭环）

- Mod Generator Skill（模板 + few-shot + capability catalog）
- 本地 esbuild 编译 + preflight
- codegen sourceType + 默认最小权限
- T1 授权 UX（grant/deny 可持久化）
- 通过 execution-kernel 完整治理链安装
- reload（含 teardown）

### V2

- 多轮对话上下文压缩
- 代码预览/手动编辑
- 更丰富模板库
- 受控开放 `turn` / `inter-mod`（附加策略门禁）

### V3

- 自动生成 smoke tests
- 版本回滚
- 组合式生成（基于现有 mod 进行重构生成）

## 13. 发布门槛

1. 端到端：描述 -> 生成 -> build -> install -> 可交互。
2. codegen mod 不再走旁路注册，必须完整进入 8 阶段治理链。
3. capability catalog 生效：T2 必拒绝，T1 必确认。
4. 权限拒绝后运行时调用 fail-close 且可审计。
5. 静态扫描可拦截禁用模式。
6. reload 无重复注册与资源泄漏。
7. 至少 3 个场景稳定可用（含“三年级数学题”）。
8. 执行结果与证据归档必须写入 `dev/report/*`，不得在 SSOT 以勾选状态记录。

## 14. 待定项

| 项 | 说明 | 阻塞 |
|----|------|------|
| codegen sourceType 命名 | 已收敛为 `codegen`（HookSourceType 已扩展） | 已关闭（2026-02-25） |
| T1 只读 core data 范围 | 允许哪些 `data-api.core.*` 查询项 | V1 |
| wildcard 语法统一 | 已统一为 glob 匹配语义（preflight/sandbox/hook 一致） | 已关闭（2026-02-25） |
| hash 与签名策略 | 本地 hash 必填，是否追加本地签名 | V1 |
| 生成模型策略 | 本地模型 vs 云端模型 | V1 |
| 组件原语库 | 提供预置 UI 原语还是裸 React 元素 | V2 |

## 15. V1 执行任务拆分（单闭环落地）

> 原则：不做“双轨并存中间态”，直接收口到 codegen 走统一治理链。

| ID | 任务 | 主要目录/文件（建议） | 完成定义（DoD） | 依赖 |
|----|------|-------------------------|-----------------|------|
| CG-01 | 新增 codegen 产物与 build/preflight 管线 | `apps/desktop/src/runtime/mod/codegen/*`（新增） | 可从 prompt 生成 `manifest + src + dist + .codegen-meta.json`，preflight 可独立执行并返回结构化错误 | 无 |
| CG-02 | 接入 codegen install 事务（禁止旁路 register） | `apps/desktop/src/runtime/mod/registration.ts` `apps/desktop/src/runtime/mod/host/lifecycle-register.ts` `apps/desktop/src/runtime/execution-kernel/kernel/flows/install-flow.ts` | codegen mod 安装必须调用 kernel `install` 并产出完整 8 阶段审计轨迹 | CG-01 |
| CG-03 | 扩展 sourceType 到 `codegen` 并收敛默认权限 | `apps/desktop/src/runtime/hook/contracts/types.ts` `apps/desktop/src/runtime/hook/contracts/capabilities.ts` `apps/desktop/src/runtime/hook/permission/permission-gateway.ts` `apps/desktop/src/runtime/execution-kernel/policy/policy-engine.ts` | `codegen` sourceType 生效；默认 allowlist 仅含 T0 子集；PolicyEngine 对 `codegen` 启用 HIGH_RISK 拒绝（不沿用 sideload 例外）；未授权 capability fail-close | CG-02 |
| CG-04 | 引入 capability catalog（T0/T1/T2）与 preflight 对齐 | `apps/desktop/src/runtime/mod/codegen/*` `apps/desktop/src/runtime/execution-kernel/policy/policy-engine.ts` `apps/desktop/src/runtime/execution-kernel/sandbox/sandbox-manager.ts` | preflight 和 runtime policy 使用同一 catalog 真相；T2 在 build 前与运行时均拒绝；wildcard 语法在 preflight/sandbox/hook 三层统一 | CG-01 |
| CG-05 | 补齐 T1 授权 UX 与持久化 grant/denial | `apps/desktop/src/shell/renderer/features/mod-codegen/*` | 用户可在加载前确认 T1 能力；拒绝后调用返回权限拒绝并可审计 | CG-03, CG-04 |
| CG-06 | 生命周期补强：新增 teardown 合同 | `apps/desktop/src/runtime/mod/types.ts` `apps/desktop/src/runtime/mod/host/lifecycle-unregister.ts` `apps/desktop/src/runtime/mod/host/lifecycle-register.ts` | reload/uninstall 触发 teardown，事件订阅/定时器/UI 注册可清理，无幽灵副作用 | CG-02 |
| CG-07 | 增量迭代与 hot-reload 稳定化 | `apps/desktop/src/runtime/mod/codegen/*` `apps/desktop/src/shell/renderer/infra/bootstrap/runtime-bootstrap-runtime-mods.ts` | “修改描述 -> reload” 可重复执行；失败不会污染已运行版本 | CG-05, CG-06 |
| CG-08 | 测试与发布门槛收口 | `apps/desktop/test/*`（新增 codegen 场景） | 通过本文件 §13 + §16 全部门槛后才允许上线 | CG-01..CG-07 |

### 15.1 推荐执行顺序

1. `CG-01 + CG-04`（先做生成与校验真相）
2. `CG-02 + CG-03`（再做治理链与权限收口）
3. `CG-05 + CG-06`（补用户授权与生命周期）
4. `CG-07 + CG-08`（做稳定性与发布封板）

## 16. 验收与测试矩阵（含“三年级数学题”）

### 16.1 端到端场景

| 场景ID | 用户描述 | 预期 capability 结果 | 核心验收点 |
|--------|----------|----------------------|------------|
| E2E-01 | 给我三年级孩子做一个每日数学题测试 | T0：`llm.text.*` + `ui.register.*` + `data.{register|query}.data-api.user-{slug}.{resource}.{action}` | 生成成功、可安装、可出题、可记录结果、次日再次进入仍可读取历史 |
| E2E-02 | 在数学题里增加题目图片 | 触发 T1：`llm.image.generate` | 必须弹授权；拒绝后功能降级为文本题且不崩溃 |
| E2E-03 | 允许它联网抓题库 | 命中 T2：`network/*` 或 `fetch` | preflight 阶段直接拒绝，mod 不得进入 install |
| E2E-04 | 修改为“每天 10 道，含乘除法”并 reload | capability 不越界 | reload 后行为更新；旧实例资源释放，无重复事件订阅 |
| E2E-05 | 卸载后重新安装同名 mod | baseline/grant/denial 一致性 | 卸载后无残留调用；重装后权限状态与审计可追溯 |

### 16.2 自动化测试建议（`apps/desktop/test`）

1. `mod-codegen-preflight-deny-patterns.test.mjs`：校验 `eval/fetch/websocket` 等禁用模式拦截。
2. `mod-codegen-capability-catalog.test.mjs`：校验 T0/T1/T2 分类与 runtime policy 一致。
3. `mod-codegen-install-flow-governance.test.mjs`：校验 codegen 必走 8 阶段治理链。
4. `mod-codegen-consent-gate.test.mjs`：校验 T1 授权同意/拒绝分支。
5. `mod-codegen-reload-teardown.test.mjs`：校验 reload 触发 teardown 且无重复注册。
6. `mod-codegen-grade3-math-e2e.test.mjs`：覆盖“三年级数学题”端到端 happy path。

### 16.3 回归命令（建议）

1. `pnpm -C apps/desktop run typecheck`
2. `pnpm -C apps/desktop run test:unit`
3. `pnpm -C apps/desktop run test`

## 17. 风险闸门与回滚策略

### 17.1 风险闸门（上线前必须满足）

1. 权限闸门：T2 永不放行；T1 无用户同意绝不放行。
2. 治理闸门：codegen mod 审计记录必须包含完整 8 阶段。
3. 生命周期闸门：连续 30 次 reload 不出现注册泄漏或重复副作用。
4. 安全闸门：静态扫描 + import 白名单双重通过后才允许 install。

### 17.2 回滚策略

1. 功能开关回滚：关闭 codegen 入口，仅保留现有 sideload/marketplace 能力。
2. 事务回滚：install 任一阶段失败则不写入已启用状态，不污染 `registeredMods`。
3. 版本回滚：保留上一可用 revision 的 `dist + manifest + meta`，reload 失败时自动恢复。
4. 数据回滚：仅允许 `data.{register|query}.data-api.user-{slug}.*` 命名空间，禁写 core/protected 域，避免跨域污染。
