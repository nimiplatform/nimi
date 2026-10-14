# Nimi

**让 AI 真正属于你。** Make AI truly yours.

Nimi 是一个可安装、开源、本地优先的个人 AI 产品：在同一个桌面空间里使用专注场景的 AI 应用、与有生命力的 AI 角色对话，以及探索不同故事背景的世界。你可以自由选择运行本地模型或云端模型，也可以使用统一的 SDK 构建专属自己的 AI 工具。

[下载与发布状态](https://nimi.ai/download) · [官方网站](https://nimi.ai) · [开发文档](https://docs.nimi.ai) · [版本发布](https://github.com/nimiplatform/nimi/releases) · [Discord 社区](https://discord.gg/BQwHJvPn)

> **当前版本（公开 Beta `nimi/v0.2.4`）**：Nimi 现已提供公开 Beta 安装包（包含 Desktop、Runtime、Avatar 及所需系统服务），支持 **macOS Apple Silicon**（`arm64`，macOS 13.0+）与 **Windows x86_64**（Windows 10 2004 / `10.0.19041`+）。请前往 [下载页面](https://nimi.ai/download) 或 [GitHub Releases](https://github.com/nimiplatform/nimi/releases) 获取安装程序与发行元数据。当前版本通过独立的 `beta` 通道分发（非 `stable` 正式版）；使用 Nimi 需要注册 Nimi 账号并在浏览器中完成登录授权。

---

## 为什么选择 Nimi？

- **AI 不只是一片空白的聊天框**：通过专注于具体任务的应用来完成工作与创作——从写作、音乐、图像处理，到家庭成长记录、心理反思与节律观察。
- **本地优先，模型随心选**：模型就绪后即可在本地设备直接运行推理，无需为这部分调用支付云端 API 费用；也可按需接入支持的云端模型服务（账号登录、内容下载与在线功能仍需联网）。模型与算力的选择权始终在你手中。
- **跨应用的记忆与连续性**：在你授权的应用之间，同一个 LocalAgent 可以跨场景持续陪伴。启用长期记忆后，记忆数据按 Agent 隔离保存在本机；当选用云端模型时，当前请求所需的上下文会发送给所选模型服务商。
- **有故事的角色与世界**：遇见拥有独特背景与世界观的 AI 角色，走进他们所在的时空，在互动中感受超越单向提问的沉浸体验。
- **打造你自己的本地应用**：借助现代化的 TypeScript SDK 与组件库，开发者可以将创意构建为本地 AI 应用，在 Desktop 监管下通过受保护会话安全访问 Nimi 能力。

---

## 生态应用一览

官方 Registry 收录的应用需要公开源码与明确的开源协议。以下生态项目展示了不同的使用方向；具体可用版本与平台以各项目发布信息为准：

| 应用名称 | 简介 |
| --- | --- |
| **ParentOS** | 专为家庭打造的儿童成长记录系统。在本地记录并保存成长里程碑、生活观察与关键发育数据；AI 辅助请求则按所选的本地或云端模型处理。 |
| **Nimi Overtone** | 音乐人的灵感试验场。从画面或场景意象出发，探索音乐走向、编排段落、推敲歌词并对比不同录音版本。 |
| **Storybook** | 互动故事创作与阅读工具。角色的性格特质与读者的每一次选择，都在共同决定故事的去向。 |
| **Realm Persona Studio** | 你的专属角色工坊。从零设定、编辑并维护属于你自己的 Realm Persona 资料、立绘形象与创作草稿。 |
| **时镜 ShiJing** | 传统历法节律观察与生活推演助手。结合干支天时与传统算法，探索生活与心境的周期变化。 |
| **Inscape 心相** | 面向成人的性格探索与日常深度反思空间。结合荣格八维认知模型，在日常选择中觉察自我。 |
| **Realm World Studio** | 构筑虚拟世界的创作工作台。设定地理风貌、社会法则与核心人物，为角色提供鲜活的舞台。 |
| **Vane** | 深度调研与信息整理应用。在大量文本与知识网络中快速筛选信源，提炼清晰的分析结论。 |
| **OpenMontage** | 剧本到视频的生产力工作台。串联文本、旁白、分镜构图与剪辑节奏，加速视听内容创作。 |
| **Next AI Draw.io** | 用自然语言绘制架构图与流程图。在直观画布上交互编辑，将模糊的想法迅速转化为精确图表。 |

### 应用运行与生命周期

应用由 Nimi Desktop 统一监管运行，并通过受保护会话访问本地 Runtime，涵盖三种分发与开发形态：
1. **官方 Registry 目录应用**：经过 Registry 准入审核的不可变安装包，用户可在 Desktop 的「应用」中一键发现、安装、启动与更新。
2. **本地包导入（Local Import）**：导入用户明确选择的不可变应用包。macOS arm64 与 Windows x86_64 已有实现，整体产品验收与公开发布准备仍需单独确认。
3. **开发者模式（Developer Mode）**：面向本地开发调试，支持热重载，直接连接本地正在开发的 App 工程。

*注：当前版本应用安装包生命周期支持 macOS (arm64) 与 Windows (x86_64)，其他平台及常规自动修复通道暂未开放。更多生态应用与提交标准请参阅 [nimi.ai/apps](https://nimi.ai/apps)。*

---

## 开发者起步

无论你是想从零构建一个全新的 AI 工具，还是将现有 Web / Electron 项目接入 Nimi 生态：

- **强类型 Nimi SDK**：`@nimiplatform/sdk` 提供标准化的本地与云端模型调用接口，抹平多模型接入复杂度。
- **现代化框架适配器**：`@nimiplatform/sdk-adapter-vercel-ai` 无缝桥接 Vercel AI SDK 7，让你用熟悉的组件与 Hooks 进行开发。
- **一键脚手架工具**：使用 `@nimiplatform/app-tools` 几秒内生成标准应用模板：

```bash
pnpm dlx --package @nimiplatform/app-tools nimi-app create --dir my-ai-app --profile standalone
```

推荐阅读：
- [快速创建第一个 App 指南](https://docs.nimi.ai/start/create-an-app)
- [发起你的第一次 AI 调用](https://docs.nimi.ai/sdk/first-ai-call)
- [TypeScript SDK 接口文档](https://docs.nimi.ai/sdk/)

---

## 平台分层架构

Nimi 采用清晰解耦的分层设计，保障安全性与扩展性：

```text
Nimi — 可安装的个人 AI 产品
└─ Nimi Home — 使用入口，当前由 Desktop 承载
   └─ Nimi Apps / Kit / SDK
      ├─ Runtime — 本地与云端 AI 执行、LocalAgent、会话与受保护访问
      └─ Realm   — 生态身份、角色资产、世界与社交关系

Cognition 独立管理长期记忆；Runtime 负责授权访问与调用协调。
Avatar 负责 2D/3D 表现，消费角色状态，不决定角色行为。
```

Runtime 与 Realm 各自拥有其领域的数据和行为，互不充当对方的下层实现。

详细架构契约、协议原语与领域所有权请参阅 [docs.nimi.ai/platform](https://docs.nimi.ai/platform)。

---

## 开源协议与信任

- **完全开源核心**：Runtime、SDK、Kit、Proto 与 App Tools 等核心组件全部基于开放协议授权。Realm 商业实现独立于公开分发包。完整映射请参阅 [LICENSE](LICENSE)。
- **安全第一**：发现潜在安全漏洞请通过 [GitHub Security Advisories](https://github.com/nimiplatform/nimi/security/advisories/new) 或直接联系 `security@nimi.ai`，详见 [SECURITY.md](SECURITY.md)。
- **代码签名与校验**：各发布渠道的签名范围、平台签名元数据校验与证书策略请查阅 [代码签名政策](https://nimi.ai/code-signing) 与 [SECURITY.md](SECURITY.md)。
- **本地优先原则**：本地模型在设备端执行推理，云端模型通过所选服务商处理请求。账号登录、Realm 内容、应用下载与更新等功能仍需联网通信——本地优先旨在保障核心数据可控，而非完全离线运行。

---

## 本地代码协作

- [CONTRIBUTING.md](CONTRIBUTING.md) — 代码分支规范、测试门禁与 DCO 签名指引。
- [ONBOARDING.md](ONBOARDING.md) — 开发者首日环境配置与跑通检查。
- [LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md) — Windows 与 macOS 深度开发指南。
- [TESTING.md](TESTING.md) — 自动化测试与质量验收策略。
- 根目录及各子目录下的 `AGENTS.md` 定义了各模块的架构约束与开发准则。

---

## 社区与交流

- **代码仓库**：[github.com/nimiplatform/nimi](https://github.com/nimiplatform/nimi)
- **Discord**：[discord.gg/BQwHJvPn](https://discord.gg/BQwHJvPn)
- **开发与维护团队**：Nimi Network Limited

---

## 开源许可证

Nimi 自主编写的组件遵循规范的开源许可：
- Runtime、Cognition、SDK、Proto、App Tools：**Apache-2.0**
- Apps、Kit、官方模板：**MIT**
- 文档与规范内容：**CC-BY-4.0**

第三方依赖与模型权重保留其各自的开源许可证条款。完整许可文本见 [licenses/](licenses/) 目录与根目录 [LICENSE](LICENSE)。
