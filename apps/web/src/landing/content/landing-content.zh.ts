import type { LandingContent } from './landing-content.js';

const ZH_SPEC_NOTE = `权威路径：.nimi/spec/**
文档入口：/docs/reference/spec-map
边界：公开展示面，不是独立真相`;

export const landingContentZh: LandingContent = {
  skipToContent: '跳转到主要内容',
  nav: {
    enterNimi: '进入 Nimi',
    install: '开始',
    sdk: 'SDK',
    catalog: 'Runtime',
    architecture: '平台',
    desktop: 'Desktop',
    apps: 'Apps',
    security: 'Governance',
    openSource: 'Source',
    faq: '常见问题',
  },
  hero: {
    eyebrow: '开源、本地优先的 AI 运行时',
    title: '让智能体在世界里生活，',
    titleAccent: '不只是聊天框里。',
    subtitle: '开源运行时、强类型 SDK、多 provider AI 与有形的智能体 —— 全部基于可阅读的契约。',
    helperPrefix: '或',
    helperDocsCta: '阅读文档',
    helperGithubCta: '查看源码',
    copyTooltipLabel: '复制链接',
    copiedCommandLabel: '已复制',
    previewAlt: 'Nimi runtime 快速上手预览',
    getStartedTitle: '快速上手',
    getStartedSubtitle: '选择你的接入入口',
    tabs: [
      {
        id: 'start',
        label: '源码',
        command: 'pnpm install && pnpm build:runtime',
        ctaText: '阅读上手文档',
      },
      {
        id: 'runtime',
        label: 'CLI',
        command: './dist/nimi doctor',
        ctaText: '阅读 Runtime 文档',
      },
      {
        id: 'platform',
        label: 'Platform',
        command: 'docs.nimi.ai/zh/platform',
        ctaText: '阅读平台文档',
      },
      { id: 'sdk', label: 'SDK', command: 'docs.nimi.ai/zh/sdk', ctaText: '阅读 SDK 文档' },
    ],
  },
  architecture: {
    title: '一个平台，多个世界。',
    subtitle: '架构',
    description:
      'Nimi 提供强类型 SDK，让你构建跨越持续世界的 AI 体验 —— 自主智能体、共享记忆、身份、社交与经济 —— 由可本地或云端运行的 runtime 桥接。',
    devTitle: '面向构建者',
    devText:
      '通过强类型 SDK 接入。无论运行在笔记本上还是你掌控的云端基础设施，都以同样方式组合源自 Character 的智能体、模型、对话和记忆。',
    userTitle: '面向产品用户',
    userText:
      'Nimi 是 AI 开放世界平台 —— 智能体跨会话持续存在、跨世界共享状态，并通过边界清楚的 runtime 能力行动。不是聊天框封装，不是单一用途的应用。',
    conclusion: '概念驱动、契约优先、跨平台运行时。',
    slogan: '你的代码、你的契约、你的世界。',
    diagram: {
      appLabel: '你的 AI 应用',
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
        { id: 'ai-models', label: 'AI 模型', icon: '\u{1F9E0}' },
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
    kicker: 'Provider 路由',
    title: '一套 API，路由到任意模型。',
    subtitle: '通过统一的强类型接入面连接到支持的 provider —— 选模型、接集成。',
    overview: {
      searchPlaceholder: '搜索 provider、模型与能力',
      cloudProvidersLabel: '云端 Provider',
      localModelsLabel: '本地模型',
      modalitiesLabel: '能力',
      modalitiesDescription: '文本 · Embedding · 图像 · 视频 · 音频 · 音乐 · 语音 · 世界',
      industryLeadersLabel: '覆盖主流 provider',
      shortcutLabel: '⌘K',
      clearSearchLabel: '清除',
      matchingProvidersLabel: '个匹配 provider',
      liveCatalogLabel: '实时目录',
      supportedByLabel: '由以下平台支持',
    },
    liveBadge: '开放目录',
    featuredProvidersLabel: '主要 provider',
    stats: {
      providers: 'provider',
      models: '默认模型',
      cloudProviders: '云端 provider',
      localModels: '本地 provider',
    },
    localTitle: '本地执行',
    localHeadline: '在你自己的机器上跑模型。',
    localDescription:
      '本地 provider 路由通过 runtime 在你的硬件上执行 —— 同一套 SDK、同一套能力类型，没有云端往返。',
    capabilitiesTitle: '能力矩阵',
    capabilitiesHeadline: '覆盖 12 类受支持能力，横跨各 provider。',
    capabilitiesDescription:
      '文本生成、视觉、Embedding、图像与视频生成、语音合成与转写、音乐生成、声音克隆与设计、世界生成 —— 每类能力都展示支持它的 provider。',
    capabilityLabels: {
      'text.generate': '文本生成',
      'text.embed': 'Embedding',
      'image.generate': '图像生成',
      'video.generate': '视频生成',
      'audio.synthesize': '语音合成',
      'audio.transcribe': '语音转写',
      'music.generate': '音乐生成',
      'music.generate.iteration': '音乐迭代',
      'text.generate.vision': '视觉语言',
      'voice_workflow.voice_clone': '声音克隆',
      'voice_workflow.voice_design': '声音设计',
      'world.generate': '世界生成',
    },
    capabilityCountLabel: '种能力类别',
    cloudBadge: '云端',
    matrixTitle: 'Provider 矩阵',
    matrixHeadline: '选定模型，自动路由到对应 provider。',
    matrixDescription:
      '每个 provider 支持一项或多项能力类别。Runtime 根据你的配置选择路由的模型 —— 切换 provider 不必修改调用点。',
    providerDetailSuffix: '项能力',
    searchResultsTitle: '搜索结果',
    searchResultsDescription: '按名称、默认模型或受支持能力筛选 provider。',
    noResultsTitle: '没有匹配的 provider。',
    noResultsDescription: '换个关键词，或在路由文档查看完整目录。',
    sourceNote: '阅读路由文档了解完整的 provider 配置与能力细节。',
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
    eyebrow: '一套强类型 SDK',
    title: '一个 SDK，',
    titleAccent: '多种运行 AI 的方式。',
    subtitle: '通过统一的强类型接入面，组合源自 Character 的智能体、模型、对话和共享环境 —— 本地或云端运行皆可。',
    callout: '查看 SDK 参考',
    primaryCta: '阅读 SDK 文档',
    secondaryCta: '查看源码',
    codeWindowTitle: 'Nimi SDK / 智能体运行时',
    codeWindowCaption: '用一个强类型接入面连接智能体上下文、运行时任务和本地/云端路由。',
    matrixEyebrow: 'SDK 能力矩阵',
    matrixTitle: '详细能力点移动到下一屏。',
    matrixSubtitle: '首屏保持产品叙事；原来的 SDK 能力点保留为可扫描的矩阵，并直接链接到参考文档。',
    runtimeBadges: ['Type-safe SDK', 'Runtime Ready', 'Local-first', 'Agent Context'],
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
        description: '优先连接本地 runtime，再用同一套契约路由到你掌控的云端基础设施。',
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
        description: '一个配置面统管模型选择、能力路由与 provider 偏好。',
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
        description: '一个配置面统管模型选择、能力路由与 provider 偏好。',
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
    title: '原生 Desktop，真实的 Web 边界。',
    subtitle:
      'Desktop 是完整应用 —— 内嵌 runtime、本地 AI、跑在你自己的机器上。Web mode 用同一套外壳加上明确的 web-only adapter。两边都是真实的产品面。',
    chromeLabels: {
      appName: 'Nimi',
      runtime: 'Runtime',
      health: '状态正常',
      healthDetail: 'gRPC 已就绪，本地 runtime 已连接。',
      workspace: '工作区',
      activity: '活动',
      ready: '就绪',
      connected: '已连接',
      installed: '已安装',
    },
    features: [
      {
        icon: 'dashboard',
        title: 'Runtime 仪表盘',
        description: '一眼看清模型状态、资源占用和活跃会话。',
      },
      { icon: 'chat', title: '内置聊天', description: '在同一个工作区里对话本地与云端模型。' },
      { icon: 'models', title: '模型管理', description: '一处安装、更新、切换模型。' },
      { icon: 'apps', title: '应用启动器', description: '在同一个工作区里打开可用的 Nimi App 与你连接的本地 App。' },
    ],
    downloadCta: '阅读 Desktop 文档',
    availability: {
      eyebrow: '已可用',
      items: [
        '原生外壳，覆盖 macOS、Linux 与 Windows',
        '通过 web mode 支持纯浏览器会话',
        '本地 AI 与 runtime 内置',
      ],
    },
  },
  apps: {
    eyebrow: 'Nimi Apps',
    title: '把新的能力装进 Nimi。',
    subtitle:
      'Nimi App 是可以在 Nimi 里打开和使用的小应用：它可以带来新的工具、场景或本地 AI 体验。Desktop 会显示当前账号与本地工作区可用的内容；开发者用 SDK 构建，并按清晰的产品规则交付。',
    cta: '查看 Desktop 文档',
    cards: [
      {
        label: '使用',
        title: '一个地方打开应用',
        description:
          '在 Desktop 的 Apps 界面打开当前产品环境中可用的工具、场景或本地 AI 体验，不需要理解底层运行方式。',
      },
      {
        label: '开发',
        title: '用 SDK 接入 Nimi',
        description:
          '开发者可以把自己的功能做成 Nimi App，通过 SDK 调用模型和 Runtime 能力，让应用在 Nimi 的环境里工作。',
      },
      {
        label: '本地',
        title: '连接你自己的 App',
        description:
          '本地 App 可以显式连接到 Nimi，适合团队内测、个人工具或尚未公开发布的应用。',
      },
    ],
    notes: [
      '新的产品工作统一走 Nimi Apps 路径。',
      '首页不提前承诺尚未开放的公开应用目录；实际可打开内容以产品内显示为准。',
      '想构建 App，请从 SDK 与 Desktop 文档开始。',
    ],
  },
  faq: {
    eyebrow: 'FAQ',
    title: '常见问题',
    description: '面向构建者与产品用户的快速答案 —— 完整内容请阅读文档。',
    communityCta: '加入 Discord',
    items: [
      {
        question: 'Nimi 是什么？',
        answer:
          '一个面向持续世界与有形智能体的开源 AI 运行时。通过统一的强类型 SDK 组合模型、对话与共享记忆。',
      },
      {
        question: '如何开始接入？',
        answer:
          '阅读 SDK 文档，安装强类型客户端，连接到本地或你自己的云端 runtime —— 同一套 SDK、同一套契约。',
      },
      {
        question: '能本地运行模型吗？',
        answer:
          '可以。Runtime 通过本地 provider 在你的硬件上执行 —— 支持本地路由的路径无需云端往返。',
      },
      {
        question: 'Nimi 是开源的吗？',
        answer:
          '是。Runtime 与 SDK 以 Apache-2.0 发布；桌面端与 app 层代码以 MIT 发布。完整源码在 GitHub 上。',
      },
      {
        question: 'Desktop 与 Web mode 有什么区别？',
        answer:
          'Desktop 是完整应用 —— 内嵌 runtime、本地 AI、原生外壳。Web mode 用同一套外壳加上 web-only adapter 支持纯浏览器会话。',
      },
      {
        question: '可以开发自己的 Nimi App 吗？',
        answer:
          '可以。开发者可以从 SDK 与 Desktop 文档开始，通过 Nimi Apps 路径把工具、场景或本地 AI 体验接入 Nimi。',
      },
    ],
  },
  security: {
    title: '规则公开，边界清楚。',
    subtitle: '用户知道自己在用什么，开发者知道该从哪里接入。',
    intro:
      'Nimi 把运行时、SDK、桌面端和应用层分清楚：该开放的入口写清楚，该保护的私有实现不绕开。',
    pillars: [
      {
        label: '公开规则',
        title: '关键规则写在仓库里',
        points: [
          '公开产品规则放在 .nimi/spec/** 中，可以被阅读和审查。',
          '文档与首页跟随同一份来源更新，减少口径漂移。',
        ],
      },
      {
        label: '清晰接入',
        title: '该用公开接口就用公开接口',
        points: [
          '开发者从 SDK、Desktop 与文档入口接入。',
          '应用不需要碰私有实现，也不会绕过用户看不见的规则。',
        ],
      },
      {
        label: '目录可信',
        title: '模型与能力目录来自数据',
        points: ['Provider、模型与能力信息由规范表生成。', '页面尽量少写空泛承诺，多展示可以追溯的内容。'],
      },
    ],
  },
  openSource: {
    title: '从头到尾，全部开源。',
    subtitle: '读 runtime、读 SDK、读规范。',
    description:
      'Nimi 在 runtime、SDK 与应用层全部以宽松许可证发布 —— 建立在你可以阅读、fork、扩展的契约之上。',
    githubCta: '查看 GitHub',
    docsCta: '阅读文档',
    roadmapCta: '阅读路线图',
    proofItems: [
      {
        label: 'Runtime + SDK',
        value: 'Apache-2.0',
        detail: '核心 runtime 与 SDK 开放可审 —— clone、构建、本地运行皆可。',
        icon: 'runtime',
      },
      {
        label: '应用层',
        value: 'MIT',
        detail: '桌面端与 app 层以宽松许可证发布 —— fork、上线、嵌入。',
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
    line1: '面向应用的开源 AI 运行时：一个 CLI、一个 SDK，本地与云端 AI。',
    line2: '阅读文档了解当前可用功能与路线图。',
    termsLabel: '服务条款',
    privacyLabel: '隐私政策',
  },
  localeToggleLabel: '语言',
  localeOptions: {
    en: 'English',
    zh: '中文',
    switchToEn: '切换语言为英文',
    switchToZh: '切换语言为中文',
  },
};
