# SDK Mod Contract

> Owner Domain: `S-MOD-*`

## S-MOD-001 Host Injection Only

mod 子路径必须通过 host 注入 facade 访问平台能力。

## S-MOD-002 Inter-Mod Messaging Semantics

inter-mod 消息语义必须保持低延迟、同进程、可观测。

## S-MOD-003 Private Client Prohibition

mod 子路径不得直连 runtime/realm 私有客户端。

## S-MOD-004 Stable Export Surface

mod 导出面必须使用稳定子路径，不允许 root forwarding 壳层扩散。
当前稳定的 mod storage surface 包括：

- `createHookClient(...).storage`
- `@nimiplatform/sdk/mod/storage`

其中 `@nimiplatform/sdk/mod/storage` 可以提供基于 host sqlite 的 convenience facade（例如 `createModKvStore(...)`），但不得扩展为新的 desktop hook subsystem 或新的宿主 capability。

以下 legacy surface 已硬切移除，不得回流：

- 旧的 mod AI 专用子路径
- 旧的 AI client 构造入口与公开类型
- 旧的 LLM hook capability 键
- 旧的 runtime route hint / override 字段
- 旧的 speech provider-list / stream-control surface

执行命令：

- `pnpm check:runtime-mod-hook-hardcut`

## S-MOD-005 Hook Lifecycle Boundary

hook 注册/注销语义必须与 desktop 执行内核对齐。

## S-MOD-006 Shell Facade Boundary

公开的 mod shell 能力必须通过 renderer-agnostic facade 暴露，不得将宿主实现细节发布为稳定 contract。

稳定公开的 shell/lifecycle surface 仅允许：

- `@nimiplatform/sdk/mod/shell`
- `@nimiplatform/sdk/mod/lifecycle`

其中：

- `mod/shell` 只允许暴露 shell-owned 的 auth、bootstrap、navigation、runtimeFields、statusBanner facade。
- `mod/shell` 如暴露 conversation capability selection/projection，只允许遵循 `runtime-route-contract.md`（`S-RUNTIME-074` ~ `S-RUNTIME-078`）与 `conversation-capability-contract.md`（`D-LLM-015` ~ `D-LLM-021`）的 host-owned typed surface；不得让 mod 获得 route truth owner 身份。
- `mod/lifecycle` 只允许暴露 route runtime lifecycle，不得暴露 package lifecycle。
- route runtime lifecycle 的公开作用域固定为 `tabId`，不得退化为 `modId`。

以下 same-tree 专属 surface 不得再作为稳定公开 contract：

- `@nimiplatform/sdk/mod/ui`
- 任意 shared React tree / shared context / shared Zustand store 入口
- 任意 shared DOM / shared CSS cascade 假设

future isolated host 必须兼容同一 `mod/shell` 和 `tabId`-scoped `mod/lifecycle` contract。

## S-MOD-010 Source-Type Coordination

source-type 与 capability 分级需要与 desktop hook allowlist 一致。

## S-MOD-011 Inter-Mod Runtime Bridge

inter-mod 与 runtime app messaging 的桥接语义必须可追溯且不破坏边界。

> **Phase 2 deferred**：`RuntimeAppService`（`app_service_projection`）为 Phase 2 服务，桥接语义定义推迟至该服务投影就绪时补充。当前仅约束边界不可突破，具体协议待定。

## S-MOD-012 Local AI Profile Contract

mod 如需声明本地 AI 推荐安装方案，公开 manifest contract 必须使用 `manifest.ai.profiles`，不得再以 `manifest.ai.dependencies` 作为用户-facing 主契约。

- `ai.profiles[]` 是用户可理解、可安装的推荐组合单位。
- profile 必须至少包含：
  - `id`
  - `title`
  - `recommended`
  - `consumeCapabilities[]`
  - `entries[]`
- `entries[]` 允许声明：
  - `model`
  - `artifact`
  - `service`
  - `node`
- profile 命名完全自定义；SDK contract 不内建高/中/低枚举。

## S-MOD-013 Local AI Install Request Boundary

mod-facing 本地 AI profile 安装必须通过 host-injected facade 发起“请求安装”，不得暴露静默直接安装 contract。

- 允许的稳定 facade 语义：
  - `runtime.local.listProfiles()`
  - `runtime.local.requestProfileInstall(...)`
  - `runtime.local.getProfileInstallStatus(...)`
- host 必须保留最终确认权。
- profile 解析可在内部归一化为执行计划，但执行计划不是 mod manifest 的公开 contract。

## S-MOD-014 World Evolution Engine Host-Injected Facade Boundary

mod-facing World Evolution Engine typed facade candidates may be exposed only through host-injected logical facades that preserve the same downstream consumer seam admitted for apps.

Allowed mod-facing candidate families are limited to:

- observe family
- selector-read family
- request family

These candidates must reuse the shared selector / result / rejection framing defined by `world-evolution-engine-consumer-contract.md` (`S-RUNTIME-092` through `S-RUNTIME-095`).

They must not:

- expose host bridge concrete method lists, IPC payloads, or subscription plumbing as stable mod contract
- expose workflow DAG / task / node / output vocabulary as mod-facing truth
- expose direct commit authorization, direct history append, or direct canonical world-state mutation success semantics
- depend on mod-private bypass clients, host-private singletons, or shared renderer state as contract authority

## S-MOD-015 World Evolution Engine Mod-Facing Selector-Read Publication Profile

Mod-facing stable selector-read publication may exist only through a host-injected World Evolution Engine facade or equivalent stable host-injected surface that preserves the same semantic matrix as the app-facing SDK publication.

The stable mod-facing logical namespace is fixed to `worldEvolution`.
The stable mod-facing logical operations are fixed to:

- `worldEvolution.executionEvents.read(selector)`
- `worldEvolution.replays.read(selector)`
- `worldEvolution.checkpoints.read(selector)`
- `worldEvolution.supervision.read(selector)`
- `worldEvolution.commitRequests.read(selector)`

These mod-facing logical methods must preserve the shared semantic matrix defined by `world-evolution-engine-consumer-contract.md` (`S-RUNTIME-097` through `S-RUNTIME-101`).

Mod-facing selector-read publication may differ from app-facing publication only by access path and host injection boundary.
It must not differ by:

- method-category names
- selector semantics
- read-result semantics
- rejection categories

Mod-facing selector-read publication must not add:

- host-only selector primitives
- host-private rejection categories
- observe or subscribe siblings
- effectful request siblings
- host concrete API semantics or IPC payload contracts
