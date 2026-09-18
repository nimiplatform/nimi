export type InformationalLocale = 'en' | 'zh';

export type CatalogApp = {
  id: string;
  name: string;
  license: string;
  repository: string;
  capabilities: ReadonlyArray<string>;
  summary?: { en: string; zh: string };
};

/**
 * Limited static projection of the admitted public catalog
 * (../nimi-app-registry index + descriptors, synced 2026-09-17).
 * Web presents display fields only; it owns no admission, install,
 * availability, or update truth.
 */
export const APP_CATALOG: ReadonlyArray<CatalogApp> = [
  {
    id: 'nimi.parentos',
    name: 'ParentOS',
    license: 'MIT',
    repository: 'https://github.com/nimiplatform/nimiapp-parentos',
    capabilities: ['text.generate', 'audio.transcribe'],
    summary: {
      zh: '记录孩子的成长与家庭观察，整理成长档案和阶段提醒。',
      en: `Keep a child's growth journal and family observations, organized into records and stage reminders.`,
    },
  },
  {
    id: 'nimi.overtone',
    name: 'Nimi Overtone',
    license: 'MIT',
    repository: 'https://github.com/nimiplatform/nimiapp-overtone',
    capabilities: ['text.generate', 'music.generate'],
    summary: {
      zh: '整理音乐创作项目、歌词与音频候选，比较和管理创作版本。',
      en: 'Organize music projects, lyrics, and audio takes, and compare creative versions.',
    },
  },
  {
    id: 'nimi.storybook',
    name: 'Storybook',
    license: 'Apache-2.0',
    repository: 'https://github.com/nimiplatform/nimiapp-storybook',
    capabilities: ['text.generate'],
    summary: {
      zh: '阅读和创作互动故事，让角色、选择与叙事共同推进故事体验。',
      en: 'Read and create interactive stories where characters, choices, and narrative move together.',
    },
  },
  {
    id: 'nimi.realm-persona-studio',
    name: 'Realm Persona Studio',
    license: 'MIT',
    repository: 'https://github.com/nimiplatform/nimiapp-realm-persona-studio',
    capabilities: ['text.generate', 'image.generate', 'audio.synthesize'],
    summary: {
      zh: '创建和管理自己的 Realm Persona，维护角色资料与创作草稿。',
      en: 'Create and manage your own Realm Personas, keeping profiles and drafts in one place.',
    },
  },
  {
    id: 'nimi.shijing',
    name: '时镜 ShiJing',
    license: 'MIT',
    repository: 'https://github.com/nimiplatform/nimiapp-shijing',
    capabilities: ['text.generate'],
    summary: {
      zh: '结合四柱与节气等确定性排盘，提供个人节律观察与解读。',
      en: 'A personal rhythm companion built on deterministic traditional calendar charting, with readings to reflect on.',
    },
  },
  {
    id: 'nimi.inscape',
    name: 'Inscape 心相',
    license: 'MIT',
    repository: 'https://github.com/nimiplatform/nimiapp-inscape',
    capabilities: ['text.generate'],
    summary: {
      zh: '面向成年人的本地性格探索与日常反思工具，用认知功能视角理解自己和关系。',
      en: 'A local tool for adults exploring personality and everyday reflection through a cognitive-function lens.',
    },
  },
  {
    id: 'nimi.realm-world-studio',
    name: 'Realm World Studio',
    license: 'MIT',
    repository: 'https://github.com/nimiplatform/nimiapp-realm-world-studio',
    capabilities: [],
    summary: {
      zh: '与 AI 共创世界设定与角色构想，审阅草稿，创建并整理自己的 Realm 世界。',
      en: 'Co-create world settings and character ideas with AI, review drafts, and organize your own Realm worlds.',
    },
  },
  {
    id: 'nimiplatform.vane',
    name: 'Vane',
    license: 'MIT',
    repository: 'https://github.com/nimiplatform/Vane',
    capabilities: ['text.generate', 'text.embed'],
    summary: {
      zh: '用 Nimi 托管的 AI 搜索、研究与阅读文档。',
      en: 'Search, research, and read documents with Nimi-managed AI.',
    },
  },
  {
    id: 'openmontage.studio',
    name: 'OpenMontage',
    license: 'AGPL-3.0-only',
    repository: 'https://github.com/nimiplatform/OpenMontage',
    capabilities: [
      'text.generate',
      'image.generate',
      'video.generate',
      'audio.synthesize',
      'audio.transcribe',
      'music.generate',
    ],
    summary: {
      zh: '从素材与生成媒体制作带旁白的视频，转写、字幕与本地渲染由 Nimi 提供。',
      en: 'Produce narrated videos from source footage and generated media, with transcription, subtitles, and local rendering powered by Nimi.',
    },
  },
  {
    id: 'io.github.nimiplatform.next-ai-draw-io',
    name: 'Next AI Draw.io',
    license: 'Apache-2.0',
    repository: 'https://github.com/nimiplatform/next-ai-draw-io',
    capabilities: ['text.generate'],
    summary: {
      zh: '用自然语言、图像和文档创建与编辑 draw.io 图表，并可恢复历史或导出成果。',
      en: 'Create and edit draw.io diagrams with natural language, images, and documents, then restore history or export your work.',
    },
  },
];

