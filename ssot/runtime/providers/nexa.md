---
title: Nimi Nexa Provider SSOT
status: ACTIVE
version: v1.2
updated_at: 2026-02-22
rules:
  - Nexa 在 Nimi 中固定为受管 binary service（`nexa-openai-gateway`）；attached endpoint 仅用于开发诊断，不作为产品主路径。
  - 控制面主权固定归属 Nimi（依赖求解、生命周期、权限、审计、fallback）；Nexa 仅承担推理执行面。
  - Mod 不得直连 provider endpoint；所有 AI 调用必须经 `@nimiplatform/mod-sdk/ai` + runtime route + llm-adapter。
  - Runtime adapter 标识在当前主线固定为 `openai_compat_adapter` + `localai_native_adapter`；Nexa 原生路径通过 `providerHints.nexa` 区分。
  - Nexa artifact 在 runtime 默认开启并纳入 managed lifecycle；当硬化或门控不满足时必须 fail-close。
  - capability matrix 必须由 `catalog + provider probe(/v1/models) + 已安装模型元数据 + 宿主探针 + 许可策略门` 合成。
  - NPU 能力判定必须采用宿主探针与 provider probe 的联合门控；不得仅依据 `/v1/models` 结果判定 NPU 可用。
  - health 门固定 `/`；capability probe 固定独立字段 `capability_probe_endpoint=/v1/models`。
  - 集成模式必须硬化：loopback only、非通配 CORS、禁止 Mod 感知私有 endpoint/凭据。
  - service lifecycle 主链固定 endpoint/provider-managed 语义；`models.start/stop/health` 不得作为 service/apply 主路径。
  - 上游默认 `NEXA_ORIGINS=*`（全开）；Nimi 必须显式覆盖为受控来源，漏注入视为安全缺口。
  - 默认 CPU/GPU-only；NPU 模式必须显式授权开关并通过 license gate。
  - reasonCode 口径固定为本文件第 8 节最小集合；禁止静默降级。
  - 不保留 openai-compatible-only 的过渡壳层。
---

# Nimi Nexa Provider 唯一真相（SSOT）

## 1. Final-State

1. Nexa 是受管本地 provider service：`serviceId=nexa-openai-gateway`。
2. Runtime 在执行面内置双 adapter：
   - `openai_compat_adapter`
   - `localai_native_adapter`
3. 节点级 adapter 默认策略（可被 `providerHints.nexa.preferredAdapter` 显式覆盖）：
   - `chat/embedding/stt/tts/image -> openai_compat_adapter`
   - `rerank/cv/diarize -> localai_native_adapter`（Nexa 原生路径）
   - `video -> Nexa provider 默认不暴露（由其他 provider 承担）`
4. 同一 provider 下不同 node 可以选择不同 adapter；不满足能力约束时必须 fail-close。

## 2. 控制面与执行面边界

Nimi 控制面负责：

1. `dependencies.resolve(deviceProfile)` 与 `dependencies.apply(preflight-first)`。
2. 生命周期写权限（Core-only）与依赖求解审计。
3. fallback（`local-runtime -> token-api`）与审计持久化。
4. SDK/Hook 稳定入口治理与权限边界。

Nexa 执行面负责：

1. 已授权请求的推理执行。
2. 模型运行时调度（CPU/GPU/NPU plugin 选择）与多模态端点执行。

## 3. Provider Adapter 契约

### 3.1 输入

Runtime 可在内部携带 `providerHints.nexa.*`，由 adapter 消化，字段最小集：

1. `backend`
2. `preferredAdapter`
3. `pluginId`
4. `deviceId`
5. `modelType`
6. `npuMode`

类型演进（MUST）：

1. Rust 结构必须从仅 `localai` 命名空间扩展为 provider 分命名空间：

```rust
LocalAiProviderHints {
  localai: Option<LocalAiProviderLocalHints>, // 既有
  nexa: Option<NexaProviderHints>,            // 新增
}
```

