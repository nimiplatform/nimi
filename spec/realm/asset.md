# Asset Public Boundary

> Domain: Realm / Asset

## 0. Normative Imports

| Kernel Location | Rule IDs |
|---|---|
| `kernel/boundary-vocabulary-contract.md` | R-BOUND-004, R-BOUND-010 |
| `kernel/asset-contract.md` | R-ASSET-001, R-ASSET-010, R-ASSET-011, R-ASSET-012, R-ASSET-020 |

## 1. Scope

Asset 在 public 范围提供跨域可依赖边界，承载创作者个人可发布资产与其发布历史（R-BOUND-004, R-ASSET-001）。

## 2. 有意薄桩声明

本文件为有意薄桩（intentional thin stub）。Asset 域的实现规则（存储布局、审核/风控、搜索排序、版本清理策略）定义在闭源 nimi-realm 仓库。本文件仅承载公共边界词汇与 `NovelAsset` 最小合同引用，不包含域特有增量规则。

公共词汇定义见 `kernel/tables/public-vocabulary.yaml`（asset 域）。
`NovelAsset` 类型与字段见 `kernel/tables/realm-asset-types.yaml`。

## 3. 非目标

本文件不定义：内部存储布局、审核风控策略、检索排序算法、冷热分层与归档清理实现。
