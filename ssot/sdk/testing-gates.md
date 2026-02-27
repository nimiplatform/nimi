---
title: Nimi SDK Testing Gates
status: ACTIVE
updated_at: 2026-02-27
parent: INDEX.md
rules:
  - 文档中声明的“已支持”能力必须有对应测试文件或门禁命令。
  - 覆盖率门禁与契约门禁必须可在仓库内复现。
  - provider 兼容性结论必须区分 fake-server contract 与 live smoke。
  - vNext 收口能力必须通过固定矩阵门禁验证，不允许只靠局部测试证明。
---

# SDK 测试与验收门禁

## 1. 测试层次

### 1.1 单元/模块测试（sdk 内）

命令：`pnpm --filter @nimiplatform/sdk test`

主要覆盖：

1. client 初始化与 scope 绑定
2. runtime transport / metadata / 错误归一化 / method parity
3. workflow builder
4. ai-provider 映射与多模态封装
5. realm facade 命名规范 + Realm 实例隔离 + 错误映射
6. mod 注入路径（无全局 host 依赖）
7. runtime + realm 编排范式（A/B/C/D）

### 1.2 覆盖率门禁

命令：`pnpm check:sdk-coverage`

阈值（默认）：

1. lines >= 90
2. branches >= 70
3. functions >= 90

### 1.3 合同与边界门禁

1. `pnpm check:sdk-import-boundary`
2. `pnpm check:sdk-single-package-layout`
3. `pnpm check:sdk-public-naming`
4. `pnpm check:reason-code-constants`
5. `pnpm check:scope-catalog-drift`
6. `pnpm check:runtime-bridge-method-drift`
7. `pnpm check:sdk-version-matrix`
8. `pnpm check:sdk-consumer-smoke`
9. `pnpm check:no-create-nimi-client`
10. `pnpm check:no-global-openapi-config`
11. `pnpm check:no-openapi-singleton-import`

### 1.4 vNext 固定矩阵门禁

命令：`pnpm check:sdk-vnext-matrix`

固定测试集：

1. `sdk/test/runtime/runtime-bridge-method-parity.test.ts`
2. `sdk/test/realm/realm-client.test.ts`
3. `sdk/test/scope/module.test.ts`
4. `sdk/test/ai-provider/provider.test.ts`
5. `sdk/test/mod/mod-runtime-context.test.ts`
6. `sdk/test/integration/runtime-realm-orchestration.test.ts`

### 1.5 PR/Release 同级门禁要求

1. PR CI 必须执行 legacy/OpenAPI 禁令与 `sdk-vnext-matrix`。
2. SDK release workflow 必须在 publish 前执行同级检查，不得降级或绕过。

## 2. runtime 契约测试

前置：`NIMI_RUNTIME_CONTRACT=1`

覆盖文件：`sdk/test/runtime/contract/**/*.test.ts`

能力：

1. runtime daemon 实连（workflow submit/get、localRuntime 调用）
2. ai-provider 与 runtime 实链路文本/流式
3. 各 provider adapter 的多模态适配行为

## 3. Provider 兼容矩阵（当前测试事实）

| Provider 场景 | Text | Embedding | Image | Video | TTS | STT | 备注 |
|---|---|---|---|---|---|---|---|
| nimiLLM (`provider_cloud_test.ts`) | Yes | Yes | Yes | Yes | Yes | Yes | 包含 `/v1/video` -> `/v1/videos` fallback 场景 |
| Nexa (`provider_local_test.ts`) | Yes | Yes | Yes | Fail-Close | Yes | Yes | video 预期失败并返回结构化错误 |
| OpenAI-compatible (`provider_openai_test.ts`) | Yes | - | - | Yes/Fail-Close | - | - | 覆盖 video endpoint fallback + stream fallback |
| Gemini (`provider_gemini_test.ts`) | - | - | Yes | Yes | - | - | operation 轮询语义 |
| GLM (`provider_glm_test.ts`) | - | - | Yes | Yes | Yes | Yes | task + native 混合语义 |
| MiniMax (`provider_minimax_test.ts`) | - | - | Yes | Yes | - | - | task id + query 轮询 |
| Kimi (`provider_kimi_test.ts`) | - | - | Yes | - | - | - | 覆盖 invalid output fail-close |
| Bytedance OpenSpeech (`provider_bytedance_openspeech_test.ts`) | - | - | - | - | Yes | Yes | 非 OpenAI 形态接口 |

## 4. Live Smoke（环境依赖）

前置：`NIMI_SDK_LIVE=1` + 对应环境变量。

覆盖文件：`nimi-sdk-ai-provider-live-smoke.test.ts`

当前场景：

1. local provider 真实服务文本生成
2. nimiLLM 真实服务文本生成

## 5. 已知测试边界

1. realm 已覆盖实例隔离与关键错误映射，但未覆盖每一个 realm endpoint 的行为契约。
2. provider contract 主要由 fake server + runtime daemon 组合验证，live smoke 仍是抽样覆盖。
