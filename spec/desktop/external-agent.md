# External Agent Domain Spec

> Normative Imports: `spec/desktop/kernel/*`
> Status: Draft
> Date: 2026-03-01

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

### Hook (D-HOOK-009)

Action capability 域：`action.discover.*` / `action.dry-run.*` / `action.verify.*` / `action.commit.*`。

### Security (D-SEC-007)

Token 安全管理：签发、吊销、审计列表。

### Telemetry (D-TEL-005)

日志区域 `external-agent`。
