import type { LandingLocale } from '../i18n/locale.js';

export type UtopiaHabitatId =
  | 'seaside-island'
  | 'starfield-town'
  | 'polar-station'
  | 'cloud-bamboo-abode';

export type UtopiaPoint2D = Readonly<{
  readonly x: number;
  readonly y: number;
}>;

export type UtopiaResidentPlacement = Readonly<{
  readonly placeId: string;
  readonly placeName: string;
  readonly activityTitle: string;
  readonly detail: string;
  readonly doorstepReply: string;
  readonly x: number;
  readonly y: number;
  readonly trail?: readonly UtopiaPoint2D[];
}>;

export type UtopiaPreviewResident = Readonly<{
  readonly id: string;
  readonly handle: string;
  readonly name: string;
  readonly worldName: string;
  readonly role: string;
  readonly avatarSrc: string;
  readonly defaultCloak: string;
  readonly defaultHeadwear: 'straw-hat' | 'beret' | 'leaf-sprout' | 'star-clip';
  readonly normal: UtopiaResidentPlacement;
  readonly tuned: UtopiaResidentPlacement;
  readonly solitary: UtopiaResidentPlacement;
}>;

export type UtopiaPreviewPlace = Readonly<{
  readonly id: string;
  readonly name: string;
  readonly sensory: string;
  readonly x: number;
  readonly y: number;
  readonly closedWhenTuned?: boolean;
  readonly openedWhenTuned?: boolean;
}>;

export type UtopiaPreviewWish = Readonly<{
  readonly id: string;
  readonly prompt: string;
  readonly targetTuned: boolean;
  readonly summary: string;
  readonly parameterDiff: string;
  readonly placeDiff: string;
}>;

export type UtopiaHabitatPreviewSpec = Readonly<{
  readonly id: UtopiaHabitatId;
  readonly bundleId: string;
  readonly title: string;
  readonly shortTitle: string;
  readonly themeLabel: string;
  readonly subtitle: string;
  readonly clockLabel: string;
  readonly baseImageSrc: string;
  readonly overlayImageSrc: string;
  readonly normalEnvLabel: string;
  readonly tunedEnvLabel: string;
  readonly normalConsequence: string;
  readonly tunedConsequence: string;
  readonly personalQuarterName: string;
  readonly sharedMomentLabel: string;
  readonly places: readonly UtopiaPreviewPlace[];
  readonly residents: readonly UtopiaPreviewResident[];
  readonly wishes: readonly UtopiaPreviewWish[];
}>;

export type UtopiaPreviewContent = Readonly<{
  readonly locale: LandingLocale;
  readonly appTitle: string;
  readonly horizonHint: string;
  readonly packBadge: string;
  readonly zoomOverview: string;
  readonly zoomCloseup: string;
  readonly solitudeToggleOff: string;
  readonly solitudeToggleOn: string;
  readonly drawerTabs: Readonly<{
    readonly journal: string;
    readonly residents: string;
    readonly tuner: string;
  }>;
  readonly journalHeading: string;
  readonly journalSubheading: string;
  readonly relocationGraceNote: string;
  readonly sharedActivityBadge: string;
  readonly wardrobeLabel: string;
  readonly headwearOptions: ReadonlyArray<{
    readonly id: 'straw-hat' | 'beret' | 'leaf-sprout' | 'star-clip';
    readonly label: string;
  }>;
  readonly cloakColors: ReadonlyArray<{
    readonly hex: string;
    readonly label: string;
  }>;
  readonly doorstepHeading: string;
  readonly doorstepHint: string;
  readonly doorstepPlaceholder: string;
  readonly doorstepQuickNotes: readonly string[];
  readonly doorstepSendAction: string;
  readonly doorstepSentBadge: string;
  readonly zhiyuHandoffAction: string;
  readonly tunerHeading: string;
  readonly tunerPrivacyNote: string;
  readonly tunerPreviewLabel: string;
  readonly tunerApplyAction: string;
  readonly tunerAppliedNote: string;
  readonly packSectionHeading: string;
  readonly creatorSampleTitle: string;
  readonly creatorSampleMeta: string;
  readonly creatorSampleChecks: readonly string[];
  readonly validateSampleAction: string;
  readonly validatedSampleBadge: string;
  readonly habitats: readonly UtopiaHabitatPreviewSpec[];
}>;

