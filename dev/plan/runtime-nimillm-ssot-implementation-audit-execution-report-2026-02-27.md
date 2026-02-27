# Runtime nimiLLM SSOT 对齐执行审计报告（v7，二次审计修正版，零 legacy）

## 0. 元信息

- 报告日期：2026-02-28
- 报告版本：v7（基于 v6 + Claude 二次审计修正）
- 审计范围：`runtime/`、`apps/desktop/`、`sdk/`、`docs/`、`ssot/`、`proto/`、`dev/`
- 审计快照：`develop@340c066`
- 文档定位：实施计划执行稿，保留在 `dev/plan/`（不迁移到 `dev/report/`）
- 审计口径：以 `develop@340c066` 复核口径为准，不回滚用户已有改动

## 1. 架构基线（本报告锁定）

本次唯一正确目标态：

1. `SDK/Desktop -> Runtime -> nimiLLM(内部模块)`。
2. `nimiLLM` 替换当前 `liteLLM + custom provider` 的实现组织方式。
3. `alibaba/bytedance/gemini/minimax/kimi/glm/openai-compat` 适配逻辑保留，但全部收敛到 `nimiLLM` 模块内部。
4. 用户侧模型前缀不变：仍可使用 `gemini/*`、`alibaba/*`、`glm/*` 等。
5. 凭证语义不变：请求注入与 ENV 均可，`nimiLLM` 不关心凭证来源，只消费规范化后的 endpoint/key。
6. per-provider 配置键名保持不变：`NIMI_RUNTIME_CLOUD_ADAPTER_{PROVIDER}_BASE_URL/API_KEY`（当前 7 组 14 个，含 `BYTEDANCE_OPENSPEECH`）继续有效，不合并为单组 `NIMILLM_*`。
7. desktop per-provider connector 配置保持不变：`DEFAULT_PROVIDER_BASE_URL` 与 `UI_MANAGED_CLOUD_PROVIDER_KEYS` 仅做 `litellm -> nimillm` 主键迁移，其他 provider 键名不改。
8. 对外变化是“接口和命名统一”：`litellm -> nimillm`，并将“7 个独立 cloud backend”收口成“1 个 nimiLLM 内部路由模块”。
9. desktop 调用链需区分“配置阶段验证路径”与“推理阶段执行路径”，WP4 仅对目标链路范围内行为做收口。
10. 本轮命名迁移采用“零 legacy”策略：不保留 `litellm/cloudlitellm/cloudai` 兼容路径，不提供向后兼容。

## 2. 先纠偏（v4 的补充）

1. v4 的架构方向正确：核心是“模块边界重构 + 命名统一”，不是删除 provider-specific 实现。
2. 需补充的不是方向，而是执行细节：统计口径、WP4 范围、WP5/WP6/WP7 覆盖和风险处置。
3. v7 进一步修正 v6 的执行偏差：`3.1` 命中统计虚高、`3.2` 测试基线偏差、`3.3` execute 入口遗漏。
4. v7 明确策略升级：`litellm` 不兼容（无 legacy），并将 WP7 从“建议门禁”升级为“强制门禁”。

## 3. 量化结果（已按口径修正）

### 3.1 命名迁移量（`litellm -> nimillm`）

统计口径（v7 锁定）：

1. 大小写敏感，仅统计字面 `litellm`。
2. 范围：`runtime sdk apps docs ssot proto dev`。
3. 排除：`dev/plan/**` 与 `dev/report/**` 下审计/执行报告类自引用文件。

统计结果（`develop@340c066`）：

1. 全仓：`174` 命中 / `28` 文件。
2. `runtime` 子域：`113` 命中 / `16` 文件。

结论：这是大规模机械替换，但不是核心架构工作。

### 3.2 runtime 模块边界重构面（核心，修正后）

关键词（与 v4 一致）：`alibaba|aliyun|bytedance|openspeech|gemini|minimax|kimi|moonshot|glm|zhipu|bigmodel`

主口径（A）：`runtime/internal`（模块边界重构真实作用域），大小写敏感 + 仅 `.go` 文件。  
扩展口径（B）：`runtime` 全域（含非 Go），用于评估外部命名扩散面。

