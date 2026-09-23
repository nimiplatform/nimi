import type { HeroDemoOddBureauMystery, HeroDemoOddBureauPreview } from './landing-content.js';

/**
 * Odd Bureau (nimi.odd-bureau, 奇物局) preview content. Shared by both locales
 * because the app ships Chinese-only UI. The photo is the app's own sample
 * scene (public/breakfast-scene.png, an AI-created sample per PRODUCT.md),
 * re-encoded as JPEG under /demo/odd-bureau/. The six objects follow the
 * app's vision.locate query order (杯子, 书本, 灯, 盆栽, 时钟, 水果) with boxes
 * measured on that image; everything Runtime text.generate would write in the
 * app (plans, mysteries, replies, the performance) is authored here and passes
 * the app's fixed rules (see demo-odd-bureau-rules.ts and the tests).
 */

const CUP = 'object-1';
const BOOK = 'object-2';
const LAMP = 'object-3';
const PLANT = 'object-4';
const CLOCK = 'object-5';
const ORANGE = 'object-6';

const missing: HeroDemoOddBureauMystery = {
  mood: 'missing',
  title: '橘子少了一瓣',
  incident: '早餐桌上的橘子被掰开了，可少了整整一瓣，谁也没承认吃过。',
  opening: '阳光刚爬上紫色桌面，橘子就发现自己缺了一角。桌上六位都说没动过嘴，可湿漉漉的痕迹还没干。',
  culpritId: BOOK,
  resolution: '时钟在六点四十分听到了「啪」的一声，桌上只有一个会开会合的家伙能发出这种声音；台灯照见的湿痕，恰好停在它脚下。原来是书本想给自己夹一枚新鲜的书签，还觉得橘子味的比枫叶好闻。',
  decisiveEvidenceIds: [CLOCK, LAMP],
  characters: [
    {
      objectId: CUP, persona: '深蓝色，早上第一个被端起来，脾气也最大',
      greeting: '别看我，我一早就装满了咖啡，嘴里没地方放橘子。',
      testimony: '六点半我旁边多了一圈咖啡渍，不是我洒的，是有谁急匆匆从我身边挤过去。',
      clueTitle: '被挤过的咖啡渍', suggestedQuestion: '谁从你旁边挤过去了？',
      replies: ['挤过去的时候，我只看见一道红色的边。别问我是谁，我当时正冒热气。', '我只知道那家伙很重，压得桌面都晃了一下。'],
    },
    {
      objectId: BOOK, persona: '红皮精装，什么都读过，最爱夹东西',
      greeting: '我一整个早上都合着，一页都没翻。想问什么就问吧。',
      testimony: '我合上的时候确实听见橘子在叫，可那是它自己掰开的声音，跟我无关。',
      clueTitle: '合上时的动静', suggestedQuestion: '你为什么要合得那么响？',
      replies: ['合得响是因为我厚。厚的书都这样，不信你问别的书。', '书签？我最近确实换了一枚，味道……嗯，有点清新。'],
    },
    {
      objectId: LAMP, persona: '绿色台灯，安静，只在需要时亮',
      greeting: '我天亮以后就关了，不过关着的时候，我也看得很清楚。',
      testimony: '我照见一道湿痕，从橘子那边一路延伸，停在一个方方正正、会开会合的家伙脚下。',
      clueTitle: '湿痕的终点', suggestedQuestion: '湿痕停在哪里？',
      replies: ['就在桌子中间那位脚下，红红的，四四方方的。我不点名，你自己看。', '我亮着的时候看得最清楚。想再确认一次，可以再开一下我。'],
    },
    {
      objectId: PLANT, persona: '慢性子，一心只想晒太阳',
      greeting: '我叶子多，可一片也没伸到桌子中间去。',
      testimony: '我只看见窗边的光走了一格，别的都在我的叶子后面，看不见。',
      clueTitle: '叶子后面的世界', suggestedQuestion: '你真的什么都没看见？',
      replies: ['看见倒是看见了一点，可我在打瞌睡，说不准。', '窗户那边我最熟，桌子中间发生的事，去问台灯。'],
    },
    {
      objectId: CLOCK, persona: '黄色闹钟，守时到令人紧张',
      greeting: '六点四十分。我记得每一件事发生的时刻，包括你走进来的这一秒。',
      testimony: '六点四十分整，我听见「啪」的一声，像一本厚东西合上了，之后就闻到橘子味。',
      clueTitle: '六点四十分的一声', suggestedQuestion: '那声音是从哪来的？',
      replies: ['从我的右边来，比我重，比我厚。我不猜，我只报时间。', '再之前是六点三十八分，橘子被掰开。两分钟之内的事，不会错。'],
    },
    {
      objectId: ORANGE, persona: '圆滚滚，容易被忽略，也容易被吃',
      greeting: '我少了一瓣！我数过三遍了！',
      testimony: '我被掰开之后，有个东西压着我的边，等它抬起来，我就少了一瓣。',
      clueTitle: '压过来的重量', suggestedQuestion: '压着你的东西是软的还是硬的？',
      replies: ['硬的，方的，还带着一股旧纸的味道。我说得够多了吧？', '我只是个橘子，我只想知道那一瓣去哪了。'],
    },
  ],
};

