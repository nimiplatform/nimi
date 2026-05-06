# Mod Hub

Mod Hub 是桌面端的单页 mod 商店：发现、安装、更新、卸载、管理已安装 mod — 全在一页。目录是 GitHub-first 静态目录；安装链有 8 阶段治理。

## Mod Hub 露出什么

| 功能 | 行为 |
| --- | --- |
| 目录 | GitHub-first 静态 mod 目录 |
| 发现 | 浏览、搜索、过滤 mod |
| 安装 | 8 阶段治理安装链 |
| 更新 | 更新已安装 mod |
| 卸载 | 移除已安装 mod |
| 已安装列表 | 本地已装 mod 文件夹管理视图 |

Mod Hub 是 **mod 管理的唯一一等入口**。没有「浏览 → 已安装」两段流；一页搞定全部。

## 8 阶段治理安装链

用户安装 mod 时，安装过 8 个准入阶段。每阶段有自己的闸口；任一阶段失败 fail-close。

| 阶段 | 用途 |
| --- | --- |
| 1 | 目录闸口 — mod 在目录里被准入 |
| 2 | 再次同意 — 用户同意安装 |
| 3 | 能力 tier 检查 — mod 声明的 tier 可准入 |
| 4 | 来源校验 — 来源核验 |
| 5 | 下载 | 在准入来源下拉取 |
| 6 | 校验 | Checksum / 签名校验 |
| 7 | 所有权连续性 — `mod id` 全局唯一 |
| 8 | 公告 / 撤销 — 最终准入 / 撤销检查 |

试图安装一个（比如）所有权连续性闸口失败的 mod 的用户拿到一条类型化错误 — `mod id` 跟另一个已安装来源冲突。安装**不**静默覆盖。

## Mod 来源注册表

| 来源种类 | 出处 | 谁准入 |
| --- | --- | --- |
| `installed` | 来自准入目录 | 目录准入 |
| `dev` | 显式注册的文件系统路径 | 用户显式注册 |

用户只能加 `dev` 来源；不能加任意 `installed` 来源。`dev` 来源需要开发者模式 + 用户注册过的文件系统路径。

`mod id` 在所有启用来源中全局唯一。`mod id` 跟 `installed` mod 冲突的 `dev` 来源 fail-close。

## 顶级 Mods 标签行为

边栏的拼图图标导航到 Mod Hub。`enableModUi=false`（网页端）时，标签不可见，用户回退到聊天。网页端**不**静默暴露 mod 面。

## 阅读场景：从目录安装 mod

你在 Mod Hub 浏览，找到喜欢的 mod。

1. **点安装。** Mod Hub 启动 8 阶段链。
2. **目录闸口。** 阶段 1 准入 mod（它在目录里）。
3. **同意。** 阶段 2 询问你的同意。
4. **能力 tier。** 阶段 3 检查 mod 声明的能力 tier；在你的准入 tier 内则继续。
5. **来源校验。** 阶段 4 核验来源。
6. **下载。** 阶段 5 拉取。
7. **校验。** 阶段 6 检查 checksum。
8. **所有权连续性。** 阶段 7 确认 `mod id` 唯一性。
9. **公告 / 撤销。** 阶段 8 最终准入。
10. **已安装。** Mod 被注册。Mod Workspace 标签为它可用。

每阶段都是闸口。任一阶段失败停止安装。

## 阅读场景：移除冲突 mod

你试图安装一个 `mod id` 跟已装 mod 冲突的 mod。

1. **阶段 1-6 通过。**
2. **阶段 7 失败。** 所有权连续性违规：`mod id` 已经存在。
3. **安装中止。** 类型化错误：「mod id 跟 X 冲突」。
4. **没静默覆盖。** 你已有的 mod 被保留。

冲突解决是显式的；用户挑要保留哪一个。

## 阅读场景：加 dev 来源

你在本地开发一个 mod。

1. **启用开发者模式。** 在设置里；作为类型化用户偏好被准入。
2. **注册文件系统路径。** 作为 `dev` 来源。
3. **Mod 加载。** 那个路径下的 mod 变成 `dev` 来源 mod，按相同 8 阶段链处理（针对 `dev` 来源做相应调整）。
4. **热重载。** Mod 源的改动可在 mod 开发合同下被拾起。

Dev 来源不是目录；它们是显式准入的本地路径。

## 来源

- [`.nimi/spec/desktop/mod-hub.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/mod-hub.md)
- [`.nimi/spec/desktop/mods-panel.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/mods-panel.md)
- [`.nimi/spec/desktop/mod-development.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/mod-development.md)
- [`.nimi/spec/desktop/kernel/mod-governance-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/mod-governance-contract.md)
- [`.nimi/spec/desktop/kernel/tables/mod-kernel-stages.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/tables/mod-kernel-stages.yaml)
- [`.nimi/spec/desktop/kernel/tables/mod-lifecycle-states.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/tables/mod-lifecycle-states.yaml)
- [`.nimi/spec/desktop/kernel/tables/mod-access-modes.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/tables/mod-access-modes.yaml)
