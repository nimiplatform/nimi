# 生成式动作提供器

> 状态：运行中 (Running)。提供器契约已获准作为APML驱动动作的运行时证明路径；能力配置文件和映射边车是已交付的后端权威接口。

生成式动作提供器是将运行时类型化的动作/表情/姿态/注视/活动意图转换为可执行后端输出的线路，它不依赖于物理 `.vrma` (或其他创作工件) 文件。正是它让“代理的动作具有生命力”——它在运行时生成动作，而非重放手动创作的资产。

## 权威边界

| 层 | 所有者 | 所属内容 |
| --- | --- | --- |
| 公共APML线路 | 运行时 | 解析、验证、公共标签集 |
| 类型化映射 | 运行时 | `runtime.agent.presentation.*` 和 `runtime.agent.state.*` 事件接口 |
| 活动本体 | 运行时 | `tables/agent-activity-ontology.yaml` 中的活动ID和类别 |
| 后端路由ID | Avatar | `tables/generated-motion-routes.yaml` |
| 后端能力配置文件 schema | Avatar | `tables/backend-capability-profile.schema.yaml` |
| 映射边车 schema + 置信度 | Avatar | `tables/mapping-sidecar.schema.yaml` |
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
- `avatarRouteId` 必须在 `tables/generated-motion-routes.yaml` 中解析。
- `capabilityProfileRef` 必须根据 `tables/backend-capability-profile.schema.yaml` 进行验证。
- `mappingSidecarRef` (如果存在) 必须根据 `tables/mapping-sidecar.schema.yaml` 进行验证。

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

## 读者场景：APML驱动“挥手”活动

1.  **模型发出APML。** 公共线路：`<activity name="wave" />`。
2.  **运行时解析 + 验证。** 发出类型化的 `runtime.agent.presentation.activity_requested` 事件。
3.  **Avatar通过SDK接收。** 提供器输入通过类型化映射、活动后端上“wave”对应的 `avatarRouteId`、能力配置文件引用和映射边车引用进行组装。
4.  **提供器执行。** 验证能力配置文件 + 边车；生成确定性的后端输出 (Live2D动作序列或VRM `AnimationClip` 形状的工件)。
5.  **后端渲染。** 输出在具身中播放。

包作者从未为“挥手”编写过 `.vrma` 文件。提供器在运行时根据已准入的后端能力生成动作。

## 读者场景：某能力未被准入

1.  **模型发出。** `<expression name="wink" />`。
2.  **运行时发出。** 类型化的 `presentation.expression_requested` 事件。
3.  **提供器检查。** 能力配置文件声明：此后端支持表情插值，但在已准入的表情集中不包含“眨眼”。
4.  **故障关闭。** 提供器返回类型化证据 (`unsupported_expression`、路由ID、配置文件引用)。后端不会静默替换为“微笑”或回退到空闲状态。
5.  **运行时探测器揭示此情况。** 调试工作台可以看到证据；产品界面处理类型化原因，而不会将其错误地表示为成功。

这种关闭姿态使得工作台探测器值得信赖。

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
| 后端路由ID | 本契约 + `tables/generated-motion-routes.yaml` |
| 后端能力配置文件 | 本契约 + `tables/backend-capability-profile.schema.yaml` |
| 映射边车 + 置信度 | 本契约 + `tables/mapping-sidecar.schema.yaml` |
| 后端执行 | 各后端契约 (Live2D / VRM) |

## 来源依据

- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
