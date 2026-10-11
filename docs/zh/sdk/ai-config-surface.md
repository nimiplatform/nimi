# AI 能力配置 (AIConfig)

SDK 中的 AIConfig 接口为应用提供了强类型的模型能力偏好管理边界。App 负责声明其所需的模型能力契约、必要的功能特性（如多模态、工具调用）、场景默认参数，以及选择采用本地 (Local) 还是云端 (Cloud) 推理路由。具体的物理设备匹配与底层模型实例化由 Runtime 自主管理，并在执行阶段严格遵从已固化的配置。

AIConfig 维护当前主体配置的完整快照。每次更新均通过版本号全量替换能力列表；配置对象中不掺杂执行态的临时会话、瞬时就绪度或底层驱动健康状态。

## 核心公开接口一览

| 模块 / 接口 | 公共引入路径 | 职责与功能 |
| --- | --- | --- |
| App 专属 AIConfig | 宿主客户端上的 `client.aiConfig` | 读取 App 自有的配置与生效选择，列出安全可选模型，支持带 Revision 的全量覆盖 |
| AIConfig 设置 UI 组件 | `@nimiplatform/kit/features/model-config` 导出的 `ModelConfigAIConfigSurface` | 基于 `client.aiConfig` 开箱即用的标准化可视化设置面板 |
| 核心类型定义 | `@nimiplatform/sdk` 或 `@nimiplatform/sdk/ai` | 导出 `NimiCapabilityAIConfig`、`NimiCapabilityAIConfigIntent` 及快照/覆盖结果类型 |
| 独立主体配置 Client | `@nimiplatform/sdk/ai` 中的 `createNimiAppAIConfigClient` | 供持有保护传输的系统宿主使用，普通 App 无需使用 |
| Agent Center 配置分区 | `@nimiplatform/kit/features/agent-center` | 在智能体管理中心展示 Local 或 Cloud 能力偏好 |

## 能力意图结构 (Capability Intent)

能力配置列表中的每一项包含以下核心字段：

| 字段名称 | 语义与作用说明 |
| --- | --- |
| `capabilityContract` | 请求的能力契约标识，例如 `text.generate` |
| `requiredFeatures` | 声明底层模型实现必须支持的特性集合（如流式输出、函数调用等） |
| `defaults` | 跨端通用的业务默认参数（如温度值、Token 上限），非物理硬件配置 |
| 路由意图 (`route`) | 声明业务偏好的执行平面：本地 (`local`) 或云端 (`cloud`) |

- **本地意图 (Local)**：仅携带轻量路径标记 `local: {}`，不耦合具体的模型文件或本地硬件标识。
- **云端意图 (Cloud)**：必须包含从 Runtime 提供的安全候选列表中选取的 `connectorRef`、`implementation` 与 `providerModelTarget`。这些属于持久化的静态配置，而非临时的请求级覆盖。

在提交生成任务时，Runtime 会直接绑定本地选中的 Loadout 或配置的云端参数，不再发起临时的动态模型替换。当前账号下的所有 LocalAgent 共享一份独立的 Agent AIConfig，单个智能体不直接充当配置 Owner。

## App 集成开发流程

1. **复用宿主客户端**：直接使用应用模板中的 `client`，Runtime 会自动从桌面 Shell 会话中解析 App 身份。
2. **查询当前配置**：调用 `client.aiConfig.get()` 获取最新快照及其版本号 `revision`。
3. **安全更新配置**：当用户在界面调整意图后，携带获取到的 `expectedRevision` 全量保存能力列表，保留未变动的其他能力项。
4. **处理并发冲突分支**：通过检查返回值 `result.outcome === 'conflict'` 而非依赖 try/catch 异常捕获；若发生并发版本冲突，重新拉取最新快照与 revision 经用户确认后再处理。
5. **发起 AI 任务**：通过 `client.ai` 提交工作负载，请求中仅需传入业务提示词与标准参数。

```ts
import type { NimiLocalAppClient, NimiPortableAppAIConfigIntent } from '@nimiplatform/sdk';

export async function useLocalTextGeneration(client: NimiLocalAppClient) {
  // 1. 获取当前配置及版本号
  const current = await client.aiConfig.get();

  // 2. 构造新的能力意图
  const textGeneration: NimiPortableAppAIConfigIntent = {
    capabilityContract: 'text.generate',
    requiredFeatures: [],
    route: { oneofKind: 'local', local: {} },
  };

  // 3. 保留其他未修改的能力
  const others = (current.config?.capabilities ?? [])
    .filter((capability) => capability.capabilityContract !== 'text.generate');

  // 4. 提交覆盖并核对 revision
  return await client.aiConfig.overwrite({
    expectedRevision: current.revision,
    capabilities: [...others, textGeneration],
  });
}
```

参考示例代码可参阅 [`examples/sdk/03-ai-config.ts`](https://github.com/nimiplatform/nimi/blob/main/examples/sdk/03-ai-config.ts)。App Client 绝不会硬编码私有账号或底层模型路径；外部直连客户端亦无权读写受保护应用的 AIConfig。

实际模型推理执行见[第一次 AI 调用](/zh/sdk/first-ai-call)。

## 严格校验与阻断机制 (Fail-Closed)

SDK 在向外分发前会严格校验能力意图格式与 `revision` 的完整性；若返回数据畸形也会立即阻断。底层 Runtime 会在执行边界校验各项前置条件，当遇到未声明意图、未经授权的云端调用、能力特征不满足或本地硬件不可用时，均会抛出强类型错误。

App 应当优雅捕获并向用户呈现这些标准错误信息：
- 严禁擅自使用虚假兜底（如伪造 `auto` 策略）；
- 严禁在代码中写死某个商业 Provider 或私有模型名称；
- 严禁自行搭建旁路 HTTP/REST 请求绕过 Runtime 调度。

## Runtime 与应用的分工边界

宿主硬件拓扑、本地已下载的模型资产、显卡驱动状态、服务健康度及底层执行耗时诊断，均由 Runtime 统一管控。诊断日志可以帮助开发者排查调用异常，但不允许应用层在每次请求时越俎代代庖地干预底层的硬件调度。

## Source Basis

- [`.nimi/spec/sdks/feature-clients.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/feature-clients.authority.yaml)
- [`sdks/typescript/core/app/local-app-runtime-platform-ai-config.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core/app/local-app-runtime-platform-ai-config.ts)
- [`sdks/typescript/core/ai/capability-configuration.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core/ai/capability-configuration.ts)
- [`sdks/typescript/core-generated/runtime-protobuf/runtime/v1/capability_configuration.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core-generated/runtime-protobuf/runtime/v1/capability_configuration.ts)
- [`kit/features/agent-center/src/components/AgentCenterAIConfigSection.tsx`](https://github.com/nimiplatform/nimi/blob/main/kit/features/agent-center/src/components/AgentCenterAIConfigSection.tsx)
