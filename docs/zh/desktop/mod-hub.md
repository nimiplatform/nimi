# Mod Hub

Mod Hub 是桌面端的单页 Mod 商店：发现、安装、更新、卸载、管理已装 Mod，全在一处。目录是 GitHub 优先的静态目录；安装链路有八阶段治理。

## Mod Hub 呈现的内容

| 能力 | 行为 |
| --- | --- |
| 目录 | GitHub 优先的静态 Mod 目录 |
| 发现 | 浏览、搜索、筛选 Mod |
| 安装 | 走八阶段治理的安装链路 |
| 更新 | 更新一个已装 Mod |
| 卸载 | 移除一个已装 Mod |
| 已装列表 | 本地已装 Mod 目录的管理视图 |

Mod Hub 是 **Mod 管理的唯一一等入口**。这里没有「商店」与「已装」分开两段的流程，一页统一处理。

## 八阶段治理的安装链路

用户安装 Mod 时，会走完八个准入阶段。每个阶段有独立的 gate；任意阶段失败就 fail-closed。

| 阶段 | 用途 |
| --- | --- |
| 1 | 目录 gate —— Mod 在准入目录中 |
| 2 | 二次同意 —— 用户同意安装 |
| 3 | 能力级别校验 —— Mod 声明的级别是否准入 |
| 4 | 来源校验 —— 出处验证 |
| 5 | 下载 —— 在准入源下取包 |
| 6 | 校验 —— 校验和 / 签名验证 |
| 7 | 归属连续性 —— `mod id` 全局唯一 |
| 8 | 通告 / 撤销 —— 终审准入或撤销 |

如果某个 Mod 的 `mod id` 与已装 Mod 冲突，安装会在第 7 阶段以强类型错误终止：「`mod id` 与 X 冲突」。安装不会静默覆盖。

## Mod 来源注册表

| 来源类型 | 出处 | 谁来准入 |
| --- | --- | --- |
| `installed` | 来自准入目录 | 目录准入 |
| `dev` | 用户显式注册的本地路径 | 用户显式注册 |

用户只能添加 `dev` 来源，不能添加任意 `installed` 来源。`dev` 来源需要先打开开发模式，再注册一个本地路径。

`mod id` 在所有启用的来源之间全局唯一。`dev` 来源若与 `installed` Mod 的 `mod id` 冲突，fail-closed。

## 顶部 Mod Tab 的行为

侧边栏拼图图标进入 Mod Hub。当 `enableModUi=false`（网页端）时，Tab 不可见，用户回到聊天，不会偷偷露出 Mod 面。

## 场景：从目录安装一个 Mod

你在 Mod Hub 浏览，看到一个想要的 Mod。

1. **点安装**。Mod Hub 启动八阶段链路。
2. **目录 gate**。第 1 阶段确认 Mod 在目录中。
3. **同意**。第 2 阶段请求你的同意。
4. **能力级别**。第 3 阶段核对声明的级别是否在你准入的范围。
5. **来源校验**。第 4 阶段验证出处。
6. **下载**。第 5 阶段拉包。
7. **校验**。第 6 阶段核对校验和。
8. **归属连续性**。第 7 阶段确认 `mod id` 唯一。
9. **通告 / 撤销**。第 8 阶段终审。
10. **已装**。Mod 注册完成，对应的 Mod Workspace Tab 可用。

每个阶段都是 gate，任意一个失败都会停下整条安装链。

## 场景：装到一半遇到冲突

你试图安装一个 Mod，它的 `mod id` 与已装 Mod 冲突。

1. **第 1 到第 6 阶段通过**。
2. **第 7 阶段失败**。归属连续性违规：`mod id` 已存在。
3. **安装中止**。强类型错误：「mod id 与 X 冲突」。
4. **不静默覆盖**。原 Mod 完整保留。

冲突的解决是显式的，由用户自己挑要保留哪一个。

## 场景：注册一个 dev 来源

你在本地开发一个 Mod。

1. **打开开发模式**。在设置里，准入为强类型用户偏好。
2. **注册一个本地路径**。作为 `dev` 来源。
3. **Mod 加载**。该路径下的 Mod 进入 `dev` 来源，按相同的八阶段链路（针对 `dev` 出处做相应调整）。
4. **热重载**。Mod 源码的改动可以按 Mod 开发契约被识别。

`dev` 来源不是目录的一部分；它是显式准入的本地路径。

## Source Basis

- [`.nimi/spec/desktop/mod-hub.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/mod-hub.md)
- [`.nimi/spec/desktop/mods-panel.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/mods-panel.md)
- [`.nimi/spec/desktop/mod-development.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/mod-development.md)
- [`.nimi/spec/desktop/kernel/mod-governance-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/mod-governance-contract.md)
- [`.nimi/spec/desktop/kernel/tables/mod-kernel-stages.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/tables/mod-kernel-stages.yaml)
- [`.nimi/spec/desktop/kernel/tables/mod-lifecycle-states.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/tables/mod-lifecycle-states.yaml)
- [`.nimi/spec/desktop/kernel/tables/mod-access-modes.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/tables/mod-access-modes.yaml)
