# Runtime Connector Domain Spec

> Status: Draft
> Date: 2026-02-28
> Scope: Connector 领域专属规则（模型、CRUD、存储、补偿、缓存、本地 connector 生命周期）。
> Normative Imports: `spec/runtime/kernel/*`

## 0. 权威导入

本文件不再重复定义跨域通用契约，统一导入 kernel 规则：

- RPC 面：`kernel/rpc-surface.md`（`K-RPC-*`）
- 鉴权/ownership：`kernel/authz-ownership.md`（`K-AUTH-*`）
- AuthN 验签/JWKS：`kernel/authn-token-validation.md`（`K-AUTHN-*`）
- AuthService/GrantService：`kernel/auth-service.md`（`K-AUTHSVC-*`）、`kernel/grant-service.md`（`K-GRANT-*`）
- key-source 与请求判定：`kernel/key-source-routing.md`（`K-KEYSRC-*`）
- MediaJob 生命周期：`kernel/media-job-lifecycle.md`（`K-JOB-*`）
- 本地 category/capability：`kernel/local-category-capability.md`（`K-LOCAL-*`）
- endpoint 安全：`kernel/endpoint-security.md`（`K-SEC-*`）
- 流式语义：`kernel/streaming-contract.md`（`K-STREAM-*`）
- 错误模型：`kernel/error-model.md`（`K-ERR-*`）
- 分页与过滤：`kernel/pagination-filtering.md`（`K-PAGE-*`）
- 审计契约：`kernel/audit-contract.md`（`K-AUDIT-*`）

## 1. 领域不变量

`CONN-*` 为 Connector 领域增量规则（非 kernel 通用规则）。

- `CONN-001`: Runtime 是 API Key Custodian，不是 Distributor。托管 key 不出 runtime 进程。
- `CONN-002`: Phase 1 remote ownership 固定 `Per-User`，不引入平台共享 remote connector。
- `CONN-003`: Local connector 是系统预设共享资源，不能由 CRUD 新建/删除。
- `CONN-004`: connector 是 inference target descriptor，本身保持薄描述，不承载用户路由策略。
- `CONN-005`: 禁止 legacy 路径（不新增并行协议、兼容双写、迁移期双轨字段）。

## 2. Connector 模型

```protobuf
message Connector {
  string connector_id = 1;                // ULID
  ConnectorKind kind = 2;                 // LOCAL_MODEL | REMOTE_MANAGED
  ConnectorOwnerType owner_type = 3;      // SYSTEM | REALM_USER
  string owner_id = 4;                    // SYSTEM 常量或 JWT sub
  string provider = 5;                    // local | gemini | openai | ...
  string endpoint = 6;                    // local 固定空串；remote 非空
  string label = 7;
  ConnectorStatus status = 8;             // ACTIVE | DISABLED
  int64 created_at = 9;                   // Unix ms
  int64 updated_at = 10;                  // Unix ms
  bool has_credential = 11;               // 展示缓存值（非门禁）
  LocalConnectorCategory local_category = 12;
}
```

领域说明：

- `CONN-010`: `provider/kind/owner_type/owner_id` 为不可变字段。
- `CONN-011`: `REMOTE_MANAGED` endpoint 持久化后不可清空。
- `CONN-012`: `LOCAL_MODEL` endpoint 固定空串。
- `CONN-013`: `has_credential` 只做展示，不作为执行门禁。

## 3. Local Connector 领域规则

- `CONN-020`: Phase 1 固定 6 个系统预设 local connector（`llm/vision/image/tts/stt/custom`）。
- `CONN-021`: local connector 的 `provider` 固定为 `local`。
- `CONN-022`: runtime 启动时必须校验并补齐 6 个 local connector。
- `CONN-023`: 同类别具体模型选择由 `model_id` 决定，connector 层不做策略分发。
- `CONN-024`: 若未来同类别多引擎并存，允许相同 `local_category` 下存在多个系统 connector（不同 `connector_id`）。
- `CONN-025`: custom 模型调用遵循 `K-LOCAL-003`（缺 profile => `available=false` + `AI_LOCAL_MODEL_PROFILE_MISSING`）。

## 4. Remote Connector 领域规则

- `CONN-030`: 每个 `realm_user_id` remote connector 上限默认 `128`。
- `CONN-031`: Phase 1 不对 `(owner_id, provider)` 建唯一约束（同 provider 可多 connector）。
- `CONN-032`: `DISABLED` 仅能通过显式 `UpdateConnector(status)` 改写；不做自动状态机。
- `CONN-033`: remote connector 被 `DISABLED` 时，consume/test/list-models 语义遵循 `K-AUTH-*` + `K-ERR-*`。

