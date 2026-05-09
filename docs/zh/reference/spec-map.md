# 规范地图

把公开文档的章节对应到规范源区，方便从公开声明追回到原始权威源，或直接在规范里导航。

## 公开章节与源区对应

| 公开章节 | 主源区 |
| --- | --- |
| 平台 | `.nimi/spec/platform/**` |
| Runtime | `.nimi/spec/runtime/**` |
| SDK | `.nimi/spec/sdk/**` |
| 桌面端与网页端 | `.nimi/spec/desktop/**` |
| Realm | `.nimi/spec/realm/**` |
| Avatar | `.nimi/spec/avatar/**` |
| Cognition | `.nimi/spec/cognition/**` |
| Nimi Coding | `.nimi/spec/product-scope.yaml`、`.nimi/spec/bootstrap-state.yaml`、`.nimi/methodology/**`、`.nimi/contracts/**` |

规范按 kernel + domain 排布。kernel 目录是单一真相源；domain 文件只是辅助阅读，不能重定义 kernel 规则。

## 规则 ID 族

kernel 用带域前缀的规则 ID。看到一条规则引用，就能直接定位归属 kernel：

| 前缀 | 归属 |
| --- | --- |
| `P-*` | 平台 |
| `K-*` | Runtime |
| `S-*` | SDK |
| `D-*` | 桌面端 |
| `R-*` | Realm |
| `F-*` | 未来能力 backlog |

Runtime 内部还有子族：`K-WF-*`（工作流）、`K-STREAM-*`（流式）、`K-MMPROV-*`（多模态 provider）、`K-DELEG-*`（委派能力）、`K-AGCORE-*`（Agent 接入），用来标明规则归哪个契约。

## 阅读建议

- 需要跨域、按任务形状阅读：从 `.nimi/spec/INDEX.md` 开始。
- 已知所属域：从对应 kernel 的 `index.md` 开始。
- kernel 的 `tables/` 目录是结构化事实源，里面是状态、错误码、能力的枚举；公开文档抽象的列表，原文就是这些表。
- kernel 的 `generated/` 目录是自动生成视图，不是权威源；权威是产生它的契约。

## 生成视图与私有面

生成的文档、构建产物、依赖目录、私有归属面不是公开文档权威。它们提供证据或实现语境，但不会悄悄变成公开产品真相。

私有仓（例如 `nimi-realm/.nimi/spec/**` 承载后端 / dashboard / 创作者侧权威，`nimi-mods/spec/**` 承载 mods 工作区权威）只在公开文档里按名字提及，不带内容。这些提及只说明位置，不会把私有权威带进公开文档。

## 来源依据

- [`.nimi/spec/INDEX.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/INDEX.md)
- [`.nimi/spec/_meta/spec-generation-audit.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/_meta/spec-generation-audit.yaml)
- [`.nimi/spec/generated/nimi-spec.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/generated/nimi-spec.md)
