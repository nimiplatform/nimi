import type { HabitatDaypart } from '@nimiplatform/sdk/app';

export type WorldScenicLandmark = Readonly<{
  readonly id: string;
  readonly name: string;
  readonly categoryLabel: string;
  readonly xPercent: number;
  readonly yPercent: number;
  readonly glyph: 'lighthouse' | 'bridge' | 'market' | 'windmill' | 'postbox' | 'boat' | 'flower' | 'spring' | 'archway' | 'hearth';
  readonly summary: string;
  readonly daypartNote?: Readonly<Partial<Record<HabitatDaypart, string>>>;
}>;

export type WorldKineticProp =
  | Readonly<{
      readonly id: string;
      readonly kind: 'windmill-sails';
      readonly xPercent: number;
      readonly yPercent: number;
      readonly sizePx: number;
      readonly durationSec: number;
    }>
  | Readonly<{
      readonly id: string;
      readonly kind: 'waterwheel-rim';
      readonly xPercent: number;
      readonly yPercent: number;
      readonly sizePx: number;
      readonly durationSec: number;
    }>
  | Readonly<{
      readonly id: string;
      readonly kind: 'lighthouse-beam';
      readonly xPercent: number;
      readonly yPercent: number;
      readonly activeDayparts: readonly HabitatDaypart[];
    }>
  | Readonly<{
      readonly id: string;
      readonly kind: 'floating-balloon';
      readonly xPercent: number;
      readonly yPercent: number;
      readonly scale: number;
    }>
  | Readonly<{
      readonly id: string;
      readonly kind: 'gliding-birds';
      readonly xPercent: number;
      readonly yPercent: number;
      readonly spanPx: number;
      readonly variant: 'seagull' | 'crane' | 'dove';
    }>;

