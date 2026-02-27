---
title: Nimi Platform Architecture Overview
status: FROZEN
created_at: 2026-02-24
updated_at: 2026-02-27
parent: INDEX.md
rules:
  - This SSOT is maintained in @nimiplatform/nimi and follows no-legacy mode.
  - Changes must preserve traceability to source and contract-level acceptance gates.
---
---

# 平台架构总览

## 1. 动机

### 1.1 当前架构的局限

```
当前：desktop 是一切的容器
┌─ desktop (Tauri) ────────────────────┐
│  ├── execution-kernel (治理链)             │
│  ├── hook system (5 子系统)                │
│  ├── llm-adapter (AI 路由)                │
│  ├── mod sandbox                          │
│  ├── Core UI (world/agent/social/economy) │
│  └── mods (上层扩展)                      │
└───────────────────────────────────────────┘
            │
            ▼
┌─ nimi-realm (closed-source) ──────────────┐
│  auth / social / economy / worlds / agents │
└───────────────────────────────────────────┘
```

问题：
- **Runtime 和 Desktop 强耦合** — AI 能力、模型管理等基础设施被锁在桌面应用进程内
- **第三方无法独立接入** — 想用 Nimi AI 能力的应用必须成为 desktop 的 mod
- **"Mod" 语义天花板** — 所有上层应用被框定为主应用的附属扩展，无法承载独立产品形态
- **平台叙事受限** — 对外定位是 "带插件的桌面应用" 而非 "AI 应用运行时平台"

### 1.2 目标架构

```
┌─────────────────────────────────────────────────────────────┐
│                         nimi-apps                            │
│                                                             │
│   desktop (第一方)        App A (第三方)    App B        │
│   ┌──────────────────┐       ┌──────────┐    ┌──────────┐  │
│   │ Core UI          │       │          │    │          │  │
│   │ nimi-hook ←→ mods│       │          │    │          │  │
│   │ App Store 入口   │       │          │    │          │  │
│   └────────┬─────────┘       └────┬─────┘    └────┬─────┘  │
│            │                      │                │        │
├────────────┴──────────────────────┴────────────────┴────────┤
│                          nimi-sdk                            │
│     @nimiplatform/sdk/realm (→ nimi-realm) + @nimiplatform/sdk/runtime (→ nimi-runtime) │
├────────────────────────────┬────────────────────────────────┤
│      nimi-realm (云端)       │      nimi-runtime (本地)        │
│                            │                                │
│  auth / social / chat      │  AI 推理 (全模态)               │
│  economy / worlds          │  模型管理 / MCP                 │
│  agents / memory           │  审计 / 沙箱 / 知识库           │
│                            │  GPU 调度 / App 通信            │
│   REST + WebSocket         │         gRPC                   │
└────────────────────────────┴────────────────────────────────┘
```

### 1.3 执行口径（No-Legacy）

1. 架构口径固定为单一目标态，不引入长期双轨并存。
2. 数据口径采用 reset-first（本地态 + 非生产环境），不做 legacy 兼容迁移。
3. 执行模式采用 AI-first，自动化为默认，人工负责 Go/No-Go 与风险兜底。

## 2. 六层定义

### 2.1 nimi-realm — 云端持久世界

**定位**：云端服务集群，管理所有需要跨设备、跨 App 共享的持久世界状态。Realm = 领土(worlds) + 居民(agents) + 身份 + 社会结构 + 经济 + 记忆。

**职责**：

| 领域 | 能力 |
|------|------|
| 身份认证 (auth) | 注册/登录/token/OAuth/账户安全 |
| 社交 (social) | 关系图谱、关注/好友、动态、消息 |
| 聊天 (chat) | 云端消息同步、历史、多设备 |
| 经济 (economy) | 资产、gift、交易、结算 |
| World | World 定义、发布、发现、元数据 |
| Agent | Agent 定义、注册、人格（Soul/Brain/Worldview） |
| Memory (云端) | 跨设备、跨 World 的长期记忆持久化 |
| 审计 (云端) | 聚合审计、合规报告 |

