import { createHomeChatData } from './home-chat-content.js';
import { createHomeDemoContent } from './home-demo-content.js';
import { createPreviewTranslate, type PreviewMessages } from '../i18n/preview-messages.js';
import { sharedMessagesZh } from './app-preview-copy/shared.zh.js';
import { sharedMessagesEn } from './app-preview-copy/shared.en.js';
import { zhiyuMessagesZh } from './app-preview-copy/zhiyu.zh.js';
import { zhiyuMessagesEn } from './app-preview-copy/zhiyu.en.js';
import { createZhiyuPreviewContent } from './landing-content.zhiyu.js';
import type { HeroDemo, HeroDemoAppItem } from './landing-content.js';
import type { LandingLocale } from '../i18n/locale.js';

const coreMessagesZh = {
  ...sharedMessagesZh,
  ...zhiyuMessagesZh,
} as unknown as PreviewMessages;

const coreMessagesEn = {
  ...sharedMessagesEn,
  ...zhiyuMessagesEn,
} as unknown as PreviewMessages;

const translateZh = createPreviewTranslate(coreMessagesZh);
const translateEn = createPreviewTranslate(coreMessagesEn);

const APP_ITEMS_ZH: ReadonlyArray<HeroDemoAppItem> = [
  { id: 'nimi.zhiyu', iconSrc: '/demo/zhiyu-icon.png', name: '织羽', task: '与 Nimi 伙伴日常相处，延续对话与记忆，体验已配置的语音和形象。', tags: ['伙伴', '对话', '记忆'], updatedAt: '2026年9月17日', localDev: true },
  { id: 'nimi.parentos', name: 'ParentOS', task: '记录孩子的成长点滴与家庭日常，在本机建立私密的成长档案。', tags: ['文字生成', '语音转写'], updatedAt: '2026年9月15日', localDev: true, iconSrc: '/demo/parentos-icon.png' },
  { id: 'io.github.nimiplatform.jev-search', name: 'Jev Search', task: '用自然语言搜索全网信息，筛选感兴趣的来源，整理出清晰的参考链接。', tags: ['搜索', '结果排序'], updatedAt: '2026年10月12日', localDev: true, iconSrc: '/demo/jev-search-icon.png' },
  { id: 'io.github.nimiplatform.jev-ultrafast', name: 'Jev Ultrafast', task: '为浏览器设定目标，让它自主观察网页、做出决策并连续执行自动化操作。', tags: ['浏览器任务', '文字'], updatedAt: '2026年10月12日', localDev: true, iconSrc: '/demo/jev-ultrafast-icon.png' },
  { id: 'moneyprinterturbo.studio', name: 'MoneyPrinterTurbo', task: '一站式短视频生成工具：串联文案创意、画面素材、AI 配音与字幕排版。', tags: ['文字', '语音', '视频'], updatedAt: '2026年10月12日', localDev: true, iconSrc: '/demo/moneyprinter-icon.png' },
  { id: 'ai.nimi.openwhispr', name: 'OpenWhispr', task: '捕捉口语灵感：通过语音听写，将零碎录音自动提炼为结构化笔记。', tags: ['听写', '笔记', '搜索'], updatedAt: '2026年10月12日', localDev: true, iconSrc: '/demo/openwhispr-icon.png' },
  { id: 'ai.nimi.videolingo', name: 'VideoLingo', task: '让视频跨越语言：串联语音转写、翻译、双语字幕校对与配音。', tags: ['转写', '翻译', '配音'], updatedAt: '2026年10月12日', localDev: true, iconSrc: '/demo/videolingo-icon.png' },
  { id: 'nimiplatform.voicestudio', name: 'VoiceStudio', task: '个性化声音设计工坊：为故事、有声书与影视旁白定制独特声线。', tags: ['声音设计', '语音', '转写'], updatedAt: '2026年10月12日', localDev: true, iconSrc: '/demo/voicestudio-icon.png' },
  { id: 'nimi.overtone', name: 'Nimi Overtone', task: '音乐创作者的灵感试验场：从画面意象出发生成多维旋律，编排歌词与音轨版本。', tags: ['音乐', '歌词'], updatedAt: '2026-10-13', localDev: true, iconSrc: '/demo/overtone-icon.png' },
  { id: 'nimi.storybook', name: 'Storybook', task: '沉浸式互动故事创作平台：与鲜活角色对话，在分支选择间推动情节，走出专属的故事体验。', tags: ['文字生成'], updatedAt: '2026年9月10日', localDev: false, iconSrc: '/demo/storybook-icon.png' },
  { id: 'nimi.realm-persona-studio', name: 'Realm Persona Studio', task: '打造专属 Realm Persona：定制角色的外貌立绘、性格特质与故事设定。', tags: ['角色创作', '图像'], updatedAt: '2026-10-13', localDev: true, iconSrc: '/demo/persona-studio-icon.png' },
  { id: 'nimi.shijing', name: '时镜 ShiJing', task: '传统干支历法与个人节律推演：以节气时令为镜，洞察身心周期与决策时机。', tags: ['文字生成'], updatedAt: '2026年9月5日', localDev: true, iconSrc: '/demo/shijing-icon.png' },
  { id: 'nimi.odd-bureau', name: '奇物局', task: '上传一张随手拍下的日常物品照片，让 AI 将它化作充满奇趣的可玩微世界。', tags: ['视觉定位', '文字生成', '语音合成'], updatedAt: '2026年9月18日', localDev: true, iconSrc: '/demo/odd-bureau-icon.png' },
  { id: 'nimi.inscape', name: 'Inscape 心相', task: '面向成人的荣格八维性格探索与深层反思空间，所有心绪笔记严格保存在本地。', tags: ['自我探索', '日常反思'], updatedAt: '2026-10-13', localDev: true, iconSrc: '/demo/inscape-icon.png' },
  { id: 'nimi.polyagent', name: 'PolyAgent', task: '预测市场研究与模拟交易：观察市场、设定策略约束，在模拟账本中推演想法。', tags: ['市场观察', '模拟交易'], updatedAt: '2026-10-13', localDev: true, iconSrc: '/demo/polyagent-icon.png' },
  { id: 'nimi.realm-world-studio', name: 'Realm World Studio', task: '构筑宏大虚拟世界：设定地理风貌、社会法则与阵营势力，为角色搭建鲜活舞台。', tags: ['世界设定', '角色创作'], updatedAt: '2026-10-13', localDev: true, iconSrc: '/demo/world-studio-icon.png' },
  { id: 'org.nimiplatform.deeptutor', name: 'DeepTutor', task: '围绕专业文献与深度难题展开对话：拆解硬核概念、推演公式并沉淀系统笔记。', tags: ['学习', '研究', '笔记'], updatedAt: '2026-10-13', localDev: true, iconSrc: '/demo/deeptutor-icon.png' },
  { id: 'openmontage.studio', name: 'OpenMontage', task: '剧本到成片的高效工作台：将零散素材、文本台词快速组织为分镜视频与旁白。', tags: ['分镜', '视频', '语音'], updatedAt: '2026-10-13', localDev: true, iconSrc: '/demo/openmontage-icon.png' },
  { id: 'org.nimiplatform.sillytavern', name: 'SillyTavern', task: '虚构角色沉浸对话平台：管理多元人设、世界书设定与长文本剧情互动。', tags: ['角色对话', '世界书'], updatedAt: '2026-10-13', localDev: true, iconSrc: '/demo/sillytavern-icon.png' },
  { id: 'nimiplatform.vane', name: 'Vane', task: '从一个深度疑问开始研究：穿梭于长篇文献与网页，提炼逻辑严谨的分析报告。', tags: ['搜索', '研究'], updatedAt: '2026-10-13', localDev: true, iconSrc: '/demo/vane-icon.png' },
  { id: 'io.github.nimiplatform.next-ai-draw-io', name: 'Next AI Draw.io', task: '用自然语言勾勒复杂架构图与流程图，在交互画布中自由排版与细化。', tags: ['图表', '文字'], updatedAt: '2026-10-13', localDev: true, iconSrc: '/demo/drawio-icon.png' },
  { id: 'io.github.nimiplatform.open-notebook', name: 'Open Notebook', task: '个人研究工作区：将资料文献、问答思索与灵感播客融为一体，沉淀知识网络。', tags: ['资料研究', '笔记', '播客'], updatedAt: '2026-10-13', localDev: true, iconSrc: '/demo/open-notebook-icon.png' },
  { id: 'io.github.nimiplatform.presenton', name: 'Presenton', task: '交互式演示文稿助手：将粗略思路转化为结构清晰、设计优雅的幻灯片。', tags: ['演示文稿', '编辑'], updatedAt: '2026-10-13', localDev: true, iconSrc: '/demo/presenton-icon.png' },
];

