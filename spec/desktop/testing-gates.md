# Desktop Testing Gates

> Normative Imports: `spec/desktop/kernel/*`

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

### Supplementary Hard-Cut Gates (D-BOOT-001, D-HOOK-008, D-IPC-011, D-IPC-012, D-MOD-002, D-CODEGEN-012)

- `rule-evidence.yaml` 可为 canonical runtime config path、runtime-only token-api routing、runtime-aligned mod/hook surface、local-ai bridge 命令边界、manifest capabilities-only policy 绑定额外静态 gate。
- 这些 hard-cut gate 不替代 lint/test/e2e，只负责阻断 legacy surface 回流。

## Verification Coverage

- `pnpm check:desktop-spec-kernel-consistency`
- `pnpm check:desktop-spec-kernel-docs-drift`
- `pnpm --filter @nimiplatform/desktop lint`
- `pnpm --filter @nimiplatform/desktop test`
- `pnpm check:desktop-mods-smoke --all`
- `pnpm check:runtime-mod-hook-hardcut`
- `pnpm check:desktop-token-api-runtime-only`
- `pnpm check:desktop-no-legacy-runtime-config-path`
- `pnpm check:no-local-ai-private-calls`
- `pnpm check:no-local-ai-tauri-commands`
- `pnpm check:no-legacy-mod-permissions-field`
- `pnpm check:local-chat-e2e`
- `pnpm check:local-chat-live-smoke`
