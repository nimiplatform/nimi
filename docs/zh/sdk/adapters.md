# 适配器

SDK vNext 将框架适配器放在 base `@nimiplatform/sdk` package 之外。适配器是迁移桥和框架投影，不拥有 Runtime 路由、Realm 真值或 SDK core API 语义。

旧的 `@nimiplatform/sdk/ai-provider` 子路径已删除。它必须 fail closed，不能转发到 vNext 适配器。

## 当前适配器姿态

| 适配器 | Package / 边界 | 角色 |
| --- | --- | --- |
| Vercel AI | `@nimiplatform/sdk-adapter-vercel-ai` | 将 Vercel Language Model 调用映射到 Nimi AI/runtime 语义 |
| OpenAI-compatible | `sdks/typescript/adapters/openai-compatible` 下的 SDK adapter source root | OpenAI-compatible chat completion 形状的迁移桥 |
| MCP / Next / React / LangGraph / LlamaIndex / Mastra | `sdks/typescript/adapters/*` 下的 adapter source root | 集成投影，不是 base SDK 子路径 |

适配器可以依赖 `@nimiplatform/sdk/ai`、`@nimiplatform/sdk/ai-runner`、
`@nimiplatform/sdk/runtime` 或 feature module。它不能恢复已删除的 base SDK 子路径。

## 边界

| 关注点 | Owner |
| --- | --- |
| Runtime 路由、provider readiness、审计 | Runtime |
| SDK core AI request/response 语义 | `@nimiplatform/sdk/ai` |
| AI runner 编排语义 | `@nimiplatform/sdk/ai-runner` |
| 框架调用形状映射 | Adapter package |
| OpenAI-compatible request/response bridge | OpenAI-compatible adapter boundary |

适配器遇到不支持的框架能力必须 fail closed。它不得伪造成功、发明 provider capability，也不得绕过 Runtime readiness。

## 场景：Vercel AI 迁移

使用 Vercel AI 的 App 应安装独立 adapter package，并显式保留 base SDK 依赖：

```ts
import { createNimiVercelAiModel } from '@nimiplatform/sdk-adapter-vercel-ai';
import { createNimiClient } from '@nimiplatform/sdk';
```

适配器把 Vercel 调用形状映射到 Nimi 的 AI/runtime surface。Runtime 仍拥有路由和执行，适配器只拥有框架投影。

## 场景：OpenAI-compatible 迁移桥

已有 OpenAI-compatible chat-completion 调用点的 App 可以通过 OpenAI-compatible adapter boundary 迁移。这个桥只在明确支持的范围内保留兼容形状。不支持的 OpenAI-compatible 特性会返回强类型失败，而不是掉到 raw Runtime 或 provider-native bypass。

## 来源依据

- [`.nimi/spec/sdks/feature-clients.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/feature-clients.authority.yaml)
- [`.nimi/spec/sdks/client-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/client-core.authority.yaml)
- [`config/sdks-adapter-source-roots.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/sdks-adapter-source-roots.yaml)
- [`config/sdks-typescript-adapter-capability-ledger.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/sdks-typescript-adapter-capability-ledger.yaml)