Worldview 补充：
- 当前开源层采用“规则根 1:1 绑定 world”的口径。
- 模块丰富度与扩展方向跟随 `ssot/boundaries/world.md` 演进（含 existences/resources/locations/glossary/visualGuide 等）。
- 本文不复制 SSOT 字段细节，只约束架构边界与执行归属。

**通信协议**：REST + WebSocket（实时推送）

**对应当前代码**：`nimi-realm`（closed-source；NestJS + Prisma + PostgreSQL + Redis）

**关键特征**：nimi-realm 是**持久世界的共享真相源（shared source of truth）** — 身份、社交关系、经济账本、World/Agent 定义、记忆，这些构成了 Realm 的持久状态，必须跨设备跨 App 一致。

### 2.2 nimi-runtime — 本地 AI 运行时服务

**定位**：独立本地后台进程，提供 AI 计算能力和本地基础设施，不包含任何 UI。

**本质**：进程管理器 + gRPC API 门面。统一编排本地推理后端与云端推理网关，对上提供单一 runtime 合同。

**职责**：

| 领域 | 能力 |
|------|------|
| AI 推理 | chat / tts / stt / t2i / i2i / t2v / i2v / embedding — 全模态标准化 |
| AI 路由 | local-runtime / token-api 双源路由，统一接口屏蔽 provider 差异 |
| AI 后端 | 本地：LocalAI / Nexa 等开源方案；云端：nimiLLM 统一网关（覆盖核心 provider） |
| 进程管理 | 子进程生命周期（按需启动/健康检查/崩溃重启/优雅关闭） |
| 模型管理 | 本地模型下载/安装/卸载/健康检查，云端 provider 配置 |
| Workflow DAG | 架构级多模型编排引擎。Runtime 提供 DAG 执行/调度/进度推送，App/Mod 提交 workflow 定义。例：图片生成 = prompt→embedding→VAE 多模型流水线 |
| 异步任务 | 提交/排队/进度推送/取消（参考 ComfyUI 模式）。Workflow DAG 中的每个节点即为一个异步任务单元 |
| GPU 仲裁 | 多 App 并发推理时的资源调度、排队和配额 |
| 本地数据层 | realm-cache（agent/memory/world 本地缓存）+ per-app-user 分区存储（`appId + subjectUserId/authId`）+ 跨 App 授权访问 |
| 知识库引擎 | 向量索引 / embedding / 检索（索引来源：realm-cache + app 数据 + 用户授权内容） |
| Credential Plane | 进程配置凭证（daemon-config）+ 请求期凭证（host 注入）双平面；secret 持久化由受信宿主负责（如 OS keychain 或等效机制） |
| MCP Server | 标准 MCP 协议，供外部 AI 工具接入 |
| 审计 (本地) | AI 调用记录、per-app 用量统计，可选上报到 realm |
| App 间通信 | 跨 App 消息传递和数据共享通道 |
| App 授权网关 | ExternalPrincipal -> App 的授权策略执行、token 签发/校验/撤销/委托 |

**V1 执行栈冻结**：
- 本地模型面：`LocalAI + Nexa`。
- 远程模型面：`nimiLLM`（统一覆盖 OpenAI-compatible + Alibaba + Bytedance + Gemini + MiniMax + Kimi + GLM）。
- 路由面：`local-runtime | token-api` 显式路由，不允许静默 fallback。
- 凭证面：`token-api` 默认走请求期凭证注入；runtime 不承担 `connectorId -> secret` 解析。
- 编排面：`Workflow DAG` 作为独立运行时能力，不并入单次模型调用接口。

**通信协议**：gRPC（unary + server streaming + bidirectional streaming）

