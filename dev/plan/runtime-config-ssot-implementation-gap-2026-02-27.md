# Runtime Config SSOT 实施差距清单（2026-02-27）

## 目标

将 `ssot/runtime/config-contract.md` 的合同要求落到 runtime / CLI / desktop / 文档全链路，并维护可验证的执行清单。

## 差距清单

| 合同项 | 当前实现 | 目标状态 | 执行动作 |
|---|---|---|---|
| 默认路径切换到 `~/.nimi/config.json` | 已在 runtime/desktop 切换 | 完成 | 持续回归测试 |
| 自动迁移 + 硬切换 | runtime 已实现迁移并删除旧路径 | 完成 | 增加集成测试覆盖 daemon 启动链 |
| `schemaVersion=1` 强约束 | runtime/CLI 已校验 | 完成 | 保持向后兼容新增字段策略 |
| secret policy（禁明文 `apiKey`） | runtime/CLI 已拒绝明文 | 完成 | 后续接入 `secretRef` |
| `nimi config init|get|set|validate|migrate` | 已实现并有单测 | 完成 | 补充 README 示例和错误码文档对齐 |
| CLI `set` 文件锁 + 原子写 | 已实现（lock + atomic write） | 完成 | 增加真实并发场景集成测试 |
| desktop 读写仅经 CLI | 已新增 tauri bridge `runtime_bridge_config_get/set` | 完成 | runtime-config panel 已切换为 bridge 读写（localStorage 仅保留 UI 偏好/派生态） |
| restart required 语义 | CLI `set` 返回 `CONFIG_RESTART_REQUIRED` | 完成 | desktop UI 增加显式重启提示（后续迭代） |
| 失败码统一落盘到错误字典 | 已完成（CLI/bridge reasonCode 与文档条目对齐） | 完成 | 持续维护新增 reasonCode 同步入表 |
| desktop 与 CLI 配置视图一致性 | runtime-config 面板已消费 bridge `get/set`，并对 runtime 配置域做投影持久化 | 完成 | 保持回归：新增 `runtime-bridge-config` 映射单测 |

## 执行顺序

1. 先修 runtime/CLI 合同实现与测试门禁。
2. 再修 desktop bridge 合同实现与 tauri 单测。
3. 最后修文档引用与 error-code 对齐，补集成证据到 `dev/report/`。

## 验证命令

```bash
cd runtime
go test ./internal/config -count=1
go test ./cmd/nimi -count=1

cd apps/desktop/src-tauri
cargo test runtime_bridge::daemon_manager::tests

cd ../..
pnpm -C apps/desktop exec tsc --noEmit
```
