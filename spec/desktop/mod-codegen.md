# Mod Codegen Domain Spec

> Scope: Desktop mod codegen 主题导引（执行内核接入、能力边界、产物关系）。
> Normative Imports: `spec/desktop/kernel/*`

## 0. 权威导入

- `kernel/codegen-contract.md`（D-CODEGEN-001, D-CODEGEN-020, D-CODEGEN-030, D-CODEGEN-041, D-CODEGEN-060, D-CODEGEN-075）
- `kernel/mod-governance-contract.md`（D-MOD-001, D-MOD-005, D-MOD-008）
- `kernel/hook-capability-contract.md`（D-HOOK-003, D-HOOK-007, D-HOOK-009）
- `kernel/tables/codegen-capability-tiers.yaml`
- `kernel/tables/codegen-import-allowlist.yaml`

## 1. 文档定位

本文件是 mod codegen 主题导引。codegen 规则正文归属 desktop kernel，domain 文档不定义独立规则体系。

## 2. 阅读路径

1. 主合同：`kernel/codegen-contract.md`。
2. 治理链路：`kernel/mod-governance-contract.md`。
3. 能力白名单与 source-type：`kernel/hook-capability-contract.md`。
4. 实施说明：`kernel/companion/mod-codegen-playbook.md`。

## 3. 模块映射

- 生成与预检：`apps/desktop/src/runtime/mod-codegen/`。
- 执行内核：`apps/desktop/src/runtime/execution-kernel/`。
- Hook 能力校验：`apps/desktop/src/runtime/hook/`。

## 4. 非目标

- 不在 domain 层定义 codegen 本地规则编号。
- 不在本文件维护执行门禁结果与阶段快照。
