# 伪闭合形态

Codex 任务看起来已经完成，但必需的权威、语义、消费方行为或抗漂移能力仍然
开放，这就是伪闭合。任务状态归 Codex；方法论与门禁决定 Codex 在诚实标记完成
之前必须拥有的证据。

## Build 通过式闭合

代码能构建，测试也通过，但用户可见路径不可用，或者真实 consumer 根本没有使用
新的实现。

处置：检查真实 runtime 与消费路径，修复失败并补回归覆盖。

## 权威闭合但消费方未闭合

规范正确，SDK owner 也提供了公共表面，但应用仍保留局部旧路径或 bypass。

处置：把 consumer 迁移到 canonical seam，并删除平行真相。

## 消费方闭合但权威未闭合

应用行为正确，但依赖没有 canonical owner 的局部规则。

处置：先解决权威。不能因为代码碰巧工作，就把它默认提升为产品真相。

## 仅 Happy Path 闭合

成功路径可用，但认证失败、runtime 不可用、非法输入、禁用控件或窄屏布局没有验证。

处置：在真实环境中验证已声明的失败态与边界态。

## 仅截图闭合

截图看起来正确，但 DOM 状态、可访问性、runtime 连通性或 console 行为有误。

处置：把视觉复核与结构、runtime 检查结合起来。

## 仅门禁闭合

机械检查全部通过，但真实应用行为与检查结论冲突。

处置：以真实行为失败为准，修复问题，并加强门禁或回归测试。

## 无证据闭合

最终摘要声称检查通过，却没有真实命令结果或 runtime 观察。

处置：运行检查。如果无法运行，就报告阻塞；不能制造通过结论。

## 平行真相闭合

新的 owner 路径已经实现，但旧 owner、读路径或写路径仍然有效。

处置：完成硬切，并验证旧路径不可达。

## 过度压缩闭合

大改动之所以显得可理解，只是因为证据或实现细节被压缩到无法重建。

处置：保持文件职责内聚，保存可追溯证据，并沿真实 owner 边界拆分职责。

## 闭合检查

Codex 完成高风险任务时，最终证据要回答：

| 维度 | 问题 |
| --- | --- |
| 权威 | Canonical truth 是否存在且已经对齐？ |
| 语义 | 实现表达的含义是否与权威一致？ |
| 消费方 | 真实 consumer 是否使用预期 seam 和行为？ |
| 抗漂移 | 测试与门禁能否阻止旧问题回归？ |

任何必备维度没有答案，Codex 任务都应保持开放，或明确给出 blocked/partial 结果。

## 来源依据

- [`.nimi/methodology/four-closure-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/four-closure-policy.yaml)
- [`.nimi/methodology/core.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/core.yaml)
- [`.nimi/contracts/negative-fixtures.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/negative-fixtures.yaml)
