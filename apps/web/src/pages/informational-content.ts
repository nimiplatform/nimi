export type InformationalLocale = 'en' | 'zh';

export type CatalogApp = {
  id: string;
  name: string;
  license: string;
  repository: string;
  capabilities: ReadonlyArray<string>;
  platforms: ReadonlyArray<'macOS arm64' | 'Windows x86_64'>;
  summary?: { en: string; zh: string };
};

const WINDOWS_ONLY = ['Windows x86_64'] as const;
const MACOS_AND_WINDOWS = ['macOS arm64', 'Windows x86_64'] as const;

/**
 * Limited static projection of the admitted public catalog
 * (nimi-app-registry index + descriptors at d5e9d95, reviewed 2026-11-14).
 * Web presents display fields only; it owns no admission, install,
 * availability, or update truth.
 */
export const APP_CATALOG: ReadonlyArray<CatalogApp> = [
  {
    id: 'nimi.parentos',
    name: 'ParentOS',
    platforms: MACOS_AND_WINDOWS,
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
    platforms: MACOS_AND_WINDOWS,
    license: 'MIT',
    repository: 'https://github.com/nimiplatform/nimiapp-overtone',
    capabilities: ['text.generate', 'music.generate', 'music.transcribe', 'audio.voice.convert', 'audio.separate'],
    summary: {
      zh: '整理音乐创作项目、歌词与音频候选，比较和管理创作版本。',
      en: 'Organize music projects, lyrics, and audio takes, and compare creative versions.',
    },
  },
  {
    id: 'nimi.storybook',
    name: 'Storybook',
    platforms: MACOS_AND_WINDOWS,
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
    platforms: MACOS_AND_WINDOWS,
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
    platforms: MACOS_AND_WINDOWS,
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
    platforms: MACOS_AND_WINDOWS,
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
    platforms: MACOS_AND_WINDOWS,
    license: 'MIT',
    repository: 'https://github.com/nimiplatform/nimiapp-realm-world-studio',
    capabilities: ['text.generate'],
    summary: {
      zh: '与 AI 共创世界设定与角色构想，审阅草稿，创建并整理自己的 Realm 世界。',
      en: 'Co-create world settings and character ideas with AI, review drafts, and organize your own Realm worlds.',
    },
  },
  {
    id: 'nimiplatform.vane',
    name: 'Vane',
    platforms: MACOS_AND_WINDOWS,
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
    platforms: MACOS_AND_WINDOWS,
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
    platforms: MACOS_AND_WINDOWS,
    license: 'Apache-2.0',
    repository: 'https://github.com/nimiplatform/next-ai-draw-io',
    capabilities: ['text.generate'],
    summary: {
      zh: '用自然语言、图像和文档创建与编辑 draw.io 图表，并可恢复历史或导出成果。',
      en: 'Create and edit draw.io diagrams with natural language, images, and documents, then restore history or export your work.',
    },
  },
  {
    id: 'org.nimiplatform.sillytavern',
    name: 'SillyTavern',
    platforms: MACOS_AND_WINDOWS,
    license: 'AGPL-3.0',
    repository: 'https://github.com/nimiplatform/SillyTavern',
    capabilities: ['text.generate', 'text.embed', 'image.generate', 'audio.synthesize', 'audio.transcribe', 'text.decide'],
  },
  {
    id: 'org.nimiplatform.deeptutor',
    name: 'DeepTutor',
    platforms: MACOS_AND_WINDOWS,
    license: 'Apache-2.0',
    repository: 'https://github.com/nimiplatform/DeepTutor',
    capabilities: ['text.generate', 'text.embed', 'audio.synthesize', 'audio.transcribe', 'image.generate', 'video.generate'],
  },
  {
    id: 'io.github.nimiplatform.open-notebook',
    name: 'Open Notebook',
    platforms: MACOS_AND_WINDOWS,
    license: 'MIT',
    repository: 'https://github.com/nimiplatform/open-notebook',
    capabilities: ['text.generate', 'text.embed', 'audio.transcribe', 'audio.synthesize'],
  },
  {
    id: 'io.github.nimiplatform.presenton',
    name: 'Presenton',
    platforms: MACOS_AND_WINDOWS,
    license: 'Apache-2.0',
    repository: 'https://github.com/nimiplatform/presenton',
    capabilities: ['text.generate', 'image.generate', 'text.embed'],
  },
  {
    id: 'nimi.odd-bureau',
    name: '奇物局',
    platforms: MACOS_AND_WINDOWS,
    license: 'MIT',
    repository: 'https://github.com/nimiplatform/nimiapp-odd-bureau',
    capabilities: ['text.generate', 'vision.locate', 'image.generate', 'video.generate', 'music.generate', 'audio.synthesize', 'audio.transcribe', 'voice.create'],
  },
  {
    id: 'nimi.polyagent',
    name: 'PolyAgent',
    platforms: MACOS_AND_WINDOWS,
    license: 'Apache-2.0',
    repository: 'https://github.com/nimiplatform/nimiapp-polyagent',
    capabilities: [],
  },
  {
    id: 'moneyprinterturbo.studio',
    name: 'MoneyPrinterTurbo',
    license: 'MIT',
    repository: 'https://github.com/nimiplatform/MoneyPrinterTurbo',
    capabilities: ['text.generate', 'text.embed', 'audio.synthesize', 'audio.transcribe', 'image.generate', 'video.generate', 'voice.create', 'music.generate'],
    platforms: WINDOWS_ONLY,
  },
  {
    id: 'ai.nimi.openwhispr',
    name: 'OpenWhispr',
    license: 'MIT',
    repository: 'https://github.com/nimiplatform/openwhispr',
    capabilities: ['audio.transcribe', 'text.generate', 'text.embed', 'audio.speaker.embed'],
    platforms: WINDOWS_ONLY,
  },
  {
    id: 'nimiplatform.voicestudio',
    name: 'VoiceStudio',
    license: 'AGPL-3.0-only',
    repository: 'https://github.com/nimiplatform/VoiceStudio',
    capabilities: ['audio.synthesize', 'audio.transcribe', 'voice.create', 'text.generate', 'audio.separate'],
    platforms: WINDOWS_ONLY,
  },
  {
    id: 'io.github.nimiplatform.jev-search',
    name: 'Jev Search',
    license: 'MIT',
    repository: 'https://github.com/nimiplatform/jev-search',
    capabilities: ['text.decide'],
    platforms: WINDOWS_ONLY,
  },
  {
    id: 'io.github.nimiplatform.jev-ultrafast',
    name: 'Jev Ultrafast',
    license: 'MIT',
    repository: 'https://github.com/nimiplatform/jev-ultrafast',
    capabilities: ['text.decide', 'text.generate'],
    platforms: WINDOWS_ONLY,
  },
  {
    id: 'ai.nimi.videolingo',
    name: 'VideoLingo',
    license: 'Apache-2.0',
    repository: 'https://github.com/nimiplatform/VideoLingo',
    capabilities: ['audio.transcribe', 'audio.separate', 'text.generate', 'text.annotate', 'audio.synthesize', 'voice.create'],
    platforms: WINDOWS_ONLY,
  },
];

