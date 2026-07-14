export async function appendSpecHumanDocRuntimeSdkNarrative(d, { renderJobStates, rtTables }) {
  d.text(`---

## 5. 流式处理

Runtime 有两类流式模式：场景流（StreamScenario）与任务状态订阅（SubscribeScenarioJobEvents）。

### 5.1 建流边界

流的建立有一个关键的分界点：AI 推理管道的全部 10 步评估通过后，流才算建立。

- **建流前**出错：走普通 gRPC error，和 unary RPC 一样
- **建流后**出错：优先通过终帧事件通知（\`done=true + reason_code\`），而非中断流

这意味着客户端可以简单地判断：如果收到了第一个流事件，说明认证、授权、凭据校验都已通过，后续错误只可能来自上游 provider。`);
  d.blank();
  d.rule('K-STREAM-002');

  d.text(`### 5.2 文本流事件

文本流的事件约定简单明确：

- 中间帧：\`done=false\`，必须携带非空的 \`text_delta\`
- 终帧：\`done=true\`，必须携带 \`usage\` 统计（token 用量）。如果上游不提供统计，填 \`-1\`
- 终帧可以携带最后一段 \`text_delta\`（即最后一个 chunk 和 done 可以合并）`);
  d.blank();
  d.rule('K-STREAM-003');

  d.text(`### 5.3 语音流事件

语音流的事件约定类似，但音频数据和状态信号严格分离：

- 中间帧：\`done=false\`，必须携带非空的 \`audio_chunk\`
- 成功终帧：\`done=true\`，\`audio_chunk\` 为空
- 失败终帧：\`done=true\`，\`reason_code\` 必填`);
  d.blank();
  d.rule('K-STREAM-004');

  d.text(`### 5.4 状态事件流

ScenarioJob 状态事件流不使用 \`done=true\` 语义。当任务到达终态后，服务端正常关闭流（gRPC OK）。`);
  d.blank();
  d.rule('K-STREAM-005');

  d.text(`---

## 6. ScenarioJob 系统

图像生成、视频生成、TTS/STT 等场景类 AI 任务采用异步模式：通过 \`SubmitScenarioJob\` 提交任务，然后通过轮询或事件流获取结果。

### 6.1 核心设计：凭据快照

ScenarioJob 的一个关键设计是**凭据快照**。任务提交时，系统会快照当前的 provider type、endpoint 和凭据。之后所有对这个 job 的操作（查询状态、获取结果、取消）都使用快照凭据，**不依赖连接器的当前状态**。

这意味着：
- 用户在任务执行期间删除连接器，不影响任务的可观测性和可控性
- 任务到达终态后，快照凭据会被清理（内存清零 + 持久化删除）`);
  d.blank();
  d.rule('K-JOB-003');
  d.rule('K-JOB-004');
  d.rule('K-JOB-005');

  d.text(`### 6.2 任务状态机

ScenarioJob 有以下状态，其中四个是终态：`);
  d.blank();
  await d.yamlTable(rtTables('job-states.yaml'), renderJobStates);

  d.text(`事件流在任一终态后可正常关闭。`);

  d.text(`
---

## 7. 安全与审计

### 7.1 Endpoint 安全

所有出站的 AI API 请求都必须经过 endpoint 安全校验，包括 managed 连接器的 endpoint 和 inline 路径的 endpoint。校验不是一次性的——**每次实际出站请求前都必须执行**，防止 TOCTOU（Time-of-check to time-of-use）攻击。`);
  d.blank();
  d.rule('K-SEC-002');
  d.rule('K-SEC-003');

  d.text(`### 7.2 审计

所有管理操作和推理操作都必须记录审计事件（成功和失败）。审计记录包含最小字段集：`);
  d.blank();
  d.rule('K-AUDIT-001');

  d.text(`审计数据有严格的安全要求：必须脱敏（不记录明文凭据），必须有保留期限（禁止无限保留）。`);
  d.blank();
  d.rule('K-AUDIT-005');

  d.text(`---

## 8. 错误处理模型

### 8.1 双层错误模型

Nimi 的错误由两层组成，二者正交：

- **gRPC Code**：表示失败的阶段/类型（如 \`NOT_FOUND\`、\`UNAUTHENTICATED\`、\`INTERNAL\`）
- **ReasonCode**：表示具体的业务原因（如 \`AI_CONNECTOR_DISABLED\`、\`AUTH_TOKEN_INVALID\`）

同一个 ReasonCode 在不同场景下可能对应不同的 gRPC Code。例如 \`AI_CONNECTOR_CREDENTIAL_MISSING\` 在 consume 场景返回 \`FAILED_PRECONDITION\`，在 test-connector 场景返回 \`OK + ok=false\`。`);
  d.blank();
  d.rule('K-ERR-001');

  d.text(`### 8.2 关键映射规则

以下是几个最重要的错误映射规则：`);
  d.blank();
  d.rule('K-ERR-004');
  d.rule('K-ERR-005');

  d.text(`### 8.3 错误传递机制

错误在不同类型的 RPC 中传递方式不同：`);
  d.blank();
  d.rule('K-ERR-003');

  d.text(`### 8.4 分页与过滤

\`ListConnectors\` 和 \`ListConnectorModels\` 支持分页。页面大小默认 50，最大 200。排序规则是固定的——本地连接器排在前面，远程连接器按创建时间倒序。`);
  d.blank();
  d.rule('K-PAGE-001');
  d.rule('K-PAGE-003');

  d.text(`---

## 9. SDK 架构

在 Nimi 的整体架构中，SDK 扮演的角色是**唯一合法网关**：Desktop 和 Web 应用不直接发 gRPC 调用，也不直接拼 HTTP 请求，一切对 Runtime 和 Realm 的访问必须经过 \`@nimiplatform/sdk\`。这不是一个便利性选择——SDK 承担了传输声明、错误投影、导入隔离三项关键职责，把"调用底层服务"从一个全局不确定行为收窄为一组受控 surface。

\`\`\`
┌─────────────────────────────────────────────────────────────┐
│                   Desktop / Web / Kit                       │
│                                                             │
│  @nimiplatform/sdk                                          │
│  ┌──────────┐ ┌──────────┐ ┌───────┐ ┌────────┐ ┌─────────┐  │
│  │  root    │ │ runtime  │ │ realm │ │core ai │ │features │  │
│  │ NimiClient│ │ gRPC/IPC │ │HTTP/WS│ │agent   │ │app DX   │  │
│  └────┬─────┘ └────┬─────┘ └───┬───┘ └───┬────┘ └────┬────┘  │
│       │ explicit    │          │         │           │       │
└───────┼──────────────┼───────────┼──────────┼────────────────┘
        ▼              ▼           ▼          ▼
  ┌───────────┐   (delegates   ┌────────┐  (adapter packages)
  │  Runtime  │    to runtime) │ Realm  │  @nimiplatform/sdk-adapter-*
  │   (Go)    │                │ Server │
  └───────────┘                └────────┘
\`\`\`

下面的规范从"为什么分层公开 surface"出发，依次展开传输层设计、错误投影模型和导入边界，最后简述每个 surface 的领域特征。

### 9.1 为什么是分层 surface？

公开 surface 看似只是目录划分，实际上反映了不同的**传输模型、信任假设和开发者意图**：

- **root NimiClient** — app-owned 显式组合面，组合 Runtime、Realm、App、AI、Agent 与 feature surfaces，不提供全局 singleton
- **runtime** — 通过 gRPC 或 Tauri IPC 与本地守护进程通信，延迟极低，但需要显式声明传输通道
- **realm** — 通过 HTTP/WebSocket 与远程 Realm 服务器通信，延迟和可靠性特征与 gRPC 截然不同
- **core ai / agent / features** — Nimi-native DX 层，组合 Runtime/Realm 既有权威 surface，不新增 product truth
- **independent adapters** — Vercel AI、OpenAI-compatible、MCP 等框架桥接属于独立 adapter package，不恢复 base SDK 的 \`ai-provider\` 或 \`ai-app\` 子路径

如果把它们合并为一个隐式入口，transport 切换逻辑、错误码映射、安全边界和框架适配语义就会交织在一起，制造出"能调通但偶尔莫名失败"的隐藏耦合。分层 surface 让每种通信模式和适配责任有独立的初始化、失败语义和 package 边界。`);
  d.blank();
  d.rule('S-SURFACE-001');

  d.text(`各子路径的方法投影遵循结构化治理。Runtime SDK 的对外方法按 service 分组，与 \`.nimi/spec/runtime/kernel/tables/rpc-methods.yaml\` 的设计名对齐——投影表 \`tables/runtime-method-groups.yaml\` 是唯一事实源：`);
  d.blank();
  d.rule('S-SURFACE-002');
  d.rule('S-SURFACE-009');

  d.text(`遗留接口名（\`listTokenProviderModels\`、\`TokenProvider*\` 系列）已被禁用，公共契约层不得暴露这些旧名称：`);
  d.blank();
  d.rule('S-SURFACE-003');

  d.text(`Realm、App/Permissions 与 scope catalog surfaces 各有最小稳定导出面：Realm 使用实例化 facade 入口（无全局配置），App/Permissions 通过显式 host transport 注入，scope catalog 暴露 in-memory register / publish / revoke 语义：`);
  d.blank();
  d.rule('S-SURFACE-004');

  d.text(`### 9.2 Transport 层：显式声明与分离

为什么 transport 必须显式声明？因为 \`node-grpc\` 和 \`tauri-ipc\` 的行为差异远超一个 adapter 能隐藏的范围：gRPC 有独立连接池、HTTP/2 多路复用、超时语义；IPC 走 Tauri 进程间通道，无网络栈。如果让 SDK "自动检测"使用哪种 transport，调用者在调试失败时将无法判断问题出在网络层还是 IPC 层。

\`\`\`typescript
import { createNimiClient } from '@nimiplatform/sdk';

// app 主路径使用 NimiClient；底层 runtime 子路径保留为 escape hatch
const client = createNimiClient({
  appId: 'my-app',
  runtime: {
    transport: { type: 'tauri-ipc' },   // 或 node-grpc + endpoint
  },
});
const { runtime } = client;
\`\`\``);
  d.blank();
  d.rule('S-TRANSPORT-001');

  d.text(`在请求结构上，SDK 严格分离 metadata 与 body：\`connectorId\` 在请求体中，而 provider endpoint、api_key 走传输 metadata。这种分离确保业务参数和基础设施凭据不混在同一层。`);
  d.blank();
  d.rule('S-TRANSPORT-002');

  d.text(`流式场景有一条关键约束：**SDK 不自动重连断开的流**。流中断后，调用方必须显式重建订阅。设计意图是避免"悄悄重连但丢了中间消息"的数据完整性问题。`);
  d.blank();
  d.rule('S-TRANSPORT-003');

  d.text(`Realm 侧的传输设计同样强调实例隔离——每个 \`new Realm(options)\` 独立维护 endpoint/token/header，禁止共享全局 \`OpenAPI\` 运行时配置。这意味着同一进程中可以同时持有多个 Realm 实例，指向不同服务器，互不干扰。`);
  d.blank();
  d.rule('S-TRANSPORT-004');

  d.text(`SDK 与 Runtime 之间的版本兼容采用 **fail-close** 策略：major 版本不兼容直接报错，不存在"部分可用"的中间态。minor/patch 差异允许通过 capability 检测做受控降级，兼容结果必须对上层可读（用于提示和治理）。`);
  d.blank();
  d.rule('S-TRANSPORT-005');

  d.text(`可观测性作为辅助能力附着在传输层：SDK 支持向下游传播调用链 trace ID（通过 metadata/header），但可观测性输出**绝不包含明文凭据**（api key / token），且不改变请求的成功/失败语义。`);
  d.blank();
  d.rule('S-TRANSPORT-006');

  d.text(`### 9.3 错误投影：三层重试模型

SDK 的错误模型是整个 Nimi 错误体系中最复杂的一环，因为它必须同时处理三种来源的错误：Runtime gRPC 错误（带 ReasonCode）、Realm HTTP 错误、以及 SDK 自身产生的本地错误。

核心设计洞察是**双层投影 + 三层重试**：

\`\`\`
错误来源                           投影结果
─────────────────────────────────────────────────
Runtime gRPC → status + ReasonCode → 直接投影
Realm HTTP   → status + body       → 直接投影
SDK 本地     → 参数/环境/边界违规   → SDK_* 错误码
                                    (独立于 Runtime ReasonCode)

重试决策树
─────────────────────────────────────────────────
                 错误发生
                    │
        ┌───────────┴───────────┐
        ▼                       ▼
   Transport 层              Application 层
   (gRPC status)             (ReasonCode)
        │                       │
  UNAVAILABLE ─── 可重试   AI_PROVIDER_UNAVAILABLE ─── 可重试
  DEADLINE_EXCEEDED 可重试 AI_PROVIDER_TIMEOUT ──────── 可重试
  RESOURCE_EXHAUSTED 可重试 AI_STREAM_BROKEN ────────── 可重试
  ABORTED ── ReasonCode    SESSION_EXPIRED ─────────── 可重试
             优先判断
        │                       │
        └───────────┬───────────┘
                    ▼
              Internal 层
           (SDK 连接恢复)
                    │
         SDK transport 错误 ─── 内部透明重试
         OPERATION_ABORTED ──── 永不重试
\`\`\``);
  d.blank();
  d.rule('S-ERROR-001');

  d.text(`Runtime ReasonCode 的权威来源是 \`.nimi/spec/runtime/kernel/tables/reason-codes.yaml\`。SDK 文档不得重新分配 ReasonCode 的数值——只做投影，不做重定义。`);
  d.blank();
  d.rule('S-ERROR-002');

  d.text(`SDK 本地错误码有独立的事实源 \`tables/sdk-error-codes.yaml\`，与 Runtime ReasonCode 不混用。Realm 本地配置错误使用 \`SDK_REALM_*\` 族，版本和方法兼容错误使用 \`SDK_RUNTIME_*\` 族——兼容错误不能降级为通用网络错误或空成功。`);
  d.blank();
  d.rule('S-ERROR-003');
  d.rule('S-ERROR-005');
  d.rule('S-ERROR-006');

  d.text(`重试语义分三层协同工作。Transport 层的重试判断基于 gRPC status code（\`UNAVAILABLE\`、\`DEADLINE_EXCEEDED\`、\`RESOURCE_EXHAUSTED\`、\`ABORTED\`），但 \`ABORTED\` 的重试被 ReasonCode 优先级约束。流中断永不自动重连（如 S-TRANSPORT-003 所定义）。`);
  d.blank();
  d.rule('S-ERROR-004');

  d.text(`Application 层通过公开的 \`isRetryableReasonCode()\` 函数标记可重试的应用级 ReasonCode，与 transport 层互补、不重叠。可重试集合包括 Runtime 侧的 \`AI_PROVIDER_UNAVAILABLE\`、\`AI_PROVIDER_TIMEOUT\`、\`AI_STREAM_BROKEN\`、\`SESSION_EXPIRED\`，以及 SDK 合成的 \`RUNTIME_UNAVAILABLE\`、\`RUNTIME_BRIDGE_DAEMON_UNAVAILABLE\`。`);
  d.blank();
  d.rule('S-ERROR-007');

  d.text(`Internal 层是 SDK 内部的连接恢复重试（auto mode），使用独立的可重试集合，仅包含 SDK transport 错误码。这层重试对外不可见，且 \`OPERATION_ABORTED\` 在任何层级都**永不重试**。`);
  d.blank();
  d.rule('S-ERROR-008');

  d.text(`### 9.4 导入边界与模块隔离

SDK 的公开子路径之间有**物理级导入隔离**，而非仅靠文档约定。设计意图是：应用开发者引入公开 SDK surface 时，不能通过 import chain 间接访问到 runtime 或 realm 的私有客户端——这是安全边界，不只是代码组织偏好。`);
  d.blank();
  d.rule('S-BOUNDARY-001');

  d.text(`Runtime 与 Realm 之间的边界尤其关键：SDK 内部代码不得将 gRPC transport 和 REST client 混入同一个私有入口点。显式分离防止凭据和传输配置的意外交叉泄漏。`);
  d.blank();
  d.rule('S-BOUNDARY-002');

  d.text(`应用 SDK 的隔离更为严格——应用不得绕过 host 注入直接访问 runtime/realm 的私有客户端。所有对平台资源的依赖必须通过注入的 host facade 流转。`);
  d.blank();
  d.rule('S-BOUNDARY-003');

  d.text(`作为迁移清理的一部分，以下旧入口被明确禁止：\`createPlatformClient\`、\`createLocalFirstPartyRuntimePlatformClient\`、\`getPlatformClient\`、全局 \`OpenAPI.BASE\` / \`OpenAPI.TOKEN\` 赋值。所有配置必须走 \`createNimiClient()\` / \`NimiClient\` 或实例级子路径模式。`);
  d.blank();
  d.rule('S-BOUNDARY-004');

  d.text(`### 9.5 各子路径领域概述

**SDK 根入口** \`createNimiClient()\` / \`NimiClient\` 是 app-owned 显式组合面。它把 Runtime、Realm、App、AI、Agent 和 feature surfaces 组合到一个开发者友好的入口，但不创建全局 singleton，也不恢复 retired platform-client 语义。docs、examples 和第一方 app 的推荐主路径都应使用这个 vNext root。

**Runtime SDK** 是最重的 low-level 子路径。\`new Runtime(options)\` 仍是允许的 escape hatch，用于显式 transport、测试和协议级控制；构造后提供与 Runtime 守护进程完整的方法投影：连接器 CRUD、AI 推理触发、认证管理、Grant 操作等。方法按 service 分组（如 S-SURFACE-002 / S-SURFACE-009 所定义），每个方法调用携带显式的 metadata/body 分离。重试策略按上述三层模型执行。

**Core AI / Agent / Features** 是 Nimi-native DX 层。它们组合 Runtime AI consume、Agent lifecycle、Realm/App projection 和 feature-specific helpers，但不拥有 Runtime/Realm product truth，不伪造 unsupported capability，不把 app chat history 或 workflow truth 写成新的 Runtime method。

**Independent adapter packages** 是框架桥接层。Vercel AI、OpenAI-compatible、MCP、Mastra、LangGraph、LlamaIndex、React 和 Next 等适配必须作为独立 package 或独立 source root 声明能力级别；base SDK 不恢复 \`@nimiplatform/sdk/ai-provider\` 或 \`@nimiplatform/sdk/ai-app\` 子路径。

**Realm SDK** 通过 HTTP/WebSocket 与远程 Realm 服务器通信。每个 \`new Realm(options)\` 实例独立配置 endpoint、token、headers（如 S-TRANSPORT-004 所定义）；它保留为 low-level escape hatch，而 app 主路径优先经由显式 \`NimiClient\` 组合 Realm 实例。Realm SDK 的认证模型允许 \`NO_AUTH\` 模式用于公开数据读取。本地配置错误使用 \`SDK_REALM_*\` 族错误码。

**App / Permissions / Scope catalog** 维护 host-injected app resource、permission 与纯内存权限目录。核心 scope catalog API 是 \`register\` / \`publish\` / \`revoke\` 三操作，不涉及网络通信。`);

  d.text(`---

## 10. Desktop 架构

Nimi Desktop 是一个 Tauri + React 应用，它把 Runtime（Go 守护进程）、Realm（远程平台）和第一方产品 surface 粘合成一个统一的用户体验。与传统 Electron 应用不同，Desktop 选择 Tauri 的核心原因是 Rust 后端提供了真正的本地能力：进程管理、安全存储、TCP 端口绑定——这些在浏览器沙箱中无法实现。

Desktop 规范由 13 个契约域组成，从启动序列到安全策略形成完整的应用生命周期。每个域都有独立的规则集，但域间存在明确的依赖关系——例如启动序列依赖 IPC 桥接，数据同步依赖认证会话。

\`\`\`
┌──────────────────────────────────────────────────────────────┐
│                    Nimi Desktop (Tauri)                       │
│                                                              │
│  ┌─────────┐  ┌──────────┐  ┌──────────────┐  ┌──────────┐ │
│  │UI Shell │  │  State   │  │ Runtime View │  │ SDK Host │ │
│  │ (React) │  │(Zustand) │  │ Projection   │  │ Facades  │ │
│  └────┬────┘  └────┬─────┘  └──────┬───────┘  └────┬─────┘ │
│       │            │               │               │       │
│  ┌────┴────────────┴───────────────┴───────────────┴────┐  │
│  │              IPC Bridge (Tauri invoke)                  │  │
│  └──────────────────────┬─────────────────────────────────┘  │
│                         │                                    │
│  ┌──────────────────────┴──────────────────────────────┐     │
│  │            Tauri Backend (Rust)                      │     │
│  │   daemon mgmt · secure store · proxy fetch · OAuth  │     │
│  └──────────┬─────────────────────────┬────────────────┘     │
└─────────────┼─────────────────────────┼──────────────────────┘
              │                         │
    ┌─────────┴──────────┐    ┌────────┴────────┐
    │  Runtime (Go gRPC) │    │  Realm (HTTP)   │
    │  localhost only     │    │  remote server  │
    └────────────────────┘    └─────────────────┘
\`\`\`

### 10.1 启动序列：有序异步初始化

Desktop 的启动不是一个简单的 \`init()\` 调用——它是一条有序的异步依赖链。为什么不能一次性初始化？因为每个阶段都有明确的前置条件：Platform Client 需要 Realm URL（来自 Runtime Defaults），DataSync 需要 Platform Client，Runtime Host 需要 DataSync，External Agent 桥接需要认证与 Runtime 投影就绪。任何阶段失败都有精确的错误边界，不会"半初始化"。

\`\`\`
阶段依赖链
─────────────────────────────────────────────────────
① Runtime Defaults (IPC)
   ↓ realm URL + execution params
② Platform Client 初始化
   ↓ API client ready
③ DataSync Facade 初始化
   ↓ initApi(realm, proxyFetch)
④ Auth Session 引导
   ↓ token ready / anonymous
⑤ Runtime Host 装配
   ↓ HTTP context + capabilities
⑥ External Agent Runtime projection
   ↓ disabled reason / token ledger projection
⑦ Bootstrap 完成
   ↓ bootstrapReady = true
\`\`\``);
  d.blank();
  d.rule('D-BOOT-001');
  d.rule('D-BOOT-002');
  d.rule('D-BOOT-003');

  d.text(`阶段 ④ 在启动期间执行 token 交换或匿名回退——这是认证状态的初始决策点。阶段 ⑤ 组装 HTTP context provider、runtime host 能力和核心数据能力。阶段 ⑥ 只消费 Runtime-owned External Agent 状态投影；当前 action registry 为空时必须显示 disabled reason，不能在 Desktop 注册 action descriptor 或启动本地 action 通道。`);
  d.blank();
  d.rule('D-BOOT-004');
  d.rule('D-BOOT-005');
  d.rule('D-BOOT-006');
  d.rule('D-BOOT-007');

  d.text(`阶段 ⑧ 设置 \`bootstrapReady\` / \`bootstrapError\` 标志，失败时清除 auth 状态。整个启动链有一个关键的幂等性守卫：\`bootstrapPromise\` 单例确保 bootstrap 全局只执行一次——即使在 HMR（热模块替换）场景下重复触发也安全。`);
  d.blank();
  d.rule('D-BOOT-008');
  d.rule('D-BOOT-009');

  d.text(`### 10.2 IPC 桥接：为什么不直接 HTTP？

Desktop 为什么不让 Renderer 直接发 HTTP 请求？三个原因：浏览器沙箱有 CORS 限制、无法访问本地文件系统、无法绑定 TCP 端口。Tauri IPC 把这些限制绕过——所有跨进程通信走 \`window.__TAURI__.invoke()\`，由 Rust 后端代理执行。

IPC 层的基础设施先于具体命令。统一的 \`invoke()\` 入口先检查 \`hasTauriInvoke\`（即 \`window.__TAURI__\` 是否存在），然后为每次调用生成 \`invokeId\`、写入结构化日志、统一错误归一化。这意味着所有 IPC 命令自动获得可观测性，无需各命令自行实现。`);
  d.blank();
  d.rule('D-IPC-009');

  d.text(`高容量模块（如 local-ai 和 external-agent）采用动态 \`import()\` 懒加载，避免主 bundle 体积膨胀：`);
  d.blank();
  d.rule('D-IPC-010');

  d.text(`在此基础设施之上，IPC 命令按功能域分组：

**Runtime Defaults 命令** — \`runtime_defaults\` 返回 realm 和运行时执行默认值，采用防御性解析：`);
  d.blank();
  d.rule('D-IPC-001');

  d.text(`**Daemon 生命周期命令** — status、start、stop、restart，报告 \`launchMode\`：`);
  d.blank();
  d.rule('D-IPC-002');

  d.text(`**Config 读写命令** — \`runtime_bridge_config_get\` / \`set\` 管理配置持久化：`);
  d.blank();
  d.rule('D-IPC-003');

  d.text(`**HTTP 代理命令** — \`http_request\` 不是认证 Runtime/Realm/provider transport。**UI 命令** — \`open_external_url\`、\`start_window_drag\`。**OAuth 命令** — Desktop 只保留 \`oauth_listen_for_code\` callback observation；code exchange、PKCE verifier、client secret 与 token custody 均由 Runtime 持有：`);
  d.blank();
  d.rule('D-IPC-004');
  d.rule('D-IPC-005');
  d.rule('D-IPC-006');

  d.text(`**External Agent 投影** — gateway status、token ledger 与 future action registry 均由 Runtime 拥有，Desktop 只通过 SDK typed Runtime API 读取 fail-closed 状态。**Local Runtime helper IPC** — Desktop 只保留系统文件选择与 reveal-in-folder 这类 shell-native helper；模型目录、安装、生命周期、健康与审计必须走 SDK RuntimeLocalService：`);
  d.blank();
  d.rule('D-IPC-007');
  d.rule('D-IPC-008');
  d.rule('D-IPC-011');

  d.text(`### 10.3 状态管理：四个 Zustand Slice

Desktop 的应用状态采用 Zustand slice 架构。为什么不用 Redux 或 Context？因为各业务域（Auth、Runtime、UI 与产品 surface）的状态生命周期完全不同——Auth 状态跨 session 持久化，Runtime 状态在 daemon 重启时重置，UI 状态纯临时。Slice 架构让每个域独立声明自己的状态和操作，最终通过无 middleware 的组合注入全局 store。`);
  d.blank();
  d.rule('D-STATE-001');
  d.rule('D-STATE-002');
  d.rule('D-STATE-003');
  d.rule('D-STATE-004');

  d.text(`四个 slice 通过 \`useAppStore\` 合并为单一 Zustand store，不使用 middleware（immer、persist 等）——状态更新直接用 \`set()\` 替换，保持调试透明性：`);
  d.blank();
  d.rule('D-STATE-005');

  d.text(`### 10.4 认证会话：Desktop 与 Web 的分歧

认证会话管理是 Desktop 和 Web 唯一出现**根本性分歧**的领域。两者共享同一个状态机（\`bootstrapping → authenticated | anonymous\`），但 token 的存储策略完全不同：Desktop 通过 Tauri secure store（OS 级密钥链）持久化 token，Web 使用 localStorage 加过期机制。

\`\`\`
Auth 状态机
─────────────────────────────────────────────────
             ┌──────────────┐
             │ bootstrapping│
             └──────┬───────┘
                    │ token exchange / check
           ┌────────┴────────┐
           ▼                 ▼
  ┌──────────────┐   ┌────────────┐
  │authenticated │   │ anonymous  │
  └──────┬───────┘   └──────┬─────┘
         │ logout/expire    │ login
         └──────────────────┘
\`\`\``);
  d.blank();
  d.rule('D-AUTH-001');
  d.rule('D-AUTH-002');
  d.rule('D-AUTH-003');

  d.text(`状态机的转换规则是确定性的：\`bootstrapping\` 只能到 \`authenticated\` 或 \`anonymous\`，\`authenticated\` 可因 logout/过期回退到 \`anonymous\`，\`anonymous\` 可通过 login 转为 \`authenticated\`。`);
  d.blank();
  d.rule('D-AUTH-004');

  d.text(`认证状态变更驱动数据同步：DataSync 监听 \`authChange\` 事件，认证成功时同步 token 并启动 polling，认证失效时停止 polling 并清除缓存。这是启动序列（10.1）和数据同步（10.5）之间的关键连接点。`);
  d.blank();
  d.rule('D-AUTH-005');

  d.text(`### 10.5 数据同步：十二条独立流

数据同步是 Desktop 最庞大的子系统——12 个业务流域，每个都有独立的触发条件、缓存策略和错误处理。为什么不用一个统一的"sync all"？因为各域的数据生命周期截然不同：Chat 需要 polling + outbox 实时推送，Notification 只需定时拉取，Economy 需要精确的余额一致性。

12 个流域共享 6 项基础设施：API init 初始化、hot state 同步、context lock 防并发、polling 调度、error log 记录、facade delegate 委托。这意味着每个流域只需声明"拉什么"和"怎么缓存"，基础设施自动处理重试和错误收集。`);
  d.blank();
  d.rule('D-DSYNC-001');
  d.rule('D-DSYNC-002');
  d.rule('D-DSYNC-003');

  d.text(`Chat 流域是最复杂的：它结合了 polling（定时拉取会话列表和未读计数）和 outbox（消息先写入本地 outbox，异步 flush 到服务器）。消息发送失败时保留在 outbox 中等待重试，不丢弃。`);
  d.blank();

  d.ruleGroup(`**领域数据流**`, [
    'D-DSYNC-004', 'D-DSYNC-005', 'D-DSYNC-006', 'D-DSYNC-007',
    'D-DSYNC-008', 'D-DSYNC-009', 'D-DSYNC-010', 'D-DSYNC-011', 'D-DSYNC-012',
  ]);

  d.text(`### 10.6 LLM 适配器与语音引擎

Desktop 的 LLM 层有一个关键设计决策：**不直接调用外部 AI API**。所有 AI 推理——无论是 OpenAI、Gemini 还是本地 Qwen——全部通过 SDK 的 Runtime 接口执行。Desktop 只在 Runtime 之上添加三层本地增强：provider 适配（路由到正确的 Runtime 方法）、Connector 凭据路由（通过 \`connector_id\` 路由到 Runtime ConnectorService 管理的凭据）、本地模型健康检查（验证 endpoint 可达性和模型状态）。

这意味着 Desktop 层面的 LLM 代码量极小——路由决策通过 \`resolveChatRoute\` 确定执行模式，凭据通过 \`connector_id\` 委托 Runtime 管理而非本地持有，健康检查通过 \`checkLocalLlmHealth\` 在推理前执行。`);
  d.blank();
  d.rule('D-LLM-001');
  d.rule('D-LLM-002');
  d.rule('D-LLM-003');
  d.rule('D-LLM-004');

  d.text(`语音引擎集成遵循相同的"不绕过 Runtime"原则。Desktop 只负责用户交互和路由展示，语音能力、readiness 与执行证据由 Runtime/SDK 投影提供。本地 AI 推理事件通过 \`LocalAiInferenceAuditPayload\` 记录，包含 eventType 和 source 追踪。`);
  d.blank();
  d.rule('D-LLM-005');
  d.rule('D-LLM-006');

  d.text(`### 10.7 UI Shell 与导航体系

UI Shell 定义了 Desktop 的视觉骨架：两栏布局（可折叠侧边栏 + 内容面板），3 组导航（Core Nav 5 项 + Quick Nav 1 项 + Detail Tab），以及 lazy-load 代码分割策略。`);
  d.blank();
  d.rule('D-SHELL-001');

  d.text(`Feature flag 只控制当前 admitted product surface，不创建扩展运行时或并行产品入口：`);
  d.blank();
  d.rule('D-SHELL-002');

  d.text(`窗口管理支持原生拖拽（Desktop 通过 \`enableTitlebarDrag\` 启用，Web 不适用）。布局结构使用 \`MainLayoutView\` 两栏布局，侧边栏可折叠，内容面板根据导航状态映射。图标系统通过 \`renderShellNavIcon\` 提供 inline SVG 图标，未知 tab 回退到 puzzle 图标。`);
  d.blank();
  d.rule('D-SHELL-003');
  d.rule('D-SHELL-006');
  d.rule('D-SHELL-007');

  d.text(`代码分割采用两级策略：\`shell-core\` 和 \`bridge\` 同步加载（启动关键路径），feature 模块（chat、social、economy 等）按路由 lazy-load。i18n 使用 \`react-i18next\` 框架，locale 文件和导航标签支持翻译。`);
  d.blank();
  d.rule('D-SHELL-004');
  d.rule('D-SHELL-005');

  d.text(`### 10.8 错误边界与归一化

Desktop 的错误来自 4 个来源：Runtime gRPC 错误、Realm HTTP 错误、IPC Bridge 错误、本地逻辑错误。错误边界的职责是将这 4 种异构错误**归一化为统一格式**，让上层代码不必关心错误的原始来源。

归一化采用两阶段匹配：先尝试精确 code match（如 \`LOCAL_AI_IMPORT_*\`、\`LOCAL_AI_MODEL_*\`），再尝试 pattern regex match，最后 fallback 到通用错误。每种错误码都有对应的 domain 分类和用户消息。`);
  d.blank();
  d.rule('D-ERR-001');
  d.rule('D-ERR-002');
  d.rule('D-ERR-003');
  d.rule('D-ERR-004');

  d.text(`Bridge 层的错误归一化（\`BRIDGE_ERROR_CODE_MAP\`）是两阶段的：先 exact code match，再 pattern regex match，最后 fallback。Bootstrap 期间的错误通过 \`bootstrapRuntime().catch()\` 处理，设置 \`bootstrapError\`、清除 auth、记录失败日志。`);
  d.blank();
  d.rule('D-ERR-005');
  d.rule('D-ERR-006');

  d.text(`### 10.9 遥测与可观测性

遥测层的目标是让每个"事情发生了"都可追踪——无论是 IPC 调用、网络重试还是 bootstrap 阶段转换。

日志载荷采用结构化格式 \`RuntimeLogPayload\`，包含 level、area、message、traceId、flowId、source、costMs、details。消息格式有严格约定：必须使用 \`action:\` 或 \`phase:\` 前缀，\`normalizeRuntimeLogMessage\` 自动补充缺失的前缀。`);
  d.blank();
  d.rule('D-TEL-001');
  d.rule('D-TEL-002');

  d.text(`Logger 通过 \`setRuntimeLogger(logger)\` 注入，未注入时 fallback 到 \`console.*\`。每个 \`invoke()\` 调用自动生成 \`invokeId\` 并记录 invoke-start/success/failed 日志。`);
  d.blank();
  d.rule('D-TEL-003');
  d.rule('D-TEL-005');

  d.text(`流程追踪 ID 通过 \`createRendererFlowId\` 生成（格式：\`\${prefix}-\${timestamp}-\${random}\`），支持跨组件的请求关联。Renderer 日志可通过 IPC 转发到 Tauri 后端（\`RendererLogPayload\`）。网络层日志使用独立的 \`net\` area，记录 retrying/recovered/exhausted 事件并映射 log level。`);
  d.blank();
  d.rule('D-TEL-004');
  d.rule('D-TEL-006');
  d.rule('D-TEL-007');

  d.text(`### 10.10 网络层：代理、重试与实时

Desktop 的网络层解决三个问题：CORS 绕过、失败重试、实时通信。

**代理 Fetch**：\`createProxyFetch()\` 将所有 HTTP 请求代理到 Tauri 后端的 \`http_request\` IPC 命令，从根本上绕过浏览器 CORS 限制。错误通过 \`normalizeApiError()\` 统一格式化（status + message + fallback）。`);
  d.blank();
  d.rule('D-NET-004');
  d.rule('D-NET-005');

  d.text(`**重试策略**：7 个 HTTP 状态码被标记为可重试（408、425、429、500、502、503、504）。\`requestWithRetry\` 使用指数退避：maxAttempts=3、initialDelayMs=120、maxDelayMs=900。每次重试触发 \`RetryEvent\` 回调（retrying/recovered/retry_exhausted），携带 reason 追踪。`);
  d.blank();
  d.rule('D-NET-001');
  d.rule('D-NET-002');
  d.rule('D-NET-003');

  d.text(`**实时传输**：Socket.IO WebSocket 连接绕过 CORS，携带 auth token 和 session protocol。内建事件去重和断线恢复机制。`);
  d.blank();
  d.rule('D-NET-006');

  d.text(`### 10.11 安全模型

Desktop 的安全策略由多层纵深防御构成，从最基础的网络限制到最上层的 External Agent 与本地资产边界。

**Layer 1: Loopback 限制** — 所有 Runtime endpoint 必须指向 localhost / 127.0.0.1 / [::1]，阻止任何远程路由。这是最基础的安全屏障：即使其他层全部失效，AI 推理请求也不会离开本机。`);
  d.blank();
  d.rule('D-SEC-001');

  d.text(`**Layer 2: Bearer Token 管理** — Token 存储在 Zustand \`auth.token\` 中，同步到 DataSync hot state。Desktop 和 Web 通过各自的持久化机制管理 Realm access token（Web 使用 localStorage 加过期机制，敏感页面需二次验证，logout 时完全清除）。`);
  d.blank();
  d.rule('D-SEC-002');
  d.rule('D-SEC-010');

  d.text(`**Layer 2.5: AI 凭据委托** — AI provider API key 的唯一托管者是 Runtime ConnectorService（K-CONN-001: custodian not distributor）。Desktop renderer 不接触原始 API key，通过 SDK \`CreateConnector\` / \`UpdateConnector\` 将凭据写入 Runtime 后即刻丢弃内存副本。AI 请求通过 \`connector_id\` 路由，Desktop/Web 统一使用 SDK ConnectorService 接口。`);
  d.blank();
  d.rule('D-SEC-009');

  d.text(`**Layer 3: OAuth 安全** — OAuth 流程通过 Tauri IPC 执行，支持 PKCE 和 clientSecret 两种模式，通过 redirect URI 监听完成授权。`);
  d.blank();
  d.rule('D-SEC-003');

  d.text(`**Layer 4: IPC 桥接隔离** — \`hasTauriInvoke()\` 检查 \`window.__TAURI__\` 存在性，统一 \`invoke()\` 入口确保所有 IPC 调用经过单一校验点。CSP 策略约束 script/style 加载和 connect-src 白名单。`);
  d.blank();
  d.rule('D-SEC-004');
  d.rule('D-SEC-008');

  d.text(`**Layer 5: External Agent 与本地资产边界** — External Agent 的 token、gateway、action descriptor registry 与 audit lineage 由 Runtime 拥有；当前 action registry 未落地时必须 fail closed，并投影 \`EXTERNAL_AGENT_ACTION_REGISTRY_EMPTY\`。本地 AI 模型与 Avatar 私有资产只能通过 Runtime/SDK 投影和 Desktop 允许的 opaque local refs 流转。`);
  d.blank();
  d.rule('D-SEC-005');
  d.rule('D-SEC-006');
  d.rule('D-SEC-007');

  d.text(`---

## 11. Standalone Cognition

\`nimi-cognition\` 现在是一个独立 spec domain，而不是 runtime 的继续 owner。它来自 runtime memory / knowledge 能力的抽离与升级，但 authority 已经单独落在 \`/.nimi/spec/cognition/kernel/**\`，runtime 只能 bridge/consume，不能反向定义 cognition 语义。`);
  d.blank();
  d.rule('C-COG-001');
  d.rule('C-COG-002');
  d.rule('C-COG-003');

  d.text(`它也不是一个 MVP 或试验性旁支。standalone cognition 的 admitted 完成标准是：不能降级 runtime 已拥有的 overlapping 能力，不能靠 façade、类型外形、宽松测试或伪 metadata 营造完成感。`);
  d.blank();
  d.rule('C-COG-004');
  d.rule('C-COG-015');
  d.rule('C-COG-017');

  d.text(`其对象模型以 kernel 为中心，同时保留 memory / knowledge / skill / working 的明确边界。artifact family registry、reference matrix、public surface、runtime upgrade matrix 与 runtime bridge boundary 现在都已经单独入表，不再靠 package 命名暗示语义。cleanup、prompt serving 与 external routine 都必须服从这一分层，而不是重新把 runtime service ownership 偷渡回来。`);
  d.blank();
  d.rule('C-COG-005');
  d.rule('C-COG-006');
  d.rule('C-COG-019');
  d.rule('C-COG-020');
  d.rule('C-COG-023');
  d.rule('C-COG-010');
  d.rule('C-COG-011');
  d.rule('C-COG-027');
  d.rule('C-COG-029');
  d.rule('C-COG-013');
  d.rule('C-COG-037');
  d.rule('C-COG-038');
  d.rule('C-COG-033');
  d.rule('C-COG-016');

  d.text(`memory / knowledge 现在不再只靠方法名册描述，而是补成了 service-grade contract：runtime overlap concern 先进入 upgrade matrix，再通过 operation registry 落成 behavior-level contract。prompt 和 completion 也分别有 lane registry 与 completion gates，避免“文档结构完整，但完成度口径仍然虚”的问题。`);
  d.blank();
  d.rule('C-COG-039');
  d.rule('C-COG-040');
  d.rule('C-COG-041');
  d.rule('C-COG-043');
  d.rule('C-COG-044');
  d.rule('C-COG-045');
  d.rule('C-COG-047');
  d.rule('C-COG-048');
  d.rule('C-COG-049');
  d.rule('C-COG-050');
  d.rule('C-COG-051');
  d.rule('C-COG-052');
  d.rule('C-COG-053');
  d.rule('C-COG-054');
  d.rule('C-COG-055');

}