const APP_ITEMS_EN: ReadonlyArray<HeroDemoAppItem> = [
  { id: 'nimi.zhiyu', iconSrc: '/demo/zhiyu-icon.png', name: 'Zhiyu', task: 'Spend time with your Nimi companions, pick up past conversations with their existing memories, and use the voices and avatars you’ve set up.', tags: ['Companions', 'Conversations', 'Memory'], updatedAt: 'September 17, 2026', localDev: true },
  { id: 'nimi.parentos', name: 'ParentOS', task: 'Record your child’s milestones and everyday family life in a private journal on your device.', tags: ['Text Generation', 'Voice Transcription'], updatedAt: 'September 15, 2026', localDev: true, iconSrc: '/demo/parentos-icon.png' },
  { id: 'io.github.nimiplatform.jev-search', name: 'Jev Search', task: 'Search the web in plain language, filter for sources that interest you, and organize the links for reference.', tags: ['Search', 'Result Ranking'], updatedAt: 'October 12, 2026', localDev: true, iconSrc: '/demo/jev-search-icon.png' },
  { id: 'io.github.nimiplatform.jev-ultrafast', name: 'Jev Ultrafast', task: 'Set a goal and let your browser read the page, make decisions, and run multi-step workflows.', tags: ['Browser Automation', 'Text'], updatedAt: 'October 12, 2026', localDev: true, iconSrc: '/demo/jev-ultrafast-icon.png' },
  { id: 'moneyprinterturbo.studio', name: 'MoneyPrinterTurbo', task: 'Make short videos in one place, from script ideas and visuals to AI voiceover and subtitle layout.', tags: ['Text', 'Voice', 'Video'], updatedAt: 'October 12, 2026', localDev: true, iconSrc: '/demo/moneyprinter-icon.png' },
  { id: 'ai.nimi.openwhispr', name: 'OpenWhispr', task: 'Capture ideas by speaking and turn short recordings into structured notes.', tags: ['Dictation', 'Notes', 'Search'], updatedAt: 'October 12, 2026', localDev: true, iconSrc: '/demo/openwhispr-icon.png' },
  { id: 'ai.nimi.videolingo', name: 'VideoLingo', task: 'Bring your videos into new languages with transcription, translation, bilingual subtitle review, and dubbing.', tags: ['Transcription', 'Translation', 'Dubbing'], updatedAt: 'October 12, 2026', localDev: true, iconSrc: '/demo/videolingo-icon.png' },
  { id: 'nimiplatform.voicestudio', name: 'VoiceStudio', task: 'Design a distinctive voice for stories, audiobooks, and cinematic narration.', tags: ['Voice Design', 'Speech', 'Transcription'], updatedAt: 'October 12, 2026', localDev: true, iconSrc: '/demo/voicestudio-icon.png' },
  { id: 'nimi.overtone', name: 'Nimi Overtone', task: 'Use imagery as a starting point for different melodies, then shape the lyrics and arrange versions of your tracks.', tags: ['Music', 'Lyrics'], updatedAt: '2026-10-13', localDev: true, iconSrc: '/demo/overtone-icon.png' },
  { id: 'nimi.storybook', name: 'Storybook', task: 'Create interactive stories, talk with their characters, and choose how the plot unfolds.', tags: ['Text Generation'], updatedAt: 'September 10, 2026', localDev: false, iconSrc: '/demo/storybook-icon.png' },
  { id: 'nimi.realm-persona-studio', name: 'Realm Persona Studio', task: 'Craft your own Realm Personas—shape portraits, personality traits, and lore drafts.', tags: ['Character Creation', 'Images'], updatedAt: '2026-10-13', localDev: true, iconSrc: '/demo/persona-studio-icon.png' },
  { id: 'nimi.shijing', name: 'ShiJing 时镜', task: 'Personal rhythm companion grounded in traditional solar-term calendars and cyclical self-observation.', tags: ['Text Generation'], updatedAt: 'September 5, 2026', localDev: true, iconSrc: '/demo/shijing-icon.png' },
  { id: 'nimi.odd-bureau', name: 'Odd Bureau 奇物局', task: 'Upload a photo of an everyday object and let AI turn it into a small, playful world you can explore.', tags: ['Visual Grounding', 'Text Generation', 'Speech Synthesis'], updatedAt: 'September 18, 2026', localDev: true, iconSrc: '/demo/odd-bureau-icon.png' },
  { id: 'nimi.inscape', name: 'Inscape 心相', task: 'Self-discovery for adults, grounded in Jungian cognitive functions—with all reflections stored strictly on your device.', tags: ['Self-Discovery', 'Daily Reflection'], updatedAt: '2026-10-13', localDev: true, iconSrc: '/demo/inscape-icon.png' },
  { id: 'nimi.polyagent', name: 'PolyAgent', task: 'Observe prediction markets, establish strategic constraints, and track hypotheses in a simulated ledger.', tags: ['Market Analysis', 'Paper Trading'], updatedAt: '2026-10-13', localDev: true, iconSrc: '/demo/polyagent-icon.png' },
  { id: 'nimi.realm-world-studio', name: 'Realm World Studio', task: 'Build worlds from the ground up: shape geographies, social rules, and factions to stage living stories.', tags: ['Worldbuilding', 'Character Creation'], updatedAt: '2026-10-13', localDev: true, iconSrc: '/demo/world-studio-icon.png' },
  { id: 'org.nimiplatform.deeptutor', name: 'DeepTutor', task: 'Interrogate technical papers and tough problems: deconstruct concepts, work through derivations, and keep notes.', tags: ['Learning', 'Research', 'Notes'], updatedAt: '2026-10-13', localDev: true, iconSrc: '/demo/deeptutor-icon.png' },
  { id: 'openmontage.studio', name: 'OpenMontage', task: 'Bring footage and script lines together into storyboard sequences with narration, then take them through to a final cut.', tags: ['Storyboards', 'Video', 'Voice'], updatedAt: '2026-10-13', localDev: true, iconSrc: '/demo/openmontage-icon.png' },
  { id: 'org.nimiplatform.sillytavern', name: 'SillyTavern', task: 'Bring fictional casts to life with multi-character lorebooks, persona profiles, and long-context dialogue.', tags: ['Character Chat', 'Lorebooks'], updatedAt: '2026-10-13', localDev: true, iconSrc: '/demo/sillytavern-icon.png' },
  { id: 'nimiplatform.vane', name: 'Vane', task: 'Dig into long-form literature and web sources to build research briefs with source references.', tags: ['Search', 'Research'], updatedAt: '2026-10-13', localDev: true, iconSrc: '/demo/vane-icon.png' },
  { id: 'io.github.nimiplatform.next-ai-draw-io', name: 'Next AI Draw.io', task: 'Sketch complex system diagrams and process flows with natural language, then fine-tune them on an interactive canvas.', tags: ['Diagrams', 'Text'], updatedAt: '2026-10-13', localDev: true, iconSrc: '/demo/drawio-icon.png' },
  { id: 'io.github.nimiplatform.open-notebook', name: 'Open Notebook', task: 'Weave documents, Q&A reflections, and podcast audio into an interconnected web of knowledge.', tags: ['Document Research', 'Notes', 'Podcasts'], updatedAt: '2026-10-13', localDev: true, iconSrc: '/demo/open-notebook-icon.png' },
  { id: 'io.github.nimiplatform.presenton', name: 'Presenton', task: 'Turn rough bullet points into well-structured, beautifully typeset slide decks.', tags: ['Presentations', 'Editor'], updatedAt: '2026-10-13', localDev: true, iconSrc: '/demo/presenton-icon.png' },
];