const strike: HeroDemoOddBureauMystery = {
  mood: 'strike',
  title: '谁按停了早晨',
  incident: '闹钟明明响了，可全屋没人起床，早餐桌上的东西集体说：今天不开工。',
  opening: '六点整的闹铃像往常一样准时，可谁也没听见。桌上的家伙们趁机罢了工，其中有一位，是故意的。',
  culpritId: PLANT,
  resolution: '闹钟说自己准时响了，只是脸被软软的东西挡住，声音闷在里面；杯子整个早晨都看见一片叶子的影子在晃。能把叶子伸到闹钟脸上的，只有盆栽。它只是想让所有人多睡一会儿，把清晨的阳光独占一小时。',
  decisiveEvidenceIds: [CLOCK, CUP],
  characters: [
    {
      objectId: CUP, persona: '深蓝色，一早就该冒热气的急性子',
      greeting: '没人来端我，我的咖啡都凉了。这种事从来没发生过。',
      testimony: '整个早晨，我旁边一直有一片叶子的影子在晃，晃得我头晕。',
      clueTitle: '晃动的叶影', suggestedQuestion: '那片叶子影子从哪儿来？',
      replies: ['从我左边来，绿油油的，一直伸到闹钟那边去了。', '我不喜欢影子。影子一来，就没人记得端我了。'],
    },
    {
      objectId: BOOK, persona: '红皮精装，罢工也要有条理',
      greeting: '我们不是无缘无故罢工的。总得有人先按停早晨，我们才有机会歇一歇。',
      testimony: '闹钟响的时候我听见了，但声音闷闷的，像隔着一层什么。',
      clueTitle: '闷住的铃声', suggestedQuestion: '铃声为什么会闷？',
      replies: ['被挡住了呗。我又没长手，挡不了它。', '要我说，谁最靠近闹钟，就先问谁。'],
    },
    {
      objectId: LAMP, persona: '绿色台灯，罢工就是不亮',
      greeting: '我今天不亮。不过我关着，也照样有话说。',
      testimony: '天亮前我照见闹钟旁边有个东西慢慢挪近，天亮以后它又缩回去了。',
      clueTitle: '挪近又缩回', suggestedQuestion: '挪近闹钟的是什么？',
      replies: ['软软的，一片一片的，我不确定是不是活的。', '它挪得很慢，慢到我以为是自己看错了。'],
    },
    {
      objectId: PLANT, persona: '慢性子，一心只想独占阳光',
      greeting: '我一直在窗边晒太阳，罢工跟我这种植物有什么关系？',
      testimony: '早晨太阳最好的时候，桌上安安静静的，我觉得很舒服。',
      clueTitle: '安静的早晨', suggestedQuestion: '你的叶子早上伸到哪里了？',
      replies: ['植物长叶子是自然规律，长到哪儿我说了不算。', '我只是希望大家都多睡一会儿。多睡一会儿，有什么不好？'],
    },
    {
      objectId: CLOCK, persona: '黄色闹钟，今天格外委屈',
      greeting: '我准时响了！六点整！一秒不差！可没有人听见。',
      testimony: '我响的时候，脸被一层软软的东西挡着，声音全闷在里面了。',
      clueTitle: '被挡住的脸', suggestedQuestion: '挡住你的东西是什么颜色？',
      replies: ['绿的，凉凉的，还有点湿。我当时只顾着响，没细看。', '它是从左边过来的，从窗户那个方向。'],
    },
    {
      objectId: ORANGE, persona: '圆滚滚，罢工也懒得动',
      greeting: '我本来就不动，罢不罢工对我都一样。',
      testimony: '我昨晚滚到桌边，看见窗户那边的东西比平时大了一圈。',
      clueTitle: '大了一圈', suggestedQuestion: '什么东西大了一圈？',
      replies: ['就是窗边那团绿的，早上又缩回去了，像没事人一样。', '我一个橘子，看东西都是圆的，你多担待。'],
    },
  ],
};

