# 规范地图

把公开文档的章节对应到规范源区，方便从公开声明追回到原始权威源，或直接在规范里导航。

## 公开章节与源区对应

| 公开章节 | 主源区 |
| --- | --- |
| 平台 | `.nimi/spec/platform/**` |
| Runtime | `.nimi/spec/runtime/**` |
| SDK | `.nimi/spec/sdks/**` |
| 桌面端与网页端 | `.nimi/spec/desktop/**` |
| Realm | 外部 Realm authority；本仓库只保留 `docs/spec/realm-readme.md` 与 `docs/spec/realm-external-anchor.md` 指针，并通过 `.nimi/spec/sdks/**` 的 consumer contracts 接入 |
| Avatar | `.nimi/spec/avatar/**` |
| Nimi Coding | `nimi-coding/spec/product-scope.yaml`、`nimi-coding/spec/_meta/spec-tree-model.yaml`、`nimi-coding/methodology/**`、`nimi-coding/contracts/**`、`nimi-coding/config/**` |

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
| `F-*` | 保留 / 历史 future backlog anchor，不在 active spec 权威内 |

Runtime 内部还有子族：`K-STREAM-*`（流式）、`K-MMPROV-*`（多模态 provider）、`K-DELEG-*`（可选委派能力）、`K-AGCORE-*`（LocalAgent 接入），用来标明规则归哪个契约。

## 阅读建议

- 需要跨域、按任务形状阅读：从 `docs/spec/INDEX.md` 开始。
- 已知所属域：从对应 kernel 的 `index.md` 开始。
- kernel 的 `tables/` 目录是结构化事实源，里面是状态、错误码、能力的枚举；公开文档抽象的列表，原文就是这些表。
- 生成 spec 视图通过
  `pnpm exec nimicoding generate-spec-derived-docs --profile nimi --scope <scope>`
  按需渲染到 stdout，不再作为 `.nimi/spec/**` 下的 tracked 文件。

## 生成视图与私有面

生成的文档、构建产物、依赖目录、私有归属面不是公开文档权威。它们提供证据或实现语境，但不会悄悄变成公开产品真相。

私有实现工作区不通过公开文档描述拓扑。Realm 相关公开文档只可引用已准入的公开投影面，不暴露私有仓库布局、source checkout 形态或实现归属路径。

## 来源依据

- [`docs/spec/INDEX.md`](https://github.com/nimiplatform/nimi/blob/main/docs/spec/INDEX.md)
- `pnpm exec nimicoding generate-spec-derived-docs --profile nimi --scope spec-human-doc`
