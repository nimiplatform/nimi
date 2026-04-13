# Runtime Proto Governance Playbook

## 1. 治理主线
Anchors: K-PROTO-001, K-PROTO-003, K-PROTO-006

proto 是 wire 权威，spec 是语义权威。改动顺序是 kernel 先行、proto 跟进。

## 2. 提交流程
Anchors: K-PROTO-007, K-PROTO-008

每次协议修改执行固定流水线：lint -> generate -> drift；禁止逆序从生成代码回推 proto。

## 3. 兼容策略
Anchors: K-PROTO-004, K-PROTO-005

breaking/additive 必须有明确分类；字段删除前必须完成 reserved。

## 4. 发布决策
Anchors: K-PROTO-009, K-PROTO-010

发布前以 gate 结果为准；design/proto 命名映射统一查 `rpc-migration-map.yaml`。
