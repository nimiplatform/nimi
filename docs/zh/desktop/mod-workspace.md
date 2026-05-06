# Mod Workspace

Mod Workspace 是桌面端里 mod 扩展 UI 渲染的地方。每个安装的 mod 拿一个标签；mod 失败时标签被 `fused`（断路）。Mod codegen 与 runtime mod 面板都住在同一个 workspace 家族。

## Mod Workspace 提供什么

| 面 | 行为 |
| --- | --- |
| Mod-UI 标签 | 每个安装的 mod 在自己的标签里渲染 |
| 标签生命周期 | `enable | disable | uninstall` |
| 断路器 | 失败的 mod 拿 `fused` 标记；标签隔离失败 |
| 渲染层 | 渲染层无关；mod **不**直接耦合浏览器 |

Workspace 标签是真实的隔离边界。在标签里失败的 mod **不**会让桌面端崩；断路器把标签 fuse 掉。

## Mod 生命周期

| 转换 | 行为 |
| --- | --- |
| `enable` | Mod 标签变活跃；mod 跑 |
| `disable` | Mod 标签暂停；mod 加载但不跑 |
| `uninstall` | Mod 标签移除；mod 取消注册 |
| 失败 → `fused` | 断路器把标签 fuse；用户可重试或卸载 |

失败断路掉**标签**，不是整个桌面端。这就是装实验性 mod 安全的原因。

## Mod Codegen

Mod Codegen 是 workspace 里的一个面，在受控执行 kernel 下生成新 mod 脚手架代码。

| 性质 | 值 |
| --- | --- |
| 执行 kernel | 受控 |
| 能力 tier 白名单 | 准入 |
| Hook 能力校验 | 准入 |
| 输出 | 在能力 tier 下的 mod 脚手架 |

用 Codegen 脚手架 mod 的开发者拿到的类型化 boilerplate 已经符合准入的能力 tier 与 hook 能力白名单。这就是让「写新 mod」**不**需要深入平台知识的原因。

## Runtime Mod 面板

Mod 有 runtime 侧关注（AI 依赖、runtime 能力分配）时，runtime mod 面板把那些关注露出。这是桌面端 mod workspace 跟 Runtime config 之间的跨域桥。

## 阅读场景：Mod 标签失败

你装的 mod 因 bug 崩了。

1. **Mod 标签跑。** 失败前活跃。
2. **检测到失败。** Mod 抛出未处理异常或没满足准入不变量。
3. **断路器触发。** 标签被标 `fused`。
4. **桌面端继续。** 桌面端别的面不受影响。其他 mod 继续跑。
5. **用户选项。** 用户可以尝试重载标签（清掉 fuse）、禁用 mod、或卸载。

一个有 bug 的 mod **不**会让桌面端瘫掉。Fuse 是隔离边界。

## 阅读场景：开发者用 Codegen 创建新 mod

开发者想脚手架一个响应聊天轮次的新 mod。

1. **打开 Mod Codegen。** 在 workspace。
2. **挑模板。** 一个 turn-hook 反应式 mod 模板。
3. **能力 tier。** Codegen 提供准入能力 tier；开发者挑合适的。
4. **生成。** Codegen 产出脚手架代码，hook 能力已预校验。
5. **开发。** 开发者在准入合同下扩展脚手架。
6. **注册为 dev 来源。** 在开发者模式下加路径。
7. **Mod 在 workspace 跑。** 新 mod 出现为标签。

Codegen 脚手架让准入合同成为默认；自由格式偏离在结构上被劝退。

## 阅读场景：跟 Runtime AI 依赖说话的 mod

某个 mod 需要一个要求特定 runtime 配置的 AI 能力。

1. **Mod 声明依赖。** 作为 manifest 的一部分，mod 声明它需要的 runtime AI 能力。
2. **Runtime mod 面板露出。** Runtime mod 面板显示依赖状态。
3. **解析。** 通过准入解析流（Provider 选择、Model 绑定），依赖变可用。
4. **Mod 跑。** Mod 的能力现在可达。

Mod **没**自建 runtime 配置路径；runtime mod 面板是准入的桥。

## Workspace **不**做什么

| 关注 | 为什么不 |
| --- | --- |
| 让 mod 旁路进原生 runtime | Mod 只消费宿主注入能力 |
| 让 mod 直接跟浏览器说话 | 渲染层无关外壳；无直接浏览器访问 |
| 让 mod 不走 Realm 合同就改 Realm 真相 | Realm 合同是规范化修改的唯一路径 |

## 来源

- [`.nimi/spec/desktop/mod-workspace.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/mod-workspace.md)
- [`.nimi/spec/desktop/mod-codegen.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/mod-codegen.md)
- [`.nimi/spec/desktop/mod-development.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/mod-development.md)
- [`.nimi/spec/desktop/kernel/mod-governance-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/mod-governance-contract.md)
- [`.nimi/spec/desktop/kernel/hook-capability-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/hook-capability-contract.md)
- [`.nimi/spec/desktop/kernel/tables/hook-capability-allowlists.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/tables/hook-capability-allowlists.yaml)
- [`.nimi/spec/desktop/kernel/tables/ui-slots.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/tables/ui-slots.yaml)
- [`.nimi/spec/desktop/kernel/tables/mod-access-modes.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/tables/mod-access-modes.yaml)