const party: HeroDemoOddBureauMystery = {
  mood: 'party',
  title: '桌上多了一圈咖啡渍',
  incident: '主人出门的那晚，桌上多了一圈咖啡渍。派对谁都参加了，可渍是谁弄出来的？',
  opening: '主人一出门，早餐桌就开了派对。灯当聚光灯，书当舞台，闹钟负责倒数。第二天，桌上多了一圈谁也不认的咖啡渍。',
  culpritId: ORANGE,
  resolution: '杯子说自己是被撞了一下才泼出来的，书本看见一个圆东西从桌子中间滚过去撞到了深蓝色的那位。桌上会滚的只有橘子。它那晚玩得太开心，想滚一圈当谢幕，结果撞翻了杯子。它说，下次会先看路。',
  decisiveEvidenceIds: [CUP, BOOK],
  characters: [
    {
      objectId: CUP, persona: '深蓝色，派对上负责端着咖啡站在角落',
      greeting: '咖啡渍在我旁边不代表是我洒的！我是被撞的！',
      testimony: '我被撞了一下，往前晃了半圈，才泼出来的。撞我的东西又圆又滚。',
      clueTitle: '半圈的晃动', suggestedQuestion: '撞你的东西是从哪边来的？',
      replies: ['从桌子中间过来的，速度快得像在谢幕。', '我要是自己洒的，早就认了。我不是那种杯子。'],
    },
    {
      objectId: BOOK, persona: '红皮精装，派对上当舞台',
      greeting: '那晚大家都在我背上跳舞，我背疼，但我看得很清楚。',
      testimony: '我看见一个圆东西从桌子中间滚过去，一直撞到深蓝色的那位身上。',
      clueTitle: '滚过去的圆东西', suggestedQuestion: '那个圆东西是什么颜色？',
      replies: ['橙色的，我不点名，桌上橙色的东西你自己数。', '它滚之前还喊了一句「看我的」，然后就撞上了。'],
    },
    {
      objectId: LAMP, persona: '绿色台灯，派对上的聚光灯',
      greeting: '我负责打光，谁在光里我都看见了，可我不想当告密的灯。',
      testimony: '最后一支舞，我的光跟着一个滚动的影子走，然后就听见「哗」的一声。',
      clueTitle: '跟着影子的光', suggestedQuestion: '你的光最后停在哪里？',
      replies: ['停在杯子旁边，那圈渍就在光里慢慢变大。', '滚动的影子……是圆的。我只能说到这儿。'],
    },
    {
      objectId: PLANT, persona: '慢性子，派对上负责摇叶子伴舞',
      greeting: '我只摇了摇叶子，没有离开窗边半步。',
      testimony: '我看见有人从窗边滚向桌子中间，可我的叶子挡住了后面的事。',
      clueTitle: '窗边滚走的家伙', suggestedQuestion: '谁从你旁边滚走了？',
      replies: ['圆圆的那位，滚得可欢了，一路喊着要谢幕。', '我摇叶子是伴舞，不是遮掩，你别误会。'],
    },
    {
      objectId: CLOCK, persona: '黄色闹钟，派对上负责倒数',
      greeting: '十一点五十九分开始倒数，十二点整，有人摔了一跤。',
      testimony: '倒数到零的时候，我听见先是「咕噜噜」，然后是「哗」。',
      clueTitle: '咕噜噜与哗', suggestedQuestion: '咕噜噜是什么声音？',
      replies: ['是滚动的声音。桌上会滚的，你数数看。', '我只报时间。十二点整，咕噜噜；十二点零一分，哗。'],
    },
    {
      objectId: ORANGE, persona: '圆滚滚，派对上最会玩的那个',
      greeting: '派对是我组织的，可派对组织者不一定就是闯祸的那个，对吧？',
      testimony: '谢幕的时候我确实滚了一圈，可我滚得很小心，什么都没碰到。',
      clueTitle: '谢幕的一圈', suggestedQuestion: '你滚的那一圈经过了哪里？',
      replies: ['经过了桌子中间，然后……然后我就停下了，不记得撞没撞到什么。', '我下次会先看路的。我是说，如果真有下次。'],
    },
  ],
};

