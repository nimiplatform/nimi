import { appendDocumentIntroduction } from './generate-spec-human-doc-helpers.mjs';

export function appendSpecHumanDocNarrative(d) {
  appendDocumentIntroduction(d);
  d.blank();
  d.rule('K-RPC-001');

  d.text(`其中每个服务的完整方法列表如下：`);
  d.blank();
  d.rule('K-RPC-002');
  d.rule('K-RPC-003');
  d.rule('K-RPC-004');

  d.text(`---

## 2. 认证体系

Nimi Runtime 的认证分为四个层次：**Token 验证**（AuthN）、**访问控制**（AuthZ）、**会话管理**（AuthService）和**授权签发**（GrantService）。这四层严格分工，各有明确的输入输出边界。

### 2.1 Token 验证（AuthN）

当请求携带 \`Authorization: Bearer <jwt>\` 头时，Runtime 会验证 JWT 的合法性。这是所有安全决策的基础。

验证规则的核心设计是**严格拒绝 + 不降级**：携带了 Authorization 头但 JWT 无效时，Runtime 不会把请求降级为匿名访问，而是直接拒绝。只有完全没有 Authorization 头的请求才被视为匿名。`);
  d.blank();
  d.rule('K-AUTHN-001');
  d.rule('K-AUTHN-002');
  d.rule('K-AUTHN-003');

  d.text(`JWKS（JSON Web Key Set）的缓存策略采用乐观缓存 + 按需刷新：正常情况使用缓存的公钥，只在遇到未知 \`kid\` 时才刷新一次。刷新失败不降级。`);
  d.blank();
  d.rule('K-AUTHN-004');
  d.rule('K-AUTHN-005');

  d.text(`所有 AuthN 失败统一返回同一个错误码，不泄露具体失败原因（格式错误、签名校验失败、过期等对外表现一致）：`);
  d.blank();
  d.rule('K-AUTHN-007');

  d.text(`AuthN 通过后，向下游投影最小身份上下文，后续的 AuthZ 层只消费这个投影结果，不重复解析 JWT：`);
  d.blank();
  d.rule('K-AUTHN-008');

  d.text(`### 2.2 访问控制（AuthZ）

AuthZ 在 AuthN 通过后执行，负责判断"这个用户能不能访问这个资源"。核心原则是**信息隐藏**：当用户无权访问某个资源时，系统表现为"资源不存在"而非"无权限"，避免泄露资源存在性。`);
  d.blank();
  d.rule('K-AUTH-001');
  d.rule('K-AUTH-002');

  d.text(`对于 Connector 相关操作，AuthZ 定义了固定的管理 RPC 门禁和 AI 推理资源校验顺序：`);
  d.blank();
  d.rule('K-AUTH-004');
  d.rule('K-AUTH-005');

  d.text(`AuthN 与 AuthZ 之间有明确的分层边界：AuthN 失败直接返回 \`UNAUTHENTICATED\`，不进入 AuthZ 评估。`);
  d.blank();
  d.rule('K-AUTH-007');

  d.text(`### 2.3 会话管理（AuthService）

\`RuntimeAuthService\` 负责应用注册、会话开启/续签/撤销，以及外部主体（如第三方 OAuth）的会话管理。它**只管理会话生命周期，不做授权决策**。`);
  d.blank();
  d.rule('K-AUTHSVC-001');
  d.rule('K-AUTHSVC-002');

  d.text(`会话 TTL 必须落在服务端配置的合法区间内，超出即拒绝（fail-close）。撤销操作是幂等的，不泄露"会话是否曾存在"的信息。`);
  d.blank();
  d.rule('K-AUTHSVC-004');
  d.rule('K-AUTHSVC-005');

  d.text(`### 2.4 授权签发（GrantService）

\`RuntimeGrantService\` 负责授权签发、访问校验和委托链管理。可以理解为"谁有权做什么"的决策中心。`);
  d.blank();
  d.rule('K-GRANT-001');
  d.rule('K-GRANT-002');

  d.text(`授权支持委托链（delegation chain）：一个 token 可以签发子 token，但子 token 的权限必须是父 token 权限的子集，且有深度限制。`);
  d.blank();
  d.rule('K-GRANT-005');
  d.rule('K-GRANT-006');

  d.text(`---

## 3. 连接器系统

Connector（连接器）是 Nimi Runtime 中最核心的抽象之一。它代表一个"AI 推理目标描述符"——告诉系统要去哪里执行 AI 推理。

### 3.1 为什么需要连接器？

用户可能使用多种 AI 服务：本地运行的开源模型（如 Qwen、LLaMA）、远程 API（如 OpenAI、Gemini、DeepSeek）。连接器统一了这些不同来源的管理方式：每个推理目标都是一个 Connector，有统一的 CRUD 接口和身份校验流程。

连接器本身是**薄描述**——它只记录"去哪里"和"用什么凭据"，不承载用户路由策略。

### 3.2 两种连接器

连接器分为两种：

- **LOCAL_MODEL**：本地模型，由系统预设。固定 6 个（对应 6 种能力类别），不能通过 CRUD 新建或删除
- **REMOTE_MANAGED**：远程托管，由用户创建。用户提供 API Key 和 endpoint，Runtime 托管凭据

\`\`\`protobuf
message Connector {
  string connector_id = 1;                // ULID
  ConnectorKind kind = 2;                 // LOCAL_MODEL | REMOTE_MANAGED
  ConnectorOwnerType owner_type = 3;      // SYSTEM | REALM_USER
  string owner_id = 4;                    // SYSTEM 常量或 JWT sub
  string provider = 5;                    // local | gemini | openai | ...
  string endpoint = 6;                    // local 固定空串；remote 非空
  string label = 7;
  ConnectorStatus status = 8;             // ACTIVE | DISABLED
  bool has_credential = 11;              // 展示用，非门禁
  LocalConnectorCategory local_category = 12;
}
\`\`\`

关键约束：
- \`provider/kind/owner_type/owner_id\` 创建后不可变
- Runtime 是 API Key **托管者**，不是分发者——凭据不出 runtime 进程`);
  d.blank();
  d.rule('K-AUTH-003');

  d.text(`### 3.3 本地模型类别

本地连接器对应 6 种固定的能力类别，每种类别映射到不同的 AI 能力：`);
  d.blank();
  d.rule('K-LOCAL-001');
  d.rule('K-LOCAL-002');

  d.text(`其中 CUSTOM 类型的模型需要提供 \`local_invoke_profile_id\`，缺失则标记为不可用：`);
  d.blank();
  d.rule('K-LOCAL-003');

  d.text(`### 3.4 连接器 CRUD 操作

**创建**：只能创建 REMOTE_MANAGED 连接器，必须提供 API Key。endpoint 为空时使用 provider 默认值。`);
  d.blank();
  d.rule('K-RPC-007');

  d.text(`**更新**：至少修改一个可变字段。凭据或 endpoint 变化时自动失效远程模型缓存。`);
  d.blank();
  d.rule('K-RPC-008');

  d.text('**删除**：采用三步补偿流程（标记 pending → 删凭据 → 删记录），支持幂等重试。删除不影响已提交的 ScenarioJob。');
  d.blank();
  d.rule('K-RPC-009');

  d.text(`### 3.5 存储与可靠性

连接器数据存储在本地文件系统：

- 注册表：\`~/.nimi/runtime/connector-registry.json\`
- 凭据：\`~/.nimi/runtime/credentials/<connector_id>.key\`
- 权限：均为 \`0600\`

所有写入使用原子操作（写临时文件 → fsync → rename → fsync 父目录），全局写串行化保证一致性。

Runtime 启动时执行重扫补偿：回填 \`has_credential\`、清理孤儿凭据、恢复 \`delete_pending\` 残留。`);

  d.text(`
---

## 4. AI 推理管道

当一个 AI 推理请求到达 Runtime，它会经历一条固定的处理管道。这个管道的设计原则是**评估顺序不可调整**——每个检查步骤的顺序都是固定的，避免越权侧信道泄露。

### 4.1 凭据路由：两条路径

请求可以通过两种方式指定凭据来源，二选一，不能混用：

1. **Managed 路径**：提供 \`connector_id\`，使用 Runtime 托管的连接器凭据
2. **Inline 路径**：通过 metadata 直接提供 provider type/endpoint/API key（临时使用，不持久化）`);
  d.blank();
  d.rule('K-KEYSRC-001');
  d.rule('K-KEYSRC-002');

  d.text(`### 4.2 请求评估顺序

请求按以下固定顺序逐步评估，任何一步失败立即返回错误：`);
  d.blank();
  d.rule('K-KEYSRC-004');

  d.text(`这个顺序的设计意图是：先做认证（步骤 2-3），再做授权（步骤 5-6），最后做安全校验（步骤 7-8）和路由（步骤 9-10）。每一步只在前置条件满足后才执行。

### 4.3 远程执行（nimillm 模块）

nimillm 是 Runtime 内部的远程执行模块，处理所有需要调用外部 AI API 的请求。它的职责边界非常清晰：

- 只负责**执行**（发送请求到 provider 并返回结果）
- 不负责认证、凭据持久化、连接器 CRUD
- 入口互斥校验由上游完成，nimillm 不重建第二套入口规则

Provider 适配分两层：先按 \`provider_type\` 选择 backend family，同 family 内允许 channel 分流，但**禁止跨 provider 自动 fallback**。

### 4.4 本地执行（local-model 子系统）

本地执行采用三层抽象：`);
  d.blank();
  d.rule('K-LOCAL-007');

  d.text(`Phase 1 采用 1:1 绑定（一个 Model 对应一个 Service）：`);
  d.blank();
  d.rule('K-LOCAL-008');

  d.text(`#### 4.4.1 本地引擎

Phase 1 支持两种 OpenAI-compatible 引擎：`);
  d.blank();
  d.rule('K-LENG-001');
  d.rule('K-LENG-002');

  d.text(`所有引擎通过标准 OpenAI-compatible HTTP API 通信：`);
  d.blank();
  d.rule('K-LENG-006');

  d.text(`健康探测使用 \`GET /v1/models\` 判定引擎可达性：`);
  d.blank();
  d.rule('K-LENG-007');

  d.text(`引擎配置优先级（高覆盖低）：RPC 请求参数 > 环境变量 > 配置文件 > 引擎默认值：`);
  d.blank();
  d.rule('K-LENG-008');

  d.text(`#### 4.4.2 设备画像

安装本地模型前，系统可以采集设备画像来评估硬件兼容性：`);
  d.blank();
  d.rule('K-DEV-001');
  d.rule('K-DEV-002');
  d.rule('K-DEV-007');

  d.text(`#### 4.4.3 模型获取

本地模型有三种获取方式：

- **Verified 安装**：从进程内硬编码的可信模型列表安装（\`InstallVerifiedModel\`）
- **手动安装**：用户提供完整元数据直接安装（\`InstallLocalModel\`）
- **Manifest 导入**：从本地文件系统读取模型清单导入（\`ImportLocalModel\`）

安装前可执行预检（\`ResolveModelInstallPlan\`），生成硬件兼容性 warnings：`);
  d.blank();
  d.rule('K-LOCAL-012');

  d.text(`#### 4.4.4 依赖解析

Mod 可以声明对本地模型的依赖，分为四类：`);
  d.blank();
  d.rule('K-LOCAL-013');

  d.text(`依赖解析后通过四阶段 Apply 管道部署：`);
  d.blank();
  d.rule('K-LOCAL-014');
  d.rule('K-LOCAL-015');

  d.text(`#### 4.4.5 适配器路由与策略门控

本地 Node 的 adapter 按 provider × capability 矩阵路由：`);
  d.blank();
  d.rule('K-LOCAL-017');

  d.text(`策略门控可条件性禁止特定组合（如当前引擎不支持目标 capability）：`);
  d.blank();
  d.rule('K-LOCAL-018');

  d.text(`#### 4.4.6 流式降级

当本地 provider 不支持流式生成时，系统可以降级为非流式生成并分片模拟推送，但必须在审计和终帧 metadata 中标记 \`stream_simulated=true\`：`);
  d.blank();
  d.rule('K-LENG-011');

  d.text(`#### 4.4.7 model_id 前缀路由

AI 执行路径根据 model_id 前缀确定引擎：`);
  d.blank();
  d.rule('K-LOCAL-020');

  d.text(`#### 4.4.8 Node 目录生成

Node 是 Service × capability 笛卡尔积的计算视图，每次查询实时生成：`);
  d.blank();
  d.rule('K-LOCAL-019');

  d.text(`#### 4.4.9 搜索结果排序

目录搜索结果的排序规则：`);
  d.blank();
  d.rule('K-LOCAL-021');

  d.text(`### 4.5 Provider 白名单

每个 provider 有固定的默认 endpoint、是否支持 managed/inline 两种路径、对应的执行模块，以及聚合后的 canonical capability 列表。这些信息由以下两个 YAML 表定义：`);
  d.blank();
}
