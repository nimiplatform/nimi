import type { HeroDemoAgent, HeroDemoMessageSeed } from './landing-content.js';

/** Fictional public-demo users. Never copied from account contacts or private chats. */
export function createDemoUsers(locale: 'zh' | 'en') {
  const t = (zh: string, en: string) => (locale === 'zh' ? zh : en);
  const conversation = (
    id: string,
    rows: ReadonlyArray<readonly [HeroDemoMessageSeed['role'], string, number]>,
  ): HeroDemoMessageSeed[] =>
    rows.map(([role, text, minutesAgo], index) => ({ id: `${id}-${index + 1}`, role, text, minutesAgo }));
  const people: HeroDemoAgent[] = [
    {
      id: 'human:lin',
      name: t('林禾', 'Lin He'),
      initial: 'L',
      handle: '@lin.demo',
      avatarUrl: '/demo/users/lin.svg',
      bio: t(
        '用镜头记录城市里容易被忽略的瞬间。周末常去看展，也喜欢沿河散步，收集老店与街角的故事。',
        'I photograph the overlooked moments of city life. Weekends are for exhibitions, riverside walks, and stories from old shops and quiet streets.',
      ),
      city: t('上海', 'Shanghai'),
      countryCode: 'CN',
      languages: ['zh', 'en'],
      tags: [t('摄影', 'Photography'), t('城市漫步', 'City walks')],
      messages: conversation('lin', [
        [
          'assistant',
          t(
            '周末一起去看展吗？我看到有一个关于城市记忆的摄影展。',
            'Want to see an exhibition this weekend? I found one about memories of the city.',
          ),
          48,
        ],
        ['user', t('好呀，周六下午怎么样？', 'Sounds good. How about Saturday afternoon?'), 45],
        [
          'assistant',
          t(
            '可以！展览里有一些老街区的底片，我很想看看那些照片背后的故事。',
            'Perfect! There are negatives of old neighborhoods. I would love to hear the stories behind them.',
          ),
          43,
        ],
        [
          'user',
          t(
            '我带相机。看完可以沿河走走，再找一家小店喝咖啡。',
            'I’ll bring my camera. We can walk by the river afterward and find a small café.',
          ),
          12,
        ],
        [
          'assistant',
          t(
            '就这么定了，两点在展馆门口见。记得给相机充好电！',
            'It’s a plan. See you outside the gallery at two. Remember to charge your camera!',
          ),
          9,
        ],
      ]),
    },
    {
      id: 'human:alex',
      name: 'Alex Chen',
      initial: 'A',
      handle: '@alex.demo',
      avatarUrl: '/demo/users/alex.svg',
      bio: t(
        '独立产品设计师，喜欢把复杂的想法画成简单的草图。正在做一个关于日常声音的小型互动作品。',
        'Independent product designer, turning complicated ideas into simple sketches. Currently making a small interactive piece about everyday sounds.',
      ),
      city: t('新加坡', 'Singapore'),
      countryCode: 'SG',
      languages: ['en', 'zh'],
      tags: [t('产品设计', 'Product design'), t('交互创作', 'Interactive art')],
      messages: conversation('alex', [
        [
          'assistant',
          t(
            '我把新的分镜思路整理好了，晚点一起看看？',
            'I have organized the new storyboard ideas. Shall we review them later?',
          ),
          185,
        ],
        [
          'user',
          t(
            '可以。这次想让观众从哪个瞬间进入故事？',
            'Sure. What moment should bring the audience into the story this time?',
          ),
          178,
        ],
        [
          'assistant',
          t(
            '从厨房水壶的声音开始，再慢慢过渡到窗外的雨声。画面只留三个镜头。',
            'Start with the sound of a kettle, then ease into the rain outside. I want to keep it to three shots.',
          ),
          175,
        ],
        [
          'user',
          t(
            '节奏挺好，最后一个镜头可以多留几秒。',
            'That rhythm works. Let the final shot linger a few seconds longer.',
          ),
          62,
        ],
        [
          'assistant',
          t(
            '好，我先做一个短版本，明天把试听和分镜一起给你。',
            'I’ll make a short cut first and share the audio and storyboard tomorrow.',
          ),
          60,
        ],
      ]),
    },
    {
      id: 'human:yue',
      name: t('沈悦', 'Yue Shen'),
      initial: 'Y',
      handle: '@yue.demo',
      avatarUrl: '/demo/users/yue.svg',
      bio: t(
        '写一点短篇，也做一点插画。喜欢旧书店、植物和没有预定路线的旅行。最近在画一本街区观察手册。',
        'Short-story writer and occasional illustrator. I like used bookshops, plants, and unplanned trips. Working on a neighborhood sketchbook.',
      ),
      city: t('杭州', 'Hangzhou'),
      countryCode: 'CN',
      languages: ['zh', 'en'],
      tags: [t('写作', 'Writing'), t('插画', 'Illustration')],
      messages: conversation('yue', [
        [
          'assistant',
          t(
            '今天在旧书店找到一本手写植物图鉴，里面还有压平的银杏叶。',
            'I found a handwritten plant guide in a used bookshop today. There was a pressed ginkgo leaf inside.',
          ),
          260,
        ],
        [
          'user',
          t(
            '很适合画进你的观察手册，叶子的颜色还在吗？',
            'That belongs in your sketchbook. Has the leaf kept its color?',
          ),
          253,
        ],
        [
          'assistant',
          t(
            '变成了淡淡的茶色。我想先画书页，再写一小段关于上一个读者的想象。',
            'It has faded to a soft tea-brown. I’ll draw the pages first, then imagine a little about the previous reader.',
          ),
          240,
        ],
      ]),
    },
    {
      id: 'human:noah',
      name: 'Noah Park',
      initial: 'N',
      handle: '@noah.demo',
      avatarUrl: '/demo/users/noah.svg',
      bio: t(
        '软件开发者，业余做合成器音乐。喜欢分享小工具、现场录音和可以慢慢打磨的个人项目。',
        'Software developer and amateur synth musician. I share small tools, field recordings, and personal projects worth taking slowly.',
      ),
      city: t('温哥华', 'Vancouver'),
      countryCode: 'CA',
      languages: ['en', 'ko'],
      tags: [t('编程', 'Programming'), t('电子音乐', 'Electronic music')],
      messages: conversation('noah', [
        [
          'assistant',
          t(
            '海边那段环境录音整理好了，风声比想象中柔和。',
            'The seaside field recording is ready. The wind sounds softer than I expected.',
          ),
          1510,
        ],
        [
          'user',
          t(
            '可以拿它做开场氛围，鼓点晚一点再进。',
            'It could set the opening atmosphere. Bring the drums in later.',
          ),
          1503,
        ],
        [
          'assistant',
          t(
            '我也这么想。先留一小段纯环境声，让人听见空间。',
            'Exactly. I’ll leave a short stretch of ambient sound so you can hear the space.',
          ),
          1495,
        ],
      ]),
    },
    {
      id: 'human:mira',
      name: 'Mira Santos',
      initial: 'M',
      handle: '@mira.demo',
      avatarUrl: '/demo/users/mira.svg',
      bio: t(
        '做独立动画，也收集旅途中的色彩。喜欢用简单形状和轻快节奏讲一个温暖的小故事。',
        'Independent animator, collecting colors on my travels. I like telling warm little stories with simple shapes and playful timing.',
      ),
      city: t('里斯本', 'Lisbon'),
      countryCode: 'PT',
      languages: ['pt', 'en'],
      tags: [t('动画', 'Animation'), t('旅行', 'Travel')],
      messages: conversation('mira', [
        ['user', t('那个电车主题的动画做到哪一步了？', 'How is the tram animation coming along?'), 2980],
        [
          'assistant',
          t(
            '关键帧已经完成，正在调整转弯时车厢轻轻摇晃的动作。',
            'The keyframes are finished. I’m adjusting the little sway as the carriage turns.',
          ),
          2975,
        ],
        [
          'user',
          t(
            '这个细节很有生活感。配色还是之前那组暖黄和蓝色吗？',
            'That small detail makes it feel alive. Are you keeping the warm yellow and blue palette?',
          ),
          2972,
        ],
        [
          'assistant',
          t(
            '是的！还加了一点日落时的珊瑚色，等完成了给你看看。',
            'Yes! I added a touch of sunset coral too. I’ll show you when it’s finished.',
          ),
          2960,
        ],
      ]),
    },
    {
      id: 'human:zhou',
      name: t('周屿', 'Zhou Yu'),
      initial: 'Z',
      handle: '@zhou.demo',
      avatarUrl: '/demo/users/zhou.svg',
      bio: t(
        '喜欢骑行、做饭和动手修东西。用笔记记录每次小旅行，也记录那些值得再做一次的家常菜。',
        'Cycling, cooking, and fixing things by hand. I keep notes on small trips and everyday dishes worth making again.',
      ),
      city: t('成都', 'Chengdu'),
      countryCode: 'CN',
      languages: ['zh'],
      tags: [t('骑行', 'Cycling'), t('烹饪', 'Cooking')],
      messages: conversation('zhou', [
        [
          'assistant',
          t(
            '上次说的绿道骑行路线我走了一遍，沿途有两处很安静的休息点。',
            'I tried the greenway route we discussed. There are two quiet places to stop along the way.',
          ),
          4540,
        ],
        [
          'user',
          t('听起来不错，全程大概要多久？', 'Sounds lovely. How long does the full route take?'),
          4534,
        ],
        [
          'assistant',
          t(
            '慢慢骑大概两小时，回程还能顺路去市场买菜。',
            'About two hours at an easy pace. We can stop at the market on the way back.',
          ),
          4520,
        ],
      ]),
    },
  ];
  return people;
}

export function createDemoSelf(locale: 'zh' | 'en'): HeroDemoAgent {
  return {
    id: 'human:self',
    name: 'Halliday',
    initial: 'H',
    handle: '@halliday.demo',
    avatarUrl: '/demo/users/halliday.svg',
    bio:
      locale === 'zh'
        ? '把日常灵感变成小作品。喜欢与朋友交换创作思路，探索新的世界。'
        : 'Turning everyday ideas into small creations. I enjoy trading creative ideas with friends and exploring new worlds.',
    city: locale === 'zh' ? '上海' : 'Shanghai',
    countryCode: 'CN',
    languages: ['zh', 'en'],
    tags: locale === 'zh' ? ['创作', '探索'] : ['Creativity', 'Exploration'],
    messages: [],
  };
}
