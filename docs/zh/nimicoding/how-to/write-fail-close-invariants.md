# 编写 Fail-Closed 验收不变式

验收不变式要让缺失要求产生真实失败，而不是生成看似合理的完成结论。

## 做法

1. 明确 canonical authority 与受影响 consumer。
2. 把每条不变式写成可观测 predicate。
3. 至少包含一项负向或不可用状态检查。
4. 指出证明它的真实命令或 runtime 交互。
5. 明确无法取得证据时必须发生什么。

## 弱形式与 Fail-Closed 形式

| 弱形式 | Fail-closed 形式 |
| --- | --- |
| “Auth 可用” | “真实 Desktop shell 通过共享 SDK 登录；Runtime 缺失时进入声明的 disabled/error 状态，不使用局部 fallback” |
| “UI 看起来不错” | “桌面与窄屏截图没有裁切；DOM 检查确认 label、focus、disabled 状态和无 console error” |
| “测试通过” | “指定的受影响范围命令 exit zero，真实 consumer 路径也成功；任一失败都阻止完成” |

## 证据形态

证据记录命令或交互、实际结果、需要时的时间，以及剩余缺口。检查实际运行之前，
不能把预期结果预写进证据栏。

## 来源依据

- [`.nimi/contracts/prompt.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/prompt.schema.yaml)
- [`.nimi/contracts/acceptance.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/acceptance.schema.yaml)
- [`.nimi/contracts/negative-fixtures.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/negative-fixtures.yaml)
