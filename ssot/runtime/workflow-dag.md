---
title: Nimi Runtime DAG Workflow Design
status: DRAFT
created_at: 2026-02-25
updated_at: 2026-02-26
parent: INDEX.md
references:
  - ssot/runtime/service-contract.md
  - ssot/runtime/proto-contract.md
  - ssot/sdk/design.md
  - ssot/platform/architecture.md
rules:
  - This SSOT is maintained in @nimiplatform/nimi and follows no-legacy mode.
  - Changes must preserve traceability to source and contract-level acceptance gates.
---
---

# DAG Workflow 设计（V1 补齐合同）

## 0. 文档定位

本文件用于将 `RuntimeWorkflowService` 从"状态机骨架"推进到可执行的 DAG 编排合同。

- 当前状态：`DRAFT`
- 用途：补齐 workflow proto 中缺失的数据流、节点类型、脚本执行能力
- 非目标：不定义可视化图编辑器、不做 custom node 开放生态
- NON-NORMATIVE 声明：本文第 3/5 节中的 proto 风格片段仅用于设计讨论，不构成 wire schema；字段真相始终以 `proto/runtime/v1/*.proto` 为准。

## 1. 问题诊断

### 1.1 当前合同的缺陷

`proto/runtime/v1/workflow.proto` 中 `WorkflowNode` 的现有定义：

```protobuf
message WorkflowNode {
  string node_id = 1;
  string node_type = 2;          // freeform string，runtime 不知道合法值
  repeated string depends_on = 3; // 只声明执行顺序，无数据流
  google.protobuf.Struct config = 4; // 无类型 JSON blob
  int32 retry_max_attempts = 5;
  string retry_backoff = 6;
}
```

三个核心缺陷：

| 缺陷 | 后果 |
|------|------|
| **无数据边（edge）** | `depends_on` 只回答"B 在 A 之后跑"，不回答"B 用 A 的什么输出作为什么输入"。节点间数据传递是黑盒 |
| **无节点类型注册** | `node_type` 是 freeform string，runtime 收到后无法做合法性校验、无法推断 input/output schema |
| **config 无类型** | `google.protobuf.Struct` 等同于 `any`，无 schema 校验，字段拼写错误只能运行时爆炸 |

### 1.2 不可用的根源

缺少数据处理层导致 DAG 不可用。以真实场景举例——用户上传一张图，要求"风格化 + 加文字描述 + 生成短视频"：

```
用户图片 → [图像理解] → 文字描述 → [文案润色] → 润色文案
                                                    ↓
用户图片 → [风格迁移] → 风格化图 ──────────────→ [视频生成] → 最终视频
```

用当前 proto 写出来时，以下问题无解：

1. `图像理解` 输出完整 `GenerateResponse`，`文案润色` 只需纯文本 — **谁来提取？**
2. `视频生成` 需要把 `润色文案` 的文本和 `风格迁移` 的图片组合成一个 prompt — **谁来拼接？**
3. `风格迁移` 输出的图分辨率不对 — **谁来处理？**
4. `图像理解` 返回的描述质量太低（token 数 < 20），想跳过润色走默认文案 — **没有条件分支**

`runtime/service-contract.md §7.3` 明确要求"第三方复杂 App 的多模型协作场景必须落在 workflow 域，不允许在 SDK 侧手工链式拼接绕过 runtime 编排"。但 runtime 不提供中间处理能力时，App 别无选择只能手工拼接。这是一个自相矛盾。

### 1.3 正确的参照系

Nimi 的 DAG 是**服务调用级编排**（AI task chaining），不是 GPU 操作级编排。正确的对标系统：

| 系统 | 共性 | Nimi 可借鉴 |
|------|------|------------|
| **Temporal.io** | 强类型 activity input/output，workflow 编排，重试/超时/取消 | Result Store 模式、activity 协议 |
| **Prefect / Dagster** | typed task input/output，DAG 编排，数据通过 result store 传递 | 数据边定义、task 注册 |
| **LangGraph** | 专门做 AI agent 的状态图，state 在节点间显式传递 | state graph 模式 |

不应对标 ComfyUI — ComfyUI 的 node 是 GPU 操作级（load checkpoint → CLIP encode → sample → VAE decode），节点间传递 Tensor/Latent，数据在 GPU 显存中流动。粒度和传输机制完全不同。

