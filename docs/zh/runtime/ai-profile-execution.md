# Profile、Loadout 与执行

AIProfile 是可移植配置包。应用 Profile 只生成可编辑的预填内容，不会提交 AIConfig、选择 Loadout、安装资源或开始执行。

## 三种独立记录

| 记录 | 用途 |
| --- | --- |
| AIProfile | 分享可移植选择和默认参数，不带机器身份或秘密 |
| AIConfig | 保存一个 App 或共享 LocalAgent owner 的完整能力配置与 revision |
| Loadout | 保存机器上的能力实现、Driver 方言和 recipe、参数及确切资源绑定 |

每项能力可以保存多个 Loadout，但机器当前最多选中一个。Local AIConfig 只有 Local 标记，不复制选中的 Loadout；Cloud 配置保存确切的 Connector 引用、CapabilityImplementation 和 provider-model target。

## 准备、提交与选择

机器配置通过准入的 Prepare / Commit 流程变更，并需要明确确认。安装模型只增加资源清单；把必要资源绑定到 Loadout、再将其设为当前选择，是不同操作。机器选择影响所有使用该能力 Local 路径的后续提交，界面需要说明这一范围。

配置有效性、资源绑定、环境兼容性、当前选择、进程状态与实际执行是不同事实。已选择或已准备好，都不代表推理成功。

## 提交时固定输入

提交 Job 时，Runtime 检查已保存的 AIConfig 与当前权限。Local 路径固定机器选中的 Loadout、完整执行组合及确切内容身份；Cloud 路径固定已提交的 Connector 和实现目标，凭据由 Runtime 托管。

排队、运行或恢复中的 Job 只使用这些已保存输入，不重新读取后来修改的 AIConfig 或机器选择，不寻找替代模型，也不静默回退。当前权限仍会独立检查。配置或资源缺失时返回强类型失败。

App 通过绑定宿主的客户端提交内容与受支持参数，不附带 Profile、Local Loadout、端点、凭据或请求级路由覆盖。[AIConfig](/zh/sdk/ai-config-surface) 是独立的配置接口。

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/desktop/ai-consumption.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/ai-consumption.authority.yaml)
- [`.nimi/spec/runtime/rpc-foundations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/rpc-foundations.authority.yaml)
- [`.nimi/spec/runtime/service-operations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/service-operations.authority.yaml)
