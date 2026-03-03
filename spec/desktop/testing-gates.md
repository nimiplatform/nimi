# Desktop Testing Gates

> Normative Imports: `spec/desktop/kernel/*`
> Status: Draft
> Date: 2026-03-02

## Scope

Desktop 规范验收门禁与执行证据契约，覆盖 kernel 规则集合 `D-*` 的可追踪性与发布前强制检查。

## Kernel References

### Rule Traceability (D-BOOT-001, D-ERR-007, D-STATE-001, D-NET-002)

- 全量 `D-*` 规则必须在 `spec/desktop/kernel/tables/rule-evidence.yaml` 中存在唯一证据条目。
- `status=covered` 必须绑定可执行门禁（`command`）且证据路径可解析到真实文件。
- `status=na` 必须提供可校验 `na_reason`。

### Consistency Gate (D-BOOT-003)

- `pnpm check:desktop-spec-kernel-consistency` 必须校验：
  - kernel 规则全集
  - `rule-evidence.yaml` 证据映射
  - 证据路径文件存在性

### Drift Gate (D-BOOT-002)

- `pnpm check:desktop-spec-kernel-docs-drift` 必须覆盖 `rule-evidence.yaml` 对应生成视图漂移。

## Verification Coverage

- `pnpm check:desktop-spec-kernel-consistency`
- `pnpm check:desktop-spec-kernel-docs-drift`
- `pnpm --filter @nimiplatform/desktop lint`
- `pnpm --filter @nimiplatform/desktop test`
