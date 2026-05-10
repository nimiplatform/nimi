# 本地环境映射

## 状态：已准入，正在构建中

本地环境映射合同以及导入边界表 (`tables/import-boundaries.yaml`) 已在 SDK 内核级别被准入。面向开发者的完整呈现表面正处于积极构建中。

## 本页面涵盖的内容

本地环境映射合同规定了 **模块开发者可以从本地环境中导入什么** —— 以及他们不能导入什么。封闭的导入边界目录已被准入；任何偏离都将被视为封闭失败。

## 导入边界目录

已准入的导入边界位于 `tables/import-boundaries.yaml` 中。每个条目声明如下：

| 字段 | 目的 |
| --- | --- |
| 边界 ID | 稳定的身份标识 |
| 允许的导入 | 明确列出的已准入导入路径 |
| 禁止的导入 | 明确列出的禁止导入路径 |
| 理由 | 该边界存在的原因 |

目录是封闭的。模块不能通过约定发明新的边界。

## 关键禁止路径

| 禁止 | 原因 |
| --- | --- |
| `runtime/internal/**` | 运行时私有表面；模块只能使用已准入的 SDK 客户端 |
| `kit/internal/**` | Kit 私有表面 |
| 模块中的应用层代码 (`apps/**`) | 模块不依赖于应用层代码 |

## 读者场景：模块导入一个功能

模块作者希望使用一个已准入的本地功能。

1. **模块导入。** `import { foo } from '@nimiplatform/sdk/local-env'`。
2. **边界检查。** 根据导入边界目录，`local-env` 是一个已准入的导入路径。
3. **模块使用。** 通过已准入的类型化表面。

如果模块尝试 `import { internal } from '@nimiplatform/sdk/runtime/internal'`，边界检查将拒绝。

## 本机制不做的事情

- 它不允许模块访问 `runtime/internal/**`。
- 它不允许模块绕过 `nimi-hook` 私自调用 SDK 运行时。
- 它不允许模块通过应用层代码分叉本地环境访问。
- 它不允许通过约定创建新的边界。

## 来源依据

- [`.nimi/spec/sdk/kernel/local-environment-projection-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/local-environment-projection-contract.md)
- [`.nimi/spec/sdk/kernel/tables/import-boundaries.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/tables/import-boundaries.yaml)
- [`.nimi/spec/sdk/kernel/boundary-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/boundary-contract.md)