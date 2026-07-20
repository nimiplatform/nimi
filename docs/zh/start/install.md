# 安装与可用性

Nimi 平台包含多个公开层（Surface），每层均有独立的分发渠道。遵循平台规范，仅当某层的发布证据已通过对应权威契约的正式准入后，公开文档才会将其标记为“可安装”。

## 当前可安装的组件

### Nimi Coding

Nimi Coding 作为独立于宿主环境（Host-agnostic）的方法论，已获得官方准入，并以 npm 软件包形式发布：[`@nimiplatform/nimi-coding`](https://www.npmjs.com/package/@nimiplatform/nimi-coding)。

Nimi workspace 安装与 host compatibility 检查见 [Nimi Coding → Host 集成](/zh/nimicoding/installation)。

最小化的首次验证路径如下：

1. 安装 Nimi workspace dependencies。
2. 运行 host-hardcut、projection 和 doctor wrappers。
3. 参照[验证 Nimi 治理设置](/zh/nimicoding/tutorials/project-bootstrap)，验证所有权与真相表面完整可用。

软件包仍然保持宿主无关；Nimi 仓库在它外围应用自己的明确准入边界。

### Nimi App Tools

`@nimiplatform/app-tools` 是面向 Nimi App 开发者仓库的公开 app-authoring CLI。

```bash
pnpm dlx --package @nimiplatform/app-tools nimi-app create --profile standalone
```

完整 scaffold 路径见 [创建 Nimi App](/zh/start/create-an-app)。CLI 只创建 scaffold 输入和本地检查；它不会创建公开 App 准入、权限授予、registry 可见性、release descriptor，或 installed-app update truth。

## Package channel 矩阵

| Package | npm install path | source checkout path | 说明 |
| --- | --- | --- | --- |
| `@nimiplatform/app-tools` | 带 `nimi-app` binary 的公开 package | `app-tools/` | Standalone scaffold 通过 `pnpm dlx --package` 运行；workspace scaffold 可以使用 `workspace:*`。 |
| `@nimiplatform/kit` | 公开 package | `kit/` | Kit 不是 Runtime 替代品；App 只使用已发布的 subpath exports。 |
| `@nimiplatform/sdk` | 面向 App consumer 的公开 package | `sdks/typescript/` private vNext workspace package | 生成的 standalone app 使用 app-tools 写入的 published SDK range；本仓库开发使用 workspace package。 |

不要假设 source checkout 会自动打开所有产品 release channel。Standalone App 仓库使用 npm package；只有在本 monorepo 或生成的 workspace-app scaffold 中才使用 `workspace:*`。

## 已有契约定义的平台层

下表所列的各平台层目前均有完整的契约文档，定义了其权责及与平台生态的协作关系。

| 平台层 | 阅读路径 | 涵盖内容 |
| --- | --- | --- |
| 平台 | [平台](/zh/platform/) | 世界模型、六项基础协议及权威准入规则 |
| Runtime | [Runtime](/zh/runtime/) | AI 任务执行、工作流、流式传输、多模态产物及 Provider 路由 |
| SDK | [SDK](/zh/sdk/) 与 [第一次 AI 调用](/zh/sdk/first-ai-call) | 应用开发者的标准化接入边界与第一次 Runtime-backed 文本生成路径 |
| App Tools | [创建 Nimi App](/zh/start/create-an-app) | App authoring scaffold 命令与本地检查 |
| Kit | [平台 Kit](/zh/platform/kit/) | 共享 UI、shell、auth、telemetry、model config 与 feature module |
| Tester / Nimi Lab | [把 Tester 当作 Reference App 使用](/zh/start/use-tester-as-reference) | Reference app scripts、Runtime auth、Kit、AIConfig 与 fail-closed states |
| 桌面端 | [桌面端](/zh/desktop/) | 第一方原生外壳（Shell） |
| 网页端 | [Web 模式](/zh/desktop/web-mode) | 受限的浏览器沙盒呈现模式 |
| Realm | [Realm](/zh/realm/) | 语义真相、世界状态及历史演进轨迹 |
| Avatar | [Avatar](/zh/avatar/) | Agent 的形体呈现标准 |
| Cognition | [Cognition](/zh/cognition/) | 独立的记忆、知识与 Prompt 服务 |

当上述任一层获得准入并新增安装命令、下载链接或发布说明时，对应章节页将同步更新。

## 跟踪可用性状态

[规范地图](/zh/reference/spec-map) 标明了各公开章节对应的权威面。[兼容姿态](/zh/reference/compatibility-posture) 明确了各层在何种条件下才被允许发布安装或版本信息。

此外，[禁止主张](/zh/reference/forbidden-claims) 页面列出了在缺乏准入证据时，公开文档严禁使用的安装类与发布类宣传语。

## 来源依据

- [`nimi-coding/README.zh-CN.md`](https://github.com/nimiplatform/nimi-coding/blob/main/README.zh-CN.md)
- [`nimi-coding/config/bootstrap.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/config/bootstrap.yaml)
- [`.nimi/spec/platform/kernel/web-release-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/web-release-contract.md)
- [`.nimi/spec/runtime/kernel/cli-onboarding-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/cli-onboarding-contract.md)
- [`.nimi/spec/platform/kernel/nimi-app-scaffolding-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/nimi-app-scaffolding-contract.md)
- [`app-tools/README.md`](https://github.com/nimiplatform/nimi/blob/main/app-tools/README.md)
- [`app-tools/lib/index.mjs`](https://github.com/nimiplatform/nimi/blob/main/app-tools/lib/index.mjs)
- [`app-tools/lib/app-scaffold.mjs`](https://github.com/nimiplatform/nimi/blob/main/app-tools/lib/app-scaffold.mjs)
- [`kit/package.json`](https://github.com/nimiplatform/nimi/blob/main/kit/package.json)
- [`sdks/typescript/package.json`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/package.json)
- [`nimi-coding/package.json`](https://github.com/nimiplatform/nimi-coding/blob/main/package.json)
- [`nimi-coding/README.md`](https://github.com/nimiplatform/nimi-coding/blob/main/README.md)
