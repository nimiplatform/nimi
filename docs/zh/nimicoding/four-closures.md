# 四个闭合维度

Nimi Coding 从四个独立维度判断高风险结果。Codex 持有任务完成状态；这些维度
定义完成结论必须具备的证据。

## 权威闭合

Canonical owner 明确、当前有效，并与变更一致。任何下游表面都没有编造或遮蔽
产品真相。

证据可以包括规范引用、owner 决策、placement 检查和禁用 bypass 的缺失证明。

## 语义闭合

实现表达了权威声明的行为与失败语义。仅仅类型正确但语义近似，不算闭合。

证据可以包括范围化测试、契约验证、负向用例和 owner 层代码检查。

## 消费方闭合

真实 consumer 使用 canonical seam 并交付预期结果。App 工作还要覆盖真实 shell、
runtime/auth/SDK 连通性、可访问性、窄屏、长文本与失败态。

## 抗漂移闭合

测试与门禁能发现旧问题或 owner bypass，不依赖评审者记住一条未写下来的规则。

## 判断规则

| 结果 | Disposition |
| --- | --- |
| 所有必备维度都有证据 | `complete` |
| 产出有价值，但明确存在开放要求 | `partial` |
| 必备真相或证据不可获得 | `deferred`，或宿主任务 blocked |

任何单一绿灯都不能替代其他维度。尤其是 build 通过，不能证明 consumer 行为或权威。

## 来源依据

- [`.nimi/methodology/four-closure-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/four-closure-policy.yaml)
- [`.nimi/methodology/core.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/core.yaml)
