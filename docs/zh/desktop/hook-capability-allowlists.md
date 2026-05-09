# 钩子能力允许列表

## 状态：已准入，正在构建中

桌面钩子能力合约
（`desktop/kernel/hook-capability-contract.md`）和允许列表表
（`tables/hook-capability-allowlists.yaml`，
`tables/hook-subsystems.yaml`）已在内核级别被准入。面向模组的钩子表面集成正处于积极构建中。

## 什么是钩子能力允许列表

模组通过**类型化钩子**访问桌面子系统。每个钩子允许一组封闭的能力——模组只能做允许列表所允许的事情，不能多做。这些允许列表是规范准入的**封闭枚举**，而不是用户可配置的设置。

## 为什么使用封闭枚举

如果允许列表是用户可配置的：
- 配置错误的模组可能会被授予超出其声明需求的能力
- 审计边界将从规范转移到每次安装的状态
- “模组X能做什么”将取决于哪个用户在哪一天安装了它

封闭枚举使得“模组X能做什么”的答案可以从规范和模组清单中推导出来，而不是从每台机器的状态中推导出来。

## 权限表面

| 关注点 | 权限 |
| --- | --- |
| 钩子能力合约 | `desktop/kernel/hook-capability-contract.md` |
| 允许列表表 | `tables/hook-capability-allowlists.yaml` |
| 子系统表 | `tables/hook-subsystems.yaml` |

这些表格列出了每个钩子的能力集和每个子系统的钩子表面。两者都是封闭的；新的能力和子系统需要准入。

## 读者场景：一个模组声明钩子能力

一个模组作者编写了一个使用桌面聊天轮次钩子的模组。

1. **模组清单声明能力。** 根据聊天轮次钩子表面的封闭允许列表。
2. **模组加载。** 桌面验证清单中的能力是否符合准入的允许列表。
3. **模组运行。** 钩子调用仅在声明的能力范围内成功。
4. **超出允许列表的能力。** 在钩子调度时被拒绝——不会静默传递。

## 钩子能力允许列表不做的事情

- 它们不是用户可配置的。
- 它们不允许模组通过约定发明新的能力。
- 它们不会静默地授予超出清单声明的能力。
- 它们不允许每次安装的状态覆盖规范准入的枚举。

## 源基础

- [`.nimi/spec/desktop/kernel/hook-capability-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/hook-capability-contract.md)
- [`.nimi/spec/desktop/kernel/tables/hook-capability-allowlists.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/tables/hook-capability-allowlists.yaml)
- [`.nimi/spec/desktop/kernel/tables/hook-subsystems.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/tables/hook-subsystems.yaml)