# Architecture Contract

> Owner Domain: `P-ARCH-*`

## P-ARCH-001 — 六层架构定义

Nimi 平台采用固定六层架构：nimi-realm（云端持久世界）、nimi-runtime（本地 AI 运行时）、nimi-sdk（开发者接口层）、desktop（第一方应用）、nimi-hook（desktop mod 接口层）、nimi-mods（desktop 内小程序）。nimi-apps 为独立应用总称。

## P-ARCH-002 — 层间通信规则

`MUST`: Realm 与 Runtime 并列互不依赖，通过 SDK 桥接。App 通过 `@nimiplatform/sdk` 统一接入。Mods 通过 nimi-hook 访问能力。通信协议固定：Realm=REST+WS，Runtime=gRPC。

## P-ARCH-003 — Realm 职责边界

`MUST`: Realm 是持久世界的共享真相源。职责域：auth、social、chat、economy、world、agent、memory（云端）、audit（云端）。六原语的语义执行与真相源锁定在 Realm。

## P-ARCH-004 — Runtime 职责边界

`MUST`: Runtime 是独立本地后台进程。职责域：AI 推理（全模态）、AI 路由（local-runtime/token-api）、进程管理、模型管理、Workflow DAG、GPU 仲裁、本地数据层、知识库、Credential Plane、MCP Server、审计（本地）、App 间通信、App 授权网关。

## P-ARCH-005 — No-Legacy 执行口径

`MUST`: 架构口径固定为单一目标态。数据口径采用 reset-first。执行模式采用 AI-first。不引入长期双轨并存。

## P-ARCH-010 — V1 执行栈冻结

`MUST`: 本地模型面：LocalAI + Nexa。远程模型面：nimiLLM。路由面：local-runtime | token-api 显式路由，不允许静默 fallback。凭证面：token-api 默认走请求期凭证注入。编排面：Workflow DAG 独立能力。实现语言固定 Go。

## P-ARCH-011 — Credential Plane 双平面

`MUST`: daemon-config plane（由 `ai.providers.*.apiKeyEnv` 驱动）与 request-credential plane（受信宿主请求期注入）不可在同一请求混用。Runtime 在 managed connector 路径下承担 `connectorId -> secret` 解析（`K-CONN-001` / `K-KEYSRC-004`），在 inline 路径下消费请求期凭据注入。

## P-ARCH-020 — SDK 统一入口

`MUST`: SDK 是开发者接入平台的唯一入口。Desktop 与第三方 app 用完全相同的 SDK API。Transport profiles: node-grpc, tauri-ipc, local-broker(FUTURE)。

## P-ARCH-021 — Desktop 定位

`MUST`: Desktop 是平台旗舰应用，架构上无特殊地位。独有特性：nimi-hook、Core UI、Runtime Console、App Store 入口。

## P-ARCH-030 — 审计双层模型

`MUST`: runtime 本地审计（AI 调用/模型操作/App 通信/授权链路）与 realm 云端审计（业务操作/合规）独立运行。本地审计可选上报云端聚合。
