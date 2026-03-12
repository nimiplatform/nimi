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

- 解析 `ModManifest`（id、version、capabilities、dependencies、entry、styles、iconAsset?）。
- `permissions` 字段已硬切退役；manifest/runtime registration 只允许 `capabilities`，不得保留 legacy permissions alias。
- 检查 `nimi.minVersion` / `nimi.maxVersion` 约束。
- `styles[]` 如存在，必须是包内相对路径，并在 load/unload 生命周期中由 host 注入和回收。
- `iconAsset` 如存在，必须是包内相对 SVG 路径；不得是 URL、绝对路径或 `..` 逃逸路径。
- 失败：输出决策记录，不进入下一阶段。

执行命令：

- `pnpm check:no-legacy-mod-permissions-field`

## D-MOD-003 — Signature/Auth 阶段

验证 mod 来源元数据与供应链声明：

- `local-dev` mode：跳过 catalog release 校验，按本地开发信任模型执行。
- `sideload` mode：手动 path / URL 安装仍可跳过 catalog gate，但不得获得额外 capability 特权。
- `catalog` mode：必须在安装前校验 digest、signature、compatibility、revocation；失败直接拒绝。
- 发布者、digest、signature、catalog provenance 不得提升 capability 白名单，只影响安装许可、审计和 UI 风险提示。
- 成功：状态 → `VERIFIED`。

**信任假设**：本地文件系统仍按 `local-dev` / `sideload` 信任模型执行；GitHub-first catalog 额外提供 release sidecar、digest、signature、revocation gate，但不会形成 capability 特权模式。

## D-MOD-004 — Dependency/Build 阶段

解析依赖并验证预构建 mod 包：

- 解析 `manifest.dependencies` 列表。
- 验证所有依赖已注册或可用。**（Phase 2 detail — Phase 1 mod 无跨 mod 依赖，此阶段执行空依赖校验后直接通过）**
- Desktop 安装流只接受预构建目录或 `.zip` 包，不接受源码仓 tarball 或在 host 侧执行构建。
- catalog 发布必须同时提供 sidecar `release.manifest.json` 作为签名与版本校验对象。
- 若 manifest 声明 `iconAsset`，打包与 catalog 发布必须携带对应静态 SVG 资产；Desktop 不得内置特定 mod 图标作为替代真相源。
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
- 如声明 `manifest.iconAsset`，host 只可读取该 manifest 明确声明的图标资源用于展示；不得扫描仓目录或内置官方 mod 图标表。
- 在沙箱环境中执行 mod 注册。

## D-MOD-007 — Lifecycle 阶段

执行生命周期迁移：

- `enable`：`INSTALLED` / `DISABLED` → `ENABLED`
- `disable`：`ENABLED` → `DISABLED`
- `uninstall`：`INSTALLED` / `DISABLED` → `UNINSTALLED`
- `update`：`ENABLED` → `UPDATING` → `ENABLED`（注册失败时必须尝试回滚到上一已安装版本；失败时 → `ROLLBACK_DISABLED`）
- catalog install/update 如命中 `community` trust tier、trust tier 降级、capability 增量或 advisory review，必须返回结构化 `consentReasons[]`；其中 capability 增量必须返回 `addedCapabilities[]`
- 满足上述 re-consent 条件时，安装产物可落盘，但 Desktop 不得自动重新启用 mod，必须等待用户重新确认

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
- Desktop 不得内置任何特定 mod 的图标资产或 `mod id -> icon` 映射；mod 图标必须由 mod 包或 catalog 元数据提供。
- `nimi-mods` 或其他外部 mod 仓只可作为可选测试/开发输入，不得成为 Desktop 产品依赖。
- 第三方 mod 作者面对的是 Desktop App，而不是 monorepo 内部脚本或路径约定。

## D-MOD-013 — Mod Source Directory Registry

Desktop 必须维护一个显式注册的 mod source directory 列表，而不是扫描固定仓路径：

- `nimi_dir` 固定为 `~/.nimi`，只保存核心配置。
- `nimi_data_dir` 默认是 `~/.nimi/data`，installed mod 目录固定为 `{nimi_data_dir}/mods`。
- Desktop 只允许 1 个 Desktop-managed installed source；用户不能新增、编辑或删除 installed source。
- 用户可在 App 内添加额外 `dev` source directories。
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
- `nimi_data_dir` 必须在 App 内可配置；切换后立即生效，但 Desktop 不得自动迁移旧数据，只能提示用户手动复制。
- 启动参数、环境变量、CLI 或手工 symlink 只允许作为内部调试/测试路径，不得成为第三方作者主流程。
- 第三方作者唯一需要的终端操作应发生在自己的 mod 仓中，例如 `pnpm dev`、`pnpm test`、`pnpm pack`。

## D-MOD-016 — Catalog 发布真相源与可见性

Mod 发布资产与 Mod Hub 可见性必须解耦：

- `nimi-mods` 仅可作为官方 mod 的源码/验证工作区，不得被 Desktop 当作 Mod Hub 真相源扫描。
- 对 external / official package，Desktop Mod Hub 的可见性必须来自独立 catalog 发布面，而不是 source repo 文件树或 release asset 枚举。
- catalog 化 release 必须发布不可变 `.zip` 与 sidecar `release.manifest.json`。
- 仅有 GitHub Release 资产不足以视为“已上架”；对应 catalog 记录合并并对外发布后，Desktop 才可将其视为可发现/可安装目标。

## D-MOD-017 — 第三方包所有权边界

第三方 package 默认采用 listing 模式，而不是源码合入模式：

- 第三方 package 的 source of truth 必须保留在作者控制的 source repo 中。
- `verified` 或 `community` trust tier 不得要求第三方源码强制并入 `nimi-mods`。
- catalog repo 只负责 listing、trust tier、revocation、advisory 和 release index，不改变第三方 package ownership。
- 同一 `packageId` 的后续 release 必须保持 ownership continuity；若 ownership 存疑，Desktop 侧 catalog install/update 必须 fail-close。

## D-MOD-018 — Trust Tier 分配语义

Catalog trust tier 固定为 `official | verified | community`，其分配语义必须满足：

- `official` 仅适用于 Nimi 控制的 package、发布链路与 signer identity。
- `verified` 仅适用于通过发布者身份与 signer continuity 审查的第三方 package。
- `community` 适用于通过基础 listing 审查但未获得完整 identity verification 的第三方 package。
- trust tier 只影响 listing、安装确认、更新策略和风险提示；不得提升 capability 白名单，也不得绕过 `D-MOD-005` / `D-MOD-003` 的策略与校验。

## D-MOD-019 — 第三方更新复审与风险处置

第三方 package 的后续 catalog 更新必须满足持续治理要求：

- 新版本必须沿用同一 `packageId` ownership 边界，通过 catalog repo 更新 release record，而不是改写历史 release。
- signer 变更、publisher ownership 变更、material capability increase 或 trust tier 变更时，必须重新进入治理复审。
- 已上架 package 的风险处置必须通过 `revocations.json`、`advisories.json` 或 package/release state overlay 完成，而不是删除既有 release 历史。
- 命中 revocation 或 advisory `block` 的 release 不得继续作为 install/update 候选。

## Fact Sources

- `tables/mod-kernel-stages.yaml` — 8 阶段枚举
- `tables/mod-lifecycle-states.yaml` — 生命周期状态
- `tables/mod-access-modes.yaml` — 访问模式
