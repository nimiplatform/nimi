# 应用互联与数据交互范式（App Interconnect）

Nimi 应用并不直接嵌入在 Realm 服务端内部，而是作为外部客户端通过标准协议与平台进行互联。应用可通过受保护的 SDK 接口，高效读取世界权威状态、订阅实时事件并安全提交状态变更。

## 应用与 Realm 的通信通道

| 通信通道 | 核心用途 | 协议特征 |
| --- | --- | --- |
| **REST 接口** | 执行标准化的只读查询与结构化提交 | 具备明确的请求校验与参数 Schema 约束 |
| **WebSocket / SSE** | 实时订阅并分发数字世界中的规范事件 | 低延迟双向或单向推送，保证多端视图实时联动 |

正式 Nimi App 建议使用由 SDK 封装的 `client.realm` 客户端。敏感认证凭据由本地 Runtime 统一托管与注入，应用代码无需自行管理底层的 Bearer Token 或手动维护 WebSocket 重连逻辑。

## 应用运行模式（Render-App 与 Extension-App）

根据应用对世界数据的读写需求，平台支持两种运行模式：

| 运行模式 | 读取权限 | 写入权限 | 同一世界活跃上限 | 典型产品场景 |
| --- | --- | --- | --- | --- |
| **`render-app`（只读展示型）** | 支持 | 不支持 | 无限制（允许多个） | 世界观信息面板、场景全景观众端、统计仪表盘 |
| **`extension-app`（扩展互动型）** | 支持 | 支持 | **同一世界仅允许 1 个** | 世界主游戏逻辑、专属剧情脚本控制器、世界事件驱动器 |

> **并发约束原理**：限定同一世界至多存在一个活跃的 `extension-app`，是为了从根本上避免多个写入者同时提交互相冲突的世界状态变动，从而确保世界演进的强一致性与确定性。

## 跨平台互操作映射（Interoperability Mappings）

当需要将 Realm 内部的数据结构导出给第三方引擎（如 Unity、Unreal Engine 或外部 Web 平台）消费时，系统提供标准化的只读转换桥梁：
- **状态格式映射**：将 Realm 的标准世界状态转换为通用的 JSON 场景树；
- **历史记录导出**：按时间序导出不可篡改的世界事件流水，便于外部进行数据分析与剧情复盘。

## 相关文档

- [世界状态提交信封机制](/zh/realm/world-state)

## Source Basis

- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
