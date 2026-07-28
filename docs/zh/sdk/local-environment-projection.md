# 本地环境映射

## 状态：已准入契约；公开使用以 SDK package exports 为准

本地环境映射合同已在 SDK 内核级别被准入。面向开发者的完整呈现 surface 只有在 SDK package exports 中出现时才是公开 API。

## 本页面涵盖的内容

本地环境映射合同规定了 **应用开发者如何消费 Runtime 投影出的本地环境状态** —— 以及他们不能推断或绕过什么。公开导出准入是封闭的；任何偏离都将被视为封闭失败。

## 导出边界

已准入的 SDK 公开导出，是 SDK 实际发布的显式 package exports 与类型化
root-client surface。其产品语义来自 canonical SDK authority；package manifest
和生成的类型声明只向 Consumer 投影该语义。应用不能通过约定发明新的导出。

## 关键禁止路径

| 禁止 | 原因 |
| --- | --- |
| `runtime/internal/**` | 运行时私有表面；应用只能使用已准入的 SDK 客户端 |
| `kit/internal/**` | Kit 私有表面 |
| 其他 App 的应用层代码 (`apps/**`) | App 不依赖其他 App 的应用层代码 |

## 读者场景：应用读取本地环境计划

应用作者希望展示 Runtime 解析出的本地 setup 计划。

1. **应用创建 client。** 使用 SDK root client 或
   `@nimiplatform/sdk/runtime`。
2. **应用调用投影。** 通过已准入的 Runtime 本地环境 helper 读取 plan、
   selected sources、activation gate 或 dependency jobs。
3. **SDK 保留 Runtime 真值。** Helper 返回类型化 Runtime 投影状态；它不从
   文件系统、Python、PATH、endpoint、包管理器或本地引擎细节推断 ready。
4. **已删除兼容路径 fail closed。** 除非 SDK 实际发布并准入该 package export，
   否则不存在公开的 `local-env` SDK 子路径。

如果应用尝试 `import { internal } from '@nimiplatform/sdk/runtime/internal'`，边界检查将拒绝。

## 本机制不做的事情

- 它不允许应用访问 `runtime/internal/**`。
- 它不允许应用绕过 Runtime 私有边界。
- 它不允许应用通过应用层代码分叉本地环境访问。
- 它不允许通过约定创建新的边界。

## 来源依据

- [`.nimi/spec/sdks/feature-clients.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/feature-clients.authority.yaml)
- [`.nimi/spec/sdks/client-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/client-core.authority.yaml)
