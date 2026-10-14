# Nimi Home 桌面工作空间

Nimi Home 是 Nimi 个人 AI 平台的统一桌面工作空间。它将人机深度对话、数字角色互动、内容创作、虚拟世界探索与个人桌面应用整合在同一入口中，让你在自己的设备上组织日常任务，并灵活调用本地或云端 AI。

在平台架构分工中：
- **Runtime** 负责本地 GPU 推理调度、云端连接器与密钥安全存储。
- **Realm** 维护生态身份、社交关系与持久化的世界状态。
- **Nimi Home** 是面向用户的使用入口，当前由 Desktop 承载并监管各 App 进程。

---

## 核心功能区域

1. **主页与动态中心（Home & Activity）**
   - 随时接续上次未完成的对话、任务与创作草稿。
   - 查看本地服务健康度、硬件加速就绪状态与待处理提醒。
   - 浏览关注好友与认证 AI 角色的最新动态。
2. **角色与世界（Characters & Worlds）**
   - 与拥有持久记忆和独特说话风格的 AI 角色持续交流。
   - 探索由生态创作者构建的数字世界。
3. **应用中心（Apps & Developer Mode）**
   - **应用库**：启动并管理已安装的官方与第三方桌面应用。
   - **本地导入（Local Import）**：直接导入手动选择的不可变 `.nimiapp` 包，无需经过 Registry 准入；若应用自身包含在线功能，运行时仍需联网。
   - **开发者模式（Developer Mode）**：面向应用开发者，支持注册本地工程目录、调试权限声明与即时热重载。
4. **AI 能力与算力配置（Capability Settings）**
   - 管理本机模型权重及所需的推理引擎。
   - 为不同能力（如文本生成、语音合成、视觉理解）指定默认运行方案（Loadout），或配置云端服务连接器。

---

## 本地 App 开发与运行

Nimi Home 通过进程隔离与开发工具链支持桌面应用的运行与调试：

- **受管 Electron 宿主**：App 运行在由 Desktop 监管的独立宿主进程中，安全通信桥接由宿主自动注入，前端代码无需也不应硬编码 API Key 或底层 gRPC 端口。
- **三种生命周期模式**：
  1. **开发者模式（Developer Mode）**：直接加载本地工程源码，支持热更新与本地回环 CDP 调试检查。
  2. **本地导入（Local Import）**：导入手动选择的不可变应用包，用于本地验证与使用。
  3. **官方目录（Registry）**：通过 Registry 准入审核后上架公开目录。应用包由发布者负责签名；符合适用策略的未签名包也可获准收录。
- **当前受支持平台**：桌面应用运行与生命周期管理当前支持 **Windows (x86_64)** 与 **macOS (arm64)**。这两个平台已实现本地导入功能（整体产品验收与公开发布准备独立评估）；其他平台的应用包生命周期暂不可用；所有平台的常规修复也尚未开放。

---

## 快速导航

- [创建第一个 Nimi App](/zh/start/create-an-app) — 使用脚手架创建并启动首个项目
- [发起第一次 AI 调用](/zh/sdk/first-ai-call) — 用几行代码接入本地或云端模型
- [AI 能力与模型配置](/zh/desktop/local-ai) — 管理本机模型与算力调度方案
- [对话模式与消息历史](/zh/desktop/chat) — 了解智能体会话与流式交互机制

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/platform/product-lifecycle.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/product-lifecycle.authority.yaml)
- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