可复现命令：

> **注意**：rg 的 `--glob '!*_test.go'` 在 zsh / rg 14.x / macOS 下不生效（`!` 被 shell 转义），必须用 `| grep -v '_test.go'` 管道过滤。

```bash
pattern='alibaba|aliyun|bytedance|openspeech|gemini|minimax|kimi|moonshot|glm|zhipu|bigmodel'
# 口径 A: runtime/internal（非测试 / 测试拆分用 grep -v）
rg -n -e "$pattern" runtime/internal -g '*.go' | grep -v '_test.go' | wc -l
rg -l -e "$pattern" runtime/internal -g '*.go' | grep -v '_test.go' | wc -l
rg -n -e "$pattern" runtime/internal -g '*_test.go' | wc -l
rg -l -e "$pattern" runtime/internal -g '*_test.go' | wc -l
rg -n -e "$pattern" runtime/internal -g '*.go' | wc -l
rg -l -e "$pattern" runtime/internal -g '*.go' | wc -l
# 口径 B: runtime 全域（含非 Go）
rg -n -e "$pattern" runtime | wc -l
rg -l -e "$pattern" runtime | wc -l
rg -n -i -e "$pattern" runtime | wc -l
rg -l -i -e "$pattern" runtime | wc -l
```

统计结果：

1. `runtime/internal` Go 非测试：`144` 命中 / `7` 文件。
2. `runtime/internal` Go 测试：`261` 命中 / `10` 文件。
3. `runtime/internal` 全域 Go：`405` 命中 / `17` 文件。
4. `runtime` 全域（含非 Go，大小写敏感）：`421` 命中 / `19` 文件。
5. `runtime` 全域（含非 Go，大小写不敏感 `-i`）：`882` 命中 / `20` 文件。

说明：

1. v6 对测试口径引用了 `runtime` 全域测试命中，导致与“模块边界重构（internal）”口径混淆。
2. v7 已把测试基线锁定为 `runtime/internal` 的 `261 / 10`，并要求在 WP2 给出精确文件清单。

核心重构文件（非测试 Go）：

1. `runtime/internal/services/ai/provider_cloud.go`（457 LOC）
2. `runtime/internal/services/ai/provider.go`（169 LOC）
3. `runtime/internal/services/ai/provider_helpers.go`（87 LOC）
4. `runtime/internal/services/ai/media_job_methods.go`（3643 LOC）
5. `runtime/internal/modelregistry/registry.go`（166 LOC）
6. `runtime/internal/config/config.go`（521 LOC）
7. `runtime/internal/daemon/daemon.go`（409 LOC）

补充范围说明：

1. `runtime/config.example.json` 与 `runtime/README.md` 不属于“Go 模块边界重构”统计口径，但属于 WP1/WP6 必须同步项。

### 3.3 provider-specific 媒体实现规模（保留并迁移）

1. `media_job_methods.go` 中 `execute*` 执行入口共 `11` 个（括号为起始行）：
   - `executeBytedanceOpenSpeech`（起始行 `L965`）
   - `executeBytedanceARKTask`（起始行 `L1092`）
   - `executeAlibabaNative`（起始行 `L1251`）
   - `executeGeminiOperation`（起始行 `L2040`）
   - `executeMiniMaxTask`（起始行 `L2267`）
   - `executeGLMTask`（起始行 `L2715`）
   - `executeGLMNative`（起始行 `L2829`）
   - `executeKimiImageChatMultimodal`（起始行 `L2975`）
   - `executeBytedanceOpenSpeechWS`（起始行 `L1810`）
   - `executeMiniMaxTranscribe`（起始行 `L2684`）
   - `executeGLMTranscribe`（起始行 `L3348`）
2. 按 provider 命名函数共 `30` 个。
3. provider-specific 代码块约 `2437` LOC（`965-3211` + `3348-3537`）。

结论：这些代码不应删除，应该迁入 `nimiLLM` 内部目录并保持行为等价；WP3 不得只按“8 个入口”迁移。