## 5. ConnectorService 领域增量

对外 RPC 名称以 `K-RPC-003` 为准。本节仅补充 Connector 领域行为：

### 5.1 CreateConnector

- `CONN-040`: `kind` 必须为 `REMOTE_MANAGED`。
- `CONN-041`: `api_key` 必填且非空字符串。
- `CONN-042`: `endpoint` 为空时按 provider 默认注入（见 `kernel/tables/provider-catalog.yaml`）。
- `CONN-043`: `label` 为空时自动生成默认值。
- `CONN-044`: 成功时 `created_at=updated_at=now`，`status=ACTIVE`。

### 5.2 UpdateConnector

- `CONN-050`: 至少提供一个可变字段（`endpoint/label/api_key/status`）。
- `CONN-051`: `status=UNSPECIFIED` 非法。
- `CONN-052`: `api_key` 显式空字符串非法。
- `CONN-053`: `label` 显式空字符串非法。
- `CONN-054`: 请求合法且包含至少一个可变字段时，无论是否同值，都刷新 `updated_at`。
- `CONN-055`: `UpdateConnector(api_key|endpoint)` 成功后必须失效 remote model cache。

### 5.3 DeleteConnector

- `CONN-060`: 成功后必须级联删除 credential。
- `CONN-061`: 成功后必须清理 remote model cache entry。
- `CONN-062`: 删除流程采用补偿中间态（`delete_pending`），见第 7 节。

### 5.4 TestConnector / ListConnectorModels

- `CONN-070`: remote 与 local 诊断语义不同，客户端必须按 `kind` 分支。
- `CONN-071`: remote 探测必须在 owner/status/credential 通过后执行。
- `CONN-072`: `ListConnectorModels(remote)` 走缓存命中路径时不出站，不做 endpoint 校验。

## 6. Provider 值域与默认 endpoint

Phase 1 provider 白名单、执行模块归属、managed/inline 入口能力由以下事实源共同定义：

- `kernel/tables/provider-catalog.yaml`：provider 值域 + 默认 endpoint + 显式 endpoint 约束
- `kernel/tables/provider-capabilities.yaml`：provider 对应执行模块（`nimillm`/`local-model`）与入口能力矩阵

## 7. 存储与补偿

## 7.1 存储介质

- registry：`~/.nimi/runtime/connector-registry.json`
- credential：`~/.nimi/runtime/credentials/<connector_id>.key`
- 权限：均为 `0600`

## 7.2 原子写入

写入流程固定：

1. 写临时文件
2. `fsync` 临时文件
3. `rename` 替换目标
4. `fsync` 父目录

## 7.3 registry 内部字段

`delete_pending: bool`（仅 remote 使用，不透出 proto）

- `CONN-080`: 非 `DeleteConnector` RPC 命中 `delete_pending=true` 必须按 `NOT_FOUND` 信息隐藏处理。
- `CONN-081`: `DeleteConnector` 命中 `delete_pending=true` 必须继续幂等清理。

## 7.4 Delete 三步补偿流程

在同一全局写锁中串行执行：

1. registry 标记 `delete_pending=true` 并持久化
2. 删除 credential（不存在视为成功）
3. 删除 registry 记录

失败策略：

- step2/step3 失败时返回错误并保留 `delete_pending=true`
- 后续 `DeleteConnector` 重试或启动重扫补偿清理

## 7.5 启动重扫补偿

runtime 启动时：

1. 加载 registry
2. 以 credential 实际状态回填 `has_credential`
3. 清理 orphan credential
4. 清理 `delete_pending` 残留

## 7.6 并发约束

- `CONN-090`: ConnectorStore（单文件实现）必须全局写串行化，禁止仅按 `connector_id` 维度加锁。
- `CONN-091`: 同 `connector_id` 的并发 `UpdateConnector` 采用 last-write-wins。
- `CONN-092`: Phase 1 单实例约束：runtime 启动需独占文件锁（例如 `~/.nimi/runtime/runtime.lock`）。

## 8. 本文件非目标

- 不定义跨域的 JWT 细节与媒体 Job owner 顺序（见 `K-AUTH-*`/`K-JOB-*`）
- 不定义流式 done 事件契约（见 `K-STREAM-*`）
- 不定义 ReasonCode 全值域与传递机制（见 `K-ERR-*`）
- 不定义 endpoint 通用安全模型（见 `K-SEC-*`）

## 9. 变更规则

修改 connector 领域时必须同时满足：

1. 若触及跨域规则，先改 `spec/runtime/kernel/*`
2. 再改本文件的领域增量规则
3. 禁止在本文件新增 kernel 规则副本
