# Desktop Spec Repair Validation

> Date: 2026-03-12
> Scope: `spec/desktop/kernel/offline-degradation-contract.md`, `scripts/check-desktop-spec-kernel-consistency.mjs`
> Purpose: 验证 Desktop cross-baseline 审计中 3 个已证实问题的修复落地情况

## 1. 核实结论

- **F1 成立**: `D-OFFLINE-005` 原先将 IndexedDB 离线缓存错误关联到 `D-SEC-003`。`D-SEC-003` 是 OAuth 安全规则，不适用于缓存存储约束。
- **F2 成立**: Desktop consistency 脚本原先只校验 `K-*` cross-domain 引用，未校验 desktop kernel 中的 `S-*` 引用是否能在 `spec/sdk/kernel/*.md` 的 heading 中解析。
- **F3 成立**: `D-OFFLINE-004` 原先只写 “re-bootstrap”，未显式引用 `S-RUNTIME-070` 的 session recovery 协议。

## 2. 修复决策

### F1 — 删除错误安全引用

- 从 `D-OFFLINE-005` 删除 “受 `D-SEC-003` 安全约束”。
- 从 Fact Sources 的 cross-reference 列表移除 `D-SEC-003`。
- 不替换为 `D-SEC-008`。原因：
  - `D-SEC-003` 明确是 OAuth 安全。
  - `D-SEC-008` 是 CSP / `connect-src` 约束，也不是 IndexedDB 存储安全的权威规则。
  - 最准确的修复是保留中性描述，仅声明 IndexedDB 是离线只读缓存层。

### F2 — 扩展 cross-domain CI 校验覆盖

- 将 desktop consistency 脚本中的单一 Runtime `K-*` 校验重构为通用 `checkCrossDomainRuleReferences(files, targets)`。
- 新增 SDK target：扫描 `spec/sdk/kernel/*.md` 的 `## S-*` headings，并验证 desktop kernel 中全部 `S-*` 引用可解析。
- 正则按仓库现有风格支持可选后缀：`K-[A-Z]+-\d{3}[a-z]?`、`S-[A-Z]+-\d{3}[a-z]?`。

### F3 — 补齐 Session Recovery 显式约束

- 在 `D-OFFLINE-004` 明确要求 Runtime 重连后遵循 `S-RUNTIME-070` 执行 `connect()` + `OpenSession()`。

## 3. 现状结果

- Desktop kernel 当前包含 **79 个 `S-*` 引用实例**，覆盖 **23 个唯一 `S-*` 规则 ID**。
- 现有全部 Desktop `S-*` 引用均可在 `spec/sdk/kernel/*.md` 中解析。
- `offline-degradation-contract.md` 已不再包含 `D-SEC-003` 的错误缓存安全引用。
- `offline-degradation-contract.md` 已显式包含 `S-RUNTIME-070`。

## 4. 验证命令

按最终顺序执行并通过：

```bash
pnpm check:desktop-spec-kernel-consistency
pnpm generate:desktop-spec-kernel-docs
pnpm check:desktop-spec-kernel-docs-drift
```

结果：

- `pnpm check:desktop-spec-kernel-consistency` → `desktop-spec-kernel-consistency: OK`
- `pnpm generate:desktop-spec-kernel-docs` → `generated desktop kernel docs (23 files)`
- `pnpm check:desktop-spec-kernel-docs-drift` → `desktop kernel generated docs are up-to-date (23 files)`

## 5. 剩余风险

- 本次仅验证已证实的 3 个修复项及其关联 CI 覆盖，不重新执行完整 Desktop freeze audit。
- 因此，本报告不能替代完整的 Desktop 全量冻结评级，只能证明本次修复范围内的问题已落地并通过当前 spec gate。
