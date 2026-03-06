# Realm App Interconnect Model

> Domain: Realm / App Interconnect Model

## 0. Normative Imports

| Kernel Location | Rule IDs |
|---|---|
| `kernel/boundary-vocabulary-contract.md` | R-BOUND-001, R-BOUND-002, R-BOUND-003, R-BOUND-010 |
| `kernel/interop-mapping-contract.md` | R-INTEROP-001, R-INTEROP-002 |
| `kernel/economy-contract.md` | R-ECON-010, R-ECON-020, R-ECON-030, R-ECON-040 |
| `spec/platform/kernel/protocol-contract.md` | P-PROTO-002, P-PROTO-003, P-PROTO-020, P-PROTO-030, P-PROTO-035, P-PROTO-040, P-PROTO-050, P-PROTO-060, P-PROTO-070, P-PROTO-100–105 |
| `spec/platform/kernel/tables/participant-profiles.yaml` | participant role / app mode |
| `spec/platform/kernel/tables/app-authorization-presets.yaml` | preset + delegation |
| `spec/platform/kernel/tables/protocol-primitives.yaml` | primitive field contracts |
| `spec/sdk/kernel/realm-contract.md` | S-REALM-010, S-REALM-012, S-REALM-014, S-REALM-028, S-REALM-029 |

## 1. 文档定位

本文件是“Realm 作为跨应用互联语义层”的薄域导引。  
应用模式、授权语义、六原语主权与映射状态以现有 kernel Rule 为权威，本文件仅提供主张到 Rule 的映射关系。

## 2. 核心主张到 Rule 映射

| 核心主张 | Rule ID 锚点（权威） |
|---|---|
| Realm 承担六原语语义执行主权 | P-PROTO-003, P-PROTO-100–105 |
| 应用可按模式渐进接入（render/extension） | P-PROTO-050, P-PROTO-060 |
| 互联建立在授权与委托约束上，而非默认放权 | P-PROTO-020, P-PROTO-030, P-PROTO-035, P-PROTO-040 |
| 跨应用边界词汇必须统一且可依赖 | R-BOUND-001, R-BOUND-002, R-BOUND-003, R-BOUND-010 |
| 经济与归因必须可审计、不可混账 | R-ECON-010, R-ECON-020, R-ECON-030, R-ECON-040 |
| 六原语映射必须按状态治理并可毕业 | R-INTEROP-001, R-INTEROP-002 |
| SDK Realm 接入必须保持实例隔离与认证边界 | S-REALM-010, S-REALM-012, S-REALM-014, S-REALM-028, S-REALM-029 |

## 3. 阅读路径

1. 先读协议主权与模式边界：`spec/platform/kernel/protocol-contract.md`（P-PROTO-003 / 050 / 060 / 070 / 100–105）。
2. 再读 Realm 边界与互操作：`kernel/boundary-vocabulary-contract.md`、`kernel/interop-mapping-contract.md`。
3. 如涉及经济互联，再读 `kernel/economy-contract.md` 与相关 tables。
4. 最后回到 SDK 接入边界：`spec/sdk/kernel/realm-contract.md`。

## 4. 现状态说明

六原语在 Realm 的实现映射状态以 `kernel/tables/primitive-mapping-status.yaml` 为准。  
当前状态（PARTIAL/COVERED/MISSING）用于收敛计划与毕业判断，不在本文件复写执行态结论。

## 5. 非目标

- 不在本文件定义新的 Rule ID 或新的本地编号体系。
- 不在本文件定义新的原语字段、授权模型或经济公式。
- 不在本文件记录阶段性通过/失败结果；执行态证据写入 `dev/report/*`。