2. `NexaProviderHints` 最小字段必须覆盖：`backend/preferredAdapter/pluginId/deviceId/modelType/npuMode`。
3. TS facade 与 Mod SDK 类型必须同步加法，不得破坏已有 `localai` 字段兼容性。

### 3.2 输出

`nodes.catalog.list` 必须返回节点级可执行信息：

1. `adapter`
2. `backend`
3. `available`
4. `reasonCode`
5. `providerHints`
6. `policyGate`

## 4. Capability Matrix（MUST）

矩阵维度：`service/provider/node/model/backend/policy`。

矩阵来源（五源合并）：

1. catalog 默认能力与 backend hints
2. provider probe（`/v1/models`）
3. 本地已安装模型元数据
4. 宿主硬件/驱动探针（OS-level host probe）
5. 许可策略门（CPU/GPU-only 或 NPU-enabled）

矩阵职责：

1. 判定节点是否可执行
2. 判定应使用哪个 adapter
3. 对 NPU 许可约束做显式门控
4. 为路由与 fallback 提供可审计证据

NPU 可用性判定（MUST）：

1. `npuUsable = hostNpuReady AND modelProbeHasNpuCandidate AND policyGateAllowsNpu`
2. `hostNpuReady` 来源于宿主探针（设备可见性、驱动/运行库可用性、插件可加载性）
3. `modelProbeHasNpuCandidate` 来源于 `/v1/models` 与模型元数据交叉结果
4. 任一条件不满足时，NPU 路径必须 fail-close，不得隐式降级为“已可用”

## 5. Node 映射（MUST）

1. `chat -> /v1/chat/completions`
2. `embedding -> /v1/embeddings`
3. `stt -> /v1/audio/transcriptions`
4. `tts -> /v1/audio/speech`
5. `image -> /v1/images/generations`
6. `video -> Nexa provider 默认不暴露`
7. `rerank -> /v1/reranking`（Nexa native）
8. `cv -> /v1/cv`（Nexa native）
9. `diarize -> /v1/audio/diarize`（Nexa native）

### 5.1 ServiceArtifact 定义快照（MUST）

说明：

1. 以下快照中的 `nodes` 使用“简写映射”表达，便于审阅；不是可直接解析的标准 YAML 结构。
2. 完整 NodeContract 结构以 `local-ai-runtime.md` 与 runtime 类型定义为准。

```yaml
serviceId: nexa-openai-gateway
artifactType: binary
engine: nexa
install:
  bootstrap: engine-pack:nexa
preflight:
  - check: port-available
    reasonCode: LOCAL_AI_SERVICE_UNREACHABLE
    params: { port: 18181 }
  - check: disk-space
    reasonCode: LOCAL_AI_SERVICE_UNREACHABLE
    params: { minBytes: 536870912 }
  - check: endpoint-loopback
    reasonCode: LOCAL_AI_SERVICE_UNREACHABLE
process:
  entry: nexa
  args: ["--skip-update", "serve"]
  env:
    NEXA_HOST: "127.0.0.1:18181"
    NEXA_ORIGINS: "http://127.0.0.1"
health:
  endpoint: /
  capability_probe_endpoint: /v1/models
  intervalMs: 30000
  timeoutMs: 4000
nodes:
  - chat.generate.nexa        -> /v1/chat/completions
  - embedding.generate.nexa   -> /v1/embeddings
  - speech.stt.nexa           -> /v1/audio/transcriptions
  - speech.tts.nexa           -> /v1/audio/speech
  - image.generate.nexa       -> /v1/images/generations
  - rerank.nexa               -> /v1/reranking
  - cv.nexa                   -> /v1/cv
  - diarize.nexa              -> /v1/audio/diarize
```

补充：

1. 当前 Mod SDK 主能力面固定六模态（`chat/image/video/tts/stt/embedding`），`rerank/cv/diarize` 在 SDK 扩展前仅作为 runtime 内部节点能力，不得隐式外放。
2. 默认端口 `18181` 与 LocalAI 默认 `1234` 分离，允许同机并行托管；若冲突，仍以 preflight 结果为准并回退动态端口策略。

## 6. 受管运行硬化与许可门控（MUST）