## 2. 设计方向

### 2.1 核心原则

1. **Runtime 提供有限的、标准化的内置节点类别**。不做开放 node 生态，不做 custom node 注册
2. **显式数据边（edge）**。节点间数据流转必须在 workflow 定义中声明，不允许隐式传递
3. **强类型节点配置**。每种 node type 有独立的 typed config，替代 `google.protobuf.Struct`
4. **Script Worker 协议**。为无法用声明式节点覆盖的变换逻辑提供脚本执行能力，协议与语言解耦

### 2.2 节点类别（三类）

#### 类别一：AI 推理节点

直接映射 `RuntimeAiService` 的现有能力，每个节点本质是一次 AI 服务调用：

| 节点类型 | 映射 RPC | 说明 |
|---------|----------|------|
| `AI_GENERATE` | `Generate` | 文本生成 |
| `AI_STREAM` | `StreamGenerate` | 流式文本生成（DAG 内收集完整结果后传给下游） |
| `AI_EMBED` | `Embed` | 向量化 |
| `AI_IMAGE` | `GenerateImage` | 图片生成 |
| `AI_VIDEO` | `GenerateVideo` | 视频生成 |
| `AI_TTS` | `SynthesizeSpeech` | 语音合成 |
| `AI_STT` | `TranscribeAudio` | 语音识别 |

#### 类别二：数据处理节点

覆盖 AI 节点之间最常见的数据变换，作为 runtime 内置标准能力：

| 节点类型 | 作用 | 必要性 |
|---------|------|--------|
| `TRANSFORM_EXTRACT` | 从上游输出中提取字段（JSONPath） | 必须 — AI 返回结构化 response，下游只需其中一个字段 |
| `TRANSFORM_TEMPLATE` | 模板渲染，把多个上游输出组合成一个字符串/结构 | 必须 — 多分支汇聚时拼接 prompt |
| `TRANSFORM_SCRIPT` | 执行用户提交的变换脚本（沙箱内） | 必须 — 声明式节点的逃生舱 |

#### 类别三：控制流节点

| 节点类型 | 作用 | V1 优先级 |
|---------|------|----------|
| `CONTROL_BRANCH` | 条件分支 — 根据上游输出决定走哪条路径 | V1（简单表达式，如 `$.token_count > 20`） |
| `CONTROL_MERGE` | 多分支汇聚 — 等待所有/任一上游完成后聚合 | V1 |
| `CONTROL_NOOP` | 空操作 — 占位/调试 | V1 |
| `CONTROL_LOOP` | 有限循环 — max iterations + exit condition | V2（V1 用 `retry_max_attempts` 覆盖重试场景） |

## 3. Proto 合同变更

### 3.1 新增：WorkflowEdge（显式数据边）

```protobuf
message WorkflowEdge {
  string from_node_id = 1;
  string from_output = 2;    // output slot 名，如 "text", "artifact_id", "output"
  string to_node_id = 3;
  string to_input = 4;       // input slot 名，如 "prompt", "image_ref", "data"
}
```

### 3.2 修改：node_type 从 string 改为 enum

```protobuf
enum WorkflowNodeType {
  WORKFLOW_NODE_TYPE_UNSPECIFIED = 0;

  // AI 推理节点（映射 RuntimeAiService）
  WORKFLOW_NODE_AI_GENERATE = 1;
  WORKFLOW_NODE_AI_STREAM = 2;
  WORKFLOW_NODE_AI_EMBED = 3;
  WORKFLOW_NODE_AI_IMAGE = 4;
  WORKFLOW_NODE_AI_VIDEO = 5;
  WORKFLOW_NODE_AI_TTS = 6;
  WORKFLOW_NODE_AI_STT = 7;

  // 数据处理节点
  WORKFLOW_NODE_TRANSFORM_EXTRACT = 20;
  WORKFLOW_NODE_TRANSFORM_TEMPLATE = 21;
  WORKFLOW_NODE_TRANSFORM_SCRIPT = 22;

  // 控制流节点
  WORKFLOW_NODE_CONTROL_BRANCH = 40;
  WORKFLOW_NODE_CONTROL_MERGE = 41;
  WORKFLOW_NODE_CONTROL_NOOP = 42;
  WORKFLOW_NODE_CONTROL_LOOP = 43;   // V2 预留
}
```

