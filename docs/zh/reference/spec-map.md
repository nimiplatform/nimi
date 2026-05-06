# Spec Map

公开文档为人写。Spec map 给那些要把公开声明追回它的源权威、或想直接 navigate spec 的读者。

## 公开 section 与源区域

| 公开 section | 主源区域 |
| --- | --- |
| Platform | `.nimi/spec/platform/**` |
| Runtime | `.nimi/spec/runtime/**` |
| SDK | `.nimi/spec/sdk/**` |
| Desktop 与 Web | `.nimi/spec/desktop/**` |
| Realm | `.nimi/spec/realm/**` |
| Avatar | `.nimi/spec/avatar/**` |
| Cognition | `.nimi/spec/cognition/**` |
| Nimi Coding | `.nimi/spec/product-scope.yaml`、`.nimi/spec/bootstrap-state.yaml`、`.nimi/methodology/**`、`.nimi/contracts/**` |

Spec 组织为 kernel + 域 layout。Kernel 目录是单一真相来源；域文件是阅读辅助、**不**该重新定义 kernel 规则。

## 规则 ID 家族

Kernel 用域前缀规则标识。看到规则引用的读者能不靠猜定位拥有 kernel：

| 前缀 | 拥有者 |
| --- | --- |
| `P-*` | Platform |
| `K-*` | Runtime |
| `S-*` | SDK |
| `D-*` | Desktop |
| `R-*` | Realm |
| `F-*` | 未来能力 backlog |

Runtime 内部，子家族如 `K-WF-*`（工作流）、`K-STREAM-*`（流式）、`K-MMPROV-*`（多模态 Provider）、`K-DELEG-*`（委派能力）、`K-AGCORE-*`（Agent 参与）标识规则属于哪个合同。

## 阅读 tips

- 如要跨域任务式阅读路径，从 `.nimi/spec/INDEX.md` 起。
- 如知道要哪个域，从相关 kernel `index.md` 起。
- Kernel 的 `tables/` 目录是结构化事实来源给枚举（状态、错误码、能力）；公开文档抽象列表时，表是字面答案。
- Kernel 的 `generated/` 目录是自动生成视图。它们**不是**权威来源；原始合同是。

## 生成与私有面

生成文档、build 输出、依赖目录、私有 owner 面**不是**公开文档权威。它们能提供证据或实现上下文，但**不**静默变成公开产品真相的来源。

私有仓库（比如 `nimi-realm/.nimi/spec/**` 给后端、dashboard、创作者侧权威，与 `nimi-mods/spec/**` 给 mods workspace 权威）只在公开文档里按名引用、**不**按内容引用。那些公开提及是放置信息；它们**不**把私有权威升格进公开文档。

## 来源

- [`.nimi/spec/INDEX.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/INDEX.md)
- [`.nimi/spec/_meta/spec-generation-audit.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/_meta/spec-generation-audit.yaml)
- [`.nimi/spec/generated/nimi-spec.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/generated/nimi-spec.md)