export const CAPABILITY_LABELS: Record<InformationalLocale, Readonly<Record<string, string>>> = {
  zh: {
    'text.generate': '文字生成',
    'text.embed': '文本嵌入',
    'image.generate': '图像生成',
    'video.generate': '视频生成',
    'music.generate': '音乐生成',
    'audio.synthesize': '语音合成',
    'audio.transcribe': '语音转写',
    'audio.separate': '音频分离',
    'vision.locate': '视觉定位',
    'realtime.interact': '实时交互',
    'voice.create': '声音创建',
  },
  en: {
    'text.generate': 'Text',
    'text.embed': 'Embeddings',
    'image.generate': 'Image',
    'video.generate': 'Video',
    'music.generate': 'Music',
    'audio.synthesize': 'Speech synthesis',
    'audio.transcribe': 'Transcription',
    'audio.separate': 'Audio separation',
    'vision.locate': 'Vision locating',
    'realtime.interact': 'Realtime',
    'voice.create': 'Voice creation',
  },
};

export type InformationalContent = {
  home: {
    metaTitle: string;
    title: string;
    intro: string;
    worldsTitle: string;
    worldsBody: string;
    worldsExampleTitle: string;
    worldsExampleSteps: ReadonlyArray<string>;
    startTitle: string;
    startBody: string;
    availability: string;
    downloadCta: string;
    appsCta: string;
  };
  apps: {
    metaTitle: string;
    title: string;
    intro: string;
    statusNote: string;
    listTitle: string;
    platformsLabel: string;
    platforms: ReadonlyArray<string>;
    capabilitiesLabel: string;
    sourceLabel: string;
    licenseLabel: string;
    summaryFallback: string;
    itemCta: string;
    createTitle: string;
    createIntro: string;
    createSteps: ReadonlyArray<string>;
    createCaveat: string;
    guideCta: string;
    notFoundTitle: string;
    notFoundBody: string;
    backToApps: string;
  };
  shared: {
    skipToContent: string;
    navHome: string;
    navApps: string;
    navDownload: string;
    navCodeSigning: string;
    language: string;
    switchEnglish: string;
    switchChinese: string;
  };
};

