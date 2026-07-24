# Platform Kernel — Migrated Domain Index

本域契约散文与表已全量迁入 canonical authority(S6 域 5,2026-07-24)。

## Canonical 容器(规范权威)

| 容器 | 覆盖面 |
|---|---|
| `.nimi/spec/canonical/platform/admission.authority.yaml` | spec 准入标准(可准入/硬拒绝类、O1-O3 迁移义务、R1-R6 执行规则) |
| `.nimi/spec/canonical/platform/testing-discipline.authority.yaml` | 测试纪律(ready 后固化 / bug 回归探测两形态) |
| `.nimi/spec/canonical/platform/core-protocol.authority.yaml` | 架构分层/六原语协议层/L0 envelope/AI last-mile 与 scope/能力目录/协议错误码与审计事件边界/desktop-open intent/AI profile 选择策略 |
| `.nimi/spec/canonical/platform/app-ecosystem.authority.yaml` | agent 身份底座/app 权限与准入/本地与 macOS protected 准入/审计风险与反自证/开发者模式与脚手架保管/生态与提案/mod-extension 退役 |
| `.nimi/spec/canonical/platform/ui-design-system.authority.yaml` | 设计模式/kit 架构与公开面/agent-center 边界/material 与 motion/标准 shell 能力语义/设计表闭包 |
| `.nimi/spec/canonical/platform/product-lifecycle.authority.yaml` | 冷启动/首跑/产品控制记录/nimi_data 产权/本地配置治理/自更新与包发布/web 发布/一方集成与迁移 |
| `.nimi/spec/canonical/platform/authority-admission.authority.yaml` | app-slice 与 package 权威准入边界(含 realm 投影委托边界的引用式条款) |
| `.nimi/spec/canonical/platform/governance-release.authority.yaml` | 许可/最终权威/发布承诺原则与降级失败语义 |
| `.nimi/spec/canonical/platform/simulator.authority.yaml` | Simulator 产品身份/选源协议/确定性状态引擎/浏览器效应边界/生产 bundle 隔离(M-10) |

原文散文见 `docs/authority/platform-*-rationale.md`(非规范);机器行数据见 `config/platform-*.yaml`(头注声明非权威);desktop-open 金向量为 `scripts/testdata/desktop-open-intent-golden-vectors.yaml`(普通 fixture)。

## 冻结邻接素材(零改动保留)

- `tables/delegated-projection-admissions.yaml` — realm 冻结,处置权 = realm 合流包(.nimi/spec/realm 委托投影保管声明)。
- `tables/protected-local-executable-trust-sets.yaml` — protected-local 冻结家族成员(runtime 冻结六件套以带锚点路径字符串引用其身份),处置权 = dev-kernel 解缠包;语义已由 app-ecosystem 容器覆盖。

不得基于本索引推断权威;权威只在 canonical 容器。