export const oddBureauPreviewContent: HeroDemoOddBureauPreview = {
  appName: '奇物局',
  photo: { src: '/demo/odd-bureau/breakfast-scene.jpg', name: '早餐之后', width: 1536, height: 1024 },
  props: [
    { id: CUP, label: '杯子', box: { x1: 0.19, y1: 0.42, x2: 0.355, y2: 0.655 } },
    { id: BOOK, label: '书本', box: { x1: 0.485, y1: 0.27, x2: 0.715, y2: 0.44 } },
    { id: LAMP, label: '灯', box: { x1: 0.665, y1: 0.01, x2: 0.895, y2: 0.42 } },
    { id: PLANT, label: '盆栽', box: { x1: 0.125, y1: 0.06, x2: 0.345, y2: 0.42 } },
    { id: CLOCK, label: '时钟', box: { x1: 0.35, y1: 0.165, x2: 0.46, y2: 0.37 } },
    { id: ORANGE, label: '水果', box: { x1: 0.375, y1: 0.41, x2: 0.535, y2: 0.595 } },
  ],
  machine: {
    title: '早餐桌回声机',
    invitation: '把闹钟的滴答，绕一圈送进杯子里。',
    nodes: [
      { objectId: CLOCK, op: 'source', melody: [0, 2, 1], line: '我每天负责第一声，今天也不例外。' },
      { objectId: BOOK, op: 'reverse', melody: [], line: '翻到最后一页，再从后往前念给你听。' },
      { objectId: LAMP, op: 'raise', melody: [], line: '有我在，什么声音都亮一度。' },
      { objectId: PLANT, op: 'slow', melody: [], line: '别急，声音到我这儿会慢慢长。' },
      { objectId: ORANGE, op: 'echo', melody: [], line: '我圆，所以什么都会滚回来一次。' },
      { objectId: CUP, op: 'store', melody: [], line: '倒进来吧，我装得下一早上的声音。' },
    ],
  },
  strike: {
    title: '早餐桌不干了',
    situation: '杯子空着，书合着，灯也不肯亮。它们说，除非今晚的故事会办得像样，否则谁都不动。',
    people: [
      { objectId: CUP, persona: '早上第一个醒，脾气最大', offers: [{ task: 'story', needsCredit: true, needsRest: null }, { task: 'stage', needsCredit: false, needsRest: null }] },
      { objectId: BOOK, persona: '话多，什么都读过', offers: [{ task: 'story', needsCredit: false, needsRest: null }, { task: 'reading', needsCredit: false, needsRest: null }] },
      { objectId: LAMP, persona: '安静，只在需要时亮', offers: [{ task: 'stage', needsCredit: false, needsRest: PLANT }, { task: 'reading', needsCredit: false, needsRest: null }] },
      { objectId: PLANT, persona: '慢性子，喜欢晒太阳', offers: [{ task: 'stage', needsCredit: false, needsRest: null }] },
      { objectId: CLOCK, persona: '守时到令人紧张', offers: [{ task: 'reading', needsCredit: true, needsRest: null }] },
      { objectId: ORANGE, persona: '圆滚滚，容易被忽略', offers: [{ task: 'story', needsCredit: false, needsRest: null }] },
    ],
  },
  performance: [
    '窗边的盆栽做了一个梦：梦见自己的叶子长到了桌子对面，够到了那盏绿色的台灯。它想借一点光，好让自己在夜里也能长高一点。',
    '可台灯误会了。它以为盆栽是来抢它的位置，气得忽明忽暗。橘子滚过来劝架，一不小心撞倒了杯子，桌上顿时一片乱哄哄。闹钟只好大声报时，请大家先安静。',
    '书本翻开一页，念出盆栽的梦。台灯听完，把光调得柔柔的，正好照在叶子上。橘子把自己的一瓣分给了杯子当赔礼。早餐桌上，谁也没再提刚才的事。',
  ],
  mysteries: [missing, strike, party],
  demo: {
    hostOnly: '这一步需要 Nimi Desktop 中的奇物局本体：照片定位、玩法创作与语音由 Runtime 执行；网页演示只展示界面与玩法。',
    voice: '朗读需要 Nimi 中配置的语音合成能力；网页演示不发声。',
    dismiss: '知道了',
  },
};
