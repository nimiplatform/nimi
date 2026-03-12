import type { LandingLocale } from '../i18n/locale.js';

export type LandingContent = {
  localeName: string;
  skipToContent: string;
  nav: {
    install: string;
    sdk: string;
    catalog: string;
    architecture: string;
    desktop: string;
    security: string;
    mods: string;
    openSource: string;
  };
  hero: {
    eyebrow: string;
    title: string;
    titleAccent: string;
    title2: string;
    titleAccent2: string;
    subtitle: string;
    description: string;
    primaryCta: string;
    docsCta: string;
    helperPrefix: string;
    helperDocsCta: string;
    helperGithubCta: string;
    copyTooltipLabel: string;
    copiedCommandLabel: string;
    githubCta: string;
    previewLabel: string;
    previewAlt: string;
    previewCaption: string;
    getStartedTitle: string;
    getStartedSubtitle: string;
    tabs: Array<{
      id: string;
      label: string;
      command: string;
      ctaText: string;
    }>;
    terminalMockupTitle: string;
  };
  architecture: {
    title: string;
    subtitle: string;
    description: string;
    devTitle: string;
    devText: string;
    userTitle: string;
    userText: string;
    conclusion: string;
    slogan: string;
  };
  modelCatalog: {
    kicker: string;
    title: string;
    subtitle: string;
    overview: {
      searchPlaceholder: string;
      cloudProvidersLabel?: string;
      localModelsLabel?: string;
      modalitiesLabel?: string;
      modalitiesValue?: string;
      modalitiesDescription?: string;
      industryLeadersLabel: string;
      shortcutLabel: string;
      clearSearchLabel: string;
      matchingProvidersLabel: string;
      liveCatalogLabel: string;
    };
    liveBadge: string;
    featuredProvidersLabel: string;
    featuredProviders: string[];
    stats: {
      providers: string;
      models: string;
      cloudProviders: string;
      localModels: string;
    };
    localTitle: string;
    localHeadline: string;
    localDescription: string;
    capabilitiesTitle: string;
    capabilitiesHeadline: string;
    capabilitiesDescription: string;
    capabilityLabels: {
      'text.generate': string;
      'text.embed': string;
      'image.generate': string;
      'video.generate': string;
      'audio.synthesize': string;
      'audio.transcribe': string;
    };
    capabilityCountLabel: string;
    cloudBadge: string;
    matrixTitle: string;
    matrixHeadline: string;
    matrixDescription: string;
    providerDetailSuffix: string;
    searchResultsTitle: string;
    searchResultsDescription: string;
    noResultsTitle: string;
    noResultsDescription: string;
    sourceNote: string;
  };
  sdk: {
    title: string;
    subtitle: string;
    tabs: Array<{
      label: string;
      snippet: string;
      caption: string;
    }>;
    previewLabel: string;
    previewAlt: string;
    previewCaption: string;
    multimodalLabel: string;
    multimodalAlt: string;
    multimodalCaption: string;
    callout: string;
  };
  desktop: {
    title: string;
    subtitle: string;
    screenshotAlt: string;
    features: Array<{
      icon: string;
      title: string;
      description: string;
    }>;
    downloadCta: string;
  };
  security: {
    title: string;
    subtitle: string;
    intro: string;
    pillars: Array<{
      label: string;
      title: string;
      points: string[];
    }>;
  };
  mods: {
    title: string;
    subtitle: string;
    items: Array<{
      icon: string;
      name: string;
      description: string;
    }>;
    buildModCta: string;
  };
  openSource: {
    title: string;
    subtitle: string;
    description: string;
    githubCta: string;
    docsCta: string;
  };
  finalCta: {
    title: string;
    description: string;
    primaryCta: string;
    githubCta: string;
  };
  footer: {
    line1: string;
    line2: string;
    termsLabel: string;
    privacyLabel: string;
  };
  localeToggleLabel: string;
  localeOptions: { en: string; zh: string };
};

const EN_TAB_LOCAL = `import { Runtime } from '@nimiplatform/sdk';

const runtime = new Runtime();

const result = await runtime.generate({
  prompt: 'Explain quantum computing simply.',
});

console.log(result.text);`;

const EN_TAB_CLOUD = `import { Runtime } from '@nimiplatform/sdk';

const runtime = new Runtime();

const result = await runtime.generate({
  provider: 'gemini',
  prompt: 'Write a haiku about open source.',
});

console.log(result.text);`;

