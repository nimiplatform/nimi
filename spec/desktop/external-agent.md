# External Agent Domain Spec

> Normative Imports: `spec/desktop/kernel/*`

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

### Hook (D-HOOK-009)

Action capability 域：`action.discover.*` / `action.dry-run.*` / `action.verify.*` / `action.commit.*`。

### Security (D-SEC-007)

Token 安全管理：签发、吊销、审计列表。

### Telemetry (D-TEL-005)

日志区域 `external-agent`。

## Phase 1 排除范围

### ExternalPrincipal 错误处理

Desktop Phase 1 **不支持 ExternalPrincipal 会话**。Runtime `K-AUTHSVC-013` 定义的 `AUTH_TOKEN_EXPIRED` 与 `AUTH_UNSUPPORTED_PROOF_TYPE` 两个 ExternalPrincipal 错误码在 Desktop Phase 1 不会触达（Desktop 仅使用 Realm 用户会话 JWT sub，不生成 ExternalPrincipal proof）。

SDK `S-ERROR-011` 将这两个错误码投影为不可重试。若 Desktop 未来支持 ExternalPrincipal，需在 `D-ERR-007` 补充以下映射：

| Runtime ReasonCode | 推荐 UI 消息 |
|---|---|
| `AUTH_TOKEN_EXPIRED` | "外部代理会话已过期，请重新认证" |
| `AUTH_UNSUPPORTED_PROOF_TYPE` | "不支持的认证类型" |

**跨层引用**：Runtime `K-AUTHSVC-013`、Platform `P-ALMI-003`/`P-ALMI-004`、SDK `S-ERROR-011`。

## CI 门禁引用

本域涉及的 CI 门禁：`pnpm check:desktop-spec-kernel-consistency`（Check 1, 11, 13~14, 19 相关规则）。
