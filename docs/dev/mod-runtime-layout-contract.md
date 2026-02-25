# desktop × nimi-mods 本地联调运行契约（No-Legacy）

状态：`active`  
更新时间：`2026-02-26`  
适用范围：`apps/desktop/` + 外部 `nimi-mods/` 本地联调

---

## 1. 目标

建立稳定、可审计、可自动化的本地联调闭环：

1. `nimi-mods` 作为唯一 mod 源码真源（外部独立仓）。
2. `desktop` 不再猜测 mod 路径，不保留 legacy fallback。
3. 开发态采用双终端手动流程，单 mod watch 粒度。
4. 产物路径、运行路径、manifest entry 三者强一致。

---

## 2. 决策冻结（No-Legacy）

1. `apps/desktop` 联调路径不做任何隐式 fallback 或路径猜测。
2. `NIMI_MODS_ROOT` 必填（绝对路径，不存在即失败）。
3. 开发态 `NIMI_RUNTIME_MODS_DIR` 必填（绝对路径，不存在即失败）。
4. 本地联调默认要求：`NIMI_RUNTIME_MODS_DIR == NIMI_MODS_ROOT`。

---

## 3. 环境变量契约

| 变量 | 用途 | 规则 |
|---|---|---|
| `NIMI_MODS_ROOT` | 外部 `nimi-mods` 源码根目录 | 必填；必须是已存在绝对路径 |
| `NIMI_RUNTIME_MODS_DIR` | `apps/desktop` runtime mod 发现目录 | 开发态必填；必须是已存在绝对路径 |

说明：

1. 开发态不允许隐式 fallback 到仓内目录。
2. release 仍使用 `app_data_dir/mods` 作为默认发现目录。

---

## 4. 构建契约（nimi-mods）

唯一构建入口：`nimi-mods/scripts/build-mod.mjs`

支持参数：

1. `--mod <id>`：构建单个 mod
2. `--all`：构建全部 mod
3. `--watch`：增量 watch 构建

统一产物约定：

1. 每个 mod 入口源码固定 `index.ts`
2. `manifest.entry` 固定 `./dist/mods/<mod>/index.js`
3. `check-mods.mjs` 校验 manifest/entry/dist 一致性

---

## 5. desktop 契约

1. `apps/desktop` 只负责 renderer/shell 启动与 runtime 加载。
2. 默认开发流程不自动拉起 `nimi-mods` watch（双终端手动）。
3. 启动前执行环境检查并输出生效路径：
`NIMI_MODS_ROOT` / `NIMI_RUNTIME_MODS_DIR`。
4. Tauri debug 模式下，缺失 `NIMI_RUNTIME_MODS_DIR` 直接失败。
5. runtime 读取本地 mod entry 时必须限制在 `NIMI_RUNTIME_MODS_DIR` 内。

---

## 6. 标准双终端流程（目标态）

```bash
# Terminal A (nimi-mods)
export NIMI_MODS_ROOT=/ABS/PATH/TO/nimi-mods
pnpm -C "$NIMI_MODS_ROOT" install
pnpm -C "$NIMI_MODS_ROOT" run watch -- --mod local-chat

# Terminal B (desktop)
export NIMI_MODS_ROOT=/ABS/PATH/TO/nimi-mods
export NIMI_RUNTIME_MODS_DIR="$NIMI_MODS_ROOT"
pnpm -C apps/desktop run dev:shell
```

---

## 7. 验收门禁

1. 未设置 `NIMI_MODS_ROOT` 时，`apps/desktop` 所有 mod 相关脚本 fail-fast。
2. 未设置 `NIMI_RUNTIME_MODS_DIR` 时，`apps/desktop` runtime（debug）fail-fast。
3. `pnpm -C $NIMI_MODS_ROOT run build -- --mod local-chat` 成功产出：
`dist/mods/local-chat/index.js`。
4. watch 模式下源码变更可触发增量构建。
5. `check-mods --require-dist` 能阻断 manifest 与 dist 漂移。
6. `prepare-default-mods` 能从 `NIMI_MODS_ROOT` 复制 manifest + dist。
7. `pnpm -C apps/desktop run smoke:mod:local-chat` 通过。

---

## 8. 故障排查矩阵

| 症状 | 原因 | 修复 |
|---|---|---|
| `Missing required env NIMI_MODS_ROOT` | 未设置 mods 根目录 | 导出绝对路径后重试 |
| `Missing required env NIMI_RUNTIME_MODS_DIR` | 未设置 runtime mods 目录 | 导出绝对路径后重试 |
| `NIMI_RUNTIME_MODS_DIR must equal NIMI_MODS_ROOT` | 本地联调目录不一致 | 将两者设为同一路径 |
| `manifest.entry mismatch` | manifest 入口未对齐统一约定 | 改为 `./dist/mods/<mod>/index.js` |
| `dev-mods-smoke failed` | env/构建/资源复制任一环节不一致 | 先按失败日志修复，再重新执行 smoke |
| apps/desktop 未加载新逻辑 | watcher 未更新 dist 产物 | 重新执行 watch/build 并 reload |
| `拒绝访问 mods 目录外的路径` | 传入了越界 entry 路径 | 修复 manifest entry 或调用参数 |

---

## 9. 非目标

1. 本轮不做 `NIMI_HOME/NIMI_ASSET_HOME` 全局持久化并轨。
2. 本轮不做 runtime/realm 架构变更。
3. 本轮不引入 legacy 兼容窗口或自动迁移脚本。
