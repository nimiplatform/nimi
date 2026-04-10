/**
 * Preset pediatric drug dictionary — "cold start" data.
 * Each entry includes: generic name, brand, default unit, default frequency,
 * pinyin initials for fuzzy search, and optional quick-reference tags.
 *
 * IMPORTANT: Tags are labeled "常见用法参考" (common usage reference),
 * NOT medical advice. Per AI boundary (Layer 2), individual dosing
 * recommendations are deferred to professionals.
 *
 * `aliases` field is reserved for future OCR normalization.
 */

export interface PediatricDrug {
  /** Unique key */
  id: string;
  /** Generic / brand display name */
  name: string;
  /** Full generic name in parentheses */
  generic?: string;
  /** Default dosage unit */
  unit: string;
  /** Alternative units */
  altUnits?: string[];
  /** Default frequency text */
  frequency: string;
  /** Pinyin initials for fuzzy matching (lowercase) */
  py: string;
  /** Quick-reference tags (NOT medical advice) */
  tags?: string[];
  /** Aliases for OCR normalization (future) */
  aliases?: string[];
}

export const PEDIATRIC_DRUGS: PediatricDrug[] = [
  // ── 退烧/镇痛 ──
  {
    id: 'ibuprofen-susp', name: '美林', generic: '布洛芬混悬液',
    unit: 'ml', altUnits: ['滴'], frequency: '每6-8小时一次',
    py: 'ml', tags: ['体温>38.5℃时使用', '间隔6小时以上'],
    aliases: ['布洛芬', '美林布洛芬'],
  },
  {
    id: 'acetaminophen-susp', name: '泰诺林', generic: '对乙酰氨基酚混悬滴剂',
    unit: 'ml', altUnits: ['滴'], frequency: '每4-6小时一次',
    py: 'tnl', tags: ['体温>38.5℃时使用', '间隔4小时以上', '可与布洛芬交替'],
    aliases: ['对乙酰氨基酚', '扑热息痛'],
  },

  // ── 抗生素 ──
  {
    id: 'amoxicillin-gran', name: '阿莫西林颗粒', generic: '阿莫西林',
    unit: '包', altUnits: ['袋', 'g'], frequency: '每日3次',
    py: 'amxl', aliases: ['阿莫西林'],
  },
  {
    id: 'cefaclor-susp', name: '头孢克洛干混悬剂', generic: '头孢克洛',
    unit: '包', altUnits: ['袋'], frequency: '每日3次',
    py: 'tbklghxj', aliases: ['头孢克洛', '希刻劳'],
  },
  {
    id: 'azithromycin-susp', name: '阿奇霉素干混悬剂', generic: '阿奇霉素',
    unit: '包', altUnits: ['袋', 'ml'], frequency: '每日1次，连用3天',
    py: 'aqms', tags: ['饭前1小时或饭后2小时服用'],
    aliases: ['阿奇霉素', '希舒美'],
  },

  // ── 感冒/呼吸道 ──
  {
    id: 'yitanjing', name: '易坦静', generic: '氨溴特罗口服液',
    unit: 'ml', frequency: '每日2次',
    py: 'ytj', tags: ['化痰止咳', '饭后服用'],
    aliases: ['氨溴特罗'],
  },
  {
    id: 'bairui-gran', name: '百蕊颗粒',
    unit: '包', altUnits: ['袋'], frequency: '每日3次',
    py: 'brkl', tags: ['清热消炎'],
  },
  {
    id: 'pudilan-oral', name: '蒲地蓝消炎口服液',
    unit: '支', frequency: '每日3次',
    py: 'pdlxykfy', tags: ['清热解毒'],
  },
  {
    id: 'xiaoer-chaigan', name: '小儿柴桂退热颗粒',
    unit: '包', altUnits: ['袋'], frequency: '每日3次',
    py: 'xecgtrkl',
  },

  // ── 消化 ──
  {
    id: 'montmorillonite', name: '蒙脱石散', generic: '思密达',
    unit: '包', altUnits: ['袋'], frequency: '每日3次',
    py: 'mtss', tags: ['饭前服用', '止泻'],
    aliases: ['思密达', '蒙脱石'],
  },
  {
    id: 'probiotics', name: '妈咪爱', generic: '枯草杆菌二联活菌颗粒',
    unit: '包', altUnits: ['袋'], frequency: '每日1-2次',
    py: 'mma', tags: ['温水冲服，≤40℃', '调节肠道菌群'],
    aliases: ['枯草杆菌', '妈咪爱'],
  },
  {
    id: 'domperidone-susp', name: '多潘立酮混悬液', generic: '吗丁啉',
    unit: 'ml', frequency: '每日3次，饭前',
    py: 'dpldhxy', aliases: ['吗丁啉', '多潘立酮'],
  },
  {
    id: 'kaisailu', name: '开塞露', generic: '甘油灌肠剂',
    unit: '支', frequency: '必要时使用',
    py: 'ksl', tags: ['便秘时使用', '非长期用药'],
  },

  // ── 过敏/皮肤 ──
  {
    id: 'cetirizine-drops', name: '仙特明', generic: '盐酸西替利嗪滴剂',
    unit: '滴', altUnits: ['ml'], frequency: '每日1次',
    py: 'xtm', tags: ['抗过敏', '睡前服用'],
    aliases: ['西替利嗪', '仙特明'],
  },
  {
    id: 'loratadine-syrup', name: '氯雷他定糖浆', generic: '开瑞坦',
    unit: 'ml', frequency: '每日1次',
    py: 'lltdtp', aliases: ['氯雷他定', '开瑞坦'],
  },
  {
    id: 'calamine-lotion', name: '炉甘石洗剂',
    unit: '次', frequency: '每日2-3次，外涂',
    py: 'lgsx', tags: ['止痒', '外用', '皮肤干燥后涂抹'],
  },

  // ── 维生素/营养 ──
  {
    id: 'vitamin-d-drops', name: '维生素D滴剂', generic: '伊可新/星鲨',
    unit: '粒', altUnits: ['滴', 'IU'], frequency: '每日1次',
    py: 'wssd', tags: ['400IU/日常规补充'],
    aliases: ['伊可新', '星鲨', 'VD'],
  },
  {
    id: 'iron-supplement', name: '右旋糖酐铁口服液',
    unit: 'ml', frequency: '每日1-2次',
    py: 'yxtgtk', tags: ['补铁', '饭后服用'],
  },
  {
    id: 'calcium-gran', name: '碳酸钙颗粒', generic: '迪巧/钙尔奇',
    unit: '包', altUnits: ['袋', '片'], frequency: '每日1次',
    py: 'tsglkl', aliases: ['迪巧', '钙尔奇'],
  },

  // ── 外用 ──
  {
    id: 'mupirocin-oint', name: '莫匹罗星软膏', generic: '百多邦',
    unit: '次', frequency: '每日2-3次，外涂',
    py: 'mplxrg', tags: ['外用', '创面感染'],
    aliases: ['百多邦', '莫匹罗星'],
  },
  {
    id: 'erythromycin-oint', name: '红霉素眼膏',
    unit: '次', frequency: '每日2-3次',
    py: 'hmsyg', tags: ['外用', '眼部感染'],
  },

  // ── 雾化 ──
  {
    id: 'budesonide-neb', name: '布地奈德雾化液', generic: '普米克令舒',
    unit: '支', altUnits: ['ml'], frequency: '每日2次，雾化吸入',
    py: 'bdndwhy', tags: ['雾化', '喘息/哮喘'],
    aliases: ['普米克', '布地奈德'],
  },
  {
    id: 'salbutamol-neb', name: '沙丁胺醇雾化液', generic: '万托林',
    unit: '支', altUnits: ['ml'], frequency: '必要时雾化',
    py: 'sdacwhy', tags: ['雾化', '急性喘息'],
    aliases: ['万托林', '沙丁胺醇'],
  },
];

/**
 * Fuzzy-match drugs by name, generic, pinyin initials, or aliases.
 * Returns matched drugs sorted by relevance.
 */
export function matchDrugs(query: string, drugs: PediatricDrug[]): PediatricDrug[] {
  if (!query.trim()) return drugs;
  const q = query.trim().toLowerCase();
  return drugs.filter((d) =>
    d.name.toLowerCase().includes(q) ||
    d.generic?.toLowerCase().includes(q) ||
    d.py.includes(q) ||
    d.aliases?.some((a) => a.toLowerCase().includes(q)),
  );
}