export const CAPABILITY_LABELS: Record<InformationalLocale, Readonly<Record<string, string>>> = {
  zh: {
    'text.generate': '图文理解与写作',
    'text.embed': '记忆语义检索',
    'text.decide': '多选权衡决策',
    'text.annotate': '多语种断句',
    'image.generate': '图像生成',
    'image.upscale': '4× 图像超清',
    'image.face_swap': '人像融合',
    'video.generate': '视频生成',
    'video.upscale': '视频超清',
    'video.face_swap': '实时视频换脸',
    'vision.locate': '画面目标定位',
    'realtime.interact': '毫秒级语音对话',
    'audio.synthesize': '自然朗读',
    'audio.transcribe': '语音转写',
    'voice.create': '音色克隆',
    'audio.speaker.embed': '声纹提取',
    'audio.separate': '人声伴奏分离',
    'audio.voice.convert': '歌声转换',
    'music.generate': '配乐创作',
    'music.transcribe': '录音自动扒谱',
  },
  en: {
    'text.generate': 'Multimodal text',
    'text.embed': 'Semantic search',
    'text.decide': 'Smart decisions',
    'text.annotate': 'Syntax & clauses',
    'image.generate': 'Image studio',
    'image.upscale': '4× image upscale',
    'image.face_swap': 'Portrait swap',
    'video.generate': 'Video studio',
    'video.upscale': '4× video upscale',
    'video.face_swap': 'Live video swap',
    'vision.locate': 'Visual pointing',
    'realtime.interact': 'Live voice chat',
    'audio.synthesize': 'Natural speech',
    'audio.transcribe': 'Transcription',
    'voice.create': 'Voice cloning',
    'audio.speaker.embed': 'Speaker embeddings',
    'audio.separate': 'Stem splitter',
    'audio.voice.convert': 'Singing swap',
    'music.generate': 'Music studio',
    'music.transcribe': 'Audio to MIDI',
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
      metaTitle: '伙伴与世界：把喜欢的 AI 伙伴请进电脑里',
      title: '把喜欢的 AI 伙伴，请进自己的电脑里',
      intro:
        '在 Nimi Home 统一管理 AI 模型与应用，遇见有声音、记得你、安静不打扰的常驻伙伴。',
      worldsTitle: '三步，把角色请进电脑常驻',
      worldsBody:
        '每一位伙伴都有完整的来历与性格，住进你的电脑后，就成了只属于你的日常朋友。',
      worldsExampleTitle: '怎么开始相处',
      worldsExampleSteps: [
        '挑一位合眼缘的角色：在故事世界里听听声音，或自己动手捏一个专属角色。',
        '落户你的电脑文件夹：在自己电脑里安家，同一个角色在你的账号下独一无二。',
        '私聊只属于你们：日常聊天与记忆只留在本地，既不会传回公开世界，也不会被别人改动。',
      ],
      startTitle: '两分钟装好开箱',
      startBody:
        '下载安装包 → 浏览器登录账号 → 选一个本地文件夹就能直接进入，AI 模型可以进去后再慢慢配。',
      downloadCta: '查看下载与支持平台',
      appsCta: '逛逛全部应用',
    },
    apps: {
      metaTitle: 'Nimi 应用生态：配好一次 AI，二十多款工具直接用',
      title: '配好一次 AI，二十多款好工具直接用',
      intro:
        '不用每装一个软件就重复下载几个 G 的运行环境、挨个填密钥——11 款官方应用与 13 款开源好工具共享同一套电脑算力。',
      statusNote:
        '打开 Nimi 桌面客户端的应用目录，可安装、更新或卸载对应的 PC 版本。',
      listTitle: '探索应用',
      platformsLabel: '平台',
      platforms: ['macOS arm64', 'Windows x86_64'],
      capabilitiesLabel: 'AI 能力',
      sourceLabel: '源码',
      licenseLabel: '许可',
      summaryFallback: '已上架的 Nimi 应用。',
      itemCta: '了解应用',
      createTitle: '开发 Nimi 应用，或接入开源工具',
      createIntro:
        '无论从零开发一款自己的 AI 应用，还是把现成的开源 AI 项目接入 Nimi，都能在本地快速跑通。',
      createSteps: [
        '选定所需的 AI 能力：文本、语音、视觉，或按需调用常驻伙伴。',
        '一行命令初始化工程：用脚手架自动生成应用模板与权限清单。',
        '几行代码调通模型：直接接入 SDK 或 Vercel AI 适配器，无需自建模型环境。',
        '桌面端实时联调：在本地验证顺畅后，即可开源并提交到应用目录。',
      ],
      createCaveat: '目前需在本地代码环境开发调试，暂不提供网页零代码生成器。',
      guideCta: '阅读创建指南',
      notFoundTitle: '未找到这个应用',
      notFoundBody: '未找到符合条件的应用。',
      backToApps: '返回全部应用',
    },
    shared: {
      skipToContent: '跳转到主要内容',
      navHome: '伙伴与世界',
      navApps: '应用生态',
      navDownload: '下载状态',
      navCodeSigning: '代码签名',
      language: '语言',
      switchEnglish: '切换语言为英文',
      switchChinese: '切换语言为中文',
    },
  },
  en: {
    home: {
      metaTitle: 'Companions & Worlds: Invite AI Companions onto Your Computer',
      title: 'Invite an AI companion to live on your computer',
      intro:
        'Manage your AI models and apps in Nimi Home, and meet voiced companions that remember you without interrupting.',
      worldsTitle: 'Three steps to bring a character home',
      worldsBody:
        'Every companion starts from a rich world story and settles onto your computer as someone uniquely yours.',
      worldsExampleTitle: 'How it works',
      worldsExampleSteps: [
        'Pick someone you click with: listen to character voices across shared worlds, or craft your own Persona.',
        'Settle into a local folder: Nimi sets up one dedicated home on your computer for that companion.',
        'Keep your chats private: everyday conversations stay on your machine—never sent back to the public world.',
      ],
      startTitle: 'Ready in two minutes',
      startBody:
        'Grab the installer, sign in via your browser, and pick a local folder—you can set up AI models afterward whenever you are ready.',
      downloadCta: 'Check downloads & platforms',
      appsCta: 'Browse all apps',
    },
    apps: {
      metaTitle: 'Nimi Apps: Set Up AI Once, Run 20+ Tools',
      title: 'Set up AI once. Run 20+ lightweight tools',
      intro:
        'Skip multi-gigabyte duplicate runtimes and per-app API keys—11 official apps and 13 adapted open-source favorites share one AI setup on your computer.',
      statusNote:
        'Open the app catalog in Nimi on your PC to install, update, or remove the desktop version.',
      listTitle: 'Explore apps',
      platformsLabel: 'Platforms',
      platforms: ['macOS arm64', 'Windows x86_64'],
      capabilitiesLabel: 'AI capabilities',
      sourceLabel: 'Source',
      licenseLabel: 'License',
      summaryFallback: 'An available app in the current catalog.',
      itemCta: 'View app',
      createTitle: 'Build a Nimi app or adapt an open-source tool',
      createIntro:
        'Build a custom AI app from scratch or wire an existing open-source AI project onto Nimi in local developer mode.',
      createSteps: [
        'Pick the AI capabilities you need: text, voice, vision, or optional companion help.',
        'Initialize the project in one command: scaffold a typed app template and permission manifest.',
        'Connect models in a few lines: call the SDK directly or drop in the Vercel AI SDK 7 adapter.',
        'Preview live on desktop: verify locally, then open-source and submit to the app catalog.',
      ],
      createCaveat: 'App creation runs in a local code environment; there is no web no-code builder.',
      guideCta: 'Read the creation guide',
      notFoundTitle: 'App not found',
      notFoundBody: 'No available app matches this address.',
      backToApps: 'Back to all apps',
    },
    shared: {
      skipToContent: 'Skip to main content',
      navHome: 'Companions & Worlds',
      navApps: 'Apps',
      navDownload: 'Download status',
      navCodeSigning: 'Code signing',
      language: 'Language',
      switchEnglish: 'Switch language to English',
      switchChinese: 'Switch language to Chinese',
    },
  },
};