const UTOPIA_CONTENT_ZH: UtopiaPreviewContent = {
  locale: 'zh',
  appTitle: 'NimiUtopia · 洞天画卷',
  horizonHint: '全住地即时生效 · 点击切换天气与潮汐',
  packBadge: '支持导入与持续拓展 .utopia 画卷包',
  zoomOverview: '全景俯瞰',
  zoomCloseup: '街区近景',
  solitudeToggleOff: '公共漫步与偶遇',
  solitudeToggleOn: '全员安静独处',
  drawerTabs: {
    journal: '风物手记',
    residents: '伙伴与便签',
    tuner: '营造与画卷包',
  },
  journalHeading: '今日洞天风物志',
  journalSubheading: 'Runtime 按真实时间推进伙伴起居与散步，默认静音绝不弹窗打扰。',
  relocationGraceNote: '已展卷迁居：此前已共处的片段完整保留，原居所待开始的邀约已体面转为「因迁居搁置」。',
  sharedActivityBadge: '同游偶遇中',
  wardrobeLabel: '洞天手绘小人装扮',
  headwearOptions: [
    { id: 'straw-hat', label: '海风草帽' },
    { id: 'beret', label: '画师贝雷' },
    { id: 'leaf-sprout', label: '春芽发卡' },
    { id: 'star-clip', label: '星芒发饰' },
  ],
  cloakColors: [
    { hex: '#2B7A8B', label: '海湾青' },
    { hex: '#D96B43', label: '暖陶橙' },
    { hex: '#5B7F58', label: '竹影绿' },
    { hex: '#6A5B8E', label: '星夜紫' },
  ],
  doorstepHeading: '门前便签（零打扰草稿）',
  doorstepHint: '点「递句话」前仅留在当前窗口，不创建空会话、不打断伙伴手头的事。',
  doorstepPlaceholder: '写一句简短问候，或直接带草稿去织羽深聊…',
  doorstepQuickNotes: [
    '看到你在外头散步，顺路打个招呼。',
    '等这阵风过去，今晚接着聊上次的话题？',
  ],
  doorstepSendAction: '递句话',
  doorstepSentBadge: '门前轻回应',
  zhiyuHandoffAction: '带草稿去织羽深聊',
  tunerHeading: '一句话营造风物（预览后生效）',
  tunerPrivacyNote: '仅传入当前洞天的公共参数与场所定义，绝不读取或上传任何私聊内容与伙伴记忆。',
  tunerPreviewLabel: '编译预览（确认后才写入住地）',
  tunerApplyAction: '确认写入洞天',
  tunerAppliedNote: '已写入当前洞天参数与风物图层',
  packSectionHeading: '洞天长卷库与开放 .utopia 创作者包',
  creatorSampleTitle: '秋日晴岚农庄（creator.autumn-farm.utopia）',
  creatorSampleMeta: '创作者扩展示例包 · 声明式 JSON + 光栅图层 + 环境声景',
  creatorSampleChecks: [
    '除当前内置样板外，可自由导入任意题材的纯声明式 .utopia 包',
    '零可执行脚本与 SVG 注入（本地沙箱强校验）',
    '私舍兜底场所与步道锚点完整性已核验',
  ],
  validateSampleAction: '本地校验示例包',
  validatedSampleBadge: '安全校验通过 · 可随时迁居试住',
  habitats: [
    {
      id: 'seaside-island',
      bundleId: 'nimi.builtin.seaside-island',
      title: '海风渔岛',
      shortTitle: '海风渔岛',
      themeLabel: '海岸聚落',
      subtitle: '灯塔、观鸟湿地、榕荫市集、退潮礁池与双栈桥渔港',
      clockLabel: '16:20 · 午后斜阳',
      baseImageSrc: '/demo/utopia/seaside-island.webp',
      overlayImageSrc: '/demo/utopia/seaside-island-tide-mist.webp',
      normalEnvLabel: '晴风 · 退潮礁池',
      tunedEnvLabel: '海雾 · 涨潮拍岸',
      normalConsequence: '退潮露出平滑岩池，「礁石滩涂」与「海岸木平台」正常开放',
      tunedConsequence: '海雾漫上栈桥，「礁石滩涂」暂闭，伙伴沿步道转入木船工坊与观鸟棚避风',
      personalQuarterName: '海边木屋',
      sharedMomentLabel: '刚才 15:40 · 禾罐与柳问荇在榕荫市集分食刚出炉的海盐烤饼',
      places: [
        { id: 'personal-quarter', name: '海边木屋', sensory: '松木地板带着海盐气息，全天开放的安静私舍。', x: 26, y: 66 },
        { id: 'tidal-reef', name: '礁石滩涂', sensory: '退潮后露出岩池与浅滩，涨潮时自动暂闭。', x: 49, y: 71, closedWhenTuned: true },
        { id: 'bird-hide', name: '遮蔽观鸟棚', sensory: '半敞木窗朝向芦苇湿地，雾天最宜听潮观鹭。', x: 53, y: 22 },
        { id: 'boat-workshop', name: '木船工坊', sensory: '干燥温暖的木梁棚屋，挂满画板、刨刀与防风灯。', x: 75, y: 31 },
        { id: 'island-deck', name: '双栈桥渔港', sensory: '临海开阔木甲板，停靠着彩漆小木船。', x: 80, y: 56 },
      ],
      residents: [
        {
          id: 'heguan',
          handle: 'heguan',
          name: '禾罐',
          worldName: '瓷炭院',
          role: '砖画创作者 · 青绿釉陶偶',
          avatarSrc: '/demo/explore/emberware-court-character-0.png',
          defaultCloak: '#2B7A8B',
          defaultHeadwear: 'straw-hat',
          normal: {
            placeId: 'tidal-reef',
            placeName: '礁石滩涂',
            activityTitle: '赶海拾贝与挑矿石',
            detail: '正沿石阶与退潮岩池来回踱步，挑带铁锈纹的浅滩碎石磨新釉料',
            doorstepReply: '“刚好趁退潮捡到两块灰青色礁石，等磨好色粉拿给你瞧瞧。”',
            x: 49,
            y: 71,
            trail: [
              { x: 49, y: 71 },
              { x: 54, y: 60 },
              { x: 43, y: 59 },
              { x: 34, y: 66 },
              { x: 43, y: 65 },
            ],
          },
          tuned: {
            placeId: 'boat-workshop',
            placeName: '木船工坊',
            activityTitle: '棚屋避雾磨色粉',
            detail: '涨潮起海雾了，抱起石臼沿木栈道搬进木梁工坊慢慢研钵',
            doorstepReply: '“外头海雾大，我躲进木船工坊借防风灯调釉色啦，屋里很暖和。”',
            x: 75,
            y: 31,
            trail: [
              { x: 75, y: 31 },
              { x: 82, y: 33 },
              { x: 75, y: 46 },
              { x: 66, y: 56 },
              { x: 75, y: 46 },
            ],
          },
          solitary: {
            placeId: 'personal-quarter',
            placeName: '海边木屋',
            activityTitle: '木屋安静独处',
            detail: '在窗边翻看旧画稿，听远处规律的潮声休息',
            doorstepReply: '“我在自己木屋里歇会儿神，有事随时喊我。”',
            x: 26,
            y: 66,
          },
        },
        {
          id: 'liuwenxing',
          handle: 'liuwenxing',
          name: '柳问荇',
          worldName: '行脉诸洲',
          role: '石渠退修前辈 · 水岸看守人',
          avatarSrc: '/demo/explore/meridian-archipelago-character-0.png',
          defaultCloak: '#5B7F58',
          defaultHeadwear: 'beret',
          normal: {
            placeId: 'island-deck',
            placeName: '双栈桥渔港',
            activityTitle: '巡看栈桥与观潮',
            detail: '顺着渔港木栈桥与市集东口缓步巡看退潮后的桩脚水痕',
            doorstepReply: '“今日退潮稳当，栈桥木桩吃水不深，坐下喝口热茶再忙吧。”',
            x: 80,
            y: 56,
            trail: [
              { x: 80, y: 56 },
              { x: 71, y: 57 },
              { x: 64, y: 58 },
              { x: 74, y: 48 },
              { x: 76, y: 53 },
            ],
          },
          tuned: {
            placeId: 'bird-hide',
            placeName: '遮蔽观鸟棚',
            activityTitle: '芦苇木桥观鹭',
            detail: '跨过湿地小木桥走进观鸟棚，看白鹭贴着薄雾水面归巢',
            doorstepReply: '“起雾涨潮时最能看清暗流走向，我在观鸟棚檐下躲雾呢。”',
            x: 53,
            y: 22,
            trail: [
              { x: 53, y: 22 },
              { x: 45, y: 27 },
              { x: 37, y: 35 },
              { x: 45, y: 27 },
            ],
          },
          solitary: {
            placeId: 'personal-quarter',
            placeName: '海边木屋',
            activityTitle: '私舍温茶静坐',
            detail: '关上木百叶窗独自温茶养神，不外出串门',
            doorstepReply: '“小炉上的茶刚滚，我在屋里清静半晌。”',
            x: 31,
            y: 63,
          },
        },
      ],
      wishes: [
        {
          id: 'seaside-mist',
          prompt: '“让海面起一层薄雾并涨潮，大家回棚屋暖和一下”',
          targetTuned: true,
          summary: '切换为涨潮海雾声景，收起外海浅滩活动',
          parameterDiff: 'tide: low-tide → high-tide · weather: sunny-breeze → sea-mist',
          placeDiff: '暂闭：礁石滩涂（禾罐将沿栈道前往木船工坊）',
        },
        {
          id: 'seaside-clear',
          prompt: '“吹散海雾迎来晴风退潮，开放礁石滩涂赶海”',
          targetTuned: false,
          summary: '恢复晴风退潮，重新开放岩池与海岸栈桥',
          parameterDiff: 'tide: high-tide → low-tide · weather: sea-mist → sunny-breeze',
          placeDiff: '开放：礁石滩涂、双栈桥渔港',
        },
      ],
    },
    {
      id: 'starfield-town',
      bundleId: 'nimi.builtin.starfield-town',
      title: '星原晴风镇',
      shortTitle: '星原晴风镇',
      themeLabel: '田园小镇',
      subtitle: '钟楼书馆、玻璃花房、喷泉广场、双桥水车与热气球坪',
      clockLabel: '17:45 · 薰衣草晚风',
      baseImageSrc: '/demo/utopia/starfield-town.webp',
      overlayImageSrc: '/demo/utopia/starfield-town-lantern-rain.webp',
      normalEnvLabel: '晴风 · 晴昼花甸',
      tunedEnvLabel: '细雨 · 庆典花灯',
      normalConsequence: '草坪与林间舞台晴朗敞开，热气球草坪与溪畔茶座热闹宜人',
      tunedConsequence: '细雨点亮满镇暖黄花灯，伙伴移步玻璃花房与钟楼书馆听雨',
      personalQuarterName: '花篱阁楼',
      sharedMomentLabel: '刚才 17:10 · 禾罐与柳问荇在溪畔水车桥边核对古镇石拱榫卯',
      places: [
        { id: 'clocktower-library', name: '钟楼书馆', sensory: '彩窗映着旧书架与黄铜钟摆，雨天格外静谧。', x: 29, y: 39 },
        { id: 'sunlight-greenhouse', name: '玻璃花房', sensory: '恒温柠檬树与草本花香，雨滴敲在玻璃穹顶上清脆悦耳。', x: 52, y: 35 },
        { id: 'fountain-plaza', name: '喷泉广场', sensory: '圆石铺就的小镇中心，傍晚会亮起成串庆典暖灯。', x: 53, y: 75 },
        { id: 'balloon-meadow', name: '热气球草坪', sensory: '铺着野餐垫的向阳坡地，细雨时暂停升空。', x: 87, y: 40, closedWhenTuned: true },
      ],
      residents: [
        {
          id: 'heguan',
          handle: 'heguan',
          name: '禾罐',
          worldName: '瓷炭院',
          role: '砖画创作者 · 青绿釉陶偶',
          avatarSrc: '/demo/explore/emberware-court-character-0.png',
          defaultCloak: '#D96B43',
          defaultHeadwear: 'beret',
          normal: {
            placeId: 'balloon-meadow',
            placeName: '热气球草坪',
            activityTitle: '草坪漫步写生气球',
            detail: '在草坡野餐垫与陶艺小院之间边走边画彩色热气球',
            doorstepReply: '“这儿的晚风有股薰衣草味，刚画完半幅气球草稿！”',
            x: 84,
            y: 42,
            trail: [
              { x: 84, y: 42 },
              { x: 75, y: 42 },
              { x: 68, y: 50 },
              { x: 76, y: 44 },
            ],
          },
          tuned: {
            placeId: 'sunlight-greenhouse',
            placeName: '玻璃花房',
            activityTitle: '花房听雨看彩窗光影',
            detail: '细雨落下后转进玻璃温室，对着满街亮起的花灯调暖黄颜料',
            doorstepReply: '“玻璃顶上的雨声真好听，外头广场的花灯也全亮起来啦。”',
            x: 52,
            y: 36,
            trail: [
              { x: 52, y: 36 },
              { x: 52, y: 48 },
              { x: 45, y: 58 },
              { x: 52, y: 48 },
            ],
          },
          solitary: {
            placeId: 'personal-quarter',
            placeName: '花篱阁楼',
            activityTitle: '阁楼整理画夹',
            detail: '在爬满蔷薇的木屋二楼安静整理速写页',
            doorstepReply: '“我在阁楼把今天的速写订成册，随时找我。”',
            x: 25,
            y: 74,
          },
        },
        {
          id: 'liuwenxing',
          handle: 'liuwenxing',
          name: '柳问荇',
          worldName: '行脉诸洲',
          role: '石渠退修前辈 · 水岸看守人',
          avatarSrc: '/demo/explore/meridian-archipelago-character-0.png',
          defaultCloak: '#2B7A8B',
          defaultHeadwear: 'straw-hat',
          normal: {
            placeId: 'fountain-plaza',
            placeName: '水车石桥畔',
            activityTitle: '沿溪桥察看水车',
            detail: '在石拱桥与喷泉广场之间缓步踱行，端详木水车引流槽',
            doorstepReply: '“这小镇水车引渠坡度拿捏得极准，一点不费水力。”',
            x: 58,
            y: 49,
            trail: [
              { x: 58, y: 49 },
              { x: 64, y: 56 },
              { x: 53, y: 69 },
              { x: 45, y: 63 },
              { x: 52, y: 55 },
            ],
          },
          tuned: {
            placeId: 'clocktower-library',
            placeName: '钟楼书馆',
            activityTitle: '钟楼翻阅镇志图谱',
            detail: '避雨走进老钟楼书馆，借着台灯翻看百年前的修桥图纸',
            doorstepReply: '“外头落了小雨，我在钟楼翻到一卷很有意思的老水利志。”',
            x: 29,
            y: 39,
            trail: [
              { x: 29, y: 39 },
              { x: 27, y: 50 },
              { x: 35, y: 60 },
              { x: 27, y: 50 },
            ],
          },
          solitary: {
            placeId: 'personal-quarter',
            placeName: '花篱阁楼',
            activityTitle: '灯下静读小憩',
            detail: '留在独立房间内看书听钟声，暂不外出偶遇',
            doorstepReply: '“刚听完六点钟声，在屋里歇歇脚。”',
            x: 29,
            y: 71,
          },
        },
      ],
      wishes: [
        {
          id: 'town-lanterns',
          prompt: '“下一场温柔傍晚细雨，把广场与桥边的庆典花灯点亮”',
          targetTuned: true,
          summary: '开启傍晚细雨与满镇花灯图层，收起露天草坪活动',
          parameterDiff: 'weather: clear-breeze → gentle-rain · event: festival-lanterns',
          placeDiff: '点亮花灯 · 暂闭：热气球草坪（转入玻璃花房与钟楼）',
        },
        {
          id: 'town-sunny',
          prompt: '“雨停放晴，重新敞开热气球草坪与林间剧场”',
          targetTuned: false,
          summary: '恢复晴昼田园微风，开放全部户外草坪场所',
          parameterDiff: 'weather: gentle-rain → clear-breeze · event: none',
          placeDiff: '开放：热气球草坪、林间露天舞台',
        },
      ],
    },
    {
      id: 'polar-station',
      bundleId: 'nimi.builtin.polar-station',
      title: '极地科考站',
      shortTitle: '极地科考站',
      themeLabel: '冰脊暖营',
      subtitle: '气象栈台、双穹顶观测温室、冰芯库与露天岩池地热泉',
      clockLabel: '21:15 · 极夜静风',
      baseImageSrc: '/demo/utopia/polar-station.webp',
      overlayImageSrc: '/demo/utopia/polar-station-aurora.webp',
      normalEnvLabel: '静夜 · 星穹微光',
      tunedEnvLabel: '天象 · 极光漫舞',
      normalConsequence: '风速平稳，科考木栈道、绿植穹顶与地热暖炉全线开放',
      tunedConsequence: '翠紫极光横跨冰脊，观测穹顶天窗开启极光守夜观测',
      personalQuarterName: '保温圆顶舱',
      sharedMomentLabel: '刚才 20:30 · 禾罐与柳问荇在地热暖炉木屋分喝热可可暖手',
      places: [
        { id: 'observation-window', name: '天文观测穹顶', sensory: '暖黄钢木圆顶直通夜空，极光出现时全员最佳观景处。', x: 52, y: 36, openedWhenTuned: true },
        { id: 'hydro-garden', name: '恒温绿植穹顶', sensory: '冰原中央生机盎然的果蔬温室，空气湿润温暖。', x: 48, y: 74 },
        { id: 'geothermal-hearth', name: '地热汤池与暖炉屋', sensory: '冒着白雾的天然地热泉紧挨松木壁炉小屋。', x: 64, y: 56 },
        { id: 'ice-core-vault', name: '冰芯样本库', sensory: '泛着冰蓝微光的雪下岩廊，陈列远古冰层切片。', x: 35, y: 58 },
      ],
      residents: [
        {
          id: 'heguan',
          handle: 'heguan',
          name: '禾罐',
          worldName: '瓷炭院',
          role: '砖画创作者 · 青绿釉陶偶',
          avatarSrc: '/demo/explore/emberware-court-character-0.png',
          defaultCloak: '#6A5B8E',
          defaultHeadwear: 'star-clip',
          normal: {
            placeId: 'hydro-garden',
            placeName: '恒温绿植穹顶',
            activityTitle: '温室灯下描冰晶叶脉',
            detail: '顺着暖灯木栈道往返绿植穹顶与木屋，对照雪光临摹霜叶',
            doorstepReply: '“冰原外头零下二十度，温室里却刚结出小番茄，太神奇了！”',
            x: 48,
            y: 74,
            trail: [
              { x: 48, y: 74 },
              { x: 41, y: 66 },
              { x: 56, y: 58 },
              { x: 48, y: 65 },
            ],
          },
          tuned: {
            placeId: 'observation-window',
            placeName: '天文观测穹顶',
            activityTitle: '仰望极光调青紫釉色',
            detail: '沿高处木栈桥登上观测穹顶，连连感叹极光像窑变釉彩',
            doorstepReply: '“快抬头看！这道绿紫交织的极光，简直像活过来的青绿窑变釉！”',
            x: 52,
            y: 35,
            trail: [
              { x: 52, y: 35 },
              { x: 59, y: 40 },
              { x: 67, y: 38 },
              { x: 59, y: 40 },
            ],
          },
          solitary: {
            placeId: 'personal-quarter',
            placeName: '保温圆顶舱',
            activityTitle: '暖舱独处小憩',
            detail: '裹着厚毛毯在圆窗舱内安静听风声休息',
            doorstepReply: '“我在自己暖舱里烤火歇会儿，有话随时递进来。”',
            x: 80,
            y: 80,
          },
        },
        {
          id: 'liuwenxing',
          handle: 'liuwenxing',
          name: '柳问荇',
          worldName: '行脉诸洲',
          role: '石渠退修前辈 · 水岸看守人',
          avatarSrc: '/demo/explore/meridian-archipelago-character-0.png',
          defaultCloak: '#D96B43',
          defaultHeadwear: 'beret',
          normal: {
            placeId: 'ice-core-vault',
            placeName: '冰芯样本库',
            activityTitle: '巡看冰廊与万年冰层',
            detail: '沿着雪地栈道缓步巡检冰芯岩廊，跟山石年轮相互印证',
            doorstepReply: '“原来千年雪层压实了，脉理竟和深山青石一模一样。”',
            x: 35,
            y: 58,
            trail: [
              { x: 35, y: 58 },
              { x: 26, y: 71 },
              { x: 37, y: 66 },
            ],
          },
          tuned: {
            placeId: 'geothermal-hearth',
            placeName: '地热暖炉廊台',
            activityTitle: '守着地热泉看漫天极光',
            detail: '端着热姜茶在地热木廊上踱步，抬头静静欣赏极光映雪',
            doorstepReply: '“脚下是滚热地脉泉，头顶是万里极光，这趟远门出得值当。”',
            x: 65,
            y: 56,
            trail: [
              { x: 65, y: 56 },
              { x: 76, y: 56 },
              { x: 58, y: 54 },
            ],
          },
          solitary: {
            placeId: 'personal-quarter',
            placeName: '保温圆顶舱',
            activityTitle: '舱内记科考札记',
            detail: '留在个人保温舱整理今日见闻，暂不串门',
            doorstepReply: '“正在灯下记几笔冰脉见闻，屋里暖气很足。”',
            x: 84,
            y: 77,
          },
        },
      ],
      wishes: [
        {
          id: 'polar-aurora',
          prompt: '“在冰脊夜空点亮漫天极光，唤醒天文观测穹顶守夜”',
          targetTuned: true,
          summary: '开启极光天象图层，激活高处观测穹顶与温泉赏景活动',
          parameterDiff: 'sky: clear-night → aurora-surge · wind: calm',
          placeDiff: '点亮极光观测 · 伙伴聚向天文观测穹顶与地热廊台',
        },
        {
          id: 'polar-calm',
          prompt: '“极光渐隐，回到静谧星穹的日常温室与冰芯考察”',
          targetTuned: false,
          summary: '恢复静夜星穹，回归温室与冰芯库日常节律',
          parameterDiff: 'sky: aurora-surge → clear-night',
          placeDiff: '恢复日常驻留节律',
        },
      ],
    },
    {
      id: 'cloud-bamboo-abode',
      bundleId: 'nimi.builtin.cloud-bamboo-abode',
      title: '云水山居',
      shortTitle: '云水山居',
      themeLabel: '青绿山居',
      subtitle: '观云剑坪、松钟飞瀑、竹廊药圃、丹房木坊与藏经茶阁',
      clockLabel: '09:30 · 晨钟山岚',
      baseImageSrc: '/demo/utopia/cloud-bamboo-abode.webp',
      overlayImageSrc: '/demo/utopia/cloud-bamboo-abode-snow.webp',
      normalEnvLabel: '晴岚 · 松风飞瀑',
      tunedEnvLabel: '瑞雪 · 云海漫谷',
      normalConsequence: '山涧晴朗，悬崖观云坪、竹引药圃与荷池回廊尽数敞开',
      tunedConsequence: '山谷飘落轻雪云岚，悬崖剑坪暂封，伙伴围炉煮茶温书',
      personalQuarterName: '竹阴草庐',
      sharedMomentLabel: '刚才 08:50 · 禾罐与柳问荇在荷池石桥引竹筒山泉浇灌药圃',
      places: [
        { id: 'cloud-terrace', name: '观云松坪', sensory: '奇松探出云海的石砌圆台，大雪封路时暂闭。', x: 16, y: 55, closedWhenTuned: true },
        { id: 'waterfall-pavilion', name: '松钟飞瀑亭', sensory: '飞瀑直落碧潭，古铜钟声随山风回荡。', x: 43, y: 29 },
        { id: 'elixir-hearth', name: '中庭丹房木坊', sensory: '铜鼎暖火不熄的四合院落，雪天最是温暖。', x: 54, y: 54 },
        { id: 'tea-pavilion', name: '竹林藏经茶阁', sensory: '掩映在修竹间的双层木阁，楼上藏书、楼下烹泉。', x: 80, y: 52 },
      ],
      residents: [
        {
          id: 'heguan',
          handle: 'heguan',
          name: '禾罐',
          worldName: '瓷炭院',
          role: '砖画创作者 · 青绿釉陶偶',
          avatarSrc: '/demo/explore/emberware-court-character-0.png',
          defaultCloak: '#5B7F58',
          defaultHeadwear: 'leaf-sprout',
          normal: {
            placeId: 'cloud-terrace',
            placeName: '观云松坪',
            activityTitle: '石阶寻景与临崖看云',
            detail: '顺着青石阶走上古松石台看脚下云卷云舒，构思山水砖雕',
            doorstepReply: '“山腰的云就在脚边流过去，这抹石青与苍绿不用调色就美极了。”',
            x: 16,
            y: 55,
            trail: [
              { x: 16, y: 55 },
              { x: 24, y: 45 },
              { x: 34, y: 46 },
              { x: 24, y: 45 },
            ],
          },
          tuned: {
            placeId: 'elixir-hearth',
            placeName: '中庭丹房木坊',
            activityTitle: '围铜炉烘陶坯听雪',
            detail: '山间飘起细雪云雾，退回四合中庭借暖炉余温慢烘泥坯',
            doorstepReply: '“外头落雪起雾啦，中庭炉火正旺，泥坯烤得暖烘烘的。”',
            x: 54,
            y: 54,
            trail: [
              { x: 54, y: 54 },
              { x: 48, y: 61 },
              { x: 62, y: 64 },
              { x: 48, y: 61 },
            ],
          },
          solitary: {
            placeId: 'personal-quarter',
            placeName: '竹阴草庐',
            activityTitle: '竹庐听风静憩',
            detail: '掩上竹扉在草庐内独自擦拭画刀与陶印',
            doorstepReply: '“竹林风声很静，我在草庐歇口气。”',
            x: 82,
            y: 80,
          },
        },
        {
          id: 'liuwenxing',
          handle: 'liuwenxing',
          name: '柳问荇',
          worldName: '行脉诸洲',
          role: '石渠退修前辈 · 水岸看守人',
          avatarSrc: '/demo/explore/meridian-archipelago-character-0.png',
          defaultCloak: '#2B7A8B',
          defaultHeadwear: 'straw-hat',
          normal: {
            placeId: 'herb-terrace',
            placeName: '竹筒引泉药圃',
            activityTitle: '沿石阶巡看竹笕水路',
            detail: '顺着荷池石桥与药圃石阶来回察看引泉竹筒，神色惬意',
            doorstepReply: '“用打通竹节引山泉分灌三畦药田，轻巧灵便，深得水脉自然之妙。”',
            x: 34,
            y: 78,
            trail: [
              { x: 34, y: 78 },
              { x: 42, y: 69 },
              { x: 50, y: 63 },
              { x: 42, y: 69 },
            ],
          },
          tuned: {
            placeId: 'tea-pavilion',
            placeName: '竹林藏经茶阁',
            activityTitle: '茶阁烹雪水品旧卷',
            detail: '踏着修竹石径走近二层茶阁，收竹叶新雪煮茶翻看古山居志',
            doorstepReply: '“山阶滑了便回阁上坐坐，刚用山泉煮了一壶老白茶。”',
            x: 80,
            y: 52,
            trail: [
              { x: 80, y: 52 },
              { x: 76, y: 64 },
              { x: 67, y: 72 },
              { x: 76, y: 64 },
            ],
          },
          solitary: {
            placeId: 'personal-quarter',
            placeName: '竹阴草庐',
            activityTitle: '草庐闭目养神',
            detail: '留在独立竹舍内调息静坐，不受外界打扰',
            doorstepReply: '“山中清静，我在竹舍里歇息片刻。”',
            x: 85,
            y: 83,
          },
        },
      ],
      wishes: [
        {
          id: 'bamboo-snow',
          prompt: '“让山谷飘起轻雪与云岚，伙伴回中庭暖炉与茶阁煮茶”',
          targetTuned: true,
          summary: '叠加云岚瑞雪图层，暂封临崖石台，转入室内围炉烹茶',
          parameterDiff: 'weather: clear-mountain → mountain-snow · mist: dense',
          placeDiff: '暂闭：观云松坪（转往中庭丹房与藏经茶阁）',
        },
        {
          id: 'bamboo-clear',
          prompt: '“云开雪霁，重开悬崖观云坪与竹涧药圃”',
          targetTuned: false,
          summary: '散去雪雾，恢复青绿山水晴岚与飞瀑松风',
          parameterDiff: 'weather: mountain-snow → clear-mountain · mist: light',
          placeDiff: '开放：观云松坪、竹筒药圃',
        },
      ],
    },
  ],
};