### 3.3 修改：WorkflowNode 使用 oneof typed config

```protobuf
message WorkflowNode {
  string node_id = 1;
  WorkflowNodeType node_type = 2;
  repeated string depends_on = 3;       // 执行依赖（保留，与 edge 互补）
  oneof type_config {
    AiGenerateNodeConfig ai_generate_config = 10;
    AiStreamNodeConfig ai_stream_config = 11;
    AiEmbedNodeConfig ai_embed_config = 12;
    AiImageNodeConfig ai_image_config = 13;
    AiVideoNodeConfig ai_video_config = 14;
    AiTtsNodeConfig ai_tts_config = 15;
    AiSttNodeConfig ai_stt_config = 16;
    ExtractNodeConfig extract_config = 20;
    TemplateNodeConfig template_config = 21;
    ScriptNodeConfig script_config = 22;
    BranchNodeConfig branch_config = 30;
    MergeNodeConfig merge_config = 31;
  }
  int32 retry_max_attempts = 5;
  string retry_backoff = 6;
}
```

### 3.4 修改：WorkflowDefinition 加 edges

```protobuf
message WorkflowDefinition {
  string workflow_type = 1;
  repeated WorkflowNode nodes = 2;
  repeated WorkflowEdge edges = 3;    // 新增：显式数据流
}
```

### 3.5 节点配置 message 定义

#### AI 节点配置

```protobuf
// AI 节点共享的基础字段
message AiGenerateNodeConfig {
  string model_id = 1;
  Modal modal = 2;
  string system_prompt = 3;
  repeated ToolSpec tools = 4;
  float temperature = 5;
  float top_p = 6;
  int32 max_tokens = 7;
  RoutePolicy route_policy = 8;
  FallbackPolicy fallback = 9;
  int32 timeout_ms = 10;
}

message AiStreamNodeConfig {
  string model_id = 1;
  Modal modal = 2;
  string system_prompt = 3;
  repeated ToolSpec tools = 4;
  float temperature = 5;
  float top_p = 6;
  int32 max_tokens = 7;
  RoutePolicy route_policy = 8;
  FallbackPolicy fallback = 9;
  int32 timeout_ms = 10;
}

message AiEmbedNodeConfig {
  string model_id = 1;
  RoutePolicy route_policy = 2;
  FallbackPolicy fallback = 3;
  int32 timeout_ms = 4;
}

message AiImageNodeConfig {
  string model_id = 1;
  RoutePolicy route_policy = 2;
  FallbackPolicy fallback = 3;
  int32 timeout_ms = 4;
}

message AiVideoNodeConfig {
  string model_id = 1;
  RoutePolicy route_policy = 2;
  FallbackPolicy fallback = 3;
  int32 timeout_ms = 4;
}

message AiTtsNodeConfig {
  string model_id = 1;
  RoutePolicy route_policy = 2;
  FallbackPolicy fallback = 3;
  int32 timeout_ms = 4;
}

message AiSttNodeConfig {
  string model_id = 1;
  string mime_type = 2;
  RoutePolicy route_policy = 3;
  FallbackPolicy fallback = 4;
  int32 timeout_ms = 5;
}
```

#### 数据处理节点配置

```protobuf
message ExtractNodeConfig {
  // JSONPath 表达式，从上游输出中提取字段
  // 例："$.output.text" 或 "$.usage.input_tokens"
  string json_path = 1;
}

message TemplateNodeConfig {
  // 模板字符串，支持 {{input_slot_name}} 占位符
  // 例："基于以下描述生成视频：{{description}}\n风格参考：{{style_note}}"
  string template = 1;
  // 输出 MIME 类型（默认 text/plain）
  string output_mime_type = 2;
}

message ScriptNodeConfig {
  // 脚本语言运行时标识
  // V1 内置：starlark, expr
  // V2 外部：python, node, 或用户注册的自定义 runtime
  string runtime = 1;
  // 用户提交的变换代码
  string code = 2;
  // 硬超时（毫秒），默认 5000
  int32 timeout_ms = 3;
  // 内存上限（字节），默认 64MB
  int64 memory_limit_bytes = 4;
}
```

