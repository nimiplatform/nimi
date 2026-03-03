# Runtime Proto Governance Contract

> Owner Domain: `K-PROTO-*`

## K-PROTO-001 Proto Source Authority

`proto/runtime/v1/*.proto` 是 wire schema 唯一权威。

## K-PROTO-002 Generated Artifact Integrity

runtime/sdk 生成产物必须由 proto 生成链路产生，禁止手改。

## K-PROTO-003 Spec vs Proto Boundary

spec 只定义语义约束与流程，不复制完整字段级 wire schema。

## K-PROTO-004 Compatibility Policy

breaking/additive 演进必须按兼容策略执行，并输出可审计结论。

## K-PROTO-005 Reserved Deletion Rule

删除字段前必须先 reserved 字段号与字段名。

## K-PROTO-006 Kernel-First Change Order

协议语义调整必须先更新 kernel 规则，再更新 proto。

## K-PROTO-007 Command Pipeline Baseline

proto 改动必须经过 lint/generate/drift 的固定流水线。

## K-PROTO-008 Fail-Fast Sequence

禁止“先改生成代码再反推 proto”的逆序流程。

## K-PROTO-009 Release Gates

发布前必须满足 proto 与上下游回归门禁，否则 NO-GO。

## K-PROTO-010 Design/Proto Mapping

design 名称与 proto 名称映射以 `rpc-migration-map.yaml` 为权威事实源。
