# Runtime Spec Kernel Split Manifest (2026-02-28)

## Scope

- In scope: `spec/runtime/**`
- Out of scope (deferred): `spec/sdk/**`

## Objectives

1. 建立 runtime kernel 单一事实源
2. 将 runtime domain 文档改为引用 kernel + 领域增量规则
3. 增加可执行 lint，阻断多事实源回流

## Executed Changes

1. Created `spec/runtime/kernel/` with 10 contract docs:
   - `index.md`
   - `rpc-surface.md`
   - `authz-ownership.md`
   - `key-source-routing.md`
   - `media-job-lifecycle.md`
   - `local-category-capability.md`
   - `endpoint-security.md`
   - `streaming-contract.md`
   - `error-model.md`
   - `pagination-filtering.md`
   - `audit-contract.md`
2. Created structured tables under `spec/runtime/kernel/tables/`:
   - `rpc-methods.yaml`
   - `reason-codes.yaml`
   - `metadata-keys.yaml`
   - `provider-catalog.yaml`
   - `job-states.yaml`
   - `provider-capabilities.yaml`
   - `connector-rpc-field-rules.yaml`
   - `state-transitions.yaml`
3. Rewritten runtime domain docs to import kernel and keep domain-only rules:
   - `spec/runtime/connector-auth.md`
   - `spec/runtime/nimillm.md`
   - `spec/runtime/local-model.md`
4. Added runtime spec index:
   - `spec/INDEX.md`
5. Added lint script:
   - `scripts/check-runtime-spec-kernel-consistency.mjs`
6. Added generated-view pipeline for kernel tables:
   - generator: `scripts/generate-runtime-spec-kernel-docs.mjs`
   - outputs: `spec/runtime/kernel/generated/*.md`
   - drift check: `check:runtime-spec-kernel-docs-drift`
   - CI gate: `core-static` job includes generated-doc drift check

## Acceptance Gates (Runtime)

- Gate A: no `docs/runtime/design-*` refs under `spec/runtime`
- Gate B: no token-provider legacy naming in `spec/runtime`
- Gate C: runtime domain docs must declare `Normative Imports: spec/runtime/kernel/*`
- Gate D: domain docs must reference at least one kernel Rule ID (`K-*-NNN`)
- Gate E: ReasonCode numeric assignment only in `reason-codes.yaml`
- Gate F: generated kernel markdown must be in sync with `tables/*.yaml`
- Gate G: `provider-catalog` 与 `provider-capabilities` provider 集必须一致（remote）
- Gate H: `state-transitions` 必须覆盖核心状态机并与 `job-states` 对齐

## Verification Command

```bash
node scripts/check-runtime-spec-kernel-consistency.mjs
node scripts/generate-runtime-spec-kernel-docs.mjs --check
```

## Next (Deferred)

1. 将同样的 kernel 引用模型扩展到 `spec/sdk/runtime.md`
2. 评估是否将 `provider-capabilities/state-transitions` 扩展到 ssot 层统一复用
3. 为新表补充“跨文件引用完整性”检查（例如 domain 文档中 provider/rpc 字段引用必须可回溯到表）