#### 控制流节点配置

```protobuf
message BranchNodeConfig {
  // 条件表达式，对上游输出求值
  // V1 支持简单表达式：$.field > 20, $.field == "value", $.field != null
  // V2 扩展为完整表达式语言
  string condition = 1;
  // 条件为 true 时激活的下游 node_id
  string true_target = 2;
  // 条件为 false 时激活的下游 node_id
  string false_target = 3;
}

message MergeNodeConfig {
  // 汇聚策略
  // ALL — 等待所有上游完成
  // ANY — 任一上游完成即继续
  // N_OF_M — 至少 N 个上游完成
  MergeStrategy strategy = 1;
  // 当 strategy = N_OF_M 时，要求的最小完成数
  int32 min_completed = 2;
}

enum MergeStrategy {
  MERGE_STRATEGY_UNSPECIFIED = 0;
  MERGE_STRATEGY_ALL = 1;
  MERGE_STRATEGY_ANY = 2;
  MERGE_STRATEGY_N_OF_M = 3;
}
```

### 3.6 depends_on 与 edges 的关系

两者互补，不冲突：

| | `depends_on` | `edges` |
|---|---|---|
| **语义** | 执行依赖（B 必须在 A 之后执行） | 数据依赖（B 的 input slot X 消费 A 的 output slot Y） |
| **用途** | 没有数据关系但有执行顺序要求时使用 | 节点间有数据流转时使用 |
| **规则** | `edges` 隐含 `depends_on` — 有数据边时不需要重复声明执行依赖 |

校验规则：
1. `MUST`：`edges` + `depends_on` 合并后的完整依赖图必须无环
2. `MUST`：`edge.from_node_id` 和 `edge.to_node_id` 必须引用已声明的 `node_id`
3. `MUST`：同一 `to_node_id + to_input` 组合不允许有多条边（一个 input slot 只能有一个数据源）
4. `SHOULD`：AI 节点的必填 input slot 缺少数据边时，提交时拒绝

## 4. 节点间数据存储

### 4.1 问题

节点 A 的输出产出后，在 B 消费前，数据存在哪里？

### 4.2 方案

采用 **Result Store + Artifact Store** 分层模型：

| 层 | 数据类型 | 存储 | 生命周期 |
|---|---|---|---|
| **Result Store** | JSON（文本、结构化数据、元数据） | 内存 map（V1）→ SQLite/badger（V2） | 随 workflow 生命周期，completed/failed/canceled 后可配置 TTL 清理 |
| **Artifact Store** | 二进制产物（图片/音频/视频） | 本地文件系统 `~/.nimi/artifacts/{task_id}/{node_id}/{slot}` | 同 Result Store |

数据流转路径：

```
Node A 执行完成
  → JSON 输出写入 Result Store（key: task_id/node_id/output_slot）
  → 二进制产物写入 Artifact Store，返回 artifact_id
  → executor 根据 edges 定义，把 A 的 output slot 绑定到 B 的 input slot
  → Node B 执行时，从 Result Store 读取绑定的 input
```

Edge 传递的是引用（`task_id + node_id + slot_name`），不是数据本身。这保证了：
- 大 artifact 不会被重复复制
- 多个下游节点可以引用同一个上游输出
- 失败重试时可以从 store 恢复上游结果

## 5. Script Worker 架构

### 5.1 定位

为无法用声明式节点（extract/template/branch）覆盖的变换逻辑提供脚本执行能力。协议与语言解耦——runtime 不关心 worker 内部用什么语言，只关心协议。

### 5.2 Worker 协议

定义 `ScriptWorkerService`，与 `inference-worker` 同级：

```protobuf
service ScriptWorkerService {
  rpc Execute(ScriptExecuteRequest) returns (ScriptExecuteResponse);
}

message ScriptExecuteRequest {
  string task_id = 1;
  string node_id = 2;
  // 上游节点输出，按 input slot name 索引
  map<string, google.protobuf.Struct> inputs = 3;
  // 用户提交的脚本代码
  string code = 4;
  // 硬超时
  int32 timeout_ms = 5;
  // 内存上限
  int64 memory_limit_bytes = 6;
}

message ScriptExecuteResponse {
  google.protobuf.Struct output = 1;
  bool success = 2;
  string error_message = 3;
}
```

