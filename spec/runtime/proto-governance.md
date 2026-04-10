# Proto Governance Domain Spec

> Scope: runtime proto 治理导引（权威边界、变更顺序、证据路径）。
> Normative Imports: `spec/runtime/kernel/*`

## 0. 权威导入

- `kernel/proto-governance-contract.md`（source authority：K-PROTO-001；generated integrity：K-PROTO-002；spec/proto boundary：K-PROTO-003；compatibility/reserved deletion：K-PROTO-004~005；kernel-first/fail-fast：K-PROTO-006, K-PROTO-008；pipeline/release/mapping：K-PROTO-007, K-PROTO-009~010）
- `kernel/tables/runtime-proto-governance-gates.yaml`

## 1. 文档定位

本文件只描述 proto 治理阅读路径，不在 domain 层复写 wire schema 细节。

## 2. 阅读路径与变更顺序

1. proto source authority 与 generated artifact integrity：`kernel/proto-governance-contract.md`（K-PROTO-001, K-PROTO-002）。
2. spec/proto boundary 与 compatibility policy：`kernel/proto-governance-contract.md`（K-PROTO-003, K-PROTO-004）。
3. reserved deletion rule 与 kernel-first change order：`kernel/proto-governance-contract.md`（K-PROTO-005, K-PROTO-006）。
4. command pipeline 与 fail-fast sequence：`kernel/proto-governance-contract.md`（K-PROTO-007, K-PROTO-008）。
5. release gates 与 design/proto mapping：`kernel/proto-governance-contract.md`（K-PROTO-009, K-PROTO-010）。
6. 实际变更顺序仍固定为：先更新 kernel 语义合同，再更新 `proto/runtime/v1/*.proto`，最后验证 lint / generate / drift / spec linkage。

## 3. 关联材料

- Companion：`kernel/companion/proto-governance-playbook.md`。
- proto 源：`proto/runtime/v1/`。
- 生成产物：`runtime/gen/runtime/v1/`、`sdk/src/runtime/generated/runtime/v1/`。
- 验证入口：`pnpm proto:lint`、`pnpm proto:generate`、`pnpm proto:drift-check`、`pnpm check:runtime-proto-spec-linkage`。
- 执行结果：local execution report route patterns（如 `nimi-coding/.local/report/**`）。

## 4. 非目标

- 不在 domain 文档定义字段级 wire schema。
- 不在本文件维护执行态变更日志。
