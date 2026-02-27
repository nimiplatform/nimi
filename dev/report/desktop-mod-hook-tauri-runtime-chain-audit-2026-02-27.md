# Desktop Mod/Hook/Tauri/Runtime 链路审计报告（2026-02-27）

- 审计日期：2026-02-27
- 审计范围：`apps/desktop`（含 `src` 与 `src-tauri`）
- 审计链路：
  1. `mod -> hook -> tauri -> runtime`
  2. `runtime config -> tauri -> runtime`
- 审计方式：仓内静态代码审计（证据化行号定位）

## 1. 结论摘要

- 综合结论：存在高优先级安全与治理风险，建议按 P0/P1 优先级修复后再视为“链路治理完成”。
- 主要风险集中在：
  1. mod entry 路径边界控制与加载顺序
  2. Tauri 全局 invoke 暴露导致 hook 权限旁路
  3. codegen sourceType 权限归一化错误
  4. 失败回滚与卸载清理不完整
  5. runtime config 读失败后自动写回风险

## 2. 关键发现（按严重度排序）

### P0-1 entry 路径越界与加载顺序问题（Critical）

`runtime_mod` manifest 解析阶段将 `entry` 直接拼接父目录生成 `entry_path`，未在该阶段做 canonical + base 限制；随后 JS 侧优先用 `import(entryPath)` 加载，而不是先走受限读取接口。

证据：
- `apps/desktop/src-tauri/src/runtime_mod/store.rs:257`
- `apps/desktop/src-tauri/src/runtime_mod/store.rs:260`
- `apps/desktop/src/runtime/mod/discovery/external/load-factory.ts:31`
- `apps/desktop/src/runtime/mod/discovery/module-loader.ts:149`
- 对比受限读取路径防护：
  - `apps/desktop/src-tauri/src/runtime_mod/store.rs:528`
  - `apps/desktop/src-tauri/src/runtime_mod/store.rs:548`

影响：
- 恶意 manifest 可通过绝对路径或 `../` 试图导向 mods 根目录外 JS。
- 当前“先 import 后 fallback readEntry”的顺序削弱了 `read_local_mod_entry` 的根目录防护价值。

### P0-2 hook 权限可被全局 Tauri invoke 旁路（Critical）

桌面窗口启用全局 Tauri 对象，默认 capability 为 `core:default`，且主进程注册了大量敏感命令。`runtime_bridge` 仅做 method allowlist，不校验调用者策略。

证据：
- `apps/desktop/src-tauri/tauri.conf.json:13`
- `apps/desktop/src-tauri/capabilities/default.json:6`
- `apps/desktop/src-tauri/src/main.rs:1009`
- `apps/desktop/src-tauri/src/runtime_bridge/unary.rs:29`
- `apps/desktop/src-tauri/src/runtime_bridge/generated/method_ids.rs:4`
- `sdk/src/runtime/transports/tauri-ipc/index.ts:43`

影响：
- 若 mod 与主 renderer 共上下文，可直接通过 `window.__TAURI__.core.invoke` 访问桥接命令，绕开 hook permission gateway。

### P1-1 codegen sourceType 在权限服务被降级为 sideload（High）

权限服务使用的 `normalizeSourceType` 缺失 `codegen` 分支，默认落入 `sideload`，与 `HookSourceType` 定义及默认 allowlist 不一致。

证据：
- `apps/desktop/src/runtime/hook/services/utils.ts:41`
- `apps/desktop/src/runtime/hook/services/permission-service.ts:26`
- `apps/desktop/src/runtime/hook/contracts/types.ts:7`
- `apps/desktop/src/runtime/hook/contracts/capabilities.ts:56`
- `apps/desktop/src/runtime/hook/contracts/capabilities.ts:99`

影响：
- codegen mod 可能获得超出预期的默认能力集合，破坏 T0/T1/T2 治理边界。

### P1-2 mod setup 失败无回滚（High）

在执行 `setup` 前已写入 sourceType、baseline/grant/denial 及 data capability；若 `setup` 抛错，未看到统一 rollback。

证据：
- `apps/desktop/src/runtime/mod/host/lifecycle-register.ts:45`
- `apps/desktop/src/runtime/mod/host/lifecycle-register.ts:55`
- `apps/desktop/src/runtime/mod/host/lifecycle.ts:155`

影响：
- 失败 mod 可残留权限状态与能力声明，造成后续行为不一致。

### P1-3 mod 卸载未统一清理 DataApi handler（High）

Data provider 注册写入 `DataApi.handlers`；卸载路径 `suspendMod` 仅清 registry/event/inter-mod/ui/permissions，未看到按 mod 维度回收 data handlers。

证据：
- `apps/desktop/src/runtime/hook/services/data-service.ts:78`
- `apps/desktop/src/runtime/hook/data-api/data-api.ts:5`
- `apps/desktop/src/runtime/hook/services/lifecycle-service.ts:51`
- `apps/desktop/src/runtime/mod/host/lifecycle-unregister.ts:81`

影响：
- teardown 不完整时可能形成“幽灵 data provider”。

### P1-4 runtime config 读失败后仍进入可写态（High）

bridge config 首次读取失败时，`runtimeBridgeReadyRef` 在 finally 中仍置 true；后续 state 变更可能触发自动 `setRuntimeBridgeConfig`。