### 5.3 Worker 拓扑

```
runtime daemon (`nimi serve`)
├── inference-worker           ← 已有：AI 推理
├── model-lifecycle-worker     ← 已有：模型管理
├── workflow-worker            ← 已有：DAG 编排
└── script-worker              ← 新增：脚本执行
    ├── built-in: starlark      (纯 Go 库，编译进二进制，天生沙箱)
    ├── built-in: expr          (纯 Go 库，编译进二进制，纯表达式)
    └── external: 用户注册      (独立进程，走 gRPC/UDS)
```

### 5.4 多语言支持

Script Worker Protocol 与语言解耦。任何遵守 `ScriptWorkerService` 协议的进程都可以注册为 worker：

`~/.nimi/config.json` 示意：

```json
{
  "scriptWorkers": [
    { "runtime": "starlark" },
    { "runtime": "expr" },
    { "runtime": "python", "command": "python3 -m nimi_script_worker", "socket": "/tmp/nimi-script-python.sock" },
    { "runtime": "node", "command": "node ./nimi-script-worker.mjs", "socket": "/tmp/nimi-script-node.sock" }
  ]
}
```

Workflow 节点通过 `ScriptNodeConfig.runtime` 字段指定使用哪个 worker。

### 5.5 V1 内置 Worker 选型

| Worker | 语言 | 沙箱 | 分发影响 | 适用场景 |
|--------|------|------|---------|---------|
| **Starlark** | Python 方言（无 import/IO/网络） | 天生沙箱 | 纯 Go，零依赖 | 数据变换、结构重组、字符串处理 |
| **Expr** | 表达式语言 | 天生沙箱 | 纯 Go，零依赖 | 条件判断、简单计算、`branch` 节点条件求值 |

