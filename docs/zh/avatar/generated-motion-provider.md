# 生成式动作提供器

> 状态：现已可用。提供器契约是 APML 驱动动作的运行时证明路径；能力配置和映射 sidecar 定义了每个后端能做什么。

生成式动作提供器把 Runtime 强类型的动作、表情、姿态、注视和活动意图，转换成可以直接执行的后端输出——不依赖物理 `.vrma` 文件或其它手工制作的素材。正是它让 Agent 的动作"活"起来：动作在运行时生成，而不是回放一份预先做好的资产。

## 权威边界

| 层 | 所有者 | 所属内容 |
| --- | --- | --- |
| 公共APML线路 | 运行时 | 解析、验证、公共标签集 |
| 类型化映射 | 运行时 | `runtime.agent.presentation.*` 和 `runtime.agent.state.*` 事件接口 |
| 活动本体 | 运行时 | `config/runtime-local-agent-activity-catalog.yaml` 中的活动ID和类别 |
| 后端路由ID | Avatar | `config/avatar-generated-motion-routes.yaml` |
| 后端能力配置文件 schema | Avatar | `config/avatar-backend-capability-profile.schema.yaml` |
| 映射边车 schema + 置信度 | Avatar | `config/avatar-mapping-sidecar.schema.yaml` |
| 提供器执行语义 | Avatar | 本契约 |

Avatar路由ID是后端映射ID。它们**不是**公共APML标签，也**不是**运行时活动本体ID。这种分离确保了即使后端路由演进，面向公共模型的线路也能保持稳定。

## 未准入的公共APML标签

本契约不准入 `<motion>`、`<expression>`、`<lookat>`、`<pose>` 或 `<clear-pose>` 的直接公共APML标签。这些名称只能在运行时验证后，作为类型化的运行时映射事件族或Avatar本地后端概念出现。公共APML继续仅使用运行时线路契约所准入的语法——例如 `<activity>`、`<emotion>` 等。

## 提供器输入

```ts
type GeneratedMotionProviderInput = {
  projection:
    | RuntimeAgentPresentationActivityRequested
    | RuntimeAgentPresentationMotionRequested
    | RuntimeAgentPresentationExpressionRequested
    | RuntimeAgentPresentationPoseRequested
    | RuntimeAgentPresentationLookatRequested
    | RuntimeAgentStateEmotionChanged
    | RuntimeAgentStatePostureChanged;
  avatarRouteId: string;
  backendKind: 'vrm' | 'live2d' | string;
  capabilityProfileRef: string;
  mappingSidecarRef: string | null;
};
```

规则：

- `projection` 必须来自已准入的 `runtime.agent.presentation.*` 或 `runtime.agent.state.*` 事件。原始 `apml.*` 解析器诊断信息是无效输入。
- `avatarRouteId` 必须在 `config/avatar-generated-motion-routes.yaml` 中解析。
- `capabilityProfileRef` 必须根据 `config/avatar-backend-capability-profile.schema.yaml` 进行验证。
- `mappingSidecarRef` (如果存在) 必须根据 `config/avatar-mapping-sidecar.schema.yaml` 进行验证。

## 提供器输出

提供器返回可执行的后端输出或故障关闭证据。输出是**确定性的**——对于VRM，是一个类型化的 `THREE.AnimationClip` 形状的工件；对于Live2D，是等效的后端原生动作帧。没有“尽力而为并带占位符”的成功路径。

| 结果 | 含义 |
| --- | --- |
| 可执行的后端输出 | 提供器生成了后端特定的动作/表情/姿态/注视输出 |
| 故障关闭证据 | 提供器无法生成可执行输出；类型化的原因代码；后端不会静默替换 |

## 能力配置文件

后端能力配置文件声明了后端支持哪些动作/表情/姿态/注视能力。示例：

- 某个配置文件可能声明支持口型同步，但无表情插值。
- 某个配置文件可能声明支持完整的动作+表情+注视，且姿态范围受限。
- 某个配置文件可能声明情感 → 表情映射，且置信度范围由映射边车准入。

提供器会先检查配置文件，再生成输出。请求不支持的能力会导致故障关闭；它不会静默回退到空闲状态、静态图像或占位符配置文件。

## 映射边车

映射边车描述了从运行时语义意图到后端路由ID的逐包映射。置信度语义已准入；边车条目可以声明：

| 字段 | 用途 |
| --- | --- |
| `route` | Avatar后端路由ID |
| `confidence` | 逐映射置信度 (准入范围) |
| `fallback` | 已准入的回退路由ID (或无 — 故障关闭) |

置信度并非模型用于推理的概率；它是在有多个映射条目适用时，提供器如何从中选择的依据。

## 读者场景：呈现已准入活动

1. **Runtime 提供验证后的结果。** 已授权呈现流请求已准入的 `agree` 活动。Avatar 消费强类型结果，不把原始模型 XML 当作后端命令。
2. **Avatar 解析自己的路由。** Generated-motion 配置把 `agree` 映射到 VRM 后端的 `nod_yes`。这是 Avatar 路由身份，不是公共 APML 标签，也不是调用者自选的 Runtime 活动命名空间。
3. **Provider 验证。** 检查活动后端的 capability profile 和必要 mapping sidecar；缺失或不支持的输入返回对应强类型失败。
4. **生成并呈现。** 准入后，确定性 provider 为这个确切路由与后端生成 VRM 动画输出，由后端播放。

支持结论来自路由配置和经过验证的后端事实，不来自 `.vrma` 文件是否存在。其他后端需要自己的已准入路由与处理结果。

## 读者场景：后端能力不支持

1. Avatar 收到已授权强类型呈现输入，并解析活动后端的已准入路由。
2. 后端 capability profile 不支持所请求的输出。
3. Provider 返回 `unsupported_capability`，后端不会静默换成另一表情或 idle 动画。
4. Avatar 记录本地诊断，产品展示真实原因；诊断不会创建 Runtime 操作权限。

公共 APML 验证发生在此前。原始标签不受支持或属性非法时，Runtime 就会拒绝，不会生成成功的呈现结果交给 Avatar。后端失败不能成为接受非法模型输出的路径。

## 读者场景：存在 `.vrma` 文件

1.  **资产审计发现包中存在 `.vrma` 文件。**
2.  **立场。** 根据契约，`.vrma` 仅是交换/创作证据。它可能出现在现有的VRM加载器或资产证据中，但它**不是**运行时支持证明。
3.  **提供器行为。** 提供器不以 `.vrma` 文件的存在作为门控条件。它以能力配置文件 + 边车 + 已准入的路由ID作为门控条件。
4.  **审计姿态。** `.vrma` 的存在不满足提供器的运行时证明要求。

提供器是运行时证明路径。创作工件就是创作工件。

## 边界摘要

| 关注点 | 所有者 |
| --- | --- |
| 公共APML语法 (包括哪些标签被准入) | 运行时线路契约 |
| 类型化运行时映射事件 | 运行时呈现流契约 |
| 后端路由ID | 本契约 + `config/avatar-generated-motion-routes.yaml` |
| 后端能力配置文件 | 本契约 + `config/avatar-backend-capability-profile.schema.yaml` |
| 映射边车 + 置信度 | 本契约 + `config/avatar-mapping-sidecar.schema.yaml` |
| 后端执行 | 各后端契约 (Live2D / VRM) |

## 来源依据

- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`runtime/internal/services/runtimeagent/chat_structured_apml.go`](https://github.com/nimiplatform/nimi/blob/main/runtime/internal/services/runtimeagent/chat_structured_apml.go)
