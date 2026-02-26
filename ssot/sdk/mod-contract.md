---
title: Nimi SDK Mod Subpaths Contract
status: ACTIVE
updated_at: 2026-02-26
parent: INDEX.md
rules:
  - mod 能力必须经 `@nimiplatform/sdk/mod/*` 子路径暴露，不允许访问 internal host 私有实现。
  - mod 运行时 host 注入是显式依赖，host 未就绪时必须 fail-close。
  - mod AI 路由必须显式可追踪（route hint / route binding / health）。
---

# mod 子路径合同

## 1. 子路径总览（事实）

来源：`sdk/package.json` + `sdk/src/mod/*`。

1. `mod/ai`
2. `mod/hook`
3. `mod/types`
4. `mod/ui`
5. `mod/logging`
6. `mod/i18n`
7. `mod/settings`
8. `mod/utils`
9. `mod/model-options`
10. `mod/runtime-route`
11. `mod/host`

## 2. 核心接口

### 2.1 `mod/ai`

1. `createAiClient(modId)`：统一 AI 调用面（text/object/image/video/embedding/tts/stt）。
2. `createAiRuntimeInspector(modId)`：依赖快照与修复动作读取。
3. 路由依赖 `routeHint + routeOverride`，并返回解析后的 `route`。

### 2.2 `mod/hook`

`createHookClient(modId)` 聚合：

1. `action`
2. `event`
3. `data`
4. `turn`
5. `ui`
6. `interMod`
7. `llm`
8. `audit`
9. `meta`

### 2.3 `mod/types`

公开 hook/runtime-mod/llm/speech 等类型，不暴露 internal 类型路径。

### 2.4 `mod/ui`

1. `useAppStore`
2. `useUiExtensionContext`
3. `SlotHost`

### 2.5 其他辅助模块

1. `mod/logging`：runtime log + renderer event
2. `mod/i18n`：翻译注册与 runtime i18n 绑定
3. `mod/settings`：mod 配置本地持久化与 React hook
4. `mod/utils`：json/storage 工具导出
5. `mod/model-options`：模型分类/过滤/分组
6. `mod/runtime-route`：route binding/options 解析
7. `mod/host`：`set/get/clearModSdkHost`

## 3. 失败语义

1. `modId` 缺失时 fail-close（例如 `AI_CLIENT_MOD_ID_REQUIRED` / `AI_RUNTIME_INSPECTOR_MOD_ID_REQUIRED`）。
2. host 未注入时 `getModSdkHost()` 抛 `MOD_SDK_HOST_NOT_READY`。
3. AI route 无效或不支持模态时直接抛错，不做隐式改写。

## 4. 验收门禁

1. `pnpm check:sdk-consumer-smoke`（覆盖所有 mod 子路径 import/call）
2. SDK 主测试集（`pnpm --filter @nimiplatform/sdk test`）
3. mods 侧边界门禁：`pnpm check:mods-no-runtime-sdk`