### 6.1 运行硬化

1. 受管进程必须以 `nexa --skip-update serve`（或等价命令）运行，禁止启动时外部更新检查影响可重复性（`--skip-update` 已在 CLI root flags 定义）。
2. `NEXA_HOST=127.0.0.1:<port>`（loopback-only，默认 `18181`）。
3. `NEXA_ORIGINS` 不得为 `*`（仅允许受控本地域值）；上游默认值为 `*`，漏注入即形成跨域暴露面。
4. 必须固定 health/probe：
   - health：`/`
   - capability probe：`/v1/models`
5. health `/` 为 liveness 门（上游 `GET /` 已注册）；readiness 以 `/v1/models` 与 capability matrix 结果为准。
6. 由于上游 server 缺省不强制 API 鉴权，Nimi 必须通过控制面隔离保证 endpoint 不被 Mod/Renderer 直连。

### 6.2 许可门控

1. 默认策略：`CPU/GPU-only`。
2. CPU/GPU 路径按 Apache-2.0 合规执行；NPU 路径按厂商额外许可执行。
3. `CPU/GPU-only` 模式下必须：
   - 禁止注入 `NEXA_TOKEN`
   - 禁止选择 NPU plugin（如 `npu/qnn/ane`）
   - 禁止选择显式 NPU 模型（如命名后缀/标签标识为 NPU）
4. `NPU-enabled` 模式必须满足：
   - 用户与部署侧显式开启
   - runtime 中存在合规 license/tokens 的受保护配置
   - 审计可追踪 `policyGate` 与 `reasonCode`

### 6.3 宿主 NPU 预检（MUST）

1. Runtime 必须在宿主侧执行 OS-level NPU 预检（而非仅依赖 provider API）：
   - 设备/驱动可见性
   - 目标插件可加载性（如 `npu/qnn/ane`）
   - 基础运行时依赖完整性
2. 预检结果必须参与 capability matrix 合成，并与 `/v1/models` 结果做 AND。
3. 诊断面必须区分以下状态：
   - `hostNpuReady=false`：宿主不具备 NPU 运行条件
   - `hostNpuReady=true` 且 `modelProbeHasNpuCandidate=false`：检测到 NPU，但缺少可用 NPU 模型
4. 以上状态必须可被 Setup/Diagnostics 可视化，不得折叠为单一“不可用”。

### 6.4 CLI/ENV 映射约束（MUST）

| 语义 | CLI | ENV | 验证状态 |
|---|---|---|---|
| 监听地址 | `--host` | `NEXA_HOST` | 源码已验证 |
| CORS | `--origins` | `NEXA_ORIGINS` | 源码已验证（上游默认 `*`） |
| keepalive | `--keepalive` | `NEXA_KEEPALIVE` | 源码已验证 |
| HTTPS 开关 | `--https` | `NEXA_HTTPS` | 字段存在，需 runtime 实测 |
| TLS cert | `--certfile` | `NEXA_CERTFILE` | 字段存在，需 runtime 实测 |
| TLS key | `--keyfile` | `NEXA_KEYFILE` | 字段存在，需 runtime 实测 |
| 数据目录 | `--data-dir` | `NEXA_DATADIR` | 源码已验证 |
| 禁更新检查 | `--skip-update` | - | 源码已验证 |
| NPU/许可 token | - | `NEXA_TOKEN` | 源码已验证 |
| 日志级别 | - | `NEXA_LOG` | 源码已验证 |

约束：

1. Runtime 实现优先 ENV 注入；CLI 作为等价补充。
2. 上游 flag/env 语义变化时，Nimi 必须在 runtime 层维持等价安全语义。
3. CORS 项属于安全强制项：即使未配置用户自定义来源，也必须由 Runtime 显式写入非 `*` 值。

## 7. 执行与路由约束

1. `dependencies.resolve/apply` 必须消费 capability matrix，不能只看 openai-compatible 子集。
2. 路由决策必须同时校验：节点能力约束 + provider hints + 许可策略门。
3. adapter mismatch 必须 fail-close。
4. fallback 审计必须带：`modId/source/provider/modality/reasonCode/adapter/policyGate`。
5. 未在 SDK 能力面声明的节点（如 `rerank/cv/diarize`）不得被 Mod 侧绕过能力声明直接调用。

