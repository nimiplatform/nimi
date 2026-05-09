# 安装与可用性

Nimi 平台包含多个公开表面（Surface），每个表面均有独立的分发渠道。遵循平台规范，仅当某表面的发布证据已通过对应权威契约的正式准入后，公开文档才会将其标记为“可安装”。

## 当前可安装的组件

### Nimi Coding

Nimi Coding 作为独立于宿主环境（Host-agnostic）的方法论，已获得官方准入，并以 npm 软件包形式发布：[`@nimiplatform/nimi-coding`](https://www.npmjs.com/package/@nimiplatform/nimi-coding)。

关于安装命令、项目 Bootstrap 布局、宿主适配器选择及完整的采用路径，请参阅 [Nimi Coding → 安装](/zh/nimicoding/installation)。

最小化的首次验证路径如下：

1. 将该 npm 包集成至宿主项目。
2. 按照“安装”页面提供的 Bootstrap 指令完成初始化。
3. 参照 [第一个 Topic](/zh/nimicoding/topic-workflow) 的指引，执行一次端到端流程，以验证方法论在本地环境的有效性。

由于该软件包具有宿主无关性，上述安装路径在任何已获准入的 AI 宿主环境下均适用。

## 处于契约层面的公开表面

下表所列的各平台表面目前在契约层面提供完整文档，阐述了各表面的定义、所辖权责及其与平台生态的协作关系。

| 平台表面 | 阅读路径 | 涵盖内容 |
| --- | --- | --- |
| 平台 | [平台](/zh/platform/) | 世界模型、六项基础协议及权威准入规则 |
| Runtime | [Runtime](/zh/runtime/) | AI 任务执行、工作流、流式传输、多模态产物及 Provider 路由 |
| SDK | [SDK](/zh/sdk/) | 应用开发者的标准化接入边界 |
| 桌面端 | [桌面端](/zh/desktop/) | 第一方原生外壳（Shell） |
| 网页端 | [Web 模式](/zh/desktop/web-mode) | 受限的浏览器沙盒呈现模式 |
| Realm | [Realm](/zh/realm/) | 语义真相、世界状态及历史演进轨迹 |
| Avatar | [Avatar](/zh/avatar/) | Agent 的形体呈现标准 |
| Cognition | [Cognition](/zh/cognition/) | 独立的记忆、知识与 Prompt 服务 |

当上述任一表面获得准入并新增安装命令、下载链接或发布说明时，对应章节页将同步更新。

## 跟踪可用性状态

[规范地图](/zh/reference/spec-map) 标明了各公开章节对应的权威面。[兼容姿态](/zh/reference/compatibility-posture) 明确了各表面在何种条件下才被允许发布安装或版本信息。

此外，[禁止主张](/zh/reference/forbidden-claims) 页面列出了在缺乏准入证据时，公开文档严禁使用的安装类与发布类宣传语。

## Source Basis

- [`.nimi/spec/product-scope.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/product-scope.yaml)
- [`.nimi/spec/bootstrap-state.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/bootstrap-state.yaml)
- [`.nimi/spec/platform/kernel/web-release-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/web-release-contract.md)
- [`.nimi/spec/runtime/kernel/cli-onboarding-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/cli-onboarding-contract.md)
- [`nimi-coding/package.json`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/package.json)
- [`nimi-coding/README.md`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/README.md)