export const INFORMATIONAL_CONTENT: Record<InformationalLocale, InformationalContent> = {
  zh: {
    home: {
      metaTitle: 'Nimi 产品入口',
      title: 'Nimi 产品入口',
      intro:
        'Nimi Home 是你进入 Nimi 的地方：找到已安装的应用、继续与 AI 的对话，管理本地 AI 与设置。',
      worldsTitle: '角色与世界',
      worldsBody:
        '从一段对话开始，了解一个角色，也了解他所在的世界。你可以带着问题而来，也可以只是想认识一个新的聊天伙伴。角色聊天与世界探索在 Nimi 产品中进行。',
      worldsExampleTitle: '一次典型的开始',
      worldsExampleSteps: [
        '在 Nimi 中选择一个感兴趣的角色。',
        '从一段对话开始，了解这个角色和他所在的世界。',
        '继续聊下去，或回到世界介绍看看还有谁。',
      ],
      startTitle: '如何开始',
      startBody:
        '安装并打开 Nimi 后，从 Nimi Home 进入应用、角色和世界；与角色互动需要 Nimi 正在运行，并完成需要的授权。',
      availability: '当前没有已发布的正式安装包；下载页会说明各平台的真实状态。',
      downloadCta: '查看下载状态',
      appsCta: '浏览全部应用',
    },
    apps: {
      metaTitle: 'Nimi 应用',
      title: 'Nimi 应用',
      intro:
        'Nimi 应用是可以在 Nimi 中使用的应用。每个上架应用都有公开的源码仓库和明确的开源许可。',
      statusNote:
        '目录发现、安装、更新与卸载通过 Desktop 产品路径在 macOS arm64 与 Windows x86_64 上提供；具体可用性同时取决于当前 Runtime 状态与账号条件。本页只作介绍，不提供安装。',
      listTitle: '目录中的应用',
      platformsLabel: '平台',
      platforms: ['macOS arm64', 'Windows x86_64'],
      capabilitiesLabel: 'AI 能力',
      sourceLabel: '源码',
      licenseLabel: '许可',
      summaryFallback: '已通过目录准入的应用。',
      itemCta: '了解应用',
      createTitle: '创建你自己的个人应用',
      createIntro:
        '围绕你的任务和习惯，创建供自己使用的本地 AI 工具。这条路径需要开发工具与本地开发模式，并不是零代码流程。',
      createSteps: [
        '描述需求：写下它要处理什么、按什么步骤工作、最后给你什么结果。',
        '创建项目：用 Nimi App 脚手架创建本地项目，需要 Node 与本地开发环境。',
        '接入能力：通过 Nimi SDK 接入所需的 AI 能力，按你的步骤组织工作流。',
        '本地运行：在本地运行并迭代，直到它符合你的习惯。',
      ],
      createCaveat: '当前没有网页版创建器；创建过程在本地开发环境中完成。',
      guideCta: '阅读创建指南',
      notFoundTitle: '未找到这个应用',
      notFoundBody: '这个地址没有对应的已准入应用。',
      backToApps: '返回全部应用',
    },
    shared: {
      skipToContent: '跳转到主要内容',
      navHome: '产品入口',
      navApps: '应用',
      navDownload: '下载状态',
      navCodeSigning: '代码签名',
      language: '语言',
      switchEnglish: '切换语言为英文',
      switchChinese: '切换语言为中文',
    },
  },
  en: {
    home: {
      metaTitle: 'Nimi product entry',
      title: 'The Nimi product entry',
      intro:
        'Nimi Home is where you enter Nimi: find the apps you installed, continue conversations with your AI, and manage local AI and settings.',
      worldsTitle: 'Characters & Worlds',
      worldsBody:
        'Start with a conversation, get to know a character, and learn about the world they belong to. Come with a question, or just to meet a new conversation partner. Character chat and world exploration happen inside the Nimi product.',
      worldsExampleTitle: 'A typical start',
      worldsExampleSteps: [
        'Pick a character that interests you in Nimi.',
        'Start with one conversation and get to know the character and their world.',
        'Keep the conversation going, or go back to the world to see who else is there.',
      ],
      startTitle: 'How to start',
      startBody:
        'Install and open Nimi, then enter apps, characters, and worlds from Nimi Home. Character interaction needs Nimi running and the required authorization completed.',
      availability: 'There is no stable public installer yet; the download page describes the real status for each platform.',
      downloadCta: 'Check download status',
      appsCta: 'Browse all apps',
    },
    apps: {
      metaTitle: 'Nimi Apps',
      title: 'Nimi Apps',
      intro:
        'Nimi Apps are the apps you can use inside Nimi. Every admitted app has a public source repository and an explicit open-source license.',
      statusNote:
        'Catalog discovery, installation, update, and uninstall are provided through the Desktop product path on macOS arm64 and Windows x86_64; availability at any moment also depends on your Runtime state and account conditions. This page is informational and does not install anything.',
      listTitle: 'Apps in the catalog',
      platformsLabel: 'Platforms',
      platforms: ['macOS arm64', 'Windows x86_64'],
      capabilitiesLabel: 'AI capabilities',
      sourceLabel: 'Source',
      licenseLabel: 'License',
      summaryFallback: 'An admitted app in the current catalog.',
      itemCta: 'View app',
      createTitle: 'Create your own personal app',
      createIntro:
        'Build a local AI tool around your own tasks and habits. This path uses developer tools and local development mode; it is not a no-code flow.',
      createSteps: [
        'Describe the need: what it handles, the steps it follows, and the result you want.',
        'Create the project: scaffold a local project with Nimi App tools. Node and a local development environment are required.',
        'Connect capabilities: use the Nimi SDK to connect the AI capabilities and organize your workflow.',
        'Run it locally: run and iterate locally until it fits your habits.',
      ],
      createCaveat: 'There is no web-based creator; creation happens in a local development environment.',
      guideCta: 'Read the creation guide',
      notFoundTitle: 'App not found',
      notFoundBody: 'No admitted app matches this address.',
      backToApps: 'Back to all apps',
    },
    shared: {
      skipToContent: 'Skip to main content',
      navHome: 'Product entry',
      navApps: 'Apps',
      navDownload: 'Download status',
      navCodeSigning: 'Code signing',
      language: 'Language',
      switchEnglish: 'Switch language to English',
      switchChinese: 'Switch language to Chinese',
    },
  },
};