- **内部 IPC（daemon ↔ 推理子进程）**：gRPC over Unix Domain Socket。参考 HuggingFace TGI 架构（Rust router ↔ Python model server via gRPC/UDS），延迟 ~100μs，全语言支持
- **客户端 API（App ↔ daemon）**：gRPC（同一套 .proto），未来按需叠加 ConnectRPC 层（零额外 proto 成本，支持 HTTP/1.1 + 浏览器 + curl 调试）
- **大 payload（图片/视频）**：V1 统一走 gRPC streaming/分块传输；不启用 shared memory 通道
- **Schema 工具链**：Buf CLI（breaking change 检测 + Schema Registry），替代原生 protoc

**实现语言（V1 锁定）**：Go。理由：runtime 当前定位是控制平面（gRPC/进程管理/调度/审计），Go 在该路径的开发与交付效率最优，且与单二进制分发模型一致。

**重评估触发条件（满足其一才讨论 Rust）**：
- 控制平面核心 SLO 长期不达标，且瓶颈被证实源于 Go runtime/GC 特性而非业务实现。
- 主路径必须引入 in-process 零拷贝/共享内存机制（当前 V1 明确不启用 shm）。
- runtime 职责新增高风险本地沙箱执行器，且需语言级约束覆盖当前安全目标。

**生命周期**：
- 首个 App 连接时自动拉起（或用户手动启动 / 常驻 tray）
- 最后一个 App 断开后 graceful shutdown（可配置常驻）
- 类比：Ollama / Docker Daemon
- 未来可能运行在非 PC 设备（智能音箱、车载、智能镜），轻量化和跨平台是硬性要求

**不包含**：
- UI Hook / event-bus（App 进程内机制，属于 nimi-hook）
- UI 渲染
- Mod 加载/治理（属于 desktop）
- 持久世界状态（身份/社交/经济，属于 nimi-realm）
- App 级沙箱（App 是独立进程，安全性由 OS 负责）
- `connectorId -> secret` 解析与长期密钥持久化策略（属于受信宿主，如 desktop/cli）

**对应当前代码**：从 `apps/desktop/src/runtime/llm-adapter/` 提升而来

### 2.2.1 nimi-cli — 统一命令行入口

**定位**：nimi-runtime 的用户面 CLI，类比 Ollama CLI。与 daemon 共享同一 Go 二进制，通过子命令切换角色。

**二进制结构**：

```
runtime/cmd/
├── nimi/           ← CLI 入口（nimi serve / nimi run / nimi model ...）

编译产物：单一二进制 `nimi`
  nimi serve    → 启动 daemon
  nimi *        → 作为 CLI client 连接 daemon gRPC
```

**命令体系**：

| 命令组 | 子命令 | 说明 |
|--------|--------|------|
| **daemon** | `nimi serve` | 启动 runtime daemon（前台/后台） |
| | `nimi status` | 查看 daemon 状态、已加载模型、GPU 占用 |
| **AI 推理** | `nimi run <model>` | 启动交互式对话（类 `ollama run`） |
| | `nimi chat <model>` | `run` 的别名 |
| **模型管理** | `nimi model list` | 列出已安装模型 |
| | `nimi model pull <model>` | 下载模型 |
| | `nimi model rm <model>` | 删除模型 |
| **Mod 管理** | `nimi mod list` | 列出已安装 mods |
| | `nimi mod install <source>` | 安装 mod（GitHub repo 或 Mod Circle） |
| | `nimi mod create` | 脚手架创建新 mod 项目 |
| | `nimi mod dev` | 启动 mod 开发模式（热重载） |
| | `nimi mod publish` | 发布到 Mod Circle（触发 PR） |
| **Workflow** | `nimi workflow run <def>` | 提交 DAG workflow |
| | `nimi workflow status <id>` | 查询 workflow 进度 |
| **Key 管理** | `nimi key set <provider>` | 设置 provider secret 引用（写入受控 secret 存储，如 OS keychain/等效机制） |
| | `nimi key list` | 列出已配置 provider 引用 |

