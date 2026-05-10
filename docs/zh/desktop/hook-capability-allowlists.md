# Hook 能力白名单

## 状态：已准入，正在构建中

桌面 Hook 能力合约
（`desktop/kernel/hook-capability-contract.md`）和白名单表
（`tables/hook-capability-allowlists.yaml`，
`tables/hook-subsystems.yaml`）已在内核层面获得准入。面向 Mod 的 Hook 面集成正处于积极构建中。

## 什么是 Hook 能力白名单

Mod 通过**类型化 Hook** 访问桌面子系统。每个 Hook 允许一组封闭的能力——Mod 只能做白名单所允许的事情，不能多做。这些白名单是规范准入的**封闭枚举**，而不是用户可配置的设置。

## 为什么使用封闭枚举

如果白名单是用户可配置的：
- 配置错误的 Mod 可能被授予超出其声明需求的能力
- 审计边界将从规范转移到每次安装的状态
- “Mod X 能做什么”将取决于哪个用户在哪一天安装了它

封闭枚举使得“Mod X 能做什么”的答案可以从规范和Mod 清单中推导出来，而不是从每台机器的状态中推导出来。

## 权威面

| 关注点 | 权威 |
| --- | --- |
| Hook 能力合约 | `desktop/kernel/hook-capability-contract.md` |
| 白名单表 | `tables/hook-capability-allowlists.yaml` |
| 子系统表 | `tables/hook-subsystems.yaml` |

这些表格列出了每个 Hook 的能力集和每个子系统的 Hook 面。两者都是封闭的；新的能力和子系统需要准入。

## 读者场景：一个 Mod 声明 Hook 能力

一个 Mod 作者编写了一个使用桌面聊天轮次 Hook 的 Mod。

1. **Mod 清单声明能力。** 根据聊天轮次 Hook 面的封闭白名单。
2. **Mod 加载。** 桌面验证清单中的能力是否符合准入的白名单。
3. **Mod 运行。** Hook 调用仅在声明的能力范围内成功。
4. **超出白名单的能力。** 在 Hook 调度时被拒绝——不会静默传递。

## Hook 能力白名单不做的事情

- 它们不是用户可配置的。
- 它们不允许 Mod 绕过约定发明新的能力。
- 它们不会静默地授予超出清单声明的能力。
- 它们不允许每次安装的状态覆盖规范准入的枚举。

## 来源依据

- [`.nimi/spec/desktop/kernel/hook-capability-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/hook-capability-contract.md)
- [`.nimi/spec/desktop/kernel/tables/hook-capability-allowlists.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/tables/hook-capability-allowlists.yaml)
- [`.nimi/spec/desktop/kernel/tables/hook-subsystems.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/tables/hook-subsystems.yaml)