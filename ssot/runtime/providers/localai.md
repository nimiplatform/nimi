---
title: Nimi LocalAI Provider SSOT
status: ACTIVE
version: v2.0
updated_at: 2026-02-22
rules:
  - LocalAI 在 Nimi 中固定为受管 binary service（`localai-openai-gateway`），不再保留 `llama-cpp-server/qwen-tts-python` 独立 service 语义。
  - 控制面主权固定归属 Nimi（依赖求解、生命周期、权限、审计、fallback）；LocalAI 仅承担推理执行面。
  - Mod 不得直连 provider endpoint；所有 AI 调用必须经 `@nimiplatform/mod-sdk/ai` + runtime route + llm-adapter。
  - Runtime 必须实现 adapter 路由：`openai_compat_adapter` + `localai_native_adapter`，并按 capability matrix fail-close 选择。
  - Runtime 共享主干必须 provider-aware；LocalAI 特有 backend 规则必须封装在 provider-specific 分发层，不得污染共享入口。
  - capability matrix 必须由 `catalog + provider probe(/v1/models) + 已安装模型元数据` 合成。
  - health 门固定 `/readyz`；capability probe 固定独立字段 `capability_probe_endpoint=/v1/models`。
  - 集成模式必须硬化：loopback only、runtime 注入 API key、禁 webui/gallery/runtime settings override/p2p/federated。
  - service lifecycle 主链固定 endpoint/provider-managed 语义；`models.start/stop/health` 仅保留模型资产接口，不作为 service/apply 主路径。
  - reasonCode 口径固定为本文件第 8 节最小集合；禁止静默降级。
  - 不保留 route-profile/openai-compatible-only 旧术语与过渡壳层。
---

# Nimi LocalAI Provider 唯一真相（SSOT）

## 1. Final-State

1. LocalAI 是唯一受管本地 provider service：`serviceId=localai-openai-gateway`。
2. Runtime 在执行面内置双 adapter：
   - `openai_compat_adapter`
   - `localai_native_adapter`
3. 节点级 adapter 默认策略（可被 `providerHints.localai.preferredAdapter` 显式覆盖）：
   - `chat/embedding -> openai_compat_adapter`
   - `stt/tts/image/video -> localai_native_adapter`
4. 同一 provider 下不同 node 可以选择不同 adapter；不满足能力约束时必须 fail-close。

## 2. 控制面与执行面边界

Nimi 控制面负责：

1. `dependencies.resolve(deviceProfile)` 与 `dependencies.apply(preflight-first)`。
2. 生命周期写权限（Core-only）与依赖求解审计。
3. fallback（`local-runtime -> token-api`）与审计持久化。
4. SDK/Hook 稳定入口治理与权限边界。

LocalAI 执行面负责：

1. 已授权请求的推理执行。
2. 后端能力调度（如 whisper.cpp/stablediffusion.cpp/video backend）。

## 3. Provider Adapter 契约

### 3.1 输入

Runtime 可在内部携带 namespaced `providerHints.*`；当前 LocalAI 消费 `providerHints.localai.*`（并保留 `providerHints.nexa` 预留位），字段最小集：

1. `backend`
2. `preferredAdapter`
3. `whisperVariant`
4. `stablediffusionPipeline`
5. `videoBackend`

### 3.2 输出

`nodes.catalog.list` 必须返回节点级可执行信息：

1. `adapter`
2. `backend`
3. `available`
4. `reasonCode`
5. `providerHints`

## 4. Capability Matrix（MUST）

矩阵维度：`service/provider/node/model/backend`。

矩阵来源（三源合并）：

1. catalog 默认能力与 backend hints
2. provider probe（`/v1/models`）
3. 本地已安装模型元数据

矩阵职责：

1. 判定节点是否可执行
2. 判定应使用哪个 adapter
3. 为路由与 fallback 提供可审计证据

## 5. Node 映射（MUST）

1. `chat -> /v1/chat/completions`
2. `embedding -> /v1/embeddings`
3. `stt -> /v1/audio/transcriptions`（whisper backend-aware）
4. `tts -> /v1/audio/speech`
5. `image -> /v1/images/generations`（stablediffusion backend-aware）
6. `video -> /v1/video/generations`（按可用性暴露）

## 6. 受管运行硬化（MUST）

1. `LOCALAI_ADDRESS=127.0.0.1:<port>`（loopback-only）
2. `LOCALAI_API_KEY=<runtime-generated>`（runtime 注入）
3. `LOCALAI_DISABLE_WEBUI=true`
4. `LOCALAI_DISABLE_GALLERY_ENDPOINT=true`
5. `LOCALAI_DISABLE_RUNTIME_SETTINGS=true`
6. `LOCALAI_DISABLE_API_KEY_REQUIREMENT_FOR_HTTP_GET=false`
7. `LOCALAI_P2P=false`
8. `LOCALAI_FEDERATED=false`

补充：

1. health 仅看 `/readyz`
2. capability probe 仅走 `/v1/models`，不得并入 health 字段

## 7. 执行与路由约束

1. `dependencies.resolve/apply` 必须消费 capability matrix，不能只看 openai-compatible 子集。
2. 路由决策必须同时校验：节点能力约束 + provider hints。
3. adapter mismatch 必须 fail-close。
4. fallback 审计必须带：`modId/source/provider/modality/reasonCode/adapter`。

## 8. ReasonCode 最小集合（冻结）

1. `LOCAL_AI_SERVICE_UNREACHABLE`
2. `LOCAL_AI_AUTH_FAILED`
3. `LOCAL_AI_CAPABILITY_MISSING`
4. `LOCAL_AI_PROVIDER_INTERNAL_ERROR`
5. `LOCAL_AI_PROVIDER_TIMEOUT`
6. `LOCAL_AI_ADAPTER_MISMATCH`

## 9. 实现清单（文件级）

1. Rust runtime：`provider_adapter.rs`、`capability_matrix.rs`、`reason_codes.rs`、`service_artifacts.rs`、`service_lifecycle.rs`、`commands.rs`、`dependency_resolver.rs`、`dependency_apply.rs`、`node_catalog.rs`。
2. TS facade/runtime-config：`runtime/local-ai-runtime/service.ts`、`runtime-config` state/discovery/resolver/panel。
3. llm-adapter：`provider-plan` + `providers/localai-native/*` + `invoke-{text,embedding,transcribe,image,video}` + hook `llm-service`。
4. Mod SDK：`LocalRuntimeRouteBinding` 加法字段 `providerHints.localai`。

## 10. DoD

1. LocalAI 深度节点（chat/embedding/stt/tts/image/video）可见且有节点级 availability/backend/adapter。
2. `dependencies.apply` 保持 preflight-first，并在 apply 后刷新 capability matrix。
3. 同一 provider 下不同 node 可命中不同 adapter。
4. whisper/stablediffusion 请求可映射到 backend-aware payload。
5. fallback 与 inference 审计字段完整，reasonCode 归一。
6. Runtime Setup 面板展示节点级可用性，不暴露私钥/私有 endpoint。
