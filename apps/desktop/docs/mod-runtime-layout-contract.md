# Desktop Runtime Mod Layout Contract

状态：`active`  
更新时间：`2026-03-11`  
适用范围：`apps/desktop/` 作为零内置 mod host 的本地开发、安装与运行

---

## 1. 目标

建立稳定、可审计、可独立仓协作的 mod host 契约：

1. `desktop` 发布包零内置 mod，不再复制或同步外部 mod 资源。
2. `desktop` 只认已安装 runtime mods 目录，不扫描 `nimi-mods` 或任何源码仓作为 fallback。
3. 外部 mod 仓独立构建，desktop 只消费预构建包或已安装目录。
4. manifest、入口脚本、样式资产、安装目录四者显式对齐。

---

## 2. 决策冻结（Zero-Bundle / No-Legacy）

1. `apps/desktop` 不再使用 legacy desktop-mods root env。
2. Desktop 固定核心配置目录 `nimi_dir=~/.nimi`，默认数据目录 `nimi_data_dir=~/.nimi/data`。
3. installed mod 目录固定为 `{nimi_data_dir}/mods`；开发态 `NIMI_RUNTIME_MODS_DIR` 只作为会话级 override。
4. 不允许把源码仓直接当作 desktop 的产品输入；本地开发使用 symlink、开发安装或直接复制到 runtime mods 目录。
5. remote install 只接受预构建 mod 目录或 `.zip` 包，desktop 不承担源码构建。

---

## 3. 环境变量与发现契约

| 变量 | 用途 | 规则 |
|---|---|---|
| `NIMI_RUNTIME_MODS_DIR` | Desktop 默认 installed mods 目录的会话级 override | 仅用于内部调试 / CI；如设置则必须是绝对路径 |

说明：

1. 未设置 `NIMI_RUNTIME_MODS_DIR` 时，desktop 运行时默认 installed 目录为 `{nimi_data_dir}/mods`。
2. 本地 manifest 扫描只发生在 runtime mods 目录内。
3. runtime 读取 entry/style 资产时必须限制在对应 mod 安装目录内。

---

## 4. Mod 包契约

预构建 mod 包必须包含：

1. `mod.manifest.yaml|yml|json`
2. `manifest.entry` 指向可执行的构建产物
3. 可选 `manifest.styles[]`，每个条目指向需要在 load/unload 时注入/回收的样式资产

目录形态允许：

1. 已安装目录
2. 单层包裹目录的 `.zip`
3. 远程 `.zip` URL

GitHub-first catalog 发布同时要求 sidecar `release.manifest.json`：

1. 该文件与 `.zip` 一起作为 release 资产发布，不放入 zip 内部
2. 字段固定为 package/release/signer/publisher/source/state 元数据
3. desktop catalog install / update 先验证 sidecar 元数据、digest、signature、compat、revocation，再进入本地安装流水线

desktop 会在安装期解包、定位 package root、验证 manifest，并写入 runtime mods 目录。

---

## 5. Desktop Host 契约

1. `apps/desktop` 只负责 manifest 扫描、安装生命周期、entry 读取、样式注入、运行时注册与审计。
2. Tauri backend 是 mod 文件系统生命周期唯一 owner：install、update、uninstall、read-manifest、install-progress。
3. catalog 读取、release 校验、digest/signature/revocation gate 也由 Tauri backend 承担，renderer 不直接信任远程 catalog JSON。
4. renderer 不再依赖 Tailwind 对外部 mod 源码的编译期扫描；mod 样式只通过 `manifest.styles[]` 动态注入。
5. 已安装用户 mod 统一按 `sideload` 能力模型运行；显式本地开发态才使用 `local-dev`。

---

## 6. 本地开发流程

```bash
# Terminal A (independent mod repo)
pnpm install
pnpm run build -- --mod my-custom-mod
ln -s /ABS/PATH/TO/my-mod/dist-package /ABS/PATH/TO/runtime-mods/my-custom-mod

# Desktop App
# Settings > Mod Developer > Add Dev Source
# 然后选择 /ABS/PATH/TO/runtime-mods
```

也可把预构建目录或 `.zip` 安装到 Desktop 当前的 installed mods 目录（默认 `{nimi_data_dir}/mods`，或被 `NIMI_RUNTIME_MODS_DIR` 临时 override 的目录）。

---

## 7. 验收门禁

1. 未设置 `NIMI_RUNTIME_MODS_DIR` 时，desktop 使用默认 `{nimi_data_dir}/mods` 且可在零 mod 状态正常启动。
2. 运行 `pnpm -C apps/desktop run smoke:mods` 时，只校验 runtime mods 目录中的已安装包。
3. 运行 `pnpm -C apps/desktop run smoke:mod:installed` 时，可验证任意单个已安装 mod 的 manifest 与 entry 完整性。
4. 安装目录删除、卸载、更新后，本地发现结果与 shell 状态同步刷新。
5. 卸载 mod 后，动态注入的样式必须被回收。

---

## 8. 故障排查矩阵

| 症状 | 原因 | 修复 |
|---|---|---|
| `Missing required env NIMI_RUNTIME_MODS_DIR` | 调试脚本缺失 runtime mods 目录 | 导出绝对路径后重试 |
| `No installed runtime mods found` | runtime mods 目录为空 | 安装、复制或 symlink 任意预构建 mod |
| `mod 包中未找到 manifest` | 目录或 zip 结构不合法 | 将 manifest 放在根目录或唯一子目录 |
| `仅支持 .zip 预构建 mod 包` | 远程或本地 archive 不是 zip | 改为预构建 `.zip` 包 |
| `拒绝访问 mods 目录外的路径` | manifest entry/styles 越界 | 修复 manifest 中的相对路径 |
| 卸载后样式残留 | styles 资产未在 manifest 中声明或清理链失败 | 校验 `styles[]` 并重新加载 mod |

---

## 9. 非目标

1. 本轮不定义外部 mod 仓内部构建系统。
2. 本轮不为 catalog 引入源码拉取与本地编译。
3. 本轮不恢复 bundled/default mods 路径或 legacy desktop-mods root env 兼容窗口。