const LANDMARKS_BY_HABITAT: Readonly<Record<string, readonly WorldScenicLandmark[]>> = {
  'nimi.builtin.seaside-island': [
    {
      id: 'landmark:cape-lighthouse',
      name: '海角红白灯塔',
      categoryLabel: '海岸引航地标',
      xPercent: 19,
      yPercent: 15,
      glyph: 'lighthouse',
      summary: '矗立在西侧青草悬崖上的珊瑚红白灯塔，推开铜框圆窗能望见整片外海的浪线与归帆。',
      daypartNote: {
        morning: '晨雾散开时，塔尖风向标正迎着第一缕海风轻转。',
        dusk: '暮色漫上海平线，塔顶透镜投出柔和的琥珀色航标光束。',
        night: '静夜潮声里，温暖的航标光束正有规律地掠过浅湾水面。',
      },
    },
    {
      id: 'landmark:banyan-market',
      name: '古榕帆布集市',
      categoryLabel: '岛心生活景致',
      xPercent: 55,
      yPercent: 45,
      glyph: 'market',
      summary: '百年老榕树浓荫下的石板小市集，条纹帆布棚里摆着海岛柑橘、手编竹篮与晒干的柠檬片。',
      daypartNote: {
        day: '正午树影斑驳，帆布檐下的贝壳风铃随海风叮当作响。',
        night: '收摊后的木棚留着防风小提灯，石桌仍带着白日的果香。',
      },
    },
    {
      id: 'landmark:seaside-postbox',
      name: '潮声红邮筒',
      categoryLabel: '栈道街角风物',
      xPercent: 34,
      yPercent: 56,
      glyph: 'postbox',
      summary: '立在木屋区石板岔路口的朱红小邮筒，收纳着贴满海鸟邮票的手绘明信片与远航来信。',
    },
    {
      id: 'landmark:creek-arch-bridge',
      name: '芦苇木拱桥',
      categoryLabel: '湿地溪桥景致',
      xPercent: 45,
      yPercent: 27,
      glyph: 'bridge',
      summary: '连接村落石径与北岸观鸟湿地的松木小拱桥，桥畔睡莲轻浮，水底游过成群银鳞小鱼。',
    },
    {
      id: 'landmark:ridge-windmill',
      name: '东坡石磨风车',
      categoryLabel: '山坡风物地标',
      xPercent: 90,
      yPercent: 17,
      glyph: 'windmill',
      summary: '北坡草甸上白墙石砌的木翼风车，借着终年不断的海风缓缓转动，坡下开满细白野雏菊。',
    },
    {
      id: 'landmark:painted-skiff-cove',
      name: '彩舟停泊内湾',
      categoryLabel: '避风港湾景致',
      xPercent: 77,
      yPercent: 76,
      glyph: 'boat',
      summary: '木栈桥环抱的翡翠色平静内湾，几艘刷着海蓝、薄荷绿与暖橘漆的小木舟正随波轻晃。',
    },
  ],
  'nimi.builtin.starfield-town': [
    {
      id: 'landmark:lavender-terrace',
      name: '西坡薰衣草垄',
      categoryLabel: '田园花坡景致',
      xPercent: 12,
      yPercent: 15,
      glyph: 'flower',
      summary: '顺着镇西向阳缓坡层叠铺开的紫蓝薰衣草田，微风拂过时整条碎石小径都萦绕着清甜草香。',
    },
    {
      id: 'landmark:book-cart-corner',
      name: '常春藤流动书车',
      categoryLabel: '街角人文风物',
      xPercent: 26,
      yPercent: 37,
      glyph: 'postbox',
      summary: '停驻在钟楼彩绘玻璃窗外的木轮小书车，敞开着植物水彩图鉴与谁都可以添一笔的小镇随笔簿。',
    },
    {
      id: 'landmark:twin-stone-bridge',
      name: '水车双孔石桥',
      categoryLabel: '临溪古桥地标',
      xPercent: 70,
      yPercent: 49,
      glyph: 'bridge',
      summary: '横跨晴风清溪的雕花双孔石拱桥，岸边大木水车吱呀汲水，将碎银般的水花送入花房引水渠。',
    },
    {
      id: 'landmark:picnic-hill',
      name: '彩格野餐草坡',
      categoryLabel: '向阳山坡景致',
      xPercent: 88,
      yPercent: 43,
      glyph: 'market',
      summary: '东坡热气球坪下方的柔软草甸，铺着红白与蓝白方格野餐布，红白风向袋正指着晴朗东南风。',
    },
  ],
  'nimi.builtin.polar-station': [
    {
      id: 'landmark:sonde-balloon',
      name: '高空探空气球架',
      categoryLabel: '冰脊观测地标',
      xPercent: 18,
      yPercent: 21,
      glyph: 'lighthouse',
      summary: '系留在气象钢栈桥边缘的乳白探空气球，随时准备升入极地平流层采集温度与高空风速。',
    },
    {
      id: 'landmark:hot-spring-pool',
      name: '地热融雪暖池',
      categoryLabel: '冰原奇观景致',
      xPercent: 71,
      yPercent: 64,
      glyph: 'spring',
      summary: '玄武岩环抱的天然翡翠色地热泉眼，在零下冰原中终年升腾着袅袅白雾，温暖着四周栈道。',
      daypartNote: {
        night: '极夜微光映着碧绿泉面，氤氲热雾在寒夜空气里格外治愈。',
      },
    },
    {
      id: 'landmark:deep-space-dish',
      name: '极夜信标天线',
      categoryLabel: '远距科考设施',
      xPercent: 80,
      yPercent: 27,
      glyph: 'windmill',
      summary: '静静仰望极夜星空的白色抛物面天线，接收着越洋破冰船的问候与高纬度电离层脉冲回波。',
    },
  ],
  'nimi.builtin.cloud-bamboo-abode': [
    {
      id: 'landmark:mountain-archway',
      name: '山门青石牌坊',
      categoryLabel: '云径山门地标',
      xPercent: 25,
      yPercent: 26,
      glyph: 'archway',
      summary: '立于苍松云阶之上的榫卯青石牌坊，山岚穿门而过，拾级而下便是清幽开阔的山居诸院。',
    },
    {
      id: 'landmark:jade-waterfall',
      name: '飞练落玉深潭',
      categoryLabel: '山泉胜景地标',
      xPercent: 52,
      yPercent: 26,
      glyph: 'spring',
      summary: '自青峰岩隙倾泻而下的银白飞瀑，坠入翡翠般的澄澈山潭，溅起细碎清凉的松风竹露。',
    },
    {
      id: 'landmark:lotus-bridge',
      name: '映荷弯月石桥',
      categoryLabel: '曲水庭院景致',
      xPercent: 67,
      yPercent: 75,
      glyph: 'bridge',
      summary: '连接竹廊与青竹静室的青石拱桥，桥下粉白睡莲亭亭舒展，夜里偶有暖黄莲灯顺水轻漂。',
    },
  ],
  'creator.autumn-farm': [
    {
      id: 'landmark:wheat-scarecrow',
      name: '麦浪草帽稻草人',
      categoryLabel: '秋收田垄风物',
      xPercent: 30,
      yPercent: 37,
      glyph: 'flower',
      summary: '守在金黄梯田麦垄中央的蓝布衣稻草人，帽檐插着干麦穗，常有红胸山雀落脚歇息。',
    },
    {
      id: 'landmark:maple-footbridge',
      name: '红枫木拱小桥',
      categoryLabel: '秋溪水岸景致',
      xPercent: 44,
      yPercent: 84,
      glyph: 'bridge',
      summary: '横跨磨坊清溪的朱漆木拱桥，秋水清浅见底，不时漂过几枚火红枫叶与金黄银杏扇叶。',
    },
    {
      id: 'landmark:honey-apiary',
      name: '暖阳松木蜂箱',
      categoryLabel: '农舍庭前风物',
      xPercent: 8,
      yPercent: 89,
      glyph: 'market',
      summary: '木秋千旁向阳排列的手工松木蜂箱，酿存着融合红果花香与迷迭香气的琥珀色秋蜜。',
    },
    {
      id: 'landmark:campfire-log-ring',
      name: '晒场篝火圆石座',
      categoryLabel: '暮秋围炉景致',
      xPercent: 69,
      yPercent: 58,
      glyph: 'hearth',
      summary: '晒谷石场东南角用溪石围起的小篝火堆，适合在秋凉黄昏烘烤板栗与红薯。',
    },
  ],
};