**设计要点**：
- 单二进制：`nimi` 二进制同时包含 daemon 和 CLI 逻辑，`nimi serve` 启动 daemon，其他命令作为 gRPC client
- 类比 Ollama：`nimi run llama3` 即时对话，daemon 按需自动拉起
- 开发者友好：`nimi mod create/dev/publish` 构成 mod 开发全流程
- 可脚本化：所有命令支持 `--json` 输出，方便 CI/CD 集成

#### CLI -> gRPC 映射（V1）

| CLI 命令 | Runtime RPC | 说明 |
|---------|-------------|------|
| `nimi run` / `nimi chat` | `RuntimeAiService.StreamGenerate` | 交互式流式对话 |
| `nimi model list` | `RuntimeModelService.ListModels` | 查询模型状态 |
| `nimi model pull` | `RuntimeModelService.PullModel` | 拉取/安装模型 |
| `nimi model rm` | `RuntimeModelService.RemoveModel` | 删除模型（protected） |
| `nimi workflow run` | `RuntimeWorkflowService.SubmitWorkflow` | 提交 DAG 任务 |
| `nimi workflow status` | `RuntimeWorkflowService.GetWorkflow` | 查询任务进度 |
| `nimi status` | `RuntimeModelService.ListModels` + `RuntimeAuditService.ListAuditEvents` | 运行状态与诊断聚合 |

### 2.2.2 ExternalPrincipal -> App 授权链路（runtime 域）

规范来源：授权语义真相以 `ssot/platform/protocol.md §3.4` 为准；本节仅保留架构路径摘要。

这个链路和 realm 登录态解耦，属于 App 可访问性授权域：

1. **App 决策授权策略**：用户在 app 内选择授权档位（`readOnly | full | delegate`）或进入 custom 配置。
2. **SDK 定义并封装 scope**：app 通过 `@nimiplatform/sdk/runtime` 提交统一命名 scope（`realm.* / runtime.* / app.<appId>.*`）与已发布的 `scopeCatalogVersion`。
3. **Runtime/Realm 执行授权**：runtime 通过单事务授权 RPC 创建策略并签发 token（绑定 `issuedScopeCatalogVersion`），执行 `app-auth/runtime.*` 校验；`realm.*` 相关授权由 realm 域执行。
4. **ExternalPrincipal 访问 App**：external principal 持 token 调 runtime，再由 runtime 在授权边界内访问目标 app 能力。

关键约束：
- 同一 external principal 访问不同 app 必须使用不同 token。
- 默认一个 `externalPrincipal-app` 组合只发一个主 token，不强制按 scope 拆多 token。
- `delegate` 预设默认仅单跳委托（不允许二次委托）；父 token 撤销时子 token 级联失效。
- App 授权策略更新后，既有 token 立即失效并需重新签发。
- App 扩展 scope 的注册/分发/查询统一走 `nimi-sdk scope` 模块。
- scope 目录由 SDK 发布版本，runtime/realm 按域执行与校验。

典型例子：
- `external-agent`：OpenClaw Agent 调用聊天 App 的授权能力。
- `external-app`：小说生成 App 在授权范围内读取聊天 App 的会话记录并生成内容。

### 2.3 nimi-realm 与 nimi-runtime 的关系

```
         nimi-realm (云端)                  nimi-runtime (本地)
         ┌──────────┐                     ┌──────────┐
         │ 共享状态  │                     │ 本地计算  │
         │ 业务逻辑  │                     │ AI 推理   │
         └────┬─────┘                     └────┬─────┘
              │                                │
              │  互不依赖，通过 nimi-sdk 桥接     │
              │                                │
              └──────────┬─────────────────────┘
                         │
                      nimi-sdk
```

- **并列关系**，互不依赖
- 一个 App 可以只用 nimi-realm（纯 Web App，无本地 AI）
- 一个 App 可以只用 nimi-runtime（纯本地 AI 工具，无云端功能）
- 完整体验两者都用
- nimi-sdk 统一封装两者的访问

### 2.4 nimi-sdk — 开发者接口层

