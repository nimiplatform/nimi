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

## S-MOD-010 Source-Type Coordination

source-type 与 capability 分级需要与 desktop hook allowlist 一致。

## S-MOD-011 Inter-Mod Runtime Bridge

inter-mod 与 runtime app messaging 的桥接语义必须可追溯且不破坏边界。

> **Phase 2 deferred**：`RuntimeAppService`（`app_service_projection`）为 Phase 2 服务，桥接语义定义推迟至该服务投影就绪时补充。当前仅约束边界不可突破，具体协议待定。
