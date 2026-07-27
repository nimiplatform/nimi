# Platform Authority Index

## Canonical 容器(规范权威)

| 容器 | 覆盖面 |
|---|---|
| `.nimi/spec/platform/core-protocol.authority.yaml` | 架构分层/六原语协议层/L0 envelope/AI last-mile 与 scope/能力目录/协议错误码与审计事件边界/desktop-open intent/AI profile 选择策略 |
| `.nimi/spec/platform/app-ecosystem.authority.yaml` | agent 身份底座/app 权限与准入/本地与 macOS protected 准入/审计风险与反自证/开发者模式与脚手架保管/生态与提案/mod-extension 退役 |
| `.nimi/spec/platform/ui-design-system.authority.yaml` | 设计模式/kit 架构与公开面/agent-center 边界/material 与 motion/标准 shell 能力语义/设计表闭包 |
| `.nimi/spec/platform/product-lifecycle.authority.yaml` | 冷启动/首跑/产品控制记录/nimi_data 产权/本地配置治理/自更新与包发布/web 发布/一方集成与迁移 |
| `.nimi/spec/platform/governance-release.authority.yaml` | 许可/最终权威/发布承诺原则与降级失败语义 |
| `.nimi/spec/platform/simulator.authority.yaml` | Simulator 产品身份/选源协议/确定性状态引擎/浏览器效应边界/生产 bundle 隔离(M-10) |

机器行数据位于 `config/platform-*.yaml`，并明确声明为非权威 projection。
不得基于本索引推断权威；权威只在 canonical 容器。