**定位**：库（非服务），运行在 App 进程内，是开发者接入平台的唯一入口。

```
@nimiplatform/sdk
├── realm                      → nimi-realm (REST + WebSocket)
│   │
│   │  REST 部分：OpenAPI codegen 直出（延续当前管线）
│   │  NestJS @nestjs/swagger → api-nimi.yaml → openapi-typescript-codegen
│   │  即当前 sdk/src/realm 的 OpenAPI codegen 管线延续，零手写 API 代码
│   │  注：原始 api-nimi.yaml 留在 nimi-realm 闭源 repo，@nimiplatform/sdk/realm 以编译后 npm 包发布
│   │
│   ├── auth.*                 身份认证
│   ├── social.*               社交关系
│   ├── chat.*                 云端消息
│   ├── economy.*              经济系统
│   ├── world.*                World 管理
│   ├── agent.*                Agent 管理
│   ├── memory.*               云端记忆
│   │
│   └── realtime.*             Socket.IO 事件（手写类型或 AsyncAPI codegen 补充）
│
├── runtime                    → nimi-runtime（V1: direct gRPC）
│   ├── ai                     基于 Vercel AI SDK v6 + Nimi Provider Bridge
│   │   │
│   │   │  采用 AI SDK v6 类型系统和调用范式（LanguageModelV3 / EmbeddingModelV3 / ImageModelV3）
│   │   │  @nimiplatform/sdk/ai-provider 作为 provider bridge，doGenerate/doStream 转为 gRPC 调用
│   │   │  开发者直接用 generateText / streamText / generateObject / embed 等 AI SDK 原语
│   │   │  当前 ModAiClient 是此方案的手写前身，按单次切换直接替换
│   │   │  边界：ai.* 只承载单次/流式模型调用，不承载 DAG 编排
│   │   │
│   │   ├── nimi('chat/default')       LanguageModelV3 — text generation + tool calling
│   │   ├── nimi.embedding('default')  EmbeddingModelV3
│   │   ├── nimi.image('default')      ImageModelV3
│   │   ├── nimi.video('default')      Nimi 扩展（AI SDK 未覆盖）
│   │   ├── nimi.tts('default')        Nimi 扩展（AI SDK 未覆盖）
│   │   └── nimi.stt('default')        Nimi 扩展（AI SDK 未覆盖）
│   │
│   ├── workflow.*             DAG 提交/查询/取消/进度订阅（独立接口，不走 AI SDK provider）
│   ├── model.*                模型管理
│   ├── mcp.*                  MCP 操作
│   ├── knowledge.*            本地知识库
│   ├── audit.*                本地审计
│   ├── app-auth.*             ExternalPrincipal 授权（authorize/revoke/delegate）
│   └── app.*                  App 间通信与受控访问
│
│   transport profile:
│   - node-grpc    : 可信进程直连（desktop main / native app / node service）
│   - tauri-ipc    : desktop renderer 经 Rust bridge 转 runtime gRPC（V1 正式 profile）
│   - local-broker : FUTURE 预留（browser/mod/renderer 本地模型访问）
│
├── scope.*                  SDK scope 模块（list/register/publish/revoke）
│   ├── 汇总 realm/runtime/app scopes
│   └── 为授权页与 external principal 提供统一 scope 目录视图
│
├── types                      全量类型定义
│
└── services (可选)           ← 高级封装，按需引入
    ├── translation              多语言翻译
    ├── ocr                      文字识别
    ├── vector-search            向量检索 / RAG
    └── knowledge-builder        知识库构建工具
```

