# AI Agent Security Interface

> Domain: Platform / AI Agent Security Interface

## 0. Normative Imports

| Kernel Location | Rule IDs |
|---|---|
| `kernel/ai-last-mile-contract.md` | P-ALMI-001–030 |
| `kernel/architecture-contract.md` | P-ARCH-011, P-ARCH-020, P-ARCH-030 |
| `kernel/protocol-contract.md` | P-PROTO-010, P-PROTO-020, P-PROTO-030, P-PROTO-035, P-PROTO-040, P-PROTO-060 |
| `spec/runtime/kernel/auth-service.md` | K-AUTHSVC-001–013 |
| `spec/runtime/kernel/grant-service.md` | K-GRANT-001–013 |
| `spec/runtime/kernel/connector-contract.md` | K-CONN-001–015 |
| `spec/runtime/kernel/pagination-filtering.md` | K-PAGE-001–006 |
| `spec/runtime/kernel/audit-contract.md` | K-AUDIT-001–018 |
| `spec/runtime/kernel/error-model.md` | K-ERR-001–010 |
| `spec/runtime/kernel/local-category-capability.md` | K-LOCAL-029, K-LOCAL-030 |
| `spec/desktop/kernel/security-contract.md` | D-SEC-005, D-SEC-007, D-SEC-009 |
| `spec/desktop/kernel/hook-capability-contract.md` | D-HOOK-006–010 |
| `spec/desktop/kernel/mod-governance-contract.md` | D-MOD-005, D-MOD-008 |
| `spec/desktop/kernel/bridge-ipc-contract.md` | D-IPC-008 |

## 1. 文档定位

本文件是“AI Agent 安全调用接口”主题的薄域导引。  
安全主张、授权语义、执行约束、审计字段的规范定义以 kernel Rule 为权威，本文件仅提供映射与阅读顺序。
对外说明主文档见：`nimi/docs/architecture/ai-agent-security-interface.md`。

## 2. 安全主张到 Rule ID 映射

| 安全主张 | Rule ID 锚点（权威） |
|---|---|
| Agent 应调用 AI 原生接口，不模拟人类 GUI | P-ALMI-002, P-ALMI-010, P-ALMI-011 |
| 默认最小权限与局部授权 | P-ALMI-003, P-PROTO-020, K-AUTHSVC-006, K-GRANT-003, K-GRANT-005 |
| 控制面/数据面分离与高风险 fail-close | P-ALMI-030, P-ARCH-011, P-PROTO-030, K-CONN-013 |
| 授权可撤销、可委托、可追踪 | P-PROTO-035, P-PROTO-040, K-GRANT-006, K-GRANT-010, K-GRANT-012 |
| 执行接口确定性（字段更新、分页、错误） | K-CONN-013, K-CONN-014, K-PAGE-002, K-PAGE-005, K-ERR-001 |
| Desktop/Mod 沙盒与能力边界 | D-SEC-005, D-SEC-009, D-HOOK-007, D-MOD-005 |
| 外部 Agent 接入安全 | P-ALMI-004, D-IPC-008, D-SEC-007, K-AUTHSVC-013 |
| 全链路审计与可追溯 | P-ARCH-030, K-AUDIT-001, K-AUDIT-006, K-AUDIT-017, K-LOCAL-029 |

## 3. 阅读路径

1. 先读平台总契约：`kernel/ai-last-mile-contract.md`、`kernel/architecture-contract.md`、`kernel/protocol-contract.md`。
2. 再读 Runtime 安全执行链：`spec/runtime/kernel/auth-service.md`、`grant-service.md`、`connector-contract.md`、`pagination-filtering.md`、`audit-contract.md`、`error-model.md`。
3. 最后读 Desktop 沙盒边界：`spec/desktop/kernel/security-contract.md`、`hook-capability-contract.md`、`mod-governance-contract.md`、`bridge-ipc-contract.md`。

### 3.1 按角色阅读

1. 架构评审：优先 `P-ALMI-*`、`P-ARCH-011/030`、`P-PROTO-020/030/035/040`。
2. Runtime 实现：优先 `K-AUTHSVC-*`、`K-GRANT-*`、`K-CONN-013~015`、`K-PAGE-*`、`K-ERR-*`、`K-AUDIT-*`。
3. Desktop/Mod 安全：优先 `D-SEC-*`、`D-HOOK-*`、`D-MOD-*`、`D-IPC-008`。

## 4. 非目标

- 不在本文件定义新的 Rule ID 或本地编号体系。
- 不在本文件重复 kernel 规则正文。
- 不在本文件记录执行态结论、测试快照或阶段进度。
