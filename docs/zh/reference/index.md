# Reference

Reference 是 Nimi 的产品概念字典。每一页是字段列表、表格或枚举，全部来自 `.nimi/spec/**`。这些页面**不叙述** — 叙述类内容在产品章节（Platform / Runtime / SDK / Desktop / Realm / Avatar / Cognition / Nimi Coding）里。

## 本节页面

| 页面 | 你需要知道什么时用 |
| --- | --- |
| [术语表](/zh/reference/glossary) | 跨域术语在一个地方的统一含义 |
| [World 字段](/zh/reference/world-fields) | World 在字段层面长什么样 |
| [Agent 字段](/zh/reference/agent-fields) | Agent 在字段层面长什么样 |
| [六个基础协议](/zh/reference/six-primitives) | 六个跨世界合同面以表格形式呈现 |
| [状态机](/zh/reference/state-machines) | 每个具名状态机及其规范状态 |
| [权威域](/zh/reference/authority-domains) | 哪个域拥有哪种真相 |
| [错误归属](/zh/reference/error-ownership) | 哪一层拥有哪种错误合同 |
| [兼容性姿态](/zh/reference/compatibility-posture) | 兼容边界以及禁止的兼容形状 |
| [禁用主张](/zh/reference/forbidden-claims) | 公开文档禁止主张清单与检测模式 |
| [Spec Map](/zh/reference/spec-map) | 一条公开主张如何回溯到 `.nimi/spec/**` |

## 怎么读

这些页面是 reference，不是教程或食谱。它们假设你已经理解了对应域的叙述，只是来查具体字段名、状态、所有者或合同。

术语不熟可从 [术语表](/zh/reference/glossary) 开始；想看走读，回到对应产品章节。

## 权威

每条 reference 条目都来自 `.nimi/spec/**`。当一条 reference 与 kernel 规则不一致时，以 kernel 规则为准并修订 reference。Reference **不发明**字段或合同，只是把规范已经记录的东西呈现出来。

## 来源

- [`.nimi/spec/INDEX.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/INDEX.md)