### 3.4 desktop 侧真实状态（旁路事实成立，需补上下文）

已确认的 5 条旁路链路：

1. connector 模型发现直连 provider：`apps/desktop/src/shell/renderer/features/runtime-config/domain/provider-connectors/discovery.ts:228-236`
2. bootstrap 模型水合直连 provider：`apps/desktop/src/shell/renderer/infra/bootstrap/runtime-bootstrap-utils.ts:334-341`
3. health-check 直连 provider：`apps/desktop/src/runtime/llm-adapter/execution/health-check.ts:23-24`
4. speech stream 直连 provider：`apps/desktop/src/runtime/llm-adapter/speech/engine/open-stream.ts:41-50`
5. list voices 直连 provider：`apps/desktop/src/runtime/llm-adapter/speech/engine/list-voices.ts:53`

关键上下文（v4 缺失）：

1. 上述旁路主要发生在配置/设置阶段（connector bootstrap / token 校验 / 本地能力探测）。
2. 推理阶段已经存在 runtime 正轨调用：`apps/desktop/src/shell/renderer/features/runtime-config/domain/provider-connectors/discovery.ts:174-176` 使用 `runtime.audit.getRuntimeHealth` 与 `runtime.audit.listAIProviderHealth`（Tauri IPC -> Go runtime）。

结论：

1. “旁路存在”判断正确。
2. 但 WP4 必须明确范围，不应默认把配置阶段全部定义为违规路径。

### 3.5 SDK/docs/SSOT

1. SDK provider-specific 合同测试 5 文件共 `911` LOC（应保留语义，不是删除语义）。
2. docs provider 示例 `6` 文件 / `605` LOC 的统计口径仅覆盖 vendor-specific 子集（`bytedance(×2)/gemini/minimax/kimi/glm`）：`bytedance-openspeech.ts`(76)、`bytedance-tts.ts`(198)、`gemini.ts`(78)、`glm.ts`(102)、`kimi.ts`(75)、`minimax.ts`(76)。注意：`alibaba` 当前无对应示例文件。
3. `docs/examples/providers/` 当前共有 `11` 个 `.ts` 文件 / `1146` LOC；除 vendor-specific 子集外，还包含 `_common.ts`、`litellm.ts`、`deepseek-chat.ts`、`localai.ts`、`nexa.ts`，WP1/WP6 必须同步处理命名迁移影响。
4. SSOT 需显式纳入 `ssot/runtime/config-contract.md` 更新（第 `3.4` 节 provider 命名与 alias 规则）。

### 3.6 proto

`proto/runtime/v1` 为 provider-agnostic；当前没有 `litellm`/厂商名硬编码。

## 4. 关键差距（按正确模型）

### G1. `nimiLLM` 模块边界不存在

当前是 `cloudProvider` 聚合多 backend 字段与分支逻辑，尚未形成独立内部模块目录与清晰 API 边界。

### G2. 对外命名仍是 `litellm`

`cloud-litellm`、`NIMI_RUNTIME_CLOUD_LITELLM_*`、docs 示例等仍是旧命名；v7 决议为“零 legacy”，因此目标不是复用 alias，而是移除 `litellm/cloudlitellm/cloudai` 兼容入口并统一失败策略。

### G3. 运行时外部语义仍像“7 个独立云后端”

`pickBackend`、provider hints、health 注册、config binding 都以独立 backend 暴露，而不是“单一 nimillm 模块 + 内部 adapter 路由”。

### G4. desktop 旁路缺少“阶段语义”分层

当前把模型发现/健康探测/speech 全部归为同一类旁路，会放大 WP4 范围并掩盖“配置阶段 by design”的可能性。

### G5. runtime-compliance 门禁未覆盖命名一致性

`runtime/cmd/runtime-compliance/main.go` 当前仅 `RS-11-01 ~ RS-11-23`，没有检查 `cloud-nimillm` 命名迁移残留。

### G6. v6 执行文档存在盲点（v7 已锁定修正）