## 8. ReasonCode 最小集合（冻结）

1. `LOCAL_AI_SERVICE_UNREACHABLE`
2. `LOCAL_AI_AUTH_FAILED`
3. `LOCAL_AI_CAPABILITY_MISSING`
4. `LOCAL_AI_PROVIDER_INTERNAL_ERROR`
5. `LOCAL_AI_PROVIDER_TIMEOUT`
6. `LOCAL_AI_ADAPTER_MISMATCH`

NPU 门控语义（MUST）：

1. 在当前冻结集合下，`policyGateAllowsNpu=false` 或 `hostNpuReady=false` 的拒绝统一映射为 `LOCAL_AI_CAPABILITY_MISSING`。
2. 以上拒绝必须在 `detail` 与审计 payload 中携带 `policyGate` 与门控原因（如 `NPU_POLICY_DENIED` / `NPU_HOST_NOT_READY`），不得只返回泛化文案。
3. 若后续扩展专属错误码（如 `LOCAL_AI_NPU_POLICY_DENIED`），需同步更新 Runtime 父 SSOT 与 reason code 归一化实现。

## 9. 实现清单（文件级）

1. Rust runtime：`provider_adapter.rs`、`capability_matrix.rs`、`reason_codes.rs`、`service_artifacts.rs`、`service_lifecycle.rs`、`commands.rs`、`dependency_resolver.rs`、`dependency_apply.rs`、`node_catalog.rs`。
2. Engine pack / host：`engine_pack.rs` 增加 Nexa binary 发现与分发；`engine_host.rs`（或等价模块）增加 `nexa serve` 受管启停与清理。
3. 设备探针：`device_profile.rs`（或等价模块）补充 NPU 宿主探针，并向 capability matrix 提供结构化输入。
4. 类型扩展：`types.rs` 中 `LocalAiProviderHints` 新增 `nexa` 命名空间；`LocalAiNodeAvailability` 与 `LocalAiCapabilityMatrixEntry` 新增 `policyGate` 字段并保持向后兼容。
5. TS facade/runtime-config：`runtime/local-ai-runtime/service.ts`、`runtime-config` state/discovery/resolver/panel；增加 `policyGate` 解析与“检测到 NPU 但缺少模型”可见状态。
6. llm-adapter：`provider-plan` + `providers/nexa-native/*` + `invoke-{text,embedding,transcribe,image,rerank,cv,diarize}` + hook `llm-service`。
7. Mod SDK：`LocalRuntimeRouteBinding` 加法字段 `providerHints.nexa`；当能力面开放时补 `rerank/cv/diarize` 标准调用接口。

## 10. DoD

1. Nexa 深度节点（chat/embedding/stt/tts/image/rerank/cv/diarize）可见且有节点级 availability/backend/adapter/policyGate。
2. `dependencies.apply` 保持 preflight-first，并在 apply 后刷新 capability matrix。
3. 同一 provider 下不同 node 可命中不同 adapter。
4. CPU/GPU-only 模式下 NPU 请求被显式拒绝且 reasonCode 可审计。
5. fallback 与 inference 审计字段完整，reasonCode 归一。
6. Runtime Setup 面板展示节点级可用性与许可门控状态，不暴露私钥/私有 endpoint。
7. 当宿主检测到 NPU 但缺少可用 NPU 模型时，UI 必须明确提示该中间状态，而不是显示为通用失败。

## 11. 追溯

1. Runtime SSOT（遵循，不重定义四层抽象）：`../local-ai-runtime.md`
2. L0 协议（遵循，不新增条目）：`../../L0-protocols/runtime-execution.md`
3. L1 语义（遵循，不新增条目）：`../../L1-foundation/runtime-execution.md`
4. 跨域语义参考：`../ai-last-mile.md`
5. 当前工作状态：`../../INTENT.md`