const EN_TAB_STREAMING = `import { Runtime } from '@nimiplatform/sdk';

const runtime = new Runtime();

const stream = await runtime.stream({
  prompt: 'Tell me a story about a robot.',
});

for await (const chunk of stream) {
  process.stdout.write(chunk.text);
}`;

const EN_TAB_WORKFLOW = `import { Runtime } from '@nimiplatform/sdk';

const runtime = new Runtime();

const draft = await runtime.generate({
  prompt: 'Draft a product launch summary.',
});

const polish = await runtime.generate({
  provider: 'gemini',
  prompt: \`Polish this summary for a blog post:\n\n\${draft.text}\`,
});

console.log(polish.text);`;

const ZH_TAB_MODS = `import { Runtime } from '@nimiplatform/sdk';

const runtime = new Runtime();

await runtime.registerMod({
  name: 'story-lab',
  capabilities: ['text.generate'],
});

const result = await runtime.generate({
  prompt: '为新的 Mod 首页写一句介绍语。',
});

console.log(result.text);`;

const ZH_TAB_LOCAL = `import { Runtime } from '@nimiplatform/sdk';

const runtime = new Runtime();

const result = await runtime.generate({
  prompt: '用简单的话解释量子计算。',
});

console.log(result.text);`;

const ZH_TAB_CLOUD = `import { Runtime } from '@nimiplatform/sdk';

const runtime = new Runtime();

const result = await runtime.generate({
  provider: 'gemini',
  prompt: '写一首关于开源的俳句。',
});

console.log(result.text);`;

const ZH_TAB_STREAMING = `import { Runtime } from '@nimiplatform/sdk';

const runtime = new Runtime();

const stream = await runtime.stream({
  prompt: '给我讲一个关于机器人的故事。',
});

for await (const chunk of stream) {
  process.stdout.write(chunk.text);
}`;