1. `3.1` 命中统计虚高，需回落到 `174/28` 与 `113/16` 的冻结值。
2. `3.2` 测试基线偏差，WP2 验收需改为 `261/10` 并锁定文件清单。
3. `3.3` execute 入口遗漏 `3` 个，WP3 若沿用“8 入口”会遗漏迁移路径。
4. `litellm` 不兼容策略在 WP1/WP6/WP7 中必须显式落地，否则实现会回退到 legacy 思路。

## 5. 执行方案（WP0-WP7，补全后）

### WP0：nimiLLM 模块边界设计（核心前置）

目标：定义 runtime 内部 `nimiLLM` 模块的 package 边界与对外最小接口。

输出要求：

1. 明确 module API：文本/流式/embed/media 调用入口、路由决策对象、子健康对象。
2. 明确内部结构：router、adapter registry、media adapter dispatcher。
3. 明确“不改行为”的迁移准则：先搬迁再整理，不在第一轮改协议语义。
4. 明确最小交付物：提交 `runtime/internal/nimillm/nimillm.go`（接口与类型签名草案，可无实现）并锁定 package 路径提案。
5. 明确签收标准：由 runtime 代码 owner 完成 API 评审通过，且 desktop/sdk 集成 reviewer 确认“外部合同不新增破坏性变更”后，WP0 才算完成。

### WP1：命名统一（外部可见，零 legacy）

目标：`litellm -> nimillm` 全仓迁移，且不保留向后兼容入口。

要求：

1. backend name：`cloud-litellm -> cloud-nimillm`。
2. provider 主键：仅保留 `nimillm`、`cloudnimillm`。
3. 删除 legacy 别名：`litellm`、`cloudlitellm`、`cloudai`（包括 runtime/desktop 的解析入口）。
4. 删除 legacy ENV：`NIMI_RUNTIME_CLOUD_LITELLM_BASE_URL/API_KEY` 与 `NIMI_RUNTIME_CLOUD_AI_BASE_URL/API_KEY` 均不再读取（含 `provider.go` 的 `CloudAIBaseURL/CloudAIAPIKey` 直接引用与 `daemon.go` 的 fallback 链）；仅允许 `NIMI_RUNTIME_CLOUD_ADAPTER_{PROVIDER}_*`（7 组 14 个）。
5. desktop per-provider 默认配置键保持不变，但 UI 管理主键从 `litellm` 改为 `nimillm`；其他 provider 键名不改。
6. 纳入非 Go 交付：同步更新 `runtime/config.example.json`、`runtime/README.md`、`docs/examples/providers/` 的命名说明。
7. 明确示例改名：`docs/examples/providers/litellm.ts -> docs/examples/providers/nimillm.ts`，并同步 README/命令示例引用。

### WP2：runtime 内部重构为单一 `nimiLLM` 模块

目标：把“7 backend 分支”改造成“1 模块内部路由”。

要求：

1. `provider_cloud.go` 的多字段与 `pickBackend` 迁入 `nimiLLM` 内部 registry/router。
2. `provider.go` routeSelector 对 cloud 仅持有一个 `nimillm` provider。
3. `registry/provider hint` 仍可保留，但语义改为 `nimiLLM` 内部 hint，不再暴露独立 cloud backend 概念。
4. `daemon` 健康对外统一 `cloud-nimillm`，内部可上报 sub-health（alibaba/bytedance/...）。
5. 与迁移代码对应的 Go 测试文件必须同步迁移或更新引用路径，覆盖面不得低于 `runtime/internal` 口径基线：`261` 命中 / `10` 测试文件。
6. WP2 必须显式覆盖以下 `10` 个测试文件（`develop@340c066` 冻结清单）：
   - `runtime/internal/modelregistry/storage_test.go`
   - `runtime/internal/services/audit/service_test.go`
   - `runtime/internal/config/config_test.go`
   - `runtime/internal/daemon/daemon_audit_test.go`
   - `runtime/internal/entrypoint/runtime_config_startup_chain_test.go`
   - `runtime/internal/services/model/service_test.go`
   - `runtime/internal/httpserver/server_test.go`
   - `runtime/internal/services/ai/provider_cloud_test.go`
   - `runtime/internal/services/ai/media_job_methods_test.go`
   - `runtime/internal/services/ai/service_test.go`

