import { createPreviewTranslate } from '../i18n/preview-messages.js';
import { createRemainingAppPreviewContent } from './landing-content.remaining-apps.js';
import { appPreviewMessagesZh } from './app-preview-messages.zh.js';
import type { LandingContent } from './landing-content.js';
import { createZhiyuPreviewContent } from './landing-content.zhiyu.js';
import { createShijingPreviewContent } from './landing-content.shijing.js';
import { createParentosPreviewContent } from './landing-content.parentos.js';
import { createStorybookPreviewContent } from './landing-content.storybook.js';
import { createOddBureauPreviewContent } from './landing-content.odd-bureau.js';
import { createJevSearchPreviewContent, createJevUltrafastPreviewContent, createMoneyPrinterPreviewContent, createOpenwhisprPreviewContent, createVideoLingoPreviewContent, createVoiceStudioPreviewContent } from './landing-content.third-party.js';

const t = createPreviewTranslate(appPreviewMessagesZh);

export const landingContentZh: LandingContent = {
  skipToContent: '跳转到主要内容',
  nav: {
    apps: '应用',
    worlds: '角色与世界',
    create: '创建应用',
    developers: '开发者',
    docs: '文档',
    discord: 'Discord',
    menu: '页面导航',
    openMenu: '打开导航菜单',
    closeMenu: '关闭导航菜单',
  },
  hero: {
    slogan: '让 AI 真正属于你',
    sloganAccent: '真正属于你',
    subSlogan: "本地优先，模型由你自由选择。\n跨越不同应用与沉浸世界，构建你的个人 AI。",
    subSloganNote: "在已授权的应用间，与同一位 LocalAgent 接续对话。",
    downloadCta: "下载公开 Beta",
    downloadNote: "Apple Silicon Mac 与 Windows x86_64 公开 Beta。使用 Nimi 需要账号。",
    docsCta: '查看文档',
    demo: {
      windowTitle: 'Nimi',
      nav: { chat: '聊天', explore: '探索', apps: '应用', runtime: '运行时', settings: '设置' },
      chat: {
        greeting: '你好，Halliday！今天想从哪里开始？',
        inputPlaceholder: '向你的 AI 伙伴提问…',
        inputNote: "当前为演示界面，实际对话在 Nimi 桌面端进行。",
        sendLabel: '发送',
        backLabel: '返回',
        userName: 'Halliday',
        defaultTargetId: 'agent-a',
        scriptedReply: '这是一条演示回复，用于展示对话样式；真实回答由 Nimi 桌面端生成。',
        dateLocale: 'zh-CN',
        dateLabels: { today: '今天', yesterday: '昨天' },
        copy: {
          bubbleUserLabel: '你',
          bubbleAssistantLabel: '智能体',
          markdownCopyLabel: '复制',
          markdownCopiedLabel: '已复制',
          typingAgentRoleLabel: '智能体',
          typingThinkingLabel: '正在思考',
          typingStopLabel: '停止',
        },
        agents: [
          {
            id: 'agent-a',
            name: '艾可 Echo',
            initial: 'E',
            messages: [
              { id: 'a-m1', role: 'user', text: '帮我看下《深空信使》第三章的大纲，引力锚点的伏笔放在什么时候揭开更合适？', minutesAgo: 8 },
              { id: 'a-m2', role: 'assistant', text: '建议放在飞船穿过碎石环的时候。表面上是一次常规读数异常，实际上是旧文明的定向脉冲，这样节奏更克制。', minutesAgo: 7 },
              { id: 'a-m3', role: 'user', text: "好，就按这个方向，把这几幕的情绪张力再收紧一点。", minutesAgo: 6 },
              { id: 'a-m4', role: 'assistant', text: '已为你重构好分段节奏草稿，重点强化了通信员的心理独白，随时可以在工作区打开查看。', minutesAgo: 5 },
            ],
          },
          {
            id: 'agent-e',
            name: '星野 Hoshino',
            initial: 'H',
            messages: [
              { id: 'e-m1', role: 'assistant', text: '欢迎回来！上次保存的那段雨夜钢琴动机，我为你生成了两个编排草稿，要试听一下吗？', minutesAgo: 1560 },
              { id: 'e-m2', role: 'user', text: "先听听偏 Lo-Fi 质感的那版。", minutesAgo: 1558 },
            ],
          },
          {
            id: 'agent-k',
            name: '卡尔 Kael',
            initial: 'K',
            messages: [
              { id: 'k-m1', role: 'assistant', text: "你本周关注的 3 篇本地大模型量化笔记已整理完毕，核心结论也提炼好了，随时可以回顾。", minutesAgo: 3000 },
            ],
          },
        ],
      },
      explore: {
        title: '探索',
        searchPlaceholder: '搜索角色、世界与应用',
        sections: [
          {
            label: '角色',
            items: [
              { name: '艾可 Echo', meta: '叙事顾问 · 演示角色' },
              { name: '星野 Hoshino', meta: '音乐伙伴 · 演示角色' },
            ],
          },
          { label: '世界', items: [{ name: '零号绿洲 Oasis Zero', meta: '架空科幻 · 演示世界' }] },
          {
            label: '应用',
            items: [
              { name: 'ParentOS', meta: '记录孩子的成长轨迹与家庭观察' },
              { name: 'Nimi Overtone', meta: "探索音乐灵感与声音实验" },
            ],
          },
        ],
      },
      apps: {
        title: '应用',
        countSuffix: ' 个 App',
        searchPlaceholder: '搜索 App 或 App ID',
        backLabel: '返回应用库',
        launchLabel: '启动',
        tabs: ['概览', 'Nimi Access', 'AI 模型'],
        tabPlaceholderNote: "当前演示不包含此面板数据。",
        aboutTitle: '关于',
        updatedLabel: '最近更新',
        moreInfoLabel: '更多信息',
        previewBadge: '交互预览 · 演示数据',
        previewUnavailableTitle: "暂未提供预览",
        previewUnavailableBody: "此 App 暂未提供交互预览，请从应用库选择其他 App。",
        closeLabel: '关闭',
        items: [
          { id: 'nimi.zhiyu', name: '织羽', task: '孵化属于你的本地 AI 伙伴：陪伴对话、个性塑造与共同成长。', tags: ['文字生成', '语音合成'], updatedAt: '2026年9月17日', localDev: true },
          { id: 'nimi.parentos', name: 'ParentOS', task: "记录孩子的成长点滴与家庭日常，在本机建立私密的成长档案。", tags: ['文字生成', '语音转写'], updatedAt: '2026年9月15日', localDev: true, iconSrc: '/demo/parentos-icon.png' },
          { id: "io.github.nimiplatform.jev-search", name: "Jev Search", task: "用自然语言搜索全网信息，筛选感兴趣的来源，整理出清晰的参考链接。", tags: ["搜索","结果排序"], updatedAt: "2026年10月12日", localDev: true, iconSrc: '/demo/jev-search-icon.png' },
          { id: "io.github.nimiplatform.jev-ultrafast", name: "Jev Ultrafast", task: "为浏览器设定目标，让它自主观察网页、做出决策并连续执行自动化操作。", tags: ["浏览器任务","文字"], updatedAt: "2026年10月12日", localDev: true, iconSrc: '/demo/jev-ultrafast-icon.png' },
          { id: "moneyprinterturbo.studio", name: "MoneyPrinterTurbo", task: "一站式短视频生成工具：串联文案创意、画面素材、AI 配音与字幕排版。", tags: ["文字","语音","视频"], updatedAt: "2026年10月12日", localDev: true, iconSrc: '/demo/moneyprinter-icon.png' },
          { id: "ai.nimi.openwhispr", name: "OpenWhispr", task: "捕捉口语灵感：通过语音听写，将零碎录音自动提炼为结构化笔记。", tags: ["听写","笔记","搜索"], updatedAt: "2026年10月12日", localDev: true, iconSrc: '/demo/openwhispr-icon.png' },
          { id: "ai.nimi.videolingo", name: "VideoLingo", task: "让视频跨越语言：串联语音转写、翻译、双语字幕校对与配音。", tags: ["转写","翻译","配音"], updatedAt: "2026年10月12日", localDev: true, iconSrc: '/demo/videolingo-icon.png' },
          { id: "nimiplatform.voicestudio", name: "VoiceStudio", task: "个性化声音设计工坊：为故事、有声书与影视旁白定制独特声线。", tags: ["声音设计","语音","转写"], updatedAt: "2026年10月12日", localDev: true, iconSrc: '/demo/voicestudio-icon.png' },
          {"id":"nimi.overtone","name":"Nimi Overtone","task":"音乐创作者的灵感试验场：从画面意象出发生成多维旋律，编排歌词与音轨版本。","tags":["音乐","歌词"],"updatedAt":"2026-10-13","localDev":true,"iconSrc":"/demo/overtone-icon.png"},
          { id: 'nimi.storybook', name: 'Storybook', task: "沉浸式互动故事创作平台：与鲜活角色对话，在分支选择间推动情节，走出专属的故事体验。", tags: ['文字生成'], updatedAt: '2026年9月10日', localDev: false, iconSrc: '/demo/storybook-icon.png' },
          {"id":"nimi.realm-persona-studio","name":"Realm Persona Studio","task":"打造专属 Realm Persona：定制角色的外貌立绘、性格特质与故事设定。","tags":["角色创作","图像"],"updatedAt":"2026-10-13","localDev":true,"iconSrc":"/demo/persona-studio-icon.png"},
          { id: 'nimi.shijing', name: '时镜 ShiJing', task: '传统干支历法与个人节律推演：以节气时令为镜，洞察身心周期与决策时机。', tags: ['文字生成'], updatedAt: '2026年9月5日', localDev: true },
          { id: 'nimi.odd-bureau', name: '奇物局', task: "上传一张随手拍下的日常物品照片，让 AI 将它化作充满奇趣的可玩微世界。", tags: ['视觉定位', '文字生成', '语音合成'], updatedAt: '2026年9月18日', localDev: true },
          {"id":"nimi.inscape","name":"Inscape 心相","task":"面向成人的荣格八维性格探索与深层反思空间，所有心绪笔记严格保存在本地。","tags":["自我探索","日常反思"],"updatedAt":"2026-10-13","localDev":true,"iconSrc":"/demo/inscape-icon.png"},
          {"id":"nimi.polyagent","name":"PolyAgent","task":"预测市场研究与模拟交易：观察市场、设定策略约束，在模拟账本中推演想法。","tags":["市场观察","模拟交易"],"updatedAt":"2026-10-13","localDev":true,"iconSrc":"/demo/polyagent-icon.png"},
          {"id":"nimi.realm-world-studio","name":"Realm World Studio","task":"构筑宏大虚拟世界：设定地理风貌、社会法则与阵营势力，为角色搭建鲜活舞台。","tags":["世界设定","角色创作"],"updatedAt":"2026-10-13","localDev":true,"iconSrc":"/demo/world-studio-icon.png"},
          {"id":"org.nimiplatform.deeptutor","name":"DeepTutor","task":"围绕专业文献与深度难题展开对话：拆解硬核概念、推演公式并沉淀系统笔记。","tags":["学习","研究","笔记"],"updatedAt":"2026-10-13","localDev":true,"iconSrc":"/demo/deeptutor-icon.png"},
          {"id":"openmontage.studio","name":"OpenMontage","task":"剧本到成片的高效工作台：将零散素材、文本台词快速组织为分镜视频与旁白。","tags":["分镜","视频","语音"],"updatedAt":"2026-10-13","localDev":true,"iconSrc":"/demo/openmontage-icon.png"},
          {"id":"org.nimiplatform.sillytavern","name":"SillyTavern","task":"虚构角色沉浸对话平台：管理多元人设、世界书设定与长文本剧情互动。","tags":["角色对话","世界书"],"updatedAt":"2026-10-13","localDev":true,"iconSrc":"/demo/sillytavern-icon.png"},
          {"id":"nimiplatform.vane","name":"Vane","task":"从一个深度疑问开始研究：穿梭于长篇文献与网页，提炼逻辑严谨的分析报告。","tags":["搜索","研究"],"updatedAt":"2026-10-13","localDev":true,"iconSrc":"/demo/vane-icon.png"},
          {"id":"io.github.nimiplatform.next-ai-draw-io","name":"Next AI Draw.io","task":"用自然语言勾勒复杂架构图与流程图，在交互画布中自由排版与细化。","tags":["图表","文字"],"updatedAt":"2026-10-13","localDev":true,"iconSrc":"/demo/drawio-icon.png"},
          {"id":"io.github.nimiplatform.open-notebook","name":"Open Notebook","task":"个人研究工作区：将资料文献、问答思索与灵感播客融为一体，沉淀知识网络。","tags":["资料研究","笔记","播客"],"updatedAt":"2026-10-13","localDev":true,"iconSrc":"/demo/open-notebook-icon.png"},
          {"id":"io.github.nimiplatform.presenton","name":"Presenton","task":"交互式演示文稿助手：将粗略思路转化为结构清晰、设计优雅的幻灯片。","tags":["演示文稿","编辑"],"updatedAt":"2026-10-13","localDev":true,"iconSrc":"/demo/presenton-icon.png"},
        ],
      },
      appPreview: {
        locale: 'zh',
        messages: appPreviewMessagesZh,
        remainingApps: createRemainingAppPreviewContent(t),
        zhiyu: createZhiyuPreviewContent(t),
        shijing: createShijingPreviewContent(t),
        parentos: createParentosPreviewContent(t),
        storybook: createStorybookPreviewContent(t),
        oddBureau: createOddBureauPreviewContent(t),
        jevSearch: createJevSearchPreviewContent(t),
        jevUltrafast: createJevUltrafastPreviewContent(t),
        moneyPrinter: createMoneyPrinterPreviewContent(t),
        openwhispr: createOpenwhisprPreviewContent(t),
        videoLingo: createVideoLingoPreviewContent(t),
        voiceStudio: createVoiceStudioPreviewContent(t),
      },
      runtime: {
        title: '运行时',
        subtitle: "本地运行时与模型状态 · 演示数据",
        groups: [
          { label: '服务', rows: [{ label: '运行时状态', value: '运行中' }, { label: '版本', value: '演示构建' }] },
          { label: "模型", rows: [{ label: '本地模型', value: '1 个可用' }, { label: '云端连接', value: '2 个' }] },
          { label: '数据', rows: [{ label: '数据目录', value: '本机' }] },
        ],
      },
      settings: {
        title: '设置',
        groups: [
          { label: '账户', rows: [{ label: "个人资料", value: 'Halliday' }, { label: '语言', value: '中文' }] },
          { label: '外观', rows: [{ label: '主题', value: '浅色' }, { label: '界面密度', value: '舒适' }] },
          { label: '通知', rows: [{ label: '桌面通知', value: '已开启' }, { label: '提示音', value: "已关闭" }] },
          { label: '关于', rows: [{ label: '版本', value: '演示构建' }] },
        ],
      },
    },
  },
  apps: {
    title: "AI 不该只是一个单调的对话框。",
    subtitle: "在 Nimi，AI 化身为趁手、专注且保护隐私的本地应用。",
  },
  worlds: {
    title: '遇见有生命力的角色，走进属于他们的世界。',
    subtitle: '告别问完即走的冰冷交互。在这里，角色拥有连贯的性格与记忆，世界拥有鲜活的历史与法则。',
    body: "与角色展开对话，走近他的喜怒哀乐与身处的世界。你可以带着具体的问题而来，也可以只是找一位老朋友聊聊天。",
    exampleTitle: '一次典型的开始',
    exampleSteps: [
      '在 Nimi 中选择一个让你产生好奇的角色。',
      '从一段对话开始，感受角色的性格底色与世界背景。',
      '继续探讨深入话题，或随时回到世界介绍看看还有哪些伙伴。',
    ],
    cta: '探索角色与世界',
  },
  capabilities: {
    title: "既能在本地运行，也能按需连接云端。",
    subtitle: '根据任务的隐私敏感度、计算强度与预算成本，随心搭配你的 AI 算力。',
    tasks: [
      {
        id: 'writing',
        title: '写作与深度重构',
        description: '润色推敲、大纲拆解、观点提炼，将零碎的思绪变成凝练的作品。',
      },
      {
        id: 'image',
        title: '多维视觉创作',
        description: '从草图绘制到细腻生成，为故事与应用赋予生动的视觉呈现。',
      },
      {
        id: 'media',
        title: '影音与多模态',
        description: '精准音视频语音转写、高质量双语字幕制作与智能声轨切分。',
      },
      {
        id: 'music',
        title: '灵感音乐创作',
        description: "根据画面意象生成旋律片段，推敲歌词结构并管理录音版本。",
      },
      {
        id: 'conversation',
        title: '角色与实时会话',
        description: '用文字或语音展开对话，在支持的实时模型上自然打断与接话。',
      },
      {
        id: 'vision',
        title: '空间与视觉定位',
        description: "识别画面元素与空间相对位置，为复杂的自动化应用提供视觉感知能力。",
      },
    ],
    localTitle: '本地 AI (Local-First)',
    localText: '模型完全在你的本机显卡或芯片上运算，无需支付云端推理费用。可用模型视设备配置而定；登录、下载与在线功能仍需联网。',
    cloudTitle: '云端 AI (Cloud-Connected)',
    cloudText: '随时按需接入前沿云端超大模型，适合极其复杂的推理、高精度生成与多模态任务。',
    costNote: 'Nimi 本身免费且开源。云端服务按对应服务商的规则计费，第三方 App 是否收费由发布者决定。',
    cta: '了解模型支持与运行条件',
  },
  create: {
    title: '把你的想法，变成自己的应用。',
    subtitle: '围绕你的真实工作流程，创建供自己使用的本地 AI 工具。',
    body: '从一个具体需求出发：它需要处理什么、按照什么步骤工作、最后给你什么结果。接入所需的 AI 能力，让这个应用按你的方式工作。',
    steps: [
      {
        title: '明确具体需求',
        description: "理清任务的输入内容、处理步骤与预期的产出结构。",
      },
      {
        title: '初始化工程骨架',
        description: '使用 Nimi App 脚手架几秒内生成标准工程，接入受保护的宿主会话。',
      },
      {
        title: '调用 Nimi SDK',
        description: '通过标准强类型接口接入本地或云端 AI，专注编写你的前端视图与交互。',
      },
      {
        title: '本地流畅调试',
        description: '在 Desktop 监督下实时预览、热重载调试，直到它完全契合你的习惯。',
      },
    ],
    caveat: '创建个人 App 目前面向拥有基本前端开发经验的开发者，暂未开放无代码拖拽搭建。',
    cta: '了解如何创建个人 App',
  },
  continuity: {
    title: '换个应用，依然是懂你的那个 AI。',
    subtitle: "经你授权，同一个 LocalAgent 可在不同应用间持续陪伴；记忆按 Agent 独立保存在本机。",
    body: "开启长期记忆后，相关内容可以为下一次互动提供上下文。使用云端推理时，相关上下文可能随请求发送给所选服务商。",
    supports: ['应用访问遵循当前有效会话的授权。', '不同 Agent 拥有各自独立的记忆。'],
  },
  developers: {
    eyebrow: '开发者生态',
    title: '让你的应用在用户的设备上安全绽放。',
    subtitle: "通过 Nimi SDK 统一调用端侧与云端多模态模型，并在受保护的桌面宿主会话中发起请求。",
    body: "查阅接入指南、API 文档与实战示例，快速上手 Nimi 生态开发。",
    points: [
      "标准 Nimi SDK：一套强类型接口，统一接入所支持的本地与云端模型。",
      "分步开发指南：从创建工程到完成首次 AI 调用，每一步都清晰明了。",
      '开箱即用脚手架：使用 app-tools 快速起步，体验秒级热重载。',
    ],
    primaryCta: '阅读开发指南',
    secondaryCta: '查看代码仓库',
  },
  getStarted: {
    title: '开启专属于你的个人 AI 时代。',
    subtitle: "从公开 Beta 开始，挑选心仪的生态应用，或结识一位新的 AI 伙伴——从你想做的事开始。",
    primaryCta: "下载公开 Beta",
    availability: "公开 Beta 已支持 Apple Silicon Mac 与 Windows x86_64。使用 Nimi 需要 Nimi 账号，并在浏览器中完成登录。",
    secondaryCta: '探索全部应用',
  },
  footer: {
    line1: 'MAKE AI TRULY YOURS',
    line2: "发现各类应用，遇见 AI 角色，探索不同世界。",
    navLabel: '页面',
    appsLabel: '应用',
    worldsLabel: '角色与世界',
    createLabel: '创建应用',
    developersLabel: '开发者',
    docsLabel: '文档',
    githubLabel: 'GitHub',
    downloadLabel: '下载状态',
    codeSigningLabel: '代码签名政策',
    securityLabel: '安全报告',
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