选择 Starlark 的理由：
- 纯 Go 实现（[google/starlark-go](https://github.com/google/starlark-go)），不引入 cgo，保持单二进制分发
- Google Bazel / Meta Buck2 生产验证
- 语法接近 Python，AI 生态开发者学习成本低
- 天生沙箱（无 import、无文件 IO、无网络、无 goroutine 泄漏），不需要额外隔离工程

不在 V1 嵌入 CPython / Node.js 的理由：
- cgo 交叉编译破坏跨平台分发
- 打破单二进制模型（需要 bundle 解释器或依赖系统安装）
- 沙箱需要额外工程（限制 import、网络、文件系统）
- `runtime/service-contract.md §2.4` 语言重评估触发条件第 3 条明确提到"新增高风险本地沙箱执行器"需要重评估

### 5.6 Script 执行约束

| 约束 | V1 默认值 | 说明 |
|------|----------|------|
| 超时 | 5000ms | 硬超时，不可豁免 |
| 内存 | 64MB | Starlark 级别足够 |
| 网络 | 禁止 | 脚本不允许发起网络请求 |
| 文件系统 | 禁止 | 脚本不允许读写文件 |
| 执行模型 | 纯函数 | 输入 → 输出，无副作用 |

### 5.7 Starlark Script 示例

```python
# 从图像理解结果提取描述，拼接风格迁移的 artifact 引用，
# 组合成视频生成的 prompt
def transform(inputs):
    description = inputs["understand"]["output"]["text"]
    style_artifact = inputs["stylize"]["artifact_id"]

    if len(description) < 20:
        description = "一段精美的短视频"

    return {
        "prompt": "基于以下描述生成视频：" + description,
        "image_ref": style_artifact,
    }
```

## 6. Executor 实现要点

### 6.1 执行模型

当前 `workflow/executor.go` 是测试桩（sleep + 发进度事件）。实际 executor 需要：

1. **拓扑排序**（已有，`helpers.go:validateDefinition`）
2. **按拓扑序执行节点**（已有骨架）
3. **节点执行时**：根据 `node_type` 分发到对应 handler
4. **数据传递**：执行前根据 `edges` 从 Result Store 读取 input，执行后将 output 写入 Result Store
5. **分支处理**：`CONTROL_BRANCH` 节点求值后，标记未激活分支的下游节点为 skipped
6. **汇聚处理**：`CONTROL_MERGE` 节点等待上游满足策略条件后继续

### 6.2 Node Handler 分发

```
executor 收到 node
  → 查 node_type enum
  → AI_GENERATE   → 构造 GenerateRequest，调用 RuntimeAiService.Generate，结果写 Result Store
  → AI_IMAGE      → 构造 GenerateImageRequest，调用 RuntimeAiService.GenerateImage，artifact 写 Artifact Store
  → EXTRACT       → 从 Result Store 读 input，执行 JSONPath，结果写 Result Store
  → TEMPLATE      → 从 Result Store 读所有 input slots，渲染模板，结果写 Result Store
  → SCRIPT        → 构造 ScriptExecuteRequest，调用 ScriptWorkerService.Execute，结果写 Result Store
  → BRANCH        → 从 Result Store 读 input，求值条件，标记激活/跳过的下游分支
  → MERGE         → 等待上游满足策略，聚合结果写 Result Store
```

## 7. 完整 Workflow 示例

### 7.1 场景：图片理解 + 风格化 + 视频生成

```json
{
  "workflow_type": "image_to_video",
  "nodes": [
    {
      "node_id": "understand",
      "node_type": "WORKFLOW_NODE_AI_GENERATE",
      "ai_generate_config": {
        "model_id": "qwen-vl-max",
        "modal": "MODAL_TEXT",
        "system_prompt": "请描述这张图片的内容、氛围和关键元素",
        "route_policy": "ROUTE_POLICY_TOKEN_API",
        "timeout_ms": 30000
      }
    },
    {
      "node_id": "quality_check",
      "node_type": "WORKFLOW_NODE_CONTROL_BRANCH",
      "branch_config": {
        "condition": "$.output.token_count > 20",
        "true_target": "polish",
        "false_target": "default_text"
      }
    },
    {
      "node_id": "polish",
      "node_type": "WORKFLOW_NODE_AI_GENERATE",
      "ai_generate_config": {
        "model_id": "deepseek-v3",
        "modal": "MODAL_TEXT",
        "system_prompt": "润色以下描述，使其更具画面感",
        "route_policy": "ROUTE_POLICY_TOKEN_API",
        "timeout_ms": 30000
      }
    },
    {
      "node_id": "default_text",
      "node_type": "WORKFLOW_NODE_TRANSFORM_TEMPLATE",
      "template_config": {
        "template": "一段精美的短视频"
      }
    },
    {
      "node_id": "stylize",
      "node_type": "WORKFLOW_NODE_AI_IMAGE",
      "ai_image_config": {
        "model_id": "sd-xl",
        "route_policy": "ROUTE_POLICY_LOCAL_RUNTIME",
        "timeout_ms": 120000
      }
    },
    {
      "node_id": "compose",
      "node_type": "WORKFLOW_NODE_CONTROL_MERGE",
      "merge_config": {
        "strategy": "MERGE_STRATEGY_ALL"
      }
    },
    {
      "node_id": "assemble_prompt",
      "node_type": "WORKFLOW_NODE_TRANSFORM_SCRIPT",
      "script_config": {
        "runtime": "starlark",
        "code": "def transform(inputs):\n  text = inputs['text']['value']\n  img = inputs['image']['artifact_id']\n  return {'prompt': '基于描述生成视频：' + text, 'image_ref': img}",
        "timeout_ms": 5000
      }
    },
    {
      "node_id": "generate_video",
      "node_type": "WORKFLOW_NODE_AI_VIDEO",
      "ai_video_config": {
        "model_id": "kling-v1",
        "route_policy": "ROUTE_POLICY_TOKEN_API",
        "timeout_ms": 300000
      }
    }
  ],
  "edges": [
    { "from_node_id": "understand", "from_output": "output", "to_node_id": "quality_check", "to_input": "data" },
    { "from_node_id": "understand", "from_output": "output", "to_node_id": "polish", "to_input": "prompt" },
    { "from_node_id": "polish", "from_output": "output", "to_node_id": "compose", "to_input": "text" },
    { "from_node_id": "default_text", "from_output": "output", "to_node_id": "compose", "to_input": "text" },
    { "from_node_id": "stylize", "from_output": "artifact", "to_node_id": "compose", "to_input": "image" },
    { "from_node_id": "compose", "from_output": "text", "to_node_id": "assemble_prompt", "to_input": "text" },
    { "from_node_id": "compose", "from_output": "image", "to_node_id": "assemble_prompt", "to_input": "image" },
    { "from_node_id": "assemble_prompt", "from_output": "output", "to_node_id": "generate_video", "to_input": "prompt" }
  ]
}
```

## 8. 版本策略

### V1（冻结基线）

- `WorkflowEdge` 显式数据边
- `WorkflowNodeType` enum 替代 freeform string
- oneof typed config 替代 `google.protobuf.Struct`
- 内置节点：7 个 AI 节点 + `EXTRACT` + `TEMPLATE` + `BRANCH` + `MERGE` + `NOOP`
- 内置 Script Worker：Starlark + Expr（编译进二进制）
- Script Worker Protocol 定义冻结
- Result Store（内存）+ Artifact Store（文件系统）

### V2（后续扩展）

- 开放外部 Script Worker 注册（Python / Node / 任意语言）
- 官方提供 Python Worker SDK 和 Node Worker SDK
- `CONTROL_LOOP` 节点
- Result Store 持久化（SQLite / badger）
- Workflow 断点续跑
- 执行缓存（基于 input hash 的节点级缓存）
- WASM Worker（语言无关的通用沙箱）

## 9. 与现有合同的关系

| 文档 | 本文影响 |
|------|---------|
| `ssot/runtime/proto-contract.md §5` | workflow.proto 骨架需要按本文 §3 更新 |
| `ssot/runtime/service-contract.md §7` | DAG 约束章节需要补充 edge 校验规则和节点类型注册语义 |
| `ssot/runtime/multimodal-provider-contract.md` | 外部任务型媒体（video/image/tts/stt）需要补齐 external-async 节点语义 |
| `ssot/runtime/multimodal-delivery-gates.md` | workflow 外部任务编排能力需要纳入 G4/G5/G7 验收 |
| `ssot/sdk/design.md §5` | `@nimiplatform/sdk/runtime` 的 `workflow.*` 接口需要映射新的 WorkflowDefinition 结构 |
| `ssot/platform/architecture.md §2.2` | Workflow DAG 描述需要补充"标准化内置节点 + Script Worker"定位 |

## 10. 发布门槛（补充 runtime/service-contract.md §11）

`MUST`：发布候选前需完成 workflow/scriptworker 单测与合同测试，并在 `dev/report/*.md` 归档证据。

注意：本节门槛是 DAG baseline。涉及外部 provider 异步任务编排（external async）时，必须额外通过 `ssot/runtime/multimodal-delivery-gates.md` 的 G4/G5/G7 门禁。

最小门槛：

- `WorkflowEdge` 数据边校验（类型匹配、无环、slot 唯一性）
- 7 个 AI 节点类型 -> `RuntimeAiService` RPC 映射
- `TRANSFORM_EXTRACT` JSONPath 提取
- `TRANSFORM_TEMPLATE` 模板渲染
- `CONTROL_BRANCH` 条件分支（true/false 路径、skipped 节点传播）
- `CONTROL_MERGE` 汇聚策略（ALL/ANY/N_OF_M）
- Starlark Script Worker 执行 + 沙箱约束（超时/内存/无 IO）
- Result Store 写入/读取/清理生命周期
- Artifact Store 写入/引用/清理生命周期
- 端到端 workflow 提交 -> 执行 -> 进度推送 -> 完成
- Script Worker Protocol 合同（request/response schema）

## 11. 待定项

| 项 | 说明 | 阻塞 |
|----|------|------|
| Artifact Store 存储路径约定 | `~/.nimi/artifacts/` 或跟随 XDG 规范 | 不阻塞 proto |
| Result Store V2 持久化方案 | SQLite vs badger vs 其他 | 不阻塞 V1 |
| 外部 Script Worker 注册/发现协议 | 配置文件 vs runtime API | V2 |
| Branch 条件表达式语法规范 | 简单比较 vs 完整表达式语言 vs 复用 Expr | V1 需要冻结 |
| WASM Worker 可行性评估 | Wazero 集成路径 | V2 |
