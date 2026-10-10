# 本地模型与 Loadout

模型文件是资源清单中的一项。Loadout 是保存下来的能力配置，绑定确切的实现 recipe 和资源。Runtime 的机器存储为每项能力最多保留一个当前选中的 Loadout，供已保存 Local 意图的 owner 后续请求使用。

## 准备本地能力

1. 在 Nimi Home 的「AI 能力」工作区查看能力和 Runtime 提供的设置选项。
2. 获取必要模型资源。「模型库」负责导入、存储、文件校验和删除；「下载」展示已有传输和设置任务。
3. 准备并提交 Loadout，补齐模型槽位、内容身份、参数和环境资源。
4. 明确设为该能力的机器默认配置。这会影响所有 App 和共享 LocalAgent owner 今后的同能力 Local 提交。
5. 在对应 AIConfig 保存 Local 意图，再通过受保护客户端执行一次实际请求。

仅安装文件不会绑定或选择 Loadout。没有匹配 recipe 的资源可以保留在清单中，但不能因此执行。Recipe 的配套资源也不能仅因被引用，就被展示为能独立完成能力的模型。

## 正确理解状态

| 事实 | 能证明什么 |
| --- | --- |
| 文件校验 | 已存储字节符合资源登记的内容身份 |
| 资源绑定 | 某个 Loadout 指定了所需资源 |
| 配置和环境检查 | 该确切配置的准备状态与强类型阻塞原因 |
| 当前选择 | 某项能力后续 Local 提交使用的机器默认配置 |
| 实际执行成功 | 这一请求已经成功完成 |

这些事实不能相互替代。未检查或检查失败就保持未知或失败，不能显示为已准备好，也不能据此断言缺组件。状态按具体配置展示，不能把一个模型的多项配置合成统一的就绪等级。

目录兼容性和推荐依据由 Runtime 提供。客户端保留其顺序，不从文件名、模型名、标签或进程健康推测兼容性。

## 执行

提交时，Runtime 验证选中的 Loadout，并原子保存包含确切资源身份的完整执行组合。排队、运行和恢复中的 Job 保留这一组合；缺少必要输入时不会搜索库存、重新排名、切换选择或回退。

App 请求携带内容与受支持参数；Local AIConfig 不带 Loadout 或模型选择器。安全的实际选择信息可用于解释配置，不能变成请求控制。

## 环境与进程

Runtime 负责已准入的依赖安装、进度、取消、清理与执行宿主管理，Home 展示强类型操作。公开的启动或预热模型操作，以及由 App 轮询驱动进程，都不是能力执行契约。

环境已准备好，Job 仍可能失败；进程尚未运行，Runtime 仍可为已准入 Job 启动它。执行结论来自实际操作结果，不能由进程状态推导。

## Source Basis

- [`.nimi/spec/runtime/local-compute.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/local-compute.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/desktop/ai-consumption.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/ai-consumption.authority.yaml)
- [`.nimi/spec/runtime/rpc-foundations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/rpc-foundations.authority.yaml)
