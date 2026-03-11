# Mod Governance Contract

> Authority: Desktop Kernel

## Scope

Desktop Mod 治理契约。定义 8 阶段执行内核、2 种访问模式、8 种生命周期状态、决策记录和审计要求。

## D-MOD-001 — Discovery 阶段

定位 mod 包并验证源引用：

- 输入：`DiscoverInput`（modId、version、mode、source）。
- 验证：source ref 存在性、mod ID 格式。
- 成功：状态 → `DISCOVERED`。

## D-MOD-002 — Manifest/Compat 阶段

解析清单并检查兼容性：

- 解析 `ModManifest`（id、version、capabilities、dependencies、entry、styles）。
- `permissions` 字段已硬切退役；manifest/runtime registration 只允许 `capabilities`，不得保留 legacy permissions alias。
- 检查 `nimi.minVersion` / `nimi.maxVersion` 约束。
- `styles[]` 如存在，必须是包内相对路径，并在 load/unload 生命周期中由 host 注入和回收。
- 失败：输出决策记录，不进入下一阶段。

执行命令：

- `pnpm check:no-legacy-mod-permissions-field`

## D-MOD-003 — Signature/Auth 阶段

验证 mod 来源元数据与供应链声明：

- `local-dev` / `sideload` mode：Phase 1 不执行签名门禁。
- 发布者、digest、signature、catalog provenance 如存在，只用于审计和 UI 风险提示，不得提升 capability 白名单。
- 成功：状态 → `VERIFIED`。

**Phase 1 信任假设**：Phase 1 假设桌面端用户对本地文件系统有完全控制权。`local-dev` 和 `sideload` 的完全信任等价于用户自行安装本地软件的信任模型。此假设的安全影响：任何有权写入本地 mod 目录的进程可注入 mod，获得 `sideload` 级别的全部能力（`D-HOOK-007` 白名单：event.pub、data.query、ui、inter-mod.req、LLM、action、audit、meta），但仍受 Runtime token authz 正交约束（`D-MOD-011`）。后续如引入签名基础设施，仍只能影响供应链提示与审计，不得形成“官方 mod”特权模式。

## D-MOD-004 — Dependency/Build 阶段

解析依赖并验证预构建 mod 包：

- 解析 `manifest.dependencies` 列表。
- 验证所有依赖已注册或可用。**（Phase 2 detail — Phase 1 mod 无跨 mod 依赖，此阶段执行空依赖校验后直接通过）**
- Desktop 安装流只接受预构建目录或 `.zip` 包，不接受源码仓 tarball 或在 host 侧执行构建。
- 成功：状态 → `INSTALLED`。

## D-MOD-005 — Sandbox/Policy 阶段

评估 capability 策略和沙箱约束：

- 解析 `requestedCapabilities`。
- 根据 `sourceType` → `AccessMode` 映射查找允许的能力白名单（参考 `D-HOOK-007`）。
- Grant ref 验证（如提供 `grantRef`）。
- 决策结果：`ALLOW`、`ALLOW_WITH_WARNING`、`DENY`。

**正交性说明**：Mod capability 检查是 renderer 本地门控，在 mod 调用 SDK 方法前执行。此机制与 Runtime K-GRANT token 授权正交——即使 mod 通过 Desktop capability 检查，其 SDK 请求仍需通过 Runtime K-DAEMON-005 authz 拦截器的 token 验证。两层各自独立执行，不存在绕过关系。

## D-MOD-006 — Load 阶段

加载 mod 入口到运行时上下文：

- 读取 `manifest.entry` 指向的源码。
- 如声明 `manifest.styles[]`，host 必须在 mod 启用时注入样式、在禁用/卸载时回收样式。
- 在沙箱环境中执行 mod 注册。

## D-MOD-007 — Lifecycle 阶段

执行生命周期迁移：

- `enable`：`INSTALLED` / `DISABLED` → `ENABLED`
- `disable`：`ENABLED` → `DISABLED`
- `uninstall`：`INSTALLED` / `DISABLED` → `UNINSTALLED`
- `update`：`ENABLED` → `UPDATING` → `ENABLED`（失败时 → `ROLLBACK_DISABLED`）

## D-MOD-008 — Audit 阶段

写入审计决策记录：

