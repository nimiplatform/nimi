---
title: Nimi SDK SSOT Index
status: ACTIVE
updated_at: 2026-02-26
rules:
  - 本目录以 `sdk/package.json` 的 exports 与 `sdk/src/*` 当前实现为事实来源。
  - 未在代码中落地的能力不得写成已实现；必须标注 `FUTURE`。
  - SDK 接口变更必须同步更新本目录分类文档与测试门禁文档。
---

# SDK SSOT 分类索引

## 1. 文档定位

`ssot/sdk/` 是 `@nimiplatform/sdk` 的接口与体验唯一真相目录。

目标：把原先单一 `design.md` 拆成按职责分类的合同，便于逐块审查接口合理性。

## 2. 阅读顺序

1. `design.md`：SDK 总体边界与全局不变量
2. `package-surface.md`：包导出面与导入边界
3. `client-init.md`：`createNimiClient` 接入体验
4. `runtime-contract.md`：`@nimiplatform/sdk/runtime` 合同
5. `realm-contract.md`：`@nimiplatform/sdk/realm` 合同
6. `scope-contract.md`：`@nimiplatform/sdk/scope` 合同
7. `ai-provider-contract.md`：`@nimiplatform/sdk/ai-provider` 合同
8. `mod-contract.md`：`@nimiplatform/sdk/mod/*` 合同
9. `testing-gates.md`：测试矩阵与验收门禁

## 3. 当前稳定导出面（事实）

来自 `sdk/package.json`：

- 根入口：`.`
- 一级子路径：`./realm`、`./runtime`、`./types`、`./scope`、`./ai-provider`
- mod 子路径：`./mod/ai`、`./mod/hook`、`./mod/types`、`./mod/ui`、`./mod/logging`、`./mod/i18n`、`./mod/settings`、`./mod/utils`、`./mod/model-options`、`./mod/runtime-route`、`./mod/host`

总计 17 个导出子路径（含根入口）。

## 4. 维护策略

1. 任何 SDK 对外签名变更，先改本目录对应分类文档，再改实现。
2. 新增子路径时，必须新增分类文档并补齐 `testing-gates.md` 对应验收条目。
3. `design.md` 只保留全局不变量，不再承载各模块细节。