const KINETIC_PROPS_BY_HABITAT: Readonly<Record<string, readonly WorldKineticProp[]>> = {
  'nimi.builtin.seaside-island': [
    { id: 'seaside-lighthouse-beam', kind: 'lighthouse-beam', xPercent: 19.0, yPercent: 7.6, activeDayparts: ['dusk', 'night'] },
    { id: 'seaside-windmill-spin', kind: 'windmill-sails', xPercent: 89.6, yPercent: 11.4, sizePx: 68, durationSec: 22 },
    { id: 'seaside-gulls-west', kind: 'gliding-birds', xPercent: 28, yPercent: 16, spanPx: 92, variant: 'seagull' },
    { id: 'seaside-gulls-cove', kind: 'gliding-birds', xPercent: 68, yPercent: 82, spanPx: 74, variant: 'seagull' },
  ],
  'nimi.builtin.starfield-town': [
    { id: 'starfield-waterwheel', kind: 'waterwheel-rim', xPercent: 67.0, yPercent: 39.2, sizePx: 38, durationSec: 16 },
    { id: 'starfield-balloon-bob', kind: 'floating-balloon', xPercent: 91.5, yPercent: 15.5, scale: 1 },
    { id: 'starfield-plaza-doves', kind: 'gliding-birds', xPercent: 48, yPercent: 58, spanPx: 68, variant: 'dove' },
  ],
  'nimi.builtin.polar-station': [
    { id: 'polar-tower-beacon', kind: 'lighthouse-beam', xPercent: 76.8, yPercent: 5.8, activeDayparts: ['dusk', 'night'] },
    { id: 'polar-sonde-bob', kind: 'floating-balloon', xPercent: 18, yPercent: 22, scale: 0.62 },
  ],
  'nimi.builtin.cloud-bamboo-abode': [
    { id: 'cloud-cranes-west', kind: 'gliding-birds', xPercent: 16, yPercent: 24, spanPx: 108, variant: 'crane' },
    { id: 'cloud-cranes-east', kind: 'gliding-birds', xPercent: 62, yPercent: 12, spanPx: 88, variant: 'crane' },
  ],
  'creator.autumn-farm': [
    { id: 'farm-windmill-spin', kind: 'windmill-sails', xPercent: 37.3, yPercent: 12.6, sizePx: 66, durationSec: 24 },
    { id: 'farm-waterwheel', kind: 'waterwheel-rim', xPercent: 46.2, yPercent: 70.5, sizePx: 42, durationSec: 15 },
    { id: 'farm-pond-birds', kind: 'gliding-birds', xPercent: 72, yPercent: 74, spanPx: 64, variant: 'dove' },
  ],
};

export function resolveWorldLandmarks(habitatId: string): readonly WorldScenicLandmark[] {
  return LANDMARKS_BY_HABITAT[habitatId] ?? [];
}

export function resolveWorldKineticProps(habitatId: string): readonly WorldKineticProp[] {
  return KINETIC_PROPS_BY_HABITAT[habitatId] ?? [];
}