**与当前代码的关系**：
- 当前 `@nimiplatform/sdk/mod/ai` → `@nimiplatform/sdk/runtime` 的 `ai.*`
- 当前 `@nimiplatform/sdk/mod/types` → `@nimiplatform/sdk/types`
- 新增 `@nimiplatform/sdk/realm`（当前 desktop 直接调 nimi-realm REST，需要标准化为 SDK 层）
- 新增 `@nimiplatform/sdk/runtime` 的 gRPC 传输层（当前是进程内调用）
- 新增 `@nimiplatform/sdk/runtime` 的 `app-auth.*`（ExternalPrincipal 授权策略提交与 token 生命周期）
- 新增 `scope.*`（scope 注册/查询/发布/撤销，供授权页与 external principal 共用）
- 新增统一 scope catalog 生成管线（Realm OpenAPI + Runtime proto + App 扩展 manifest），由 SDK 发布版本
- `local-broker` 作为未来扩展预留，当前阶段不纳入实现门槛

### 2.5 desktop — 第一方应用

**定位**：Nimi 平台的旗舰应用。架构上是一个 nimi-app，没有特殊地位。

**与其他 nimi-app 的共性**：
- 通过 `@nimiplatform/sdk` 接入 nimi-realm 和 nimi-runtime
- 和第三方 app 用完全相同的 SDK API

**独有特性**：
- **nimi-hook**：Mod 宿主系统，为 mods 提供 Hook 接口
- **Core UI**：World / Agent / Social / Economy 的完整管理界面
- **Runtime Console**：runtime 管理与监控（启动/重启、健康状态、队列、调用统计、诊断导出）
- **App Store 入口**：发现、下载、启动第三方 nimi-apps

### 2.6 nimi-hook — Desktop 的 Mod 接口层

**定位**：desktop 内部模块，为 nimi-mods 提供访问平台能力的沙箱化接口。

**五个子系统**：

| 子系统 | 职责 |
|--------|------|
| event-bus | Mod 间及 Mod 与 Desktop 的发布/订阅事件 |
| data-api | 数据注册/查询 |
| ui-extension | UI 插槽注册（sidebar、routes 等） |
| turn-hook | 对话 pipeline 拦截 |
| inter-mod | Mod 间消息传递 |

**运行位置**：desktop 进程内，零延迟。

**关键约束**：
- Hook 系统只存在于 desktop 内
- Mod 通过 hook 访问能力，hook 内部通过 nimi-sdk 连接 realm/runtime
- 其他 nimi-app 不需要 hook（它们直接用 nimi-sdk）

**对应当前代码**：`apps/desktop/src/runtime/hook/` + `apps/desktop/src/runtime/execution-kernel/`

### 2.7 nimi-mods — Desktop 内小程序

**定位**：运行在 desktop 沙箱内的轻量扩展，类比微信小程序。

**特征**：
- 不需要独立安装、独立进程
- 通过 nimi-hook 访问 Desktop 能力（进而访问 realm 和 runtime）
- 遵循 8 阶段治理链（discovery → manifest → signature → dependency → sandbox → load → lifecycle → audit）
- 产出可分享内容（卡片、贴纸、短视频等）

**当前 launch plan 中的 12 个 mod 全部归入此类。**

### 2.8 nimi-apps — 独立应用

**定位**：基于 nimi-sdk 构建的独立应用，拥有自己的进程、UI、数据。desktop 是其中一个。

本阶段只冻结两条底线：
1. nimi-app 通过统一 SDK 接入 realm/runtime，不允许私有后门。
2. App 可访问边界由 Runtime/Realm 执行授权，不由客户端自判。

注：App 生态分类、分发、商店与准入流程属于后续专题，当前不作为主线输入。

### 2.9 Browser/Mod 本地 Broker 授权边界（FUTURE 占位）

定位：浏览器页面与 mod 的本地 runtime 访问能力先做设计占位，待生态规模与产品优先级满足后再实现（desktop renderer 已由 tauri-ipc + Rust bridge 在 V1 落地）。

标注范围：
1. 预留 `brokerGrant`（realm 签名）语义。
2. 预留 `origin + appId + scope + exp + jti` 校验语义。
3. 预留“仅本地模型、禁云端凭证代理”的安全目标。
4. 当前阶段不纳入发布 gate 与实现计划。

## 3. 层间通信总图