- `DecisionRecord`：decisionId、modId、version、stage、result、reasonCodes、createdAt。
- `LocalAuditRecord`：id、modId、stage、eventType、decision、reasonCodes、payload、occurredAt。
- 每个 kernel stage 完成后必须产出至少一条审计记录。

## D-MOD-009 — Access Mode 策略

2 种访问模式的能力约束：

| Mode | 签名要求 | 能力白名单映射 | 信任级别 |
|---|---|---|---|
| `local-dev` | 无 | 按 sourceType 查表 | high |
| `sideload` | 无 | `sideload` 白名单 | low |

## D-MOD-010 — Decision Result 语义

- `ALLOW`：通过，进入下一阶段。
- `ALLOW_WITH_WARNING`：通过但记录警告 reason codes。
- `DENY`：拒绝，终止流水线，记录拒绝原因。

## D-MOD-011 — Mod 信任边界声明

Runtime 对 Mod 无感知。所有 mod 发起的 SDK 请求在 Runtime 视角等同于 Desktop 用户操作。

**信任模型**：
- **Desktop 层**（D-MOD-005）：capability sandbox 是唯一的 mod 隔离机制。Mod 调用 SDK 方法前必须通过 capability 检查。
- **Runtime 层**（K-DAEMON-005 authz 拦截器）：按 token 级别验证权限（AppMode + Scope），不区分请求来源是用户操作还是 mod 操作。
- **两层正交**：即使 mod 通过 Desktop capability 检查，其 SDK 请求仍需通过 Runtime token 授权。反之亦然。

**安全含义**：
- Desktop renderer 层 sandbox 被绕过时，Runtime 无法阻止携带有效 token 的请求。
- Phase 1 跳过签名验证（D-MOD-003），`local-dev` 和 `sideload` 模式的 mod 完全受信任。
- 此信任模型是**设计意图**：Runtime 的安全职责是 token 级授权，不是调用来源鉴别。来源鉴别是 Desktop 层职责。

## D-MOD-012 — Desktop 作为零内置 Mod Host

Desktop App 的产品定位是第三方 mod 的运行、开发与测试宿主，不是 `apps/desktop` 源码仓私有联调工具。

- Desktop 发布产物必须保持 zero-bundle：不得内置任何特定 mod。
- `nimi-mods` 或其他外部 mod 仓只可作为可选测试/开发输入，不得成为 Desktop 产品依赖。
- 第三方 mod 作者面对的是 Desktop App，而不是 monorepo 内部脚本或路径约定。

## D-MOD-013 — Mod Source Directory Registry

Desktop 必须维护一个显式注册的 mod source directory 列表，而不是扫描固定仓路径：

- 默认安装目录：`~/.nimi/mods`。
- 用户可在 App 内添加额外 source directories。
- 每个 source directory 必须声明类型：`installed` 或 `dev`。
- source directory 类型只影响展示、reload 和管理行为，不影响冲突裁决。
- Desktop 不得自动猜测、递归扫描或隐式加入未注册目录。

## D-MOD-014 — Mod ID 全局唯一与冲突 Fail-Close

在所有已启用 source directories 的合并视图中，`mod id` 必须全局唯一：

- 只要发现同一个 `mod id` 在两个或以上 source directories 中同时出现，Desktop 必须将该 `mod id` 标记为 `conflict`。
- 冲突态下，Desktop 不得自动挑选优先级，也不得让 `dev` 覆盖 `installed`。
- 冲突 mod 必须拒绝加载，并输出结构化诊断：`mod id`、冲突目录列表、manifest 路径。
- 该 fail-close 策略优先于“最佳努力加载”，以保证第三方开发态可诊断性。

## D-MOD-015 — 第三方开发流程边界

面向第三方 mod 作者的 Desktop 开发流程必须满足 UI-only host 原则：

- Desktop 侧所有开发相关操作必须可以在 App 界面内完成，例如：开启 Developer Mode、添加 dev 目录、查看冲突、触发 reload、查看日志。
- 启动参数、环境变量、CLI 或手工 symlink 只允许作为内部调试/测试路径，不得成为第三方作者主流程。
- 第三方作者唯一需要的终端操作应发生在自己的 mod 仓中，例如 `pnpm dev`、`pnpm test`、`pnpm pack`。

## Fact Sources

- `tables/mod-kernel-stages.yaml` — 8 阶段枚举
- `tables/mod-lifecycle-states.yaml` — 生命周期状态
- `tables/mod-access-modes.yaml` — 访问模式
