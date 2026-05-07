# 范式

Nimi Coding 是**一套面向 AI 开发的新范式**，不是一份 checklist，也不是一座 workflow 库。这一页讲清楚它「范式」在哪里。

## 今天的工程工具假设了什么

Code review、测试、类型检查、linter、CI 这些工具背后有一个共同假设：**它们要抓的失败是局部的、写在代码里的**。Bug 住在某个函数里。类型不匹配出现在边界上。测试失败对应一条没成立的行为断言。

之所以这些工具用得起来，是因为开发者的意图跟产出代码紧贴在一起。开发者想做 X、不小心写成 Y，code review 与测试就能把那道 gap 露出来。

## AI 协作真正打破的是什么

AI 辅助实现常常交付这样的东西：

- 能编译
- 老测试都能过
- 在 reviewer 看来也合理
- 但在权威、范围、语义、产品含义上仍然错

方法论要应对的失败形态：

| 形态 | 机制 |
| --- | --- |
| 老文档锚定 | 助手沿用一份看起来权威、其实早已脱离 spec 的文档 |
| 范围隐性扩张 | 助手「顺手」改了相邻表面，所有权悄无声息地搬了家 |
| 自圆其说式合成 | 缺权威来源时，助手编出一个跟真材实料看起来无差别的答案 |
| 旧路径保留 | 助手把新路径加在旧路径旁边当「平稳迁移」，可旧路径本来就该删掉 |
| Build-pass 闭合 | 因为测试跑过了就标完成，可用户那一端的行为还是错的 |
| 假装重开是安全的 | 已闭合的表面以「修个小毛病」的名义被再碰一次，闭合权威跟着悄悄变了 |
| 伪成功 | 类型化合同失败被一个「返回点什么」的 fallback 兜住，不再 fail-close |
| 上下文门禁偏移 | 原本用来保护 AI 上下文预算的门禁，被压缩文件、浅摘要、薄工件绕过去；形式上过了门禁，审计所需的证据却丢了 |

这些不是常规意义上的 bug，而是**闭合失败** —— 工作在闭合条件其实没有成立的状态下被宣布做完了。

上下文门禁偏移在 AI 原生工作流里尤其危险。门禁本身可能是对的：它要防止超大文件或超大证据集把 AI 上下文塞满。问题出在执行层：如果为了过门禁，把原本有结构的代码压成一坨密集逻辑，或者把证据压成下一位审计者无法复原的摘要，门禁的目的就被反向消解了。Nimi Coding 把这看作漂移，而不是成功：正确做法是保留边界清楚、职责内聚的文件和类型化证据，而不是用压缩工件把复杂性藏起来。

## 「范式」而不是「checklist」

Checklist 是「记得做这几件事」。范式是「换一套看待工作的视角」。

Nimi Coding 给出的回应不是再多一份要记的清单，而是**一套显式机制：工作开始前先声明闭合条件，工作结束后再形成可核验的证据。**

让它成为范式而不是 checklist 的，是这四步：

1. **权威被点名。** 每一次改动都要点明它的真相住在哪里（`.nimi/spec/**`）、谁拥有这个表面、这是哪一类工作（alignment / redesign / refactor / spec / authority）。
2. **执行被 packet 化。** 实现工作受一份冻结的 packet 框定：在 worker 动手之前就写明允许读什么、允许写什么、acceptance invariant、negative test、stop line、reopen 条件。worker 不能自己扩范围。
3. **闭合是多维的。** 权威闭合、语义闭合、消费方闭合、抗漂移闭合是四个独立的关。一个 wave 四过三还是没闭合。
4. **角色分离，审计独立。** Manager 拥有 wave 准入与判断；worker 拥有 packet 写集合；auditor 做结构性 review 与漂移检测，没有变更或准入的权力。

这四步组合起来构成范式：在这个体系里，AI 合理但其实错了的输出，没有外部证据是没法升格为「完成」的，而且这份证据来自跟产出循环结构上分离的另一个循环。

## 阅读场景：code review 抓不到的失败

某开发者请 AI「给用户资料加一个新字段」。AI 做了。code review 通过。测试通过。

code review 跟测试都答不出来的问题：

- 这次改动需不需要去更新规范化的用户身份合同？还是说这只是个展示字段？
- 新字段会不会跟某个本来就该删的迁移产生互相牵连？
- 别处（别的 app、别的文档）有没有因此暗示这个字段已经存在、可它其实没存在？
- 这个新字段是可审计的吗？还是它绕过审计被偷偷塞进去了？

Nimi Coding 让这些问题**结构性地可回答**：改动被一份点名权威域的 packet 框住；packet 的 negative test 检查的就是 code review 看不到的那几件事；闭合维度强迫你回答「消费方现在用的是不是正确的接缝」。

## 阅读场景：「再调一调 prompt」为什么不顶用

一种常见的尝试性修法：「AI 老犯错，那就给它更好的 prompt」。这种修法处理的是症状（AI 的输出），而不是结构性问题（review 输出的那个循环跟产出输出的循环是同一个）。

Nimi Coding 的角色分离才能处理这个结构性问题。auditor 的角色**不是同一个循环**。在 `manager_worker_auditor` 执行模式下，审计来自一个结构上分离的循环：另一个 AI session、另一家厂商、另一台宿主。

Prompt 调得再好也替代不了这种结构性的分离。范式提供的就是这种分离。

## 来源

- [`nimi-coding/README.md`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/README.md)
- [`.nimi/methodology/four-closure-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/four-closure-policy.yaml)
- [`.nimi/methodology/role-separation-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/role-separation-policy.yaml)
- [`.nimi/methodology/authority-convergence-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/authority-convergence-policy.yaml)
- [`.nimi/contracts/forbidden-shortcuts.catalog.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/forbidden-shortcuts.catalog.yaml)
