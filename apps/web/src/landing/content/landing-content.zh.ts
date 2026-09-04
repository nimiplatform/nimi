import type { LandingContent } from './landing-content.js';

export const landingPositioningZh = {
  hero: {
    title: '让 AI 真正',
    titleAccent: '属于你。',
    subtitle: '在 Nimi 中对话、创作和探索，让你的对话、角色、作品与世界，在同一个地方自然延续。',
  },
  desktop: {
    title: 'Nimi，离你更近。',
    description: '把你的对话、创作、角色与世界带到同一个流畅的桌面体验中。',
  },
} as const;

export const landingContentZh: LandingContent = {
  skipToContent: '跳转到主要内容',
  nav: {
    experiences: '体验',
    catalog: '你的 AI',
    desktop: 'Nimi Home',
    apps: '应用',
    sdk: '开发者',
    security: '信任',
    faq: '常见问题',
    docs: '文档',
    download: '下载',
  },
  hero: {
    title: landingPositioningZh.hero.title,
    titleAccent: landingPositioningZh.hero.titleAccent,
    subtitle: landingPositioningZh.hero.subtitle,
    primaryCta: '获取 Nimi',
    secondaryCta: '看看 Nimi 能做什么',
    proofPoints: ['开源', '本地优先', '自由选择 AI'],
  },
  experiences: {
    eyebrow: '你可以这样用 Nimi',
    title: '聊天、创作，或者去新的世界看看。',
    subtitle:
      '继续上次的对话，把灵感做成图片、视频和声音，或者选一个世界，体验新的故事。想做什么，都可以从这里开始。',
    cards: [
      {
        id: 'talk',
        label: '对话',
        title: '下次见面，接着聊',
        description:
          '角色设定和对话中的重要内容都会保留下来。不管是打字还是语音，下次回来都不用再把背景从头说一遍。',
        scenario: '昨天没聊完的话题，今天打开就能继续。',
        points: [
          '保留角色设定与重要记忆',
          '支持文字和语音',
          '本地和云端 AI 都能用',
        ],
      },
      {
        id: 'create',
        label: '创作',
        title: '把想法一步步做出来',
        description:
          '先确定角色的形象、声音和风格，再用你选择的 AI 生成图片、视频、语音或音乐。',
        scenario: '从一段故事开始，再补上画面、配音和音乐。',
        points: [
          '支持图片、视频、语音和音乐',
          '围绕同一角色继续创作',
          '自由选择 AI 服务',
        ],
      },
      {
        id: 'explore',
        label: '探索',
        title: '进入不同的世界',
        description:
          '每个世界都有自己的设定、角色和故事。你可以自由探索，认识新的角色，看看故事会怎样发展。',
        scenario: '选一个感兴趣的世界，先认识一个新角色。',
        points: [
          '多种主题和世界设定',
          '认识不同性格的角色',
          '按自己的方式体验故事',
        ],
      },
    ],
  },
  architecture: {
    title: '一个 Nimi，无限可能。',
    subtitle: 'Nimi 如何连接在一起',
    description:
      'Nimi 把不同的个人 AI 体验带进同一个产品。Realm 让生态身份保持一致，Runtime 则在本地或云端运行 AI 能力。',
    devTitle: '面向构建者',
    devText:
      '通过强类型 SDK 组合源自 Character 的智能体、能力、对话和记忆；Local 或 Cloud 实现都由 Runtime 选择。',
    userTitle: '为你而生',
    userText:
      '在一个地方对话、创作、遇见角色并探索世界，不必把每一种体验都当成独立产品。Nimi 让它们在同一个入口自然相连。',
    conclusion: '一个产品，开放构建，承载不同的 AI 体验。',
    slogan: '你的 AI，你的选择，你的 Nimi。',
    diagram: {
      appLabel: 'AI 应用',
      realm: 'REALM',
      runtime: 'RUNTIME',
      cloudContextPlane: '云端上下文层',
      localExecutionPlane: '本地执行层',
      cloudContext: '云端上下文',
      localCompute: '本地算力',
      realmDomains: [
        { id: 'worlds', label: '世界', icon: '\u{1F310}' },
        { id: 'agents', label: '智能体', icon: '\u{1F916}' },
        { id: 'social', label: '社交', icon: '\u{1F465}' },
        { id: 'economy', label: '经济', icon: '\u{1F4B0}' },
        { id: 'memory', label: '记忆', icon: '\u{1F9E0}' },
        { id: 'identity', label: '身份', icon: '\u{1F464}' },
      ],
      runtimeCapabilities: [
        { id: 'ai-models', label: 'AI 能力', icon: '\u{1F9E0}' },
        { id: 'conversations', label: '对话', icon: '\u{26A1}' },
        { id: 'knowledge', label: '知识库', icon: '\u{1F4DA}' },
      ],
      crossCutting: [
        { id: 'unified-account', label: '统一账户', icon: '\u{1F464}' },
        { id: 'shared-data', label: '共享数据', icon: '\u{1F4BE}' },
        { id: 'shared-auth', label: '统一授权', icon: '\u{1F512}' },
        { id: 'persistent-presence', label: '跨世界持续在场', icon: '\u{1F310}' },
        { id: 'multi-world-exploration', label: '跨世界探索', icon: '\u{1F9ED}' },
        { id: 'seamless-ai', label: '无缝 AI 体验', icon: '\u{2728}' },
      ],
      transportLabels: { rest: 'REST + WebSocket', grpc: 'gRPC' },
      mobileFallback: {
        sdkLabel: '@nimi/sdk',
        sdkDescription: '连接本地与云端智能的统一接入面。',
      },
    },
  },
  modelCatalog: {
    kicker: '你的 AI，你来选',
    title: '和你已经在用的 AI 一起工作。',
    subtitle:
      'Nimi 用同一套能力语言工作，由 Runtime 把每次请求路由到你选择的提供商：几十家云服务，或你自己设备上的模型。',
    overview: {
      searchPlaceholder: '搜索提供商与能力',
      cloudProvidersLabel: '云提供商',
      localModelsLabel: '本地模型',
      modalitiesLabel: '能力',
      modalitiesDescription: '文本 · Embedding · 图像 · 视频 · 音频 · 音乐 · 语音 · 世界',
      shortcutLabel: '⌘K',
      clearSearchLabel: '清除',
      matchingProvidersLabel: '项匹配目录记录',
      liveCatalogLabel: '实时目录',
      supportedByLabel: '提供商家族',
    },
    capabilityLabels: {
      'text.generate': '文本生成',
      'text.embed': 'Embedding',
      'image.generate': '图像生成',
      'video.generate': '视频生成',
      'audio.synthesize': '语音合成',
      'audio.transcribe': '语音转写',
      'music.generate': '音乐生成',
      'realtime.interact': '实时交互',
      'voice.create': '声音创建',
      'world.generate': '世界生成',
    },
    providerDetailSuffix: '项能力',
    noResultsTitle: '没有匹配的目录记录。',
    noResultsDescription: '可以试试提供商或能力名称。',
    providerDisplayNames: {
      anthropic: 'Anthropic',
      aws_polly: 'AWS Polly',
      azure: 'Azure',
      azure_speech: 'Azure Speech',
      bedrock: 'AWS Bedrock',
      cohere: 'Cohere',
      dashscope: 'DashScope',
      deepseek: 'DeepSeek',
      elevenlabs: 'ElevenLabs',
      fireworks: 'Fireworks',
      fish_audio: 'Fish Audio',
      flux: 'FLUX',
      gemini: 'Gemini',
      glm: 'GLM',
      kimi: 'Kimi',
      luma: 'Luma',
      mistral: 'Mistral',
      mochi: 'Mochi',
      moonshot: 'Moonshot',
      openai: 'OpenAI',
      openai_compatible: 'OpenAI Compatible',
      perplexity: 'Perplexity',
      pika: 'Pika',
      qwen: 'Qwen',
      replicate: 'Replicate',
      runway: 'Runway',
      sora: 'Sora',
      stability: 'Stability',
      suno: 'Suno',
      together: 'Together',
      udio: 'Udio',
      veo: 'Veo',
      viggle: 'Viggle',
      volcengine: 'Volcengine',
      x_ai: 'xAI',
      xai: 'xAI',
      yi: 'Yi',
    },
    marqueeProviderOrder: ['openai', 'anthropic', 'gemini', 'deepseek', 'dashscope', 'volcengine'],
  },
  sdk: {
    eyebrow: '开发者专区',
    title: '一个 SDK，',
    titleAccent: '多种运行 AI 的方式。',
    subtitle: '通过统一的强类型接入面组合源自 Character 的智能体、能力、对话和共享环境；Runtime 管理 Local 或 Cloud 执行。',
    callout: '查看 SDK 参考',
    primaryCta: '阅读 SDK 文档',
    secondaryCta: '查看源码',
    codeWindowTitle: 'Nimi SDK / 智能体运行时',
    codeWindowCaption: '用一个强类型接入面连接智能体上下文、Runtime 任务和 Local 或 Cloud 能力意图。',
    matrixEyebrow: 'SDK 能力矩阵',
    matrixTitle: '完整 SDK 能力一览。',
    matrixSubtitle: 'SDK 的每个能力域都列在这里，并直接链接到参考文档。',
    runtimeBadges: ['Type-safe SDK', 'Runtime-backed', 'Local-first', 'Agent Context'],
    heroHighlights: [
      {
        title: 'Realm 与 Runtime 客户端',
        description: '通过类型化的所有者接口访问 Realm 产品数据与 Runtime 的 LocalAgent 行为。',
      },
      {
        title: '任务与状态同步',
        description: '用强类型事件流协调任务交接、世界事件和运行状态更新。',
      },
      {
        title: '本地 / 云端一体运行',
        description: '使用同一份能力契约，由 Runtime 解释 owner 的 Local 或 Cloud 意图。',
      },
    ],
    tabs: [
      {
        id: 'delegation',
        label: '任务委派',
        description: '在智能体与人之间交接任务，带强类型上下文交接与审计轨迹。',
        docsPath: 'sdk/delegation-client',
        previewMediaId: 'runtime',
      },
      {
        id: 'local-environment',
        label: '本地环境',
        description: '将共享环境映射到本地会话 —— 文件、工具与运行时状态。',
        docsPath: 'sdk/local-environment-projection',
        previewMediaId: 'runtime',
      },
      {
        id: 'ai-config',
        label: 'AI 配置',
        description: '为各项已准入能力表达 owner 范围内的 Local 或 Cloud 意图；具体实现由 Runtime 选择。',
        docsPath: 'sdk/ai-config-surface',
        previewMediaId: 'sdk',
      },
      {
        id: 'wee-projection',
        label: '世界事件',
        description: '把世界执行事件作为强类型数据流式输出，供产品消费者使用。',
        docsPath: 'sdk/wee-projection',
        previewMediaId: 'streamJob',
      },
      {
        id: 'wee-consumer',
        label: 'WEE 消费',
        description: '订阅世界执行事件，并保持回压安全的消费机制。',
        docsPath: 'sdk/wee-consumer',
        previewMediaId: 'streamJob',
      },
      {
        id: 'transport-error',
        label: '传输与错误',
        description: '强类型传输契约 + 全 SDK 一致的结构化错误语义。',
        docsPath: 'sdk/transport-and-error',
        previewMediaId: 'runtime',
      },
    ],
    capabilityMatrix: [
      {
        title: '任务委派',
        description: '在智能体与人之间交接任务，带强类型上下文交接与审计轨迹。',
        docsPath: 'sdk/delegation-client',
      },
      {
        title: '本地环境',
        description: '将共享环境映射到本地会话 —— 文件、工具与运行时状态。',
        docsPath: 'sdk/local-environment-projection',
      },
      {
        title: 'AI 配置',
        description: '为各项已准入能力表达 owner 范围内的 Local 或 Cloud 意图；具体实现由 Runtime 选择。',
        docsPath: 'sdk/ai-config-surface',
      },
      {
        title: '世界事件',
        description: '把世界执行事件作为强类型数据流式输出，供产品消费者使用。',
        docsPath: 'sdk/wee-projection',
      },
      {
        title: 'WEE 消费',
        description: '订阅世界执行事件，并保持回压安全的消费机制。',
        docsPath: 'sdk/wee-consumer',
      },
      {
        title: '传输与错误',
        description: '强类型传输契约 + 全 SDK 一致的结构化错误语义。',
        docsPath: 'sdk/transport-and-error',
      },
    ],
    previewMedia: {
      sdk: { alt: 'Nimi SDK 快速上手预览' },
      multimodal: { alt: 'Nimi 多模态客户端预览' },
      streamJob: { alt: 'Nimi stream job 预览' },
      runtime: { alt: 'Nimi Runtime 强类型客户端预览' },
    },
  },
  desktop: {
    title: landingPositioningZh.desktop.title,
    subtitle: landingPositioningZh.desktop.description,
    chromeLabels: {
      appName: 'Nimi',
      runtime: 'AI 引擎',
      workspace: '工作区',
      capabilities: '谁在哪里运行',
      localIntent: '在这台设备上',
      cloudIntent: '在云端',
    },
    capabilitiesList: [
      { name: '对话与文本', intent: 'local' },
      { name: '图像创作', intent: 'cloud' },
      { name: '语音与声音', intent: 'local' },
    ],
    features: [
      {
        icon: 'dashboard',
        title: '一眼看清全局',
        description: '活跃会话、AI 用量和设备负载，都在同一个视图里。',
      },
      { icon: 'chat', title: '内置聊天', description: '在同一个窗口里和人、AI 助手和 Nimi 智能体对话。' },
      { icon: 'models', title: '本地 AI 管理', description: '在一处安装和更新设备上的 AI 模型。' },
      { icon: 'apps', title: '应用都在一处', description: '在同一个工作区打开可用的 Nimi App 和已连接的本地应用。' },
    ],
    downloadCta: '查看下载状态',
    availability: {
      eyebrow: '发布状态',
      items: [
        'Windows signed RC 与 Stable 等待 production code signing',
        'Unsigned preview 只使用不可晋升的 vX.Y.Z-preview.N 显式 tag',
        '目前没有已发布的 Nimi 稳定版',
      ],
    },
  },
  apps: {
    eyebrow: 'Nimi Apps',
    title: '把新的能力接入 Nimi。',
    subtitle:
      'Nimi App 是可以在 Nimi 里打开和使用的小应用：它可以带来新的工具、场景或本地 AI 体验。Nimi Home 会显示当前账号与本地工作区可用的内容；开发者用 SDK 构建，并按清晰的产品规则交付。',
    cta: '查看 Nimi App 文档',
    cards: [
      {
        label: '使用',
        title: '一个地方打开应用',
        description:
          '在 Nimi Home 的 Apps 界面打开当前产品环境中可用的工具、场景或本地 AI 体验，不需要理解底层运行方式。',
      },
      {
        label: '开发',
        title: '用 SDK 接入 Nimi',
        description:
          '开发者可以把产品功能做成 Nimi App，通过 SDK 调用 Runtime 能力，无需选择具体实现。',
      },
      {
        label: '本地',
        title: '连接本地 App',
        description:
          '本地 App 可以显式连接到 Nimi，适合团队内测、个人工具或尚未公开发布的应用。',
      },
    ],
    notes: [
      '新的产品工作统一走 Nimi Apps 路径。',
      'Nimi Apps 定义目录、本地导入、安装、更新、启动、修复、卸载和 Developer Mode 的生命周期契约。当前预发布仅开放 Developer Mode 本地开发路径；公开目录、本地导入、普通安装、已安装 App 启动、发布者发布和 registry onboarding 尚不可用。',
      '公开应用目录尚未开放；Nimi 只显示你今天真正能打开的内容。',
      '想构建 App，请从 SDK 与 Nimi App 文档开始。',
    ],
  },
  faq: {
    eyebrow: 'FAQ',
    title: '常见问题',
    description: '大多数人在深入了解前会问的问题，完整内容请阅读文档。',
    communityCta: '加入 Discord',
    items: [
      {
        question: 'Nimi 是什么？',
        answer:
          'Nimi 是一个开源、本地优先的个人 AI 产品：在同一个地方对话、创作、遇见角色、探索世界，并自由选择本地或云端 AI。',
      },
      {
        question: '今天能下载 Nimi 吗？',
        answer:
          '还不能。目前没有已发布的 Nimi 稳定版：Windows 签名仍在审批，只有未签名的开发者预览版。关注 GitHub 或加入 Discord，稳定版发布时会第一时间公布。',
      },
      {
        question: '我的数据私密吗？',
        answer:
          'Nimi 是本地优先的：对话和 AI 工作可以完全用本地模型在你自己的设备上运行。只有你主动选择时，才会用到云提供商。',
      },
      {
        question: 'Nimi 支持哪些 AI 提供商？',
        answer:
          '几十家云提供商：OpenAI、Anthropic、Gemini、DeepSeek 等等，加上完全在你自己机器上运行的本地模型。每项能力由你选，Runtime 负责执行。',
      },
      {
        question: 'Nimi 是开源的吗？',
        answer:
          '是。Runtime 与 SDK 以 Apache-2.0 发布，应用层以 MIT 发布，完整源码在 GitHub 上。',
      },
      {
        question: '我是开发者，从哪里开始？',
        answer:
          '从 SDK 文档和 Developer Mode 本地开发路径开始：在本地搭一个 Nimi App，用强类型 SDK 构建。公开目录分发尚未开放。',
      },
    ],
  },
  security: {
    title: '信任、安全与发布完整性。',
    subtitle: '查看源码、私下报告安全问题，并在下载前核对真实发布状态。',
    intro:
      'Nimi 直接提供源码、安全报告、发布可用性和代码签名状态入口；尚未完成的工作会明确标为 pending。',
    linksAriaLabel: 'Nimi 信任与安全入口',
    pillars: [
      {
        label: '源码与文档',
        title: '了解 Nimi 如何构建',
        points: [
          '源代码公开在 github.com/nimiplatform/nimi。',
          '产品与开发者文档发布在 docs.nimi.ai。',
        ],
      },
      {
        label: '安全',
        title: '私下报告安全问题',
        points: [
          '通过 GitHub Security Advisories 私下提交漏洞。',
          '安全邮箱：security@nimi.ai。',
        ],
      },
      {
        label: '代码签名',
        title: '验证具体制品，不依赖口头承诺',
        points: [
          'Windows production signing 尚不可用；SignPath Foundation 申请将在公开 unsigned Runtime bootstrap 之后进行。',
          'Authenticode 验证通过前，任何当前 Nimi 制品都不能被视为 SignPath-signed。',
        ],
      },
    ],
    statuses: [
      { label: 'Windows', value: 'Windows signed RC 与 Stable 等待 production code signing' },
      { label: 'SignPath Foundation', value: '申请尚未提交；计划在 unsigned bootstrap 之后进行' },
    ],
    links: [
      { label: '下载', detail: '稳定版与 unsigned preview 状态', href: '/download' },
      { label: 'Code signing policy', detail: '范围、控制与验证说明', href: '/code-signing' },
      { label: '源代码', detail: 'github.com/nimiplatform/nimi', href: 'https://github.com/nimiplatform/nimi' },
      { label: '文档', detail: 'docs.nimi.ai', href: 'https://docs.nimi.ai' },
      { label: 'GitHub Security Advisories', detail: '私下提交漏洞', href: 'https://github.com/nimiplatform/nimi/security/advisories/new' },
      { label: 'security@nimi.ai', detail: '安全邮箱', href: 'mailto:security@nimi.ai' },
    ],
  },
  openSource: {
    title: '从头到尾，全部开源。',
    subtitle: '读 runtime、读 SDK、读规范。',
    description:
      'Nimi 在 Runtime、SDK 与应用层使用宽松许可证发布，并建立在可阅读、fork 和扩展的契约之上。',
    githubCta: '查看 GitHub',
    docsCta: '阅读文档',
    roadmapCta: '阅读路线图',
    proofItems: [
      {
        label: 'Runtime + SDK',
        value: 'Apache-2.0',
        detail: '核心 runtime 与 SDK 开放可审，clone、构建、本地运行皆可。',
        icon: 'runtime',
      },
      {
        label: '应用层',
        value: 'MIT',
        detail: '桌面端与 app 层以宽松许可证发布，fork、上线、嵌入。',
        icon: 'apps',
      },
      {
        label: '契约',
        value: 'Public',
        detail: '托管的云端层通过公开 SDK 边界保持可见。',
        icon: 'contracts',
        featured: true,
      },
    ],
  },
  footer: {
    line1: `${landingPositioningZh.hero.title} ${landingPositioningZh.hero.titleAccent}`,
    line2: '阅读文档了解当前可用功能与路线图。',
    termsLabel: '服务条款',
    privacyLabel: '隐私政策',
    downloadLabel: '下载',
    codeSigningLabel: '代码签名政策',
    securityLabel: '安全报告',
  },
  localeToggleLabel: '语言',
  localeOptions: {
    en: 'English',
    zh: '中文',
    switchToEn: '切换语言为英文',
    switchToZh: '切换语言为中文',
  },
};