const UTOPIA_CONTENT_EN: UtopiaPreviewContent = {
  locale: 'en',
  appTitle: 'NimiUtopia · Habitat Scroll',
  horizonHint: 'Applies habitat-wide · Click to cycle tide and weather',
  packBadge: 'Import & expand with custom .utopia packs',
  zoomOverview: 'Panoramic view',
  zoomCloseup: 'Courtyard zoom',
  solitudeToggleOff: 'Strolling & shared spots',
  solitudeToggleOn: 'All in quiet solitude',
  drawerTabs: {
    journal: 'Chronicle',
    residents: 'Companions & Note',
    tuner: 'Tuner & Packs',
  },
  journalHeading: 'Today in the Habitat',
  journalSubheading: 'Runtime advances daily routines and strolls on real local time—quiet by default with zero notification spam.',
  relocationGraceNote: 'Relocated cleanly: earlier shared moments stay intact, while pending prior-habitat invites are marked set aside due to relocation.',
  sharedActivityBadge: 'Hanging out together',
  wardrobeLabel: 'Hand-drawn chibi outfit',
  headwearOptions: [
    { id: 'straw-hat', label: 'Sun Hat' },
    { id: 'beret', label: 'Artist Beret' },
    { id: 'leaf-sprout', label: 'Leaf Sprout' },
    { id: 'star-clip', label: 'Star Hairpin' },
  ],
  cloakColors: [
    { hex: '#2B7A8B', label: 'Harbor Teal' },
    { hex: '#D96B43', label: 'Terracotta' },
    { hex: '#5B7F58', label: 'Bamboo Sage' },
    { hex: '#6A5B8E', label: 'Twilight Iris' },
  ],
  doorstepHeading: 'Doorstep Note (Zero-Side-Effect Draft)',
  doorstepHint: 'Stays purely in this window until you send—never creates empty chat threads or interrupts an active routine.',
  doorstepPlaceholder: 'Leave a quick hello at the door, or hand off to Zhiyu for a full chat...',
  doorstepQuickNotes: [
    'Saw you strolling outside—just dropping by to say hello!',
    'Once the weather settles, want to pick up our last chat tonight?',
  ],
  doorstepSendAction: 'Send quick note',
  doorstepSentBadge: 'Doorstep reply',
  zhiyuHandoffAction: 'Continue deeply in Zhiyu',
  tunerHeading: 'One-Line Scenery Tuner (Preview First)',
  tunerPrivacyNote: 'Sends only public habitat parameter and place definitions—never reads or uploads private chat history or companion memories.',
  tunerPreviewLabel: 'Compiled diff preview (applied only on confirm)',
  tunerApplyAction: 'Apply to habitat',
  tunerAppliedNote: 'Applied parameter and scenery layers to active habitat',
  packSectionHeading: 'Habitat Library & Open .utopia Creator Packs',
  creatorSampleTitle: 'Autumn Mist Farmstead (creator.autumn-farm.utopia)',
  creatorSampleMeta: 'Creator expansion bundle · Declarative JSON + raster layers + ambient audio',
  creatorSampleChecks: [
    'Import new habitats of any theme beyond built-in starter scrolls',
    'Zero executable scripts or SVG code (strict local bundle validator)',
    'Verified private fallback quarter and footpath anchor coordinates',
  ],
  validateSampleAction: 'Validate sample bundle',
  validatedSampleBadge: 'Validation passed · Ready for local relocation',
  habitats: [
    {
      id: 'seaside-island',
      bundleId: 'nimi.builtin.seaside-island',
      title: 'Seaside Island',
      shortTitle: 'Seaside Island',
      themeLabel: 'Coastal Village',
      subtitle: 'Cliff lighthouse, reed bird-hide, banyan market, tidal reef pool, and double-pier harbor',
      clockLabel: '4:20 PM · Sunlit Breeze',
      baseImageSrc: '/demo/utopia/seaside-island.webp',
      overlayImageSrc: '/demo/utopia/seaside-island-tide-mist.webp',
      normalEnvLabel: 'Sunny · Low-Tide Reef',
      tunedEnvLabel: 'Sea Mist · High Tide',
      normalConsequence: 'Low tide reveals the rock pools—Tidal Reef and Harbor Deck are open',
      tunedConsequence: 'High tide and sea mist close the Tidal Reef; companions stroll to the Boat Workshop and Bird Hide',
      personalQuarterName: 'Seaside Cabin',
      sharedMomentLabel: '3:40 PM · Heguan and Liu Wenxing shared warm sea-salt flatbread under the banyan market awning',
      places: [
        { id: 'personal-quarter', name: 'Seaside Cabin', sensory: 'Pine floorboards and distant surf—always open for quiet rest.', x: 26, y: 66 },
        { id: 'tidal-reef', name: 'Tidal Reef Pool', sensory: 'Smooth rock pools exposed at low tide; closes automatically at high tide.', x: 49, y: 71, closedWhenTuned: true },
        { id: 'bird-hide', name: 'Reed Bird-Hide', sensory: 'Half-open timber lookout facing the marsh reeds and herons.', x: 53, y: 22 },
        { id: 'boat-workshop', name: 'Boat Workshop', sensory: 'Dry, warm timber shed lined with sketchboards, planes, and storm lanterns.', x: 75, y: 31 },
        { id: 'island-deck', name: 'Harbor Pier', sensory: 'Open coastal boardwalk moored with painted wooden skiffs.', x: 80, y: 56 },
      ],
      residents: [
        {
          id: 'heguan',
          handle: 'heguan',
          name: 'Heguan',
          worldName: 'Emberware Court',
          role: 'Brick artist · Glazed clay folk',
          avatarSrc: '/demo/explore/emberware-court-character-0.png',
          defaultCloak: '#2B7A8B',
          defaultHeadwear: 'straw-hat',
          normal: {
            placeId: 'tidal-reef',
            placeName: 'Tidal Reef Pool',
            activityTitle: 'Strolling the low-tide reef',
            detail: 'Walking along the shore path and exposed rock pools to pick iron-veined pebbles',
            doorstepReply: '"Found two slate-blue reef stones while the tide is out—wait till you see the glaze color!"',
            x: 49,
            y: 71,
            trail: [
              { x: 49, y: 71 },
              { x: 54, y: 60 },
              { x: 43, y: 59 },
              { x: 34, y: 66 },
              { x: 43, y: 65 },
            ],
          },
          tuned: {
            placeId: 'boat-workshop',
            placeName: 'Boat Workshop',
            activityTitle: 'Grinding pigments indoors',
            detail: 'Walked up the timber stairs into the warm boat shed as sea mist rolled in',
            doorstepReply: '"The sea mist rolled in fast, so I ducked into the boat workshop to grind pigments by lantern light."',
            x: 75,
            y: 31,
            trail: [
              { x: 75, y: 31 },
              { x: 82, y: 33 },
              { x: 75, y: 46 },
              { x: 66, y: 56 },
              { x: 75, y: 46 },
            ],
          },
          solitary: {
            placeId: 'personal-quarter',
            placeName: 'Seaside Cabin',
            activityTitle: 'Resting in private cabin',
            detail: 'Flipping through clay sketches by the cabin window while listening to the waves',
            doorstepReply: '"Taking a quiet breather in my cabin—ping me anytime you need me."',
            x: 26,
            y: 66,
          },
        },
        {
          id: 'liuwenxing',
          handle: 'liuwenxing',
          name: 'Liu Wenxing',
          worldName: 'Meridian Archipelago',
          role: 'Retired canal negotiator',
          avatarSrc: '/demo/explore/meridian-archipelago-character-0.png',
          defaultCloak: '#5B7F58',
          defaultHeadwear: 'beret',
          normal: {
            placeId: 'island-deck',
            placeName: 'Harbor Pier',
            activityTitle: 'Walking the pier & tide marks',
            detail: 'Strolling between the wooden harbor pier and market square checking low-water marks',
            doorstepReply: '"Steady low tide today—the harbor pilings look sound. Pull up a stool if you have a minute."',
            x: 80,
            y: 56,
            trail: [
              { x: 80, y: 56 },
              { x: 71, y: 57 },
              { x: 64, y: 58 },
              { x: 74, y: 48 },
              { x: 76, y: 53 },
            ],
          },
          tuned: {
            placeId: 'bird-hide',
            placeName: 'Reed Bird-Hide',
            activityTitle: 'Watching herons in the mist',
            detail: 'Crossed the marsh footbridge into the sheltered lookout as egrets glided home',
            doorstepReply: '"You can read coastal currents clearest when the tide turns—resting dry under the bird-hide roof."',
            x: 53,
            y: 22,
            trail: [
              { x: 53, y: 22 },
              { x: 45, y: 27 },
              { x: 37, y: 35 },
              { x: 45, y: 27 },
            ],
          },
          solitary: {
            placeId: 'personal-quarter',
            placeName: 'Seaside Cabin',
            activityTitle: 'Quiet tea indoors',
            detail: 'Warming a kettle privately with shutters drawn—solitude mode active',
            doorstepReply: '"Kettle just boiled in my cabin—enjoying a quiet spell indoors."',
            x: 31,
            y: 63,
          },
        },
      ],
      wishes: [
        {
          id: 'seaside-mist',
          prompt: '"Roll in high tide and gentle sea mist so everyone heads under shelter"',
          targetTuned: true,
          summary: 'Switch to high-tide sea mist and walk companions to sheltered spots',
          parameterDiff: 'tide: low-tide -> high-tide · weather: sunny-breeze -> sea-mist',
          placeDiff: 'Closes: Tidal Reef Pool (Heguan walks to Boat Workshop)',
        },
        {
          id: 'seaside-clear',
          prompt: '"Clear the mist and bring back sunny low tide so the reef opens up"',
          targetTuned: false,
          summary: 'Restore sunny breeze and low tide, reopening rock pools and pier',
          parameterDiff: 'tide: high-tide -> low-tide · weather: sea-mist -> sunny-breeze',
          placeDiff: 'Opens: Tidal Reef Pool, Harbor Pier',
        },
      ],
    },
    {
      id: 'starfield-town',
      bundleId: 'nimi.builtin.starfield-town',
      title: 'Starfield Town',
      shortTitle: 'Starfield Town',
      themeLabel: 'Pastoral Town',
      subtitle: 'Clocktower library, glass conservatory, fountain plaza, waterwheel bridge, and balloon meadow',
      clockLabel: '5:45 PM · Lavender Dusk',
      baseImageSrc: '/demo/utopia/starfield-town.webp',
      overlayImageSrc: '/demo/utopia/starfield-town-lantern-rain.webp',
      normalEnvLabel: 'Clear · Balloon Meadow',
      tunedEnvLabel: 'Showers · Festival Lanterns',
      normalConsequence: 'Open skies keep the Balloon Meadow, stone waterwheel bridge, and grove stage bustling',
      tunedConsequence: 'Evening showers light up warm street lanterns; companions gather in the Greenhouse and Clocktower',
      personalQuarterName: 'Rose-Trellis Loft',
      sharedMomentLabel: '5:10 PM · Heguan and Liu Wenxing admired the old stone arch waterwheel joinery together',
      places: [
        { id: 'clocktower-library', name: 'Clocktower Library', sensory: 'Stained glass, brass pendulum ticks, and tall oak bookshelves.', x: 29, y: 39 },
        { id: 'sunlight-greenhouse', name: 'Glass Conservatory', sensory: 'Warm citrus leaves and herb beds under pattering glass panes.', x: 52, y: 35 },
        { id: 'fountain-plaza', name: 'Fountain Plaza', sensory: 'Cobblestone town heart strung with warm festival lanterns at dusk.', x: 53, y: 75 },
        { id: 'balloon-meadow', name: 'Balloon Meadow', sensory: 'Sunlit picnic slope; pauses flights during evening showers.', x: 87, y: 40, closedWhenTuned: true },
      ],
      residents: [
        {
          id: 'heguan',
          handle: 'heguan',
          name: 'Heguan',
          worldName: 'Emberware Court',
          role: 'Brick artist · Glazed clay folk',
          avatarSrc: '/demo/explore/emberware-court-character-0.png',
          defaultCloak: '#D96B43',
          defaultHeadwear: 'beret',
          normal: {
            placeId: 'balloon-meadow',
            placeName: 'Balloon Meadow',
            activityTitle: 'Sketching along the meadow',
            detail: 'Strolling between the picnic lawn and pottery yard sketching pastel balloon panels',
            doorstepReply: '"The breeze smells like lavender out here—just finished sketching the hot-air balloon!"',
            x: 84,
            y: 42,
            trail: [
              { x: 84, y: 42 },
              { x: 75, y: 42 },
              { x: 68, y: 50 },
              { x: 76, y: 44 },
            ],
          },
          tuned: {
            placeId: 'sunlight-greenhouse',
            placeName: 'Glass Conservatory',
            activityTitle: 'Watching lantern glow through rain',
            detail: 'Stepped inside the glass conservatory to mix warm amber tones as plaza lanterns lit up',
            doorstepReply: '"Rain on the glass roof sounds lovely, and all the festival lanterns outside just came on."',
            x: 52,
            y: 36,
            trail: [
              { x: 52, y: 36 },
              { x: 52, y: 48 },
              { x: 45, y: 58 },
              { x: 52, y: 48 },
            ],
          },
          solitary: {
            placeId: 'personal-quarter',
            placeName: 'Rose-Trellis Loft',
            activityTitle: 'Sorting sketches upstairs',
            detail: 'Binding today’s town sketches quietly in the cottage loft',
            doorstepReply: '"Tying up my sketchbook pages upstairs—reach out anytime."',
            x: 25,
            y: 74,
          },
        },
        {
          id: 'liuwenxing',
          handle: 'liuwenxing',
          name: 'Liu Wenxing',
          worldName: 'Meridian Archipelago',
          role: 'Retired canal negotiator',
          avatarSrc: '/demo/explore/meridian-archipelago-character-0.png',
          defaultCloak: '#2B7A8B',
          defaultHeadwear: 'straw-hat',
          normal: {
            placeId: 'fountain-plaza',
            placeName: 'Waterwheel Bridge',
            activityTitle: 'Walking the millrace & plaza',
            detail: 'Pacing between the stone bridge and fountain cobblestones admiring the timber waterwheel',
            doorstepReply: '"Whoever graded this town’s millrace knew their craft—not a drop of current wasted."',
            x: 58,
            y: 49,
            trail: [
              { x: 58, y: 49 },
              { x: 64, y: 56 },
              { x: 53, y: 69 },
              { x: 45, y: 63 },
              { x: 52, y: 55 },
            ],
          },
          tuned: {
            placeId: 'clocktower-library',
            placeName: 'Clocktower Library',
            activityTitle: 'Reading old bridge blueprints',
            detail: 'Took shelter in the clocktower library with a century-old town aqueduct folio',
            doorstepReply: '"Ducked out of the drizzle into the clocktower—found a fascinating old bridge chronicle."',
            x: 29,
            y: 39,
            trail: [
              { x: 29, y: 39 },
              { x: 27, y: 50 },
              { x: 35, y: 60 },
              { x: 27, y: 50 },
            ],
          },
          solitary: {
            placeId: 'personal-quarter',
            placeName: 'Rose-Trellis Loft',
            activityTitle: 'Quiet reading by lamplight',
            detail: 'Resting indoors as the six-o’clock chimes fade',
            doorstepReply: '"Listening to the evening chimes from my room—all peaceful here."',
            x: 29,
            y: 71,
          },
        },
      ],
      wishes: [
        {
          id: 'town-lanterns',
          prompt: '"Bring a gentle dusk shower and light the festival lanterns across the plaza"',
          targetTuned: true,
          summary: 'Activate evening rain and festival lanterns; shelter meadow activities',
          parameterDiff: 'weather: clear-breeze -> gentle-rain · event: festival-lanterns',
          placeDiff: 'Lights lanterns · Closes: Balloon Meadow (moves to Conservatory & Clocktower)',
        },
        {
          id: 'town-sunny',
          prompt: '"Clear the rain and reopen the sunny Balloon Meadow and grove stage"',
          targetTuned: false,
          summary: 'Restore sunlit breeze and reopen outdoor meadow hangouts',
          parameterDiff: 'weather: gentle-rain -> clear-breeze · event: none',
          placeDiff: 'Opens: Balloon Meadow, Grove Stage',
        },
      ],
    },
    {
      id: 'polar-station',
      bundleId: 'nimi.builtin.polar-station',
      title: 'Polar Station',
      shortTitle: 'Polar Station',
      themeLabel: 'Arctic Outpost',
      subtitle: 'Weather deck, twin geodesic domes, ice-core vault, and outdoor geothermal spring',
      clockLabel: '9:15 PM · Polar Night',
      baseImageSrc: '/demo/utopia/polar-station.webp',
      overlayImageSrc: '/demo/utopia/polar-station-aurora.webp',
      normalEnvLabel: 'Clear · Starlit Ridge',
      tunedEnvLabel: 'Sky Event · Aurora Surge',
      normalConsequence: 'Calm polar night keeps boardwalks, hydro-garden dome, and hearth lodge open',
      tunedConsequence: 'Emerald-violet aurora ribbons sweep overhead, drawing companions to the Sky Dome and hot spring',
      personalQuarterName: 'Insulated Pod',
      sharedMomentLabel: '8:30 PM · Heguan and Liu Wenxing warmed up with hot cocoa beside the pine hearth',
      places: [
        { id: 'observation-window', name: 'Sky Observation Dome', sensory: 'Warm timber-framed geodesic dome beneath the polar stars.', x: 52, y: 36, openedWhenTuned: true },
        { id: 'hydro-garden', name: 'Hydroponic Dome', sensory: 'Lush warm greenery thriving in the middle of the ice ridge.', x: 48, y: 74 },
        { id: 'geothermal-hearth', name: 'Geothermal Spring & Lodge', sensory: 'Steaming mineral pool tucked beside a glowing log cabin.', x: 64, y: 56 },
        { id: 'ice-core-vault', name: 'Ice-Core Vault', sensory: 'Glacier-blue snow tunnel housing ancient layered ice samples.', x: 35, y: 58 },
      ],
      residents: [
        {
          id: 'heguan',
          handle: 'heguan',
          name: 'Heguan',
          worldName: 'Emberware Court',
          role: 'Brick artist · Glazed clay folk',
          avatarSrc: '/demo/explore/emberware-court-character-0.png',
          defaultCloak: '#6A5B8E',
          defaultHeadwear: 'star-clip',
          normal: {
            placeId: 'hydro-garden',
            placeName: 'Hydroponic Dome',
            activityTitle: 'Sketching frost & vine leaves',
            detail: 'Walking the lit timber boardwalk between the greenhouse dome and main lodge',
            doorstepReply: '"Minus twenty outside, yet cherry tomatoes are ripening inside this dome—wild!"',
            x: 48,
            y: 74,
            trail: [
              { x: 48, y: 74 },
              { x: 41, y: 66 },
              { x: 56, y: 58 },
              { x: 48, y: 65 },
            ],
          },
          tuned: {
            placeId: 'observation-window',
            placeName: 'Sky Observation Dome',
            activityTitle: 'Studying aurora glaze hues',
            detail: 'Climbed the upper boardwalk to the observation dome marveling at aurora curtains',
            doorstepReply: '"Look up! Those green-and-violet aurora bands look just like a living kiln-transmuted glaze!"',
            x: 52,
            y: 35,
            trail: [
              { x: 52, y: 35 },
              { x: 59, y: 40 },
              { x: 67, y: 38 },
              { x: 59, y: 40 },
            ],
          },
          solitary: {
            placeId: 'personal-quarter',
            placeName: 'Insulated Pod',
            activityTitle: 'Cozy pod downtime',
            detail: 'Wrapped in a wool blanket watching snow drift past the porthole',
            doorstepReply: '"Curled up warm in my pod—leave a note anytime."',
            x: 80,
            y: 80,
          },
        },
        {
          id: 'liuwenxing',
          handle: 'liuwenxing',
          name: 'Liu Wenxing',
          worldName: 'Meridian Archipelago',
          role: 'Retired canal negotiator',
          avatarSrc: '/demo/explore/meridian-archipelago-character-0.png',
          defaultCloak: '#D96B43',
          defaultHeadwear: 'beret',
          normal: {
            placeId: 'ice-core-vault',
            placeName: 'Ice-Core Vault',
            activityTitle: 'Inspecting ancient ice strata',
            detail: 'Pacing along the snow boardwalk outside the ice-core tunnel checking strata rings',
            doorstepReply: '"Compressed snow from a thousand winters holds strata lines just like canyon limestone."',
            x: 35,
            y: 58,
            trail: [
              { x: 35, y: 58 },
              { x: 26, y: 71 },
              { x: 37, y: 66 },
            ],
          },
          tuned: {
            placeId: 'geothermal-hearth',
            placeName: 'Geothermal Spring Deck',
            activityTitle: 'Watching aurora by the hot spring',
            detail: 'Strolling the steaming spring deck with ginger tea as aurora reflects off the snow',
            doorstepReply: '"Warm earth spring underfoot and aurora ribbons overhead—what a sight."',
            x: 65,
            y: 56,
            trail: [
              { x: 65, y: 56 },
              { x: 76, y: 56 },
              { x: 58, y: 54 },
            ],
          },
          solitary: {
            placeId: 'personal-quarter',
            placeName: 'Insulated Pod',
            activityTitle: 'Writing polar field notes',
            detail: 'Jotting quiet observations inside the heated sleeping pod',
            doorstepReply: '"Writing down a few glacier notes in my heated pod."',
            x: 84,
            y: 77,
          },
        },
      ],
      wishes: [
        {
          id: 'polar-aurora',
          prompt: '"Light up a vivid polar aurora across the ridge for a sky-dome watch"',
          targetTuned: true,
          summary: 'Enable aurora sky overlay and gather companions at the Sky Dome & Spring',
          parameterDiff: 'sky: clear-night -> aurora-surge · wind: calm',
          placeDiff: 'Aurora watch active · Companions head to Sky Dome & Geothermal Deck',
        },
        {
          id: 'polar-calm',
          prompt: '"Let the aurora fade back into a calm starlit polar night"',
          targetTuned: false,
          summary: 'Return to quiet starlit polar routine across domes and ice vault',
          parameterDiff: 'sky: aurora-surge -> clear-night',
          placeDiff: 'Restores standard evening station routine',
        },
      ],
    },
    {
      id: 'cloud-bamboo-abode',
      bundleId: 'nimi.builtin.cloud-bamboo-abode',
      title: 'Cloud Bamboo Abode',
      shortTitle: 'Cloud Abode',
      themeLabel: 'Misty Sanctuary',
      subtitle: 'Cliffside pine terrace, bell waterfall, bamboo herb beds, hearth courtyard, and tea loft',
      clockLabel: '9:30 AM · Morning Bell',
      baseImageSrc: '/demo/utopia/cloud-bamboo-abode.webp',
      overlayImageSrc: '/demo/utopia/cloud-bamboo-abode-snow.webp',
      normalEnvLabel: 'Clear · Pine & Waterfall',
      tunedEnvLabel: 'Snowfall · Valley Mist',
      normalConsequence: 'Clear mountain air keeps the Cliffside Pine Terrace, bamboo aqueduct, and lotus cloister open',
      tunedConsequence: 'Mountain snow and thick mist close the cliff terrace; companions gather by the hearth and tea loft',
      personalQuarterName: 'Bamboo Thatch Hut',
      sharedMomentLabel: '8:50 AM · Heguan and Liu Wenxing guided spring water through bamboo pipes into the herb beds',
      places: [
        { id: 'cloud-terrace', name: 'Cliffside Pine Terrace', sensory: 'Stone platform jutting into a sea of clouds; closes in heavy snow.', x: 16, y: 55, closedWhenTuned: true },
        { id: 'waterfall-pavilion', name: 'Bell & Waterfall Pavilion', sensory: 'Mountain cascade plunging into jade pools beside a bronze bell.', x: 43, y: 29 },
        { id: 'elixir-hearth', name: 'Central Hearth Courtyard', sensory: 'Sheltered courtyard warmed by a glowing bronze brazier.', x: 54, y: 54 },
        { id: 'tea-pavilion', name: 'Bamboo Tea & Scroll Loft', sensory: 'Two-story timber pavilion tucked in tall bamboo for tea and reading.', x: 80, y: 52 },
      ],
      residents: [
        {
          id: 'heguan',
          handle: 'heguan',
          name: 'Heguan',
          worldName: 'Emberware Court',
          role: 'Brick artist · Glazed clay folk',
          avatarSrc: '/demo/explore/emberware-court-character-0.png',
          defaultCloak: '#5B7F58',
          defaultHeadwear: 'leaf-sprout',
          normal: {
            placeId: 'cloud-terrace',
            placeName: 'Cliffside Pine Terrace',
            activityTitle: 'Walking the cliff pine steps',
            detail: 'Strolling up the stone steps to watch clouds drift past the cliffside pine',
            doorstepReply: '"Clouds are drifting right past my boots—nature mixed this mineral green better than I ever could."',
            x: 16,
            y: 55,
            trail: [
              { x: 16, y: 55 },
              { x: 24, y: 45 },
              { x: 34, y: 46 },
              { x: 24, y: 45 },
            ],
          },
          tuned: {
            placeId: 'elixir-hearth',
            placeName: 'Central Hearth Courtyard',
            activityTitle: 'Warming clay tiles by the brazier',
            detail: 'Moved into the sheltered courtyard to dry clay tiles slowly while snowflakes drift outside',
            doorstepReply: '"Snow started drifting over the ridge, so I brought my clay tiles in beside the warm courtyard brazier."',
            x: 54,
            y: 54,
            trail: [
              { x: 54, y: 54 },
              { x: 48, y: 61 },
              { x: 62, y: 64 },
              { x: 48, y: 61 },
            ],
          },
          solitary: {
            placeId: 'personal-quarter',
            placeName: 'Bamboo Thatch Hut',
            activityTitle: 'Listening to bamboo wind',
            detail: 'Polishing carving tools quietly behind a woven bamboo screen',
            doorstepReply: '"Resting quietly in the bamboo hut listening to the leaves."',
            x: 82,
            y: 80,
          },
        },
        {
          id: 'liuwenxing',
          handle: 'liuwenxing',
          name: 'Liu Wenxing',
          worldName: 'Meridian Archipelago',
          role: 'Retired canal negotiator',
          avatarSrc: '/demo/explore/meridian-archipelago-character-0.png',
          defaultCloak: '#2B7A8B',
          defaultHeadwear: 'straw-hat',
          normal: {
            placeId: 'herb-terrace',
            placeName: 'Bamboo Herb Terraces',
            activityTitle: 'Walking the bamboo flumes',
            detail: 'Pacing along the stone bridge and herb steps tracing split-bamboo spring conduits',
            doorstepReply: '"Hollowed bamboo conduits splitting spring water across three terraces—effortless mountain engineering."',
            x: 34,
            y: 78,
            trail: [
              { x: 34, y: 78 },
              { x: 42, y: 69 },
              { x: 50, y: 63 },
              { x: 42, y: 69 },
            ],
          },
          tuned: {
            placeId: 'tea-pavilion',
            placeName: 'Bamboo Tea & Scroll Loft',
            activityTitle: 'Brewing aged white tea upstairs',
            detail: 'Walked along the bamboo stone path to the tea loft as snow dusted the steps',
            doorstepReply: '"Steps turned frosty, so I’m upstairs in the tea loft steeping aged white tea."',
            x: 80,
            y: 52,
            trail: [
              { x: 80, y: 52 },
              { x: 76, y: 64 },
              { x: 67, y: 72 },
              { x: 76, y: 64 },
            ],
          },
          solitary: {
            placeId: 'personal-quarter',
            placeName: 'Bamboo Thatch Hut',
            activityTitle: 'Quiet breathing indoors',
            detail: 'Resting undisturbed inside the private bamboo cottage',
            doorstepReply: '"Enjoying the mountain hush inside my bamboo cottage."',
            x: 85,
            y: 83,
          },
        },
      ],
      wishes: [
        {
          id: 'bamboo-snow',
          prompt: '"Let mountain snow and valley mist drift in while everyone warms tea indoors"',
          targetTuned: true,
          summary: 'Add snowfall and mist layers; close cliff terrace for cozy hearth & tea loft time',
          parameterDiff: 'weather: clear-mountain -> mountain-snow · mist: dense',
          placeDiff: 'Closes: Cliffside Pine Terrace (moves to Hearth Courtyard & Tea Loft)',
        },
        {
          id: 'bamboo-clear',
          prompt: '"Part the snow clouds to reopen the cliffside pine terrace and herb flumes"',
          targetTuned: false,
          summary: 'Clear snow mist and reopen outdoor mountain viewpoints',
          parameterDiff: 'weather: mountain-snow -> clear-mountain · mist: light',
          placeDiff: 'Opens: Cliffside Pine Terrace, Bamboo Herb Terraces',
        },
      ],
    },
  ],
};

export function createUtopiaPreviewContent(locale: LandingLocale): UtopiaPreviewContent {
  return locale === 'zh' ? UTOPIA_CONTENT_ZH : UTOPIA_CONTENT_EN;
}
