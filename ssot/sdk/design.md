---
title: Nimi SDK Design Contract
status: ACTIVE
created_at: 2026-02-24
updated_at: 2026-02-27
parent: INDEX.md
rules:
  - SDK 采用单包模型：只发布 `@nimiplatform/sdk`，能力通过稳定子路径暴露。
  - SDK 规范条款只在 `ssot/sdk/*` 维护；其他 SSOT 文档提及 SDK 时仅允许引用。
  - SDK 文档必须反映当前实现与测试事实，不接受“文档先行但实现缺失”。
  - SDK 对外失败语义固定为 `code + reasonCode + actionHint + source + details` 结构化错误。
---

# SDK 设计总合同（分类版）

## 1. 目标与边界

目标：定义 `@nimiplatform/sdk` 作为统一接入面的稳定合同。

边界：

1. SDK 负责对外接口、初始化体验、错误规范、导入边界。
2. SDK 不负责 runtime/realm 业务策略本身，只负责协议封装与调用体验。
3. SDK 不公开 `internal` 或 `generated` 私有实现路径。

## 2. 全局不变量

1. 单包发布不变量：`@nimiplatform/sdk` + 稳定子路径。
2. 初始化不变量：SDK 主入口为 `new Runtime(...)` / `new Realm(...)`，不提供单入口聚合初始化器。
3. 传输不变量：runtime transport 必须显式声明（`node-grpc` 或 `tauri-ipc`）。
4. 错误不变量：统一 `NimiError` 结构，不抛裸字符串作为最终对外错误。
5. 兼容性不变量：多模态能力以 runtime 合同为准，SDK 只做严格映射，不做静默降级。

## 3. 分类合同入口

1. 包导出与导入边界：`package-surface.md`
2. 客户端初始化体验：`client-init.md`
3. runtime 子路径：`runtime-contract.md`
4. realm 子路径：`realm-contract.md`
5. scope 子路径：`scope-contract.md`
6. ai-provider 子路径：`ai-provider-contract.md`
7. mod 子路径：`mod-contract.md`
8. 测试与门禁：`testing-gates.md`

## 4. 评审清单（用于后续讨论接口合理性）

1. 接入成本：新 app 是否只需最小配置即可稳定调用。
2. 边界清晰度：子路径职责是否清晰，是否存在跨域泄漏。
3. 失败可诊断性：错误码是否能直接指导修复动作。
4. 兼容一致性：本地/云端 provider 差异是否通过合同显式表达。
5. 可验证性：每项“支持”是否有对应测试与门禁。

## 5. Runtime 合同锚点（兼容历史引用）

`@nimiplatform/sdk/runtime` 的完整方法面、transport、幂等策略、错误映射与 workflow builder 细节，统一以 `runtime-contract.md` 为准。