```
nimi-mods ←→ desktop       : 进程内 nimi-hook（零延迟）
desktop → nimi-realm         : nimi-sdk @nimiplatform/sdk/realm（REST + WS）
desktop(main) → nimi-runtime : nimi-sdk @nimiplatform/sdk/runtime（node-grpc direct gRPC）
desktop(renderer) → nimi-runtime : nimi-sdk @nimiplatform/sdk/runtime（tauri-ipc -> Rust bridge -> gRPC）
nimi-apps → nimi-realm            : nimi-sdk @nimiplatform/sdk/realm（REST + WS）
nimi-apps(trusted) → nimi-runtime : nimi-sdk @nimiplatform/sdk/runtime（node-grpc direct gRPC）
nimi-apps ←→ nimi-apps           : gRPC via nimi-runtime app.message
render-app → world               : read-only（无绑定）
extension-app → world            : write with world binding（creator controlled 1:1）
externalPrincipal → nimi-runtime : app access token + runtime app-auth API
externalPrincipal → nimi-apps    : via nimi-runtime (authorized scopes only)
nimi-runtime → 本地模型           : 进程内/子进程调用
nimi-runtime → 云端 AI provider  : HTTPS
nimi-realm ←→ 数据库/缓存         : PostgreSQL / Redis / OpenSearch

(FUTURE) browser/mod → local-broker → nimi-runtime（local model only）
```

## 4. 与当前架构的映射

| 当前组件 | 目标归属 | 变化 |
|---------|---------|------|
| `nimi-realm`（closed-source codebase） | **nimi-realm** | 作为云端服务独立维护 |
| `apps/desktop/src/runtime/llm-adapter/` | **nimi-runtime** | 提升为独立服务 |
| `apps/desktop/src/runtime/hook/` | **nimi-hook**（desktop 内部） | 保留在 desktop，不进 SDK |
| `apps/desktop/src/runtime/execution-kernel/` | **nimi-hook**（desktop 内部） | 保留在 desktop，继续管 mod 治理 |
| `nimi-mods/`（external repo root） | **nimi-mods** | desktop 通过 `NIMI_MODS_ROOT` / `NIMI_RUNTIME_MODS_DIR` 联调加载 |
| `sdk/src/mod/` | **nimi-sdk** | 扩展为完整 SDK（含 `@nimiplatform/sdk/realm` + `@nimiplatform/sdk/runtime`） |

## 5. 审计的双层模型

| 层 | 职责 | 存储 |
|----|------|------|
| **nimi-runtime 本地审计** | AI 调用记录、模型操作、App 间通信日志、ExternalPrincipal 授权/token 链路日志 | 本地文件/SQLite |
| **nimi-realm 云端审计** | 业务操作（交易、社交、World 变更）、合规报告、跨设备聚合 | PostgreSQL |

两层审计独立运行。本地审计可选上报到云端聚合。

## 6. 当前执行入口（文档层已收敛）

以下主题已完成文档层讨论并进入 `FROZEN`，当前重点是实现与验收：

1. **nimi-runtime gRPC API 定义** — 完整 proto 合同（→ ssot/runtime/proto-contract.md）
2. **nimi-sdk 分层细节** — `@nimiplatform/sdk/realm` / `@nimiplatform/sdk/runtime` API 设计（→ ssot/sdk/design.md）
3. **Desktop Runtime Contract** — 代码归属与切换边界（→ ssot/desktop/runtime-contract.md）
4. **Platform Protocol** — L0 封装 + L1 app-auth 锚点 + L2 Realm 六原语画像（→ ssot/platform/protocol.md）
5. **ExternalPrincipal 授权细化** — preset/custom、委托深度与撤销语义（→ ssot/runtime/service-contract.md / ssot/sdk/design.md / ssot/platform/protocol.md）
6. **Realm 六原语实现映射** — 现有 nimi-realm 到协议合同的差距清单（→ ssot/economy/realm-interop-mapping.md）
