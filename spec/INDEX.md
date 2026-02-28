# Spec Index

> Status: Draft
> Date: 2026-02-28

## Runtime（当前）

Runtime 规范采用 kernel + domain 的两层结构：

- Kernel（唯一事实源）：`spec/runtime/kernel/`
- Domain：
  - `spec/runtime/connector-auth.md`
  - `spec/runtime/nimillm.md`
  - `spec/runtime/local-model.md`

## Task-Oriented 最短阅读路径

### 修改 Connector 鉴权 / owner / key-source

1. `spec/runtime/kernel/authz-ownership.md`
2. `spec/runtime/kernel/key-source-routing.md`
3. `spec/runtime/connector-auth.md`

### 修改 remote 执行行为（nimillm）

1. `spec/runtime/kernel/rpc-surface.md`
2. `spec/runtime/kernel/streaming-contract.md`
3. `spec/runtime/kernel/error-model.md`
4. `spec/runtime/nimillm.md`

### 修改 local 执行行为

1. `spec/runtime/kernel/local-category-capability.md`
2. `spec/runtime/kernel/streaming-contract.md`
3. `spec/runtime/local-model.md`

### 修改错误码

1. `spec/runtime/kernel/tables/reason-codes.yaml`
2. `spec/runtime/kernel/error-model.md`
3. 受影响 domain 文档（只更新引用，不复制定义）

### 修改 provider 值域 / 入口能力 / endpoint 约束

1. `spec/runtime/kernel/tables/provider-catalog.yaml`
2. `spec/runtime/kernel/tables/provider-capabilities.yaml`
3. 受影响 domain 文档（`connector-auth.md` / `nimillm.md` / `local-model.md`）

### 修改状态机与迁移

1. `spec/runtime/kernel/tables/job-states.yaml`
2. `spec/runtime/kernel/tables/state-transitions.yaml`
3. 受影响 kernel/domain 文档（按 Rule ID 引用）

## 约束

- 规则必须先改 kernel，再改 domain。
- domain 文档禁止复述 kernel 规则正文。
- `spec/sdk` 暂未纳入本轮拆分。