const CORE_DEMO_CACHE: Partial<Record<LandingLocale, HeroDemo>> = {};

export function getHeroDemoAppItems(locale: LandingLocale): ReadonlyArray<HeroDemoAppItem> {
  return locale === 'zh' ? APP_ITEMS_ZH : APP_ITEMS_EN;
}

/**
 * Lightweight synchronous HeroDemo seed containing Home, Chat, the 23 App
 * catalog metadata rows, and the Zhiyu companion seed so public routes mount
 * on frame 1 without downloading the 22 non-Zhiyu app preview datasets.
 */
export function createCoreHeroDemo(locale: LandingLocale): HeroDemo {
  const cached = CORE_DEMO_CACHE[locale];
  if (cached) return cached;

  const created: HeroDemo = locale === 'zh'
    ? {
      windowTitle: 'Nimi Home',
      nav: { home: '首页', chat: '聊天', explore: '探索', apps: '应用', runtime: 'AI 能力', cloud: '云服务', integrations: '集成', downloads: '下载', messages: '消息中心', settings: '设置', diagnostics: '高级与诊断' },
      home: createHomeDemoContent('zh'),
      chat: {
        greeting: '你好，Halliday！想从哪里开始？',
        inputPlaceholder: '向 Nimi 提问…',
        inputNote: '当前为演示界面，实际对话在 Nimi 桌面端进行。',
        sendLabel: '发送',
        backLabel: '返回',
        userName: 'Halliday',
        defaultTargetId: 'ai:assistant',
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
        ...createHomeChatData('zh'),
      },
      apps: {
        title: '应用',
        countSuffix: ' 个 App',
        searchPlaceholder: '搜索 App 或 App ID',
        backLabel: '返回应用库',
        launchLabel: '启动',
        tabs: ['概览', 'Nimi Access', 'AI 模型'],
        aboutTitle: '关于',
        updatedLabel: '最近更新',
        moreInfoLabel: '更多信息',
        previewBadge: '交互预览 · 演示数据',
        previewUnavailableTitle: '暂未提供预览',
        previewUnavailableBody: '此 App 暂未提供交互预览，请从应用库选择其他 App。',
        closeLabel: '关闭',
        items: APP_ITEMS_ZH,
      },
      appPreview: {
        locale: 'zh',
        messages: coreMessagesZh,
        zhiyu: createZhiyuPreviewContent(translateZh, 'zh'),
      },
    }
    : {
      windowTitle: 'Nimi Home',
      nav: { home: 'Home', chat: 'Chat', explore: 'Explore', apps: 'Apps', runtime: 'AI Capabilities', cloud: 'Cloud Services', integrations: 'Integrations', downloads: 'Downloads', messages: 'Message center', settings: 'Settings', diagnostics: 'Advanced & diagnostics' },
      home: createHomeDemoContent('en'),
      chat: {
        greeting: 'Hi, Halliday! Where shall we begin today?',
        inputPlaceholder: 'Ask your AI companion…',
        inputNote: 'Interactive preview; real conversations take place inside the Nimi desktop app.',
        sendLabel: 'Send',
        backLabel: 'Back',
        userName: 'Halliday',
        defaultTargetId: 'ai:assistant',
        scriptedReply: 'This is a sample reply demonstrating UI flow; real responses are generated live by the Nimi desktop app.',
        dateLocale: 'en-US',
        dateLabels: { today: 'Today', yesterday: 'Yesterday' },
        copy: {
          bubbleUserLabel: 'You',
          bubbleAssistantLabel: 'Agent',
          markdownCopyLabel: 'Copy',
          markdownCopiedLabel: 'Copied',
          typingAgentRoleLabel: 'Agent',
          typingThinkingLabel: 'Thinking',
          typingStopLabel: 'Stop',
        },
        ...createHomeChatData('en'),
      },
      apps: {
        title: 'Apps',
        countSuffix: ' Apps',
        searchPlaceholder: 'Search apps or App IDs',
        backLabel: 'Back to app library',
        launchLabel: 'Launch',
        tabs: ['Overview', 'Nimi Access', 'AI Models'],
        aboutTitle: 'About',
        updatedLabel: 'Recently updated',
        moreInfoLabel: 'More info',
        previewBadge: 'Interactive Preview · Demo Data',
        previewUnavailableTitle: 'Preview not available',
        previewUnavailableBody: 'An interactive preview is not available for this app yet. Please pick another app from the catalog.',
        closeLabel: 'Close',
        items: APP_ITEMS_EN,
      },
      appPreview: {
        locale: 'en',
        messages: coreMessagesEn,
        zhiyu: createZhiyuPreviewContent(translateEn, 'en'),
      },
    };

  CORE_DEMO_CACHE[locale] = created;
  return created;
}

export const LOCALE_TOGGLE_OPTIONS: Record<LandingLocale, {
  en: string;
  zh: string;
  switchToEn: string;
  switchToZh: string;
}> = {
  zh: {
    en: 'English',
    zh: '中文',
    switchToEn: '切换语言为英文',
    switchToZh: '切换语言为中文',
  },
  en: {
    en: 'English',
    zh: '中文',
    switchToEn: 'Switch language to English',
    switchToZh: 'Switch language to Chinese',
  },
};