### WP3：媒体 adapter 内聚（保留代码，不删语义）

目标：把 `media_job_methods.go` 中 provider-specific 执行器迁入 `nimiLLM` 模块内部。

要求：

1. 保留现有 `11` 个 `execute*` 执行入口与约 `30` 个 provider 命名函数语义，不得删减。
2. 外层只保留统一 dispatcher，不再在 `Service` 层散落 provider 实现细节。
3. 迁移后测试仍按 provider 行为断言（Gemini operation、GLM task/native、Bytedance OpenSpeech WS 等）。
4. 若媒体实现迁入 `nimiLLM` 子目录，相关媒体测试需同步迁移到模块内部测试目录，禁止出现“实现已迁移、测试仍绑旧路径”的分裂状态。
5. 迁移清单必须按三层列出并验收：`execute*`、`resolve*`、provider helper；禁止只按“主入口函数”粗粒度迁移。

### WP4：desktop 调用链收口到 runtime（按阶段分层）

目标：满足“运行时执行链路”的 `Desktop -> Runtime -> nimiLLM`。

范围决策（必须先定）：

1. `MUST` 收口：speech stream / list voices（运行时行为）。
2. `SHOULD` 评估后决定：模型发现 / 健康探测（配置阶段验证是否允许直连）。
3. 若决定收口配置阶段旁路：需补 runtime API（模型发现与健康语义）后再替换 desktop 调用。

实现后置处置（避免死代码）：

1. 若旁路全部收口，需明确清理或降级以下 adapter 资产：`DashScopeCompatibleAdapter`、`VolcengineCompatibleAdapter`、`speech/dashscope-compatible.ts`、`speech/volcengine-compatible.ts`、voice preset 列表。
2. 若保留备用路径，需以 feature flag 或显式 fallback 条款记录，不允许隐式存活。

### WP5：SDK 与合同测试同步（以 WP1 命名迁移为主触发）

目标：保留 per-provider 测试语义，但归位到“nimiLLM 内部 adapter 行为验证”叙事。

要求：

1. 不删除 `provider_gemini/provider_glm/...` 这些行为覆盖。
2. 更新测试命名与注释，避免“独立 cloud backend”误导。
3. desktop 侧至少纳入以下测试并完成回归：
   - `apps/desktop/test/runtime-route-resolver-v11.test.ts`
   - `apps/desktop/test/runtime-bootstrap-speech-route-resolver.test.ts`
   - `apps/desktop/test/runtime-config-split-contract.test.ts`
   - `apps/desktop/test/runtime-bridge-config.test.ts`
4. `runtime-bridge-config.test.ts` 必须新增“无 legacy”断言：旧 `litellm` 名称与键位不得再被接受或归一到有效 provider。

### WP6：docs + SSOT 叙事收口

目标：从“LiteLLM + custom adapters”改为“runtime 内部 nimiLLM 模块 + 内部 adapters”。

要求：

1. 更新 `docs/runtime/ai-provider-support-matrix.md`。
2. 更新 provider 示例说明（前缀不变，调用链变为 runtime 内部模块），并完成 `litellm.ts -> nimillm.ts` 改名及引用收敛。
3. 更新 `runtime/README.md` 的 cloud-plane 描述与 env 示例。
4. 更新 `ssot/runtime/config-contract.md` 第 `3.4` 节：主命名改为 `nimillm`，明确 `litellm/cloudlitellm/cloudai` 为非法输入；保留 Gemini alias 条款。

### WP7：门禁回归与证据归档（强制门禁）

必须通过：

