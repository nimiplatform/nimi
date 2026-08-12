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
    getStartedSubtitle: '选择接入入口',
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
      'Nimi 提供强类型 SDK，用于构建跨越持续世界、自主智能体、共享记忆、身份、社交与经济的 AI 体验。Runtime 在 Local 或 Cloud 环境执行能力。',
    devTitle: '面向构建者',
    devText:
      '通过强类型 SDK 组合源自 Character 的智能体、能力、对话和记忆；Local 或 Cloud 实现都由 Runtime 选择。',
    userTitle: '面向产品用户',
    userText:
      'Nimi 是 AI 开放世界平台 —— 智能体跨会话持续存在、跨世界共享状态，并通过边界清楚的 runtime 能力行动。不是聊天框封装，不是单一用途的应用。',
    conclusion: '概念驱动、契约优先、跨平台运行时。',
    slogan: '代码、契约与世界归创建者。',
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
    kicker: 'Runtime 实现目录',
    title: '一套能力 API，由 Runtime 选择具体实现。',
    subtitle: '浏览 Runtime 管理的 Cloud 实现和 Local 资源兼容性；App 请求始终以能力为单位。',
    overview: {
      searchPlaceholder: '搜索实现家族与能力',
      cloudProvidersLabel: 'Cloud 实现',
      localModelsLabel: 'Local 资源',
      modalitiesLabel: '能力',
      modalitiesDescription: '文本 · Embedding · 图像 · 视频 · 音频 · 音乐 · 语音 · 世界',
      shortcutLabel: '⌘K',
      clearSearchLabel: '清除',
      matchingProvidersLabel: '项匹配目录记录',
      liveCatalogLabel: 'Runtime 目录',
      supportedByLabel: '已准入实现家族',
    },
    capabilityLabels: {
      'text.generate': '文本生成',
      'text.embed': 'Embedding',
      'image.generate': '图像生成',
      'video.generate': '视频生成',
      'audio.synthesize': '语音合成',
      'audio.transcribe': '语音转写',
      'music.generate': '音乐生成',
      'voice.create': '声音创建',
      'world.generate': '世界生成',
    },
    providerDetailSuffix: '项能力',
    noResultsTitle: '没有匹配的目录记录。',
    noResultsDescription: '可改用能力或实现家族关键词。',
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
    subtitle: '通过统一的强类型接入面组合源自 Character 的智能体、能力、对话和共享环境；Runtime 管理 Local 或 Cloud 执行。',
    callout: '查看 SDK 参考',
    primaryCta: '阅读 SDK 文档',
    secondaryCta: '查看源码',
    codeWindowTitle: 'Nimi SDK / 智能体运行时',
    codeWindowCaption: '用一个强类型接入面连接智能体上下文、Runtime 任务和 Local 或 Cloud 能力意图。',
    matrixEyebrow: 'SDK 能力矩阵',
    matrixTitle: '详细能力点移动到下一屏。',
    matrixSubtitle: '首屏保持产品叙事；原来的 SDK 能力点保留为可扫描的矩阵，并直接链接到参考文档。',
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
    title: '原生 Desktop，真实的 Web 边界。',
    subtitle:
      'Desktop 是包含 Runtime、本地 AI 和原生外壳的完整应用。Web mode 使用同一套外壳和明确的 web-only adapter；两者都是正式产品表面。',
    chromeLabels: {
      appName: 'Nimi',
      runtime: 'Runtime',
      workspace: '工作区',
      capabilities: '能力意图',
      localIntent: '本地意图',
      cloudIntent: '云端意图',
    },
    features: [
      {
        icon: 'dashboard',
        title: 'Runtime 概览',
        description: '一眼查看 Runtime 活动、资源占用和活跃会话。',
      },
      { icon: 'chat', title: '内置聊天', description: '同一个对话界面支持本地或云端能力意图。' },
      { icon: 'models', title: '本地 AI 资源', description: '在一处安装和更新由 Runtime 管理的 AI 资源。' },
      { icon: 'apps', title: '应用启动器', description: '在同一个工作区打开可用的 Nimi App 与已连接的本地 App。' },
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
          '一个面向持续世界与有形智能体的开源 AI 运行时。通过统一的强类型 SDK 组合能力、对话与共享记忆。',
      },
      {
        question: '如何开始接入？',
        answer:
          '阅读 SDK 文档并安装强类型客户端，再连接 Local 或 Cloud Runtime；两种环境使用同一套 SDK 和契约。',
      },
      {
        question: 'AI 能力可以在本地执行吗？',
        answer:
          '可以。Owner 表达 Local 能力意图后，Runtime 可以使用机器上的已准入资源执行，App 请求形态保持不变。',
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
        title: '能力与实现目录来自数据',
        points: ['Runtime 实现与能力信息由规范表生成。', '页面尽量少写空泛承诺，多展示可以追溯的内容。'],
      },
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
