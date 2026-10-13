/** Public authored examples, localized by the landing content loader. */
export const jevSearchPreviewContent = {
  name: 'Jev Search',
  tagline: 'Picks where to search. Ranks what comes back.',
  query: 'Rust async runtimes on Hacker News this month',
  examples: [
    'Rust async runtimes on Hacker News this month',
    'What do Reddit users think of the Framework laptop?',
    'New papers on speculative decoding',
  ],
  results: [
    {
      source: 'Hacker News',
      url: 'news.ycombinator.com',
      title: 'Choosing an async runtime for a Rust project',
      description:
        'A sample discussion comparing runtime design, ergonomics, and the kinds of workloads each approach fits.',
      relevance: 96,
    },
    {
      source: 'Google',
      url: 'rust-lang.org',
      title: 'Async Rust: tasks, futures, and runtimes',
      description:
        'An example reading list for understanding how asynchronous Rust programs are executed.',
      relevance: 92,
    },
    {
      source: 'Hacker News',
      url: 'news.ycombinator.com',
      title: 'What we learned building an async service',
      description:
        'Example notes on scheduling, cancellation, and keeping concurrent code understandable.',
      relevance: 85,
    },
  ],
  notice:
    'Static product preview. Search results and relevance scores are illustrative; no search or AI request is sent.',
} as const;

export const jevUltrafastPreviewContent = {
  name: 'Jev Ultrafast',
  title: 'Every page is a set of possibilities.',
  description:
    'A decision model picks the next operation, then its element. A text model writes field values.',
  goal: 'Open the information link on example.com.',
  steps: [
    {
      title: 'Observe the page',
      action: 'CLICK',
      target: 'More information…',
      detail: 'The page has one link. Follow it to read about example domains.',
      url: 'https://example.com',
      page: 'Example Domain',
    },
    {
      title: 'Read the destination',
      action: 'DONE',
      target: 'IANA-managed Reserved Domains',
      detail: 'The information page is open. This saved example has reached its destination.',
      url: 'https://www.iana.org/help/example-domains',
      page: 'Example Domains',
    },
  ],
  notice:
    'Static product preview · a saved example sequence. No browser is launched and no model decision is made.',
} as const;

export const moneyPrinterPreviewContent = {
  name: 'MoneyPrinterTurbo',
  subject: '给自己一个周末，去海边慢下来',
  script:
    '把城市留在身后，沿着海岸慢慢走。\n清晨听海浪，午后找一家小店，傍晚等一场日落。\n旅行不必安排得很满，留一点时间，给风和自己。',
  terms: '海岸, 日落, 周末旅行',
  stages: ['文案', '素材', '配音', '字幕', '成片'],
  materials: ['coast-morning.mp4', 'quiet-cafe.mp4', 'sunset-walk.mp4'],
  notice: '静态产品预览 · 文案、素材与制作记录均为示例；不会调用模型、制作视频或发布内容。',
} as const;

export const openwhisprPreviewContent = {
  name: 'OpenWhispr',
  navigation: ['首页', '统计', '聊天', '笔记', '上传', '词典', '设置'],
  notes: [
    {
      title: '海边旅行的几个想法',
      time: '10:24',
      duration: '00:18',
      text: '周末想去海边走一走。带一本书，找一家安静的小店，不用把时间安排得太满。',
      raw: '周末想去海边走一走，嗯，带一本书，找一家安静的小店，不用把时间安排得太满。',
    },
    {
      title: '播客选题草稿',
      time: '09:16',
      duration: '00:12',
      text: '下一期想聊聊如何把零散的灵感整理成可以开始的小项目。',
      raw: '下一期，呃，想聊聊如何把零散的灵感整理成可以开始的小项目。',
    },
    {
      title: '今天的待办',
      time: '昨天',
      duration: '00:09',
      text: '整理书桌，回复邮件，傍晚出去散步。',
      raw: '整理一下书桌，回复邮件，然后傍晚出去散步。',
    },
  ],
  chatPrompt: '帮我整理海边旅行笔记中的准备事项',
  chatReply:
    '这份示例笔记里提到了三件事：留出一个周末、带一本书、找一家安静的小店。行程保持宽松就好。',
  notice: '静态产品预览 · 听写、笔记与聊天均使用示例数据；不会录音、读取你的笔记或调用 AI。',
} as const;

export const videoLingoPreviewContent = {
  name: 'VideoLingo',
  project: 'A quiet weekend by the sea',
  file: 'weekend-by-the-sea.mp4',
  stages: ['导入媒体', '识别语音', '翻译字幕', '配音合成'],
  subtitles: [
    {
      time: '00:00:00 → 00:00:03',
      source: 'Leave a little room in your weekend.',
      target: '给你的周末留一点空白。',
    },
    {
      time: '00:00:03 → 00:00:06',
      source: 'Take a book and walk beside the sea.',
      target: '带一本书，沿着海边慢慢走。',
    },
    { time: '00:00:06 → 00:00:09', source: 'There is no need to hurry.', target: '不必着急赶路。' },
  ],
  notice: '静态产品预览 · 使用示例项目与双语字幕；不会上传媒体、运行转译或生成配音。',
} as const;

export const voiceStudioPreviewContent = {
  name: 'VoiceStudio',
  navigation: ['克隆', '故事', '配音', '配置档案', '转录', '设计', '有声读物', '项目', '工具'],
  description: '温暖、沉稳的成年女声，吐字清晰，语速自然，适合讲述轻松的旅行故事。',
  script: '给自己一个安静的周末，沿着海边慢慢走，让故事从风和海浪开始。',
  voices: [
    { name: '海边叙述者', detail: '温暖 · 清晰 · 自然', initial: '海' },
    { name: '深夜电台', detail: '低沉 · 放松 · 舒缓', initial: '夜' },
    { name: '晨间随笔', detail: '明亮 · 轻快 · 亲切', initial: '晨' },
  ],
  notice: '静态产品预览 · 声音配置与音轨为示例；不会录音、克隆声音或调用语音模型。',
} as const;

export type JevSearchPreviewContent = typeof jevSearchPreviewContent;
export type JevUltrafastPreviewContent = typeof jevUltrafastPreviewContent;
export type MoneyPrinterPreviewContent = typeof moneyPrinterPreviewContent;
export type OpenwhisprPreviewContent = typeof openwhisprPreviewContent;
export type VideoLingoPreviewContent = typeof videoLingoPreviewContent;
export type VoiceStudioPreviewContent = typeof voiceStudioPreviewContent;
