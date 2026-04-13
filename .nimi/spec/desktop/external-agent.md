# External Agent Domain Spec

> Normative Imports: `.nimi/spec/desktop/kernel/*`

## Scope

外部 Agent 功能域 — Agent action 桥接、token 管理、gateway 状态、action 执行生命周期。

## Module Map

- `runtime/external-agent/` — External agent runtime
- `runtime/external-agent/tier1-actions.ts` — Tier-1 action 注册
- `bridge/runtime-bridge/external-agent.ts` — External agent IPC 桥接

## Kernel References

### IPC (D-IPC-008)

External agent 命令集（命令清单见 `D-IPC-008`）。

### Bootstrap (D-BOOT-006)

启动序列中注册 tier-1 actions 并启动 action bridge。

### Auth / UI Flow (D-AUTH-010, D-AUTH-011)

Desktop External Agent Access 面板是 ExternalPrincipal token 的唯一 UI 投影。用户流程固定为：

1. 读取 gateway status；
2. 输入 `principalId`、`subjectAccountId`、`mode`、`actions`、`ttlSeconds`；
3. 调用 issue token 命令；
4. 在同一面板展示一次性明文 token 和可撤销 token ledger；
5. 后续 revoke/list 仅基于 token ledger，不重复暴露历史明文 token。

### Hook (D-HOOK-010)

Action capability 域：`action.discover.*` / `action.dry-run.*` / `action.verify.*` / `action.commit.*`。

### Security (D-SEC-007)

Token 安全管理：签发、吊销、审计列表。

### Telemetry (D-TEL-005)

日志区域 `external-agent`。

## Phase 1 排除范围

Desktop Phase 1 不支持 ExternalPrincipal 会话；相关错误投影、授权语义与未来 UI 映射以 Runtime `K-AUTHSVC-013`、Platform `P-ALMI-003`/`P-ALMI-004` 与 SDK `S-ERROR-011` 为准。本域不再重复列出跨层错误表。

## CI 门禁引用

本域涉及的 CI 门禁：`pnpm exec nimicoding validate-spec-governance --profile nimi --scope desktop-consistency`（Check 1, 11, 13~14, 19 相关规则）。