1. `cd runtime && go build ./...`
2. `cd runtime && go test ./... -count=1`
3. `cd runtime && go vet ./...`
4. `cd runtime && go run ./cmd/runtime-compliance --gate`
5. `cd proto && buf lint`
6. `cd proto && buf breaking --against ../runtime/proto/runtime-v1.baseline.binpb`
7. `pnpm proto:drift-check`
8. `pnpm --filter @nimiplatform/sdk test`
9. `pnpm check:sdk-vnext-matrix`
10. `pnpm check:examples`
11. `pnpm --filter @nimiplatform/desktop exec tsx --test test/runtime-route-resolver-v11.test.ts`
12. `pnpm --filter @nimiplatform/desktop exec tsx --test test/runtime-bootstrap-speech-route-resolver.test.ts`
13. `pnpm --filter @nimiplatform/desktop exec tsx --test test/runtime-config-split-contract.test.ts`
14. `pnpm --filter @nimiplatform/desktop exec tsx --test test/runtime-bridge-config.test.ts`

runtime-compliance 新增检查项（强制）：

1. `RS-11-24`：cloud backend 命名统一为 `cloud-nimillm`（禁止 `cloud-litellm` 与 legacy alias）。
2. `RS-11-25`：禁止遗留 `litellm` 引用（仅文档历史快照文件可白名单）。

新增静态门禁（强制）：

1. desktop 不允许出现 token-api 云链路下的 `createProviderAdapter(...).listModels/healthCheck` 直连路径（仅限 WP4 决议白名单）。
2. desktop 不允许出现 token-api speech 流式直连 provider（仅限显式迁移白名单）。
3. 全仓新增变更中禁止引入 `litellm/cloudlitellm/cloudai` 配置键、provider 名与示例路径。

## 6. 执行拓扑

为避免 `WP1/WP2` 同文件并行改动导致冲突，执行顺序调整为“先命名统一，再做结构重构”。

1. `WP0 -> WP1`
2. `WP1 -> WP2`
3. `WP2 -> WP3`
4. `WP2 -> WP4`
5. `WP1 -> WP5`
6. `WP1/WP3/WP4/WP5 -> WP6`
7. `WP6 -> WP7`

## 7. SSOT 与合同结论

1. 当前 SSOT 与“内部模块模式”本质兼容，不需要“先大改 SSOT”才能开始。
2. 但必须同步更新 `ssot/runtime/config-contract.md` 的 provider 命名条款，明确 `litellm/cloudlitellm/cloudai` 非法且不兼容，同时保留 Gemini alias 条款。
3. 不建议删 per-provider 合同测试条目；它们正是 `nimiLLM` 内部适配质量的验证基线。

## 8. 风险与控制

1. 风险：命名迁移导致外部环境变量断裂。
   - 控制：采用零 legacy fail-fast 策略，启动时对旧键直接报错并给出迁移提示；通过 WP7 强制门禁阻止旧键回流。
2. 风险：误把 per-provider ENV/config 合并成单组 `NIMILLM_*`，引发兼容性回归。
   - 控制：在 Section 1 与 WP1 显式锁定“per-provider 键名不变”，并把该项纳入 WP7 回归清单。
3. 风险：desktop 旁路在重构中被忽略，导致“表面统一、实际绕行”。
   - 控制：按“配置阶段/推理阶段”分层定义收口范围，并增加静态扫描门禁与链路级测试。
4. 风险：媒体重构误删 provider-specific 逻辑。
   - 控制：坚持“先迁移后优化”，不在同一轮改行为语义。
5. 风险：对外健康语义丢失 provider 可观测性。
   - 控制：对外 `cloud-nimillm` + 内部 `sub-health` 双层输出。
6. 风险：WP4 收口后 desktop adapter 资产形成死代码。
   - 控制：在 WP4 验收中增加“收口后 adapter 处置决议”（清理/保留+flag）强制项。

## 9. 最终结论（v7）

1. v7 已吸收二次审计结论并修正核心偏差：`3.1` 统计虚高、`3.2` 测试基线偏差、`3.3` execute 入口遗漏。
2. 策略已升级为“零 legacy”：`litellm` 不兼容，禁止兼容别名和旧键位回流。
3. 当前可执行主线保持不变：`WP0 -> WP1 -> WP2 -> WP3`，并在 WP4 先锁定“配置阶段旁路是否 by design”的设计决策，最终由 WP7 强制门禁收敛。