证据：
- `apps/desktop/src/shell/renderer/features/runtime-config/runtime-config-panel-controller.ts:505`
- `apps/desktop/src/shell/renderer/features/runtime-config/runtime-config-panel-controller.ts:513`
- `apps/desktop/src/shell/renderer/features/runtime-config/runtime-config-panel-controller.ts:525`
- `apps/desktop/src/shell/renderer/features/runtime-config/runtime-config-panel-controller.ts:539`

影响：
- 可能把本地投影视图误写回 runtime config，产生配置漂移/覆盖。

### P2-1 local-runtime 解析失败自动降级 token-api（Medium）

当路由错误为 model/capability 缺失时，策略会自动 fallback 到 token-api（非显式 token-api override）。

证据：
- `apps/desktop/src/shell/renderer/infra/bootstrap/runtime-bootstrap-route-resolvers.ts:214`
- `apps/desktop/src/shell/renderer/infra/bootstrap/runtime-bootstrap-route-resolvers.ts:220`

影响：
- 在“强本地优先/隐私优先”预期下，可能出现未显式确认的云侧调用。

### P2-2 runtime config CLI 调用无超时与高频写放大（Medium）

`runtime_bridge_config_get/set` 通过外部 CLI 同步执行，`wait_with_output` 无超时，且面板存在 debounce 自动写回。

证据：
- `apps/desktop/src-tauri/src/runtime_bridge/daemon_manager.rs:421`
- `apps/desktop/src-tauri/src/runtime_bridge/daemon_manager.rs:429`
- `apps/desktop/src-tauri/src/runtime_bridge/daemon_manager.rs:477`
- `apps/desktop/src/shell/renderer/features/runtime-config/runtime-config-panel-controller.ts:536`

影响：
- CLI 卡住可能影响交互；高频编辑会触发频繁进程启动。

### P2-3 重复 modId 的载入赢家不稳定（Medium）

manifest 侧按 `id` 排序后，注册批处理通过 Map 去重，重复 modId 最终生效项依赖枚举/覆盖顺序。

证据：
- `apps/desktop/src-tauri/src/runtime_mod/store.rs:524`
- `apps/desktop/src/runtime/mod/registration.ts:81`

影响：
- 同 modId 多目录场景行为不稳定，易引入隐式漂移。

## 3. 链路核验结果

### 3.1 mod -> hook -> tauri -> runtime

关键路径已核验：
- bootstrap & sideload：
  - `apps/desktop/src/shell/renderer/infra/bootstrap/runtime-bootstrap-runtime-mods.ts:64`
  - `apps/desktop/src/runtime/mod/discovery/external/sideload.ts:11`
- register & permission：
  - `apps/desktop/src/runtime/mod/host/lifecycle-register.ts:10`
  - `apps/desktop/src/runtime/hook/services/permission-service.ts:15`
- hook 调 runtime：
  - `apps/desktop/src/runtime/hook/services/llm-service.ts:143`
  - `apps/desktop/src/runtime/llm-adapter/execution/runtime-ai-bridge.ts:83`
- tauri bridge：
  - `sdk/src/runtime/transports/tauri-ipc/index.ts:233`
  - `apps/desktop/src-tauri/src/runtime_bridge/mod.rs:79`

### 3.2 runtime config -> tauri -> runtime

关键路径已核验：
- renderer config panel：
  - `apps/desktop/src/shell/renderer/features/runtime-config/runtime-config-panel-controller.ts:495`
  - `apps/desktop/src/shell/renderer/features/runtime-config/runtime-bridge-config.ts:322`
- bridge 命令调用：
  - `apps/desktop/src/shell/renderer/bridge/runtime-bridge/runtime-daemon.ts:50`
- tauri runtime bridge：
  - `apps/desktop/src-tauri/src/runtime_bridge/mod.rs:129`
  - `apps/desktop/src-tauri/src/runtime_bridge/daemon_manager.rs:421`
  - `apps/desktop/src-tauri/src/runtime_bridge/daemon_manager.rs:425`

## 4. 优化建议（执行优先级）

### P0 立即执行

1. 将 sideload 入口加载改为“强制先走 `runtime_mod_read_local_entry` 再执行 blob import”，并在 manifest 解析阶段增加 entry canonical/base 校验。
2. 收紧 Tauri 能力边界：关闭全局 Tauri 或隔离 mod 执行上下文；对敏感命令增加 caller policy 校验。
3. 修复 `normalizeSourceType` 的 `codegen` 分支缺失并补充权限回归测试。

### P1 短期执行

1. 对 register 生命周期引入事务化回滚（setup 失败时恢复 sourceType/baseline/grant/denial/data capability）。
2. 在卸载/失败路径增加 DataApi provider 统一清理。
3. runtime config 读失败时禁止自动写回，直到成功读取基线配置。

### P2 中期执行

1. 为 local-runtime -> token-api fallback 增加显式策略开关（strict local mode）。
2. 为 runtime config CLI 调用增加超时与重试/取消机制，降低高频写放大。
3. 对重复 modId 冲突做显式检测与确定性策略（版本优先或强制报错）。

## 5. 测试与验证缺口

1. 未执行动态攻击验证（如越界 entry 构造、`window.__TAURI__` 直接调用 PoC）。
2. 未执行全量自动化回归，仅完成静态证据审计。
3. 建议新增用例：
   - sideload entry 越界拒绝用例
   - codegen sourceType 权限隔离用例
   - setup 失败回滚一致性用例
   - runtime config read-fail 不触发 write-back 用例

## 6. 审计边界说明

1. 本报告仅基于仓内代码状态（2026-02-27）形成。
2. 本报告不替代渗透测试、运行时沙箱隔离验证与生产环境合规审计。