export const LANDING_CONTENT: Record<LandingLocale, LandingContent> = {
  en: {
    localeName: 'English',
    skipToContent: 'Skip to main content',
    nav: {
      install: 'Install',
      sdk: 'SDK',
      catalog: 'Catalog',
      architecture: 'Architecture',
      desktop: 'Desktop',
      security: 'Security',
      mods: 'Mods',
      openSource: 'Open Source',
    },
    hero: {
      eyebrow: 'Install in seconds',
      title: 'Local + cloud AI',
      titleAccent: '',
      title2: ' in ',
      titleAccent2: 'one runtime',
      subtitle: 'One CLI and one SDK to run any model, anywhere.',
      description: '',
      primaryCta: 'Download Desktop',
      docsCta: 'Read the docs',
      helperPrefix: 'Or',
      helperDocsCta: 'Read Docs',
      helperGithubCta: 'View on GitHub',
      copyTooltipLabel: 'Copy command',
      copiedCommandLabel: 'Copied',
      githubCta: 'View on GitHub',
      previewLabel: 'Quickstart walkthrough',
      previewAlt: 'Nimi quickstart walkthrough',
      previewCaption: 'Install, start the runtime, and get a first answer from the CLI in one flow.',
      getStartedTitle: 'Get Started',
      getStartedSubtitle: 'Choose your install path',
      tabs: [
        { id: 'desktop', label: 'Desktop App', command: '', ctaText: 'Download Desktop App' },
        { id: 'curl', label: 'Terminal (curl)', command: 'curl -fsSL https://install.nimi.xyz | sh', ctaText: 'Copy Command' },
        { id: 'npm', label: 'npm', command: 'npm install -g @nimiplatform/nimi', ctaText: 'Copy Command' },
      ],
      terminalMockupTitle: 'Walkthrough',
    },
    architecture: {
      title: 'The Unified Architecture.',
      subtitle: 'Project Overview',
      description:
        'Nimi is building shared infrastructure for the next generation of AI apps, with one runtime surface for developers and one coherent experience for users.',
      devTitle: 'For developers',
      devText:
        'Use the SDK and runtime to unify model access, orchestration, and app integration without stitching together incompatible vendor surfaces.',
      userTitle: 'For users',
      userText:
        'Move between AI apps with a more consistent runtime, shared identity, and less repeated setup across products built on Nimi.',
      conclusion: 'One platform, with clear boundaries between app, runtime, and realm.',
      slogan: 'Infrastructure for next-generation AI apps.',
    },
    modelCatalog: {
      kicker: 'Model coverage',
      title: 'The live model catalog',
      subtitle: 'Search one runtime surface across local and cloud model coverage.',
      overview: {
        searchPlaceholder: 'search 38 cloud providers and infinite models…',
        cloudProvidersLabel: 'Cloud Providers',
        localModelsLabel: 'Local Models',
        modalitiesLabel: 'Modalities',
        modalitiesValue: 'OMNI',
        modalitiesDescription: 'Text / TTS / STT / Video / Image / Embeddings',
        industryLeadersLabel: 'Supported by industry leaders',
        shortcutLabel: 'Ctrl K',
        clearSearchLabel: 'Clear',
        matchingProvidersLabel: 'matching providers',
        liveCatalogLabel: 'Live catalog',
      },
      liveBadge: 'From runtime catalog',
      featuredProvidersLabel: 'Featured providers',
      featuredProviders: ['OpenAI', 'Anthropic', 'Gemini', 'xAI', 'DashScope', 'Volcengine', 'Mistral', 'DeepSeek'],
      stats: {
        providers: 'providers',
        models: 'models',
        cloudProviders: 'cloud providers',
        localModels: 'local models',
      },
      localTitle: 'Offline / local',
      localHeadline: 'On-device voice and speech models are already in the stack.',
      localDescription:
        'Current local catalog coverage is voice-first: Qwen3-TTS, CosyVoice2, GPT-SoVITS, F5-TTS, Piper, and Kokoro variants are available through the same runtime surface.',
      capabilitiesTitle: 'Capability spread',
      capabilitiesHeadline: 'Text, embeddings, image, video, TTS, and STT in one runtime.',
      capabilitiesDescription:
        'This is where the landing page starts to look credible: frontier text models, image generators, video systems, and speech models all show up in the same catalog.',
      capabilityLabels: {
        'text.generate': 'Text / reasoning',
        'text.embed': 'Embeddings',
        'image.generate': 'Image',
        'video.generate': 'Video',
        'audio.synthesize': 'Speech / TTS',
        'audio.transcribe': 'Transcription / STT',
      },
      capabilityCountLabel: 'catalog entries',
      cloudBadge: 'cloud',
      matrixTitle: 'Cloud matrix',
      matrixHeadline: 'Every provider, with actual model ids.',
      matrixDescription:
        'No hand-wavy “supports OpenAI-compatible models” claim here. These are the concrete model ids currently represented in the runtime catalog.',
      providerDetailSuffix: 'models live in this provider bucket',
      searchResultsTitle: 'Search results from the live catalog',
      searchResultsDescription: 'Show matching providers with capability and model ids directly instead of keeping the full matrix visible.',
      noResultsTitle: 'No providers match this search.',
      noResultsDescription: 'Try a provider name like OpenAI, Gemini, or DashScope, or search for a model id.',
      sourceNote:
        'Source of truth: runtime/catalog/providers/*.yaml in this repository. Snapshot reflected here was derived on March 10, 2026.',
    },
    sdk: {
      title: 'One SDK. Multiple ways to run AI.',
      subtitle: 'Start local, add cloud when you need it, and keep the integration surface stable.',
      tabs: [
        { label: 'Walkthrough', snippet: EN_TAB_LOCAL, caption: 'Go from install to first answer fast.' },
        { label: 'Multimodal', snippet: EN_TAB_CLOUD, caption: 'Handle text, image, and speech in one flow.' },
        { label: 'Stream Job', snippet: EN_TAB_STREAMING, caption: 'Run streaming jobs through the same runtime.' },
        { label: 'Workflow', snippet: EN_TAB_WORKFLOW, caption: 'Chain steps into one repeatable AI workflow.' },
      ],
      previewLabel: 'SDK walkthrough',
      previewAlt: 'Nimi SDK walkthrough',
      previewCaption: 'Install the SDK, start the runtime, and send local and cloud requests from the same app flow.',
      multimodalLabel: 'Beyond text',
      multimodalAlt: 'Nimi multimodal walkthrough',
      multimodalCaption: 'The same runtime also handles image and speech flows when you move beyond text-only examples.',
      callout: 'Start with one setup. Expand without rewriting.',
    },
    desktop: {
      title: 'Desktop Workspace for AI',
      subtitle: 'Run models, chat, and manage mods from one desktop workspace.',
      screenshotAlt: 'Nimi desktop app preview',
      features: [
        { icon: 'dashboard', title: 'Runtime Dashboard', description: 'See health, model status, and resource usage at a glance.' },
        { icon: 'chat', title: 'Built-in Chat', description: 'Talk to local and cloud models from the same workspace.' },
        { icon: 'mods', title: 'Mod Host', description: 'Launch installed mods without leaving the desktop app.' },
        { icon: 'models', title: 'Model Management', description: 'Install, update, and switch models from one place.' },
      ],
      downloadCta: 'Download Desktop App',
    },
    security: {
      title: 'Security by design',
      subtitle: 'Local-first execution, explicit boundaries, and controlled cloud access.',
      intro: 'Nimi is designed to keep execution paths, credentials, and extension access under clearer control.',
      pillars: [
        {
          label: 'Designed in',
          title: 'Clear system boundaries',
          points: ['Local and cloud paths are separated by design.', 'Cloud access routes through the runtime boundary.'],
        },
        {
          label: 'Built today',
          title: 'Controls already in place',
          points: [
            'Provider credentials stay on the runtime connector path, not in the desktop renderer.',
            'Mods and desktop surfaces are constrained by runtime-only routing and capability checks.',
          ],
        },
        {
          label: 'Hardening next',
          title: 'Still getting stronger',
          points: ['Runtime-side enforcement is still being tightened.', 'Mod policy, sandbox coverage, and audit visibility continue to improve.'],
        },
      ],
    },
    mods: {
      title: 'Extend with mods',
      subtitle: 'Pre-built apps powered by the Nimi runtime. Or build your own.',
      items: [
        { icon: 'chat', name: 'local-chat', description: 'Chat with local AI models. Private, fast, no network.' },
        { icon: 'sim', name: 'kismet', description: 'Economic simulation engine with real-time charts.' },
        { icon: 'audio', name: 'audio-book', description: 'Multi-voice audiobooks with AI narration.' },
        { icon: 'video', name: 'videoplay', description: 'Episode-scale video from narrative scripts.' },
        { icon: 'story', name: 'textplay', description: 'Interactive fiction with branching narratives.' },
        { icon: 'docs', name: 'knowledge-base', description: 'Document indexing and AI-powered search.' },
      ],
      buildModCta: 'Build your own mod',
    },
    openSource: {
      title: 'Open source at the core',
      subtitle: 'Built in the open. Ship with confidence.',
      description:
        'Nimi runtime, SDK, and desktop app are open source under Apache-2.0 and MIT. Realm is an optional managed cloud layer, and its contracts are public through the SDK.',
      githubCta: 'View on GitHub',
      docsCta: 'Read the docs',
    },
    finalCta: {
      title: 'Build on one AI runtime',
      description: 'Install Nimi, wire up the SDK, and keep local and cloud execution under one surface.',
      primaryCta: 'Read the docs',
      githubCta: 'View on GitHub',
    },
    footer: {
      line1: 'Nimi: Open-source AI runtime',
      line2: 'Licenses: Apache-2.0 (runtime/sdk), MIT (apps), CC-BY-4.0 (docs)',
      termsLabel: 'Terms of Service',
      privacyLabel: 'Privacy Policy',
    },
    localeToggleLabel: 'Language',
    localeOptions: {
      en: 'EN',
      zh: '中文',
    },
  },
  zh: {
    localeName: '简体中文',
    skipToContent: '跳转到主要内容',
    nav: {
      install: '安装',
      sdk: 'SDK',
      catalog: '模型目录',
      architecture: '架构',
      desktop: '桌面端',
      security: '安全',
      mods: 'Mods',
      openSource: '开源',
    },
    hero: {
      eyebrow: '几秒完成安装',
      title: '本地与云端 AI',
      titleAccent: '',
      title2: ' 的',
      titleAccent2: '统一 Runtime',
      subtitle: '一个 CLI，一套 SDK，随处运行任何模型。',
      description: '',
      primaryCta: '下载 Desktop',
      docsCta: '阅读文档',
      helperPrefix: '或',
      helperDocsCta: '阅读文档',
      helperGithubCta: '查看 GitHub',
      copyTooltipLabel: '复制命令',
      copiedCommandLabel: '已复制',
      githubCta: '查看 GitHub',
      previewLabel: '快速上手演示',
      previewAlt: 'Nimi 快速上手演示',
      previewCaption: '从安装、启动 runtime 到在 CLI 中跑通第一条回答，一次看完。',
      getStartedTitle: '快速开始',
      getStartedSubtitle: '选择你的安装方式',
      tabs: [
        { id: 'desktop', label: '桌面客户端', command: '', ctaText: '下载 Desktop App' },
        { id: 'curl', label: '终端 (curl)', command: 'curl -fsSL https://install.nimi.xyz | sh', ctaText: '复制命令' },
        { id: 'npm', label: 'npm', command: 'npm install -g @nimiplatform/nimi', ctaText: '复制命令' },
      ],
      terminalMockupTitle: '演示',
    },
    architecture: {
      title: '统一架构',
      subtitle: '项目概览',
      description: 'Nimi 在做的是下一代 AI 应用的基础设施，让开发者和用户都能工作在同一套边界清晰的系统上。',
      devTitle: '面向开发者',
      devText: '通过 SDK 和 runtime，把模型接入、调用路径和应用集成统一起来，减少重复适配和供应商耦合。',
      userTitle: '面向用户',
      userText: '在不同 AI 应用之间获得更一致的体验、身份和执行路径，而不是每个产品都重新配置一遍。',
      conclusion: '一个平台，连接 app、runtime 和 realm。',
      slogan: '为下一代 AI 应用构建基础设施。',
    },
    modelCatalog: {
      kicker: '模型覆盖',
      title: '实时模型目录',
      subtitle: '在一个 runtime 视图里搜索本地与云端模型能力覆盖。',
      overview: {
        searchPlaceholder: 'search 38 cloud providers and infinite models…',
        cloudProvidersLabel: '云端 Providers',
        localModelsLabel: '本地 Models',
        modalitiesLabel: '能力类型',
        modalitiesValue: 'OMNI',
        modalitiesDescription: '文本 / TTS / STT / 视频 / 图像 / Embeddings',
        industryLeadersLabel: '已接入的主流厂商',
        shortcutLabel: 'Ctrl K',
        clearSearchLabel: '清空',
        matchingProvidersLabel: '个匹配的 providers',
        liveCatalogLabel: '实时目录',
      },
      liveBadge: '来自 runtime catalog',
      featuredProvidersLabel: '重点 provider',
      featuredProviders: ['OpenAI', 'Anthropic', 'Gemini', 'xAI', 'DashScope', 'Volcengine', 'Mistral', 'DeepSeek'],
      stats: {
        providers: '个 provider',
        models: '个 model',
        cloudProviders: '个云 provider',
        localModels: '个本地 model',
      },
      localTitle: '离线 / 本地',
      localHeadline: '本地语音与合成模型已经在栈内。',
      localDescription: '当前本地 catalog 以语音为主：Qwen3-TTS、CosyVoice2、GPT-SoVITS、F5-TTS、Piper、Kokoro 等都已通过同一 runtime 接口接入。',
      capabilitiesTitle: 'Capability 分布',
      capabilitiesHeadline: '文本、Embedding、图像、视频、TTS、STT，同属一个 runtime。',
      capabilitiesDescription: '这一块能直接把 landing page 的气场拉起来：前沿文本模型、图像生成、视频系统、语音模型，全部在同一份 catalog 里。',
      capabilityLabels: {
        'text.generate': '文本 / 推理',
        'text.embed': 'Embedding',
        'image.generate': '图像',
        'video.generate': '视频',
        'audio.synthesize': '语音 / TTS',
        'audio.transcribe': '转写 / STT',
      },
      capabilityCountLabel: '个 catalog 条目',
      cloudBadge: '云端',
      matrixTitle: '云端矩阵',
      matrixHeadline: '所有 provider，直接列出真实 model id。',
      matrixDescription: '不用笼统地写“supports OpenAI-compatible models”。这里展示的都是 runtime catalog 里已经存在的具体 model id。',
      providerDetailSuffix: '个 model 已在这个 provider 分组中接入',
      searchResultsTitle: '来自 live catalog 的搜索结果',
      searchResultsDescription: '直接展示命中 provider 的 capability 和 model id，不再保留整个 matrix 视图。',
      noResultsTitle: '没有匹配到 provider。',
      noResultsDescription: '可以试试 OpenAI、Gemini、DashScope 这类 provider 名，或直接搜索 model id。',
      sourceNote: '事实源：仓库中的 runtime/catalog/providers/*.yaml。当前 landing 反映的是 2026 年 3 月 10 日推导出来的 snapshot。',
    },
    sdk: {
      title: '一套 SDK，以多种运行方式运行 AI',
      subtitle: '先跑本地，需要时再接入云端，集成方式保持不变。',
      tabs: [
        { label: '流程全览', snippet: ZH_TAB_LOCAL, caption: '安装 SDK，启动 runtime，然后在同一个 app 流程里发起本地和云端请求。' },
        { label: '多模型支持', snippet: ZH_TAB_CLOUD, caption: '只需一行配置，即可在开源模型和商业 API 之间无缝切换。' },
        { label: '多调用方式', snippet: ZH_TAB_STREAMING, caption: '在流式响应、批量处理和异步执行之间自由切换。' },
        { label: 'Mod 开发', snippet: ZH_TAB_MODS, caption: '通过构建和注入自定义 runtime mods 来扩展 Nimi 的核心能力。' },
      ],
      previewLabel: 'SDK 流程全览',
      previewAlt: 'Nimi SDK 流程全览',
      previewCaption: '安装 SDK，启动 runtime，然后在同一个 app 流程里发起本地和云端请求。',
      multimodalLabel: '超越纯文本',
      multimodalAlt: 'Nimi 多模态流程演示',
      multimodalCaption: '当你需要处理纯文本以外的场景时，同一个 runtime 也完美支持图像和语音流程。',
      callout: '先完成一次集成，之后按需扩展。',
    },
    desktop: {
      title: 'Desktop Workspace for AI',
      subtitle: '在一个桌面工作区里运行模型、聊天并管理 mods。',
      screenshotAlt: 'Nimi 桌面应用预览',
      features: [
        { icon: 'dashboard', title: '运行时仪表盘', description: '一眼看到健康状态、模型状态和资源使用。' },
        { icon: 'chat', title: '内置对话', description: '在同一个工作区内和本地及云端模型对话。' },
        { icon: 'mods', title: '模块宿主', description: '不离开桌面端，直接启动已安装的 mods。' },
        { icon: 'models', title: '模型管理', description: '在一处完成安装、更新和切换模型。' },
      ],
      downloadCta: '下载桌面应用',
    },
    security: {
      title: '以安全设计为出发点',
      subtitle: '以本地优先的执行路径、明确边界和可控云接入为基础。',
      intro: 'Nimi 希望让执行路径、凭据管理和 extension 访问都更可控。',
      pillars: [
        {
          label: '设计先行',
          title: '先定好系统边界',
          points: ['本地与云端的执行路径是分开设计的。', '云接入统一通过 runtime 边界路由。'],
        },
        {
          label: '已有基础',
          title: '已经具备的控制',
          points: ['提供者凭据留在 runtime connector 路径，而不在 desktop renderer 里流转。', 'Desktop 和 mod 调用面受 runtime-only 路由和 capability 检查限制。'],
        },
        {
          label: '持续加固',
          title: '还在继续加强',
          points: ['Runtime 侧的执行层约束还在持续收紧。', 'Mod policy、sandbox 覆盖和 audit 可见性也在继续完善。'],
        },
      ],
    },
    mods: {
      title: '用模块扩展',
      subtitle: '基于 Nimi runtime 的预制应用，或者自己构建。',
      items: [
        { icon: 'chat', name: 'local-chat', description: '与本地 AI 模型对话，私密、快速、无需联网。' },
        { icon: 'sim', name: 'kismet', description: '实时图表经济模拟引擎。' },
        { icon: 'audio', name: 'audio-book', description: 'AI 多角色有声书。' },
        { icon: 'video', name: 'videoplay', description: '从叙事脚本生成剧集级视频。' },
        { icon: 'story', name: 'textplay', description: '分支叙事互动式小说。' },
        { icon: 'docs', name: 'knowledge-base', description: '文档索引与 AI 搜索。' },
      ],
      buildModCta: '构建你的模块',
    },
    openSource: {
      title: '开源为核',
      subtitle: '在开放中构建，放心交付。',
      description: 'Nimi 的 runtime、SDK 和桌面应用均以 Apache-2.0 和 MIT 开源。Realm 是可选的托管云层，其契约通过 SDK 对外公开。',
      githubCta: '查看 GitHub',
      docsCta: '阅读文档',
    },
    finalCta: {
      title: '开始使用 Nimi 构建',
      description: '安装 Nimi，接入 SDK，把本地与云端执行统一在同一个表面之下。',
      primaryCta: '阅读文档',
      githubCta: '查看 GitHub',
    },
    footer: {
      line1: 'Nimi：开源 AI 运行时',
      line2: '许可证：Apache-2.0（runtime/sdk）、MIT（apps）、CC-BY-4.0（docs）',
      termsLabel: '服务条款',
      privacyLabel: '隐私政策',
    },
    localeToggleLabel: '语言',
    localeOptions: {
      en: 'EN',
      zh: '中文',
    },
  },
};

export function getLandingContent(locale: LandingLocale): LandingContent {
  return LANDING_CONTENT[locale];
}
