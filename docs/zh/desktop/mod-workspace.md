# Mod Workspace

Mod Workspace 是桌面端里 Mod 扩展 UI 的渲染所在。每个已装 Mod 拿一个 Tab，单个 Mod 异常时 Tab 会被 `fused`（断路）。Mod 代码生成与 Runtime Mod 面板都属于这一族 workspace。

## Mod Workspace 提供的能力

| 面 | 行为 |
| --- | --- |
| Mod UI Tab | 每个已装 Mod 单独一 Tab |
| Tab 生命周期 | `enable`、`disable`、`uninstall` |
| 断路 | 出问题的 Mod 标记为 `fused`，故障被隔离在 Tab 内 |
| 渲染层 | 渲染层无关，Mod 不直接耦合浏览器 |

Tab 是真实的隔离边界。Mod 在 Tab 内崩溃不会超出桌面端的性能承载，断路器把 Tab 熔断。

## Mod 生命周期

| 转移 | 行为 |
| --- | --- |
| `enable` | Mod Tab 转为活动状态，Mod 运行 |
| `disable` | Mod Tab 暂停，Mod 已加载但不运行 |
| `uninstall` | Mod Tab 移除，Mod 解除注册 |
| 失败 → `fused` | 断路器熔断 Tab，用户可选择重试或卸载 |

失败熔断的是**这一个 Tab**，不是整个桌面端。这一点是装载实验性 Mod 仍然安全的根据。

## Mod 代码生成

Mod Codegen 是 workspace 里的一个面，用来在受控执行 kernel 下生成新 Mod 的脚手架代码。

| 属性 | 取值 |
| --- | --- |
| 执行 kernel | 受控 |
| 能力级别白名单 | 准入 |
| Hook 能力校验 | 准入 |
| 输出 | 在能力级别下的 Mod 脚手架 |

开发者用 Codegen 起一个 Mod 时，获取的是已经符合准入能力级别和 Hook 能力白名单的强类型骨架。这一点让「写一个新 Mod」不必要求深层的平台知识。

## Runtime Mod 面板

如果 Mod 牵涉 Runtime 一侧的事项（AI 依赖、Runtime 能力分配），Runtime Mod 面板会把这些事项呈现出来。这是桌面端 Mod workspace 与 Runtime Config 之间的跨域桥。

## 场景：某个 Mod Tab 崩了

你装的某个 Mod 因为 bug 崩溃。

1. **Mod Tab 运行中**。崩溃前一直是活动状态。
2. **检测到失败**。Mod 抛出未处理异常，或违反某条准入不变式。
3. **断路器触发**。Tab 标记为 `fused`。
4. **桌面端继续运行**。其他面与其他 Mod 不受影响。
5. **用户的选项**。重新加载（清掉熔断）、停用、卸载，三选一。

一个有 bug 的 Mod 不会超出桌面端的性能承载。熔断就是隔离边界。

## 场景：用 Codegen 起一个新 Mod

某开发者想做一个对聊天回合做反应的 Mod。

1. **打开 Mod Codegen**。在 workspace 里。
2. **挑模板**。挑一个 turn-hook 反应式 Mod 模板。
3. **能力级别**。Codegen 列出准入的级别，开发者挑合适的一档。
4. **生成**。Codegen 输出脚手架代码，Hook 能力已经预先验证过。
5. **开发**。在准入契约下扩展脚手架。
6. **注册为 dev 来源**。在开发模式下添加路径。
7. **Mod 在 workspace 中运行**。新 Mod 呈现为一个 Tab。

Codegen 让准入契约成为默认值，自由偏离在结构上就被压住了。

## 场景：Mod 依赖 Runtime AI 能力

某个 Mod 需要一项 AI 能力，要求特定的 Runtime 配置。

1. **Mod 声明依赖**。在 manifest 里声明它需要的 Runtime AI 能力。
2. **Runtime Mod 面板呈现**。面板显示依赖的当前状态。
3. **完成解析**。在准入流程里（provider 选择、模型绑定）完成解析。
4. **Mod 运行**。这一项能力对 Mod 可达。

Mod 没有自己发明 Runtime 配置路径；面板就是准入的桥。

## Workspace 不做的事

| 关注点 | 原因 |
| --- | --- |
| 让 Mod 绕开宿主直连 Runtime | Mod 只能消费宿主注入的能力 |
| 让 Mod 直接对接浏览器 | 渲染层无关的外壳，不开放浏览器直连 |
| 让 Mod 不走 Realm 契约改 Realm 真相 | Realm 契约是规范变更的唯一路径 |

## Source Basis

- [`.nimi/spec/desktop/mod-workspace.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/mod-workspace.md)
- [`.nimi/spec/desktop/mod-codegen.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/mod-codegen.md)
- [`.nimi/spec/desktop/mod-development.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/mod-development.md)
- [`.nimi/spec/desktop/kernel/mod-governance-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/mod-governance-contract.md)
- [`.nimi/spec/desktop/kernel/hook-capability-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/hook-capability-contract.md)
- [`.nimi/spec/desktop/kernel/tables/hook-capability-allowlists.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/tables/hook-capability-allowlists.yaml)
- [`.nimi/spec/desktop/kernel/tables/ui-slots.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/tables/ui-slots.yaml)
- [`.nimi/spec/desktop/kernel/tables/mod-access-modes.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/tables/mod-access-modes.yaml)
