import type { Language, MaterialKind, SkillDefinition, SkillOverride } from './types.js';

type LocalizedText = Readonly<Record<Language, string>>;

type BuiltInSkill = {
  readonly id: string;
  readonly icon: string;
  readonly name: LocalizedText;
  readonly purpose: LocalizedText;
  readonly request: LocalizedText;
  readonly instructions: LocalizedText;
  readonly tools: readonly string[];
  readonly materials: readonly MaterialKind[];
};

export const MORNING_CARE_SKILL = 'morning-care';
export const EVENING_WRAP_SKILL = 'evening-wrap';
export const WEEK_PLAN_SKILL = 'week-plan';
export const CARE_REVIEW_SKILL = 'care-review';

/** A skill whose request names one person or area ({circle}); starting it asks whom it is about. */
export function skillNeedsFocus(skill: { readonly request: string }): boolean {
  return skill.request.includes('{circle}');
}
/** Everyday conversation on duty: not listed as a skill, it lets the agent act on what the user says. */
export const CHAT_SKILL = 'chat';

const BUILT_IN_SKILLS: readonly BuiltInSkill[] = [
  {
    id: MORNING_CARE_SKILL,
    icon: 'sunrise',
    name: { zh: '晨间照看', en: 'Morning care' },
    purpose: {
      zh: '看看今天：到点的事、需要准备的事、其他 App 的新变化，挑出今天最要紧的几件。',
      en: "Look over today: what's due, what needs preparing and what changed elsewhere, then pick the few things that matter most.",
    },
    request: { zh: '帮我看看今天有什么需要照看的。', en: 'Take a look at what needs looking after today.' },
    instructions: {
      zh: [
        '1. 先看今天的安排、已经过期的事和等我决定的事；需要更完整的信息时用 day_list_items。',
        '2. 用 day_recent_changes 看看各照看对象的新变化。分清提醒、事实记录和 App 的解读，不要把解读当成结论。',
        '3. 挑出今天最需要注意的 1–3 件事，说明原因和建议的时间点。',
        '4. 发现明显缺少的准备或提醒，可以用 day_create_item / day_update_item 直接安排，并在回复里说清改了什么；拿不准我的意愿时用 day_ask_user 留个问题，不要替我决定。',
        '5. 回复简短、先说结论再列事项；只使用资料和工具结果里的事实。',
      ].join('\n'),
      en: [
        '1. Start with today\'s plan, overdue items and decisions waiting on me; use day_list_items when you need more.',
        '2. Check new changes for each person or area with day_recent_changes. Keep reminders, factual records and an app\'s interpretations apart; never treat an interpretation as a conclusion.',
        '3. Pick the 1–3 things that matter most today, with a reason and a suggested time.',
        '4. If a preparation or reminder is clearly missing, arrange it with day_create_item / day_update_item and say what you changed. When unsure what I want, leave a question with day_ask_user instead of deciding for me.',
        '5. Keep the reply short: conclusion first, then the list. Use only facts from the material and tool results.',
      ].join('\n'),
    },
    tools: ['day_list_items', 'day_list_circles', 'day_recent_changes', 'day_read_handbook', 'day_create_item', 'day_update_item', 'day_ask_user'],
    materials: ['today', 'overdue', 'waiting', 'recent-sources', 'circles'],
  },
  {
    id: EVENING_WRAP_SKILL,
    icon: 'moon',
    name: { zh: '晚间收尾', en: 'Evening wrap-up' },
    purpose: {
      zh: '回顾今天做完了什么、还剩什么，把没做完的事放到合适的时间，安心休息。',
      en: "Review what got done and what's left, move unfinished things to a sensible time, and rest easy.",
    },
    request: { zh: '帮我收个尾，看看今天还剩什么。', en: "Help me wrap up the day and see what's left." },
    instructions: {
      zh: [
        '1. 先肯定今天已经完成的事，再看还没完成的事。',
        '2. 对没完成的事给出建议：改到明天、本周某天，或者不再需要。只有我已经表达过意愿时才直接改期；否则用 day_ask_user 列出选项。',
        '3. 提醒明早需要提前准备的事情。',
        '4. 语气放松，帮助我结束这一天。',
      ].join('\n'),
      en: [
        '1. Acknowledge what I finished today, then look at what is still open.',
        '2. Suggest what to do with each unfinished item: move it to tomorrow, later this week, or drop it. Reschedule directly only when I have already said what I want; otherwise offer options with day_ask_user.',
        '3. Point out anything that needs preparing for tomorrow morning.',
        '4. Keep a relaxed tone that helps me close the day.',
      ].join('\n'),
    },
    tools: ['day_list_items', 'day_update_item', 'day_complete_item', 'day_create_item', 'day_ask_user'],
    materials: ['today', 'overdue', 'recent-done'],
  },
  {
    id: WEEK_PLAN_SKILL,
    icon: 'calendar-range',
    name: { zh: '一周家庭安排', en: 'Week ahead' },
    purpose: {
      zh: '梳理未来 7 天的约定和事项，找出冲突、过满的日子和需要提前准备的事。',
      en: 'Lay out the next 7 days, spotting clashes, overloaded days and things to prepare early.',
    },
    request: { zh: '帮我看看这一周怎么安排。', en: 'Help me plan the week ahead.' },
    instructions: {
      zh: [
        '1. 按天梳理未来 7 天的约定和到期事项。',
        '2. 找出时间冲突、同一天事情过多、需要提前准备（采购、预约、带东西）的地方。',
        '3. 为需要准备的事创建带提醒的事项，时间放在前一天或当天早上。',
        '4. 有冲突时列出选项请我决定（day_ask_user）。',
        '5. 最后给一段简短的本周概览。',
      ].join('\n'),
      en: [
        '1. Go day by day through appointments and due items for the next 7 days.',
        '2. Find clashes, overloaded days and things that need preparing (shopping, bookings, things to bring).',
        '3. Create reminders for preparations, the day before or that morning.',
        '4. When there is a clash, offer options with day_ask_user.',
        '5. Finish with a short overview of the week.',
      ].join('\n'),
    },
    tools: ['day_list_items', 'day_list_circles', 'day_read_handbook', 'day_create_item', 'day_update_item', 'day_ask_user'],
    materials: ['week', 'circles', 'handbook', 'waiting'],
  },
  {
    id: 'visit-prep',
    icon: 'clipboard-check',
    name: { zh: '约定前准备', en: 'Appointment prep' },
    purpose: {
      zh: '为看医生、家长会、办事等约定做准备：带什么、问什么、什么时候出发。',
      en: 'Get ready for a doctor visit, school meeting or errand: what to bring, what to ask, when to leave.',
    },
    request: { zh: '帮我为接下来的约定做准备。', en: 'Help me prepare for my next appointment.' },
    instructions: {
      zh: [
        '1. 找到我指定的或最近的一个约定类事项。',
        '2. 结合家庭手册和相关来源记录，列出要带的东西、想问的问题、需要提前确认的事。',
        '3. 为出发前的准备创建提醒（例如前一晚准备材料、出发前 30 分钟）。',
        '4. 值得长期保存的信息（例如医生的建议），在我确认后用 day_save_note 记进家庭手册。',
      ].join('\n'),
      en: [
        '1. Find the appointment I named, or the nearest one.',
        '2. Using the handbook and related records, list what to bring, questions to ask and things to confirm beforehand.',
        '3. Create reminders for the preparation (e.g. the evening before, 30 minutes before leaving).',
        '4. Save information worth keeping (such as a doctor\'s advice) with day_save_note once I confirm.',
      ].join('\n'),
    },
    tools: ['day_list_items', 'day_read_handbook', 'day_recent_changes', 'day_create_item', 'day_save_note', 'day_ask_user'],
    materials: ['week', 'handbook', 'recent-sources'],
  },
  {
    id: 'shopping-list',
    icon: 'shopping-basket',
    name: { zh: '采购清单', en: 'Shopping list' },
    purpose: {
      zh: '从事项、约定和家庭手册里整理一份按类别分好的采购清单。',
      en: 'Gather a categorized shopping list from your items, appointments and handbook.',
    },
    request: { zh: '帮我整理一份采购清单。', en: 'Put together a shopping list for me.' },
    instructions: {
      zh: [
        '1. 从未完成的事项、近期约定和家庭手册（过敏、偏好、常用品）中找出需要买的东西。',
        '2. 合并重复，按类别分组（食品、日用、孩子、药品等）。',
        '3. 我同意后，把清单保存成一个事项（清单放在备注里），并设一个合适的提醒。',
      ].join('\n'),
      en: [
        '1. Find what needs buying from open items, upcoming appointments and the handbook (allergies, preferences, staples).',
        '2. Merge duplicates and group by category (food, household, kids, medicine…).',
        '3. Once I agree, save the list as one item (list in the notes) with a sensible reminder.',
      ].join('\n'),
    },
    tools: ['day_list_items', 'day_read_handbook', 'day_create_item', 'day_ask_user'],
    materials: ['week', 'handbook'],
  },
  {
    id: 'occasions',
    icon: 'gift',
    name: { zh: '生日与纪念日', en: 'Birthdays & occasions' },
    purpose: {
      zh: '提前为生日、纪念日和节日安排礼物、预订和联络。',
      en: 'Plan gifts, bookings and calls for birthdays, anniversaries and holidays in good time.',
    },
    request: { zh: '看看最近有没有需要准备的生日或纪念日。', en: 'Check whether any birthdays or occasions are coming up.' },
    instructions: {
      zh: [
        '1. 查看未来几周的生日、纪念日和节日事项，以及家庭手册里相关的偏好。',
        '2. 为每个场合给出准备时间线：礼物、预订、联络、当天安排。',
        '3. 需要提前动手的，创建带提醒的事项；需要我挑选的，用 day_ask_user 给出选项。',
      ].join('\n'),
      en: [
        '1. Look at birthdays, anniversaries and holidays in the coming weeks, plus related preferences in the handbook.',
        '2. For each occasion, propose a timeline: gift, booking, calls, the day itself.',
        '3. Create reminders for things to start early; offer choices with day_ask_user when I should pick.',
      ].join('\n'),
    },
    tools: ['day_list_items', 'day_read_handbook', 'day_list_circles', 'day_create_item', 'day_ask_user'],
    materials: ['week', 'handbook', 'circles'],
  },
  {
    id: 'catch-up',
    icon: 'inbox',
    name: { zh: '整理新变化', en: 'Catch up on changes' },
    purpose: {
      zh: '把其他 App 的新变化归到对应的家人或领域，分清哪些要处理、哪些只是记录。',
      en: 'Sort new changes from other apps under the right person or area, separating what needs action from what is just a record.',
    },
    request: { zh: '帮我整理一下最近的新变化。', en: 'Help me catch up on recent changes.' },
    instructions: {
      zh: [
        '1. 用 day_recent_changes 读取近期变化。',
        '2. 按照看对象归类，分成：需要处理的提醒、事实记录、App 的解读。',
        '3. 需要到源 App 完成的（例如在 ParentOS 记录身高体重），说明去哪里完成，不要说成已经完成。',
        '4. 需要跟进的事可以创建事项。',
      ].join('\n'),
      en: [
        '1. Read recent changes with day_recent_changes.',
        '2. Group them by person or area into: reminders to act on, factual records, and app interpretations.',
        '3. When something must be done in its source app (e.g. logging height in ParentOS), say where to do it; never claim it is done.',
        '4. Create items for anything that needs following up.',
      ].join('\n'),
    },
    tools: ['day_recent_changes', 'day_list_circles', 'day_list_items', 'day_create_item', 'day_ask_user'],
    materials: ['recent-sources', 'circles'],
  },
  {
    id: CARE_REVIEW_SKILL,
    icon: 'heart-handshake',
    name: { zh: '照看回顾', en: 'Check-in' },
    purpose: {
      zh: '针对一位家人或一个生活领域，回顾近况、未完成的事和下一步。',
      en: 'Review one person or area of life: how things are, what is open, and what comes next.',
    },
    request: { zh: '帮我看看「{circle}」最近怎么样。', en: 'How are things with "{circle}" lately?' },
    instructions: {
      zh: [
        '1. 只关注我指定的照看对象：它的关注点、事项、家庭手册条目和来源变化。',
        '2. 说说近况和值得注意的地方，区分事实与推测。',
        '3. 建议接下来一两周的 1–3 个行动；我同意的可以直接建成事项。',
        '4. 有值得长期记住的信息，在我确认后记进家庭手册。',
      ].join('\n'),
      en: [
        '1. Focus only on the person or area I named: its concerns, items, handbook entries and source changes.',
        '2. Describe how things are and what deserves attention, separating facts from guesses.',
        '3. Suggest 1–3 actions for the next week or two; create items for the ones I agree to.',
        '4. Save lasting information to the handbook once I confirm.',
      ].join('\n'),
    },
    tools: ['day_list_items', 'day_read_handbook', 'day_recent_changes', 'day_create_item', 'day_save_note', 'day_ask_user'],
    materials: ['circles', 'handbook', 'recent-sources', 'week'],
  },
];

export function builtInSkillIds(): readonly string[] {
  return BUILT_IN_SKILLS.map((skill) => skill.id);
}

function builtInDefinition(skill: BuiltInSkill, language: Language, override: SkillOverride | undefined): SkillDefinition {
  return {
    id: skill.id,
    builtIn: true,
    icon: skill.icon,
    name: skill.name[language],
    purpose: skill.purpose[language],
    instructions: override?.instructions ?? skill.instructions[language],
    request: override?.request ?? skill.request[language],
    tools: skill.tools,
    materials: skill.materials,
    enabled: override?.enabled ?? true,
    updatedAt: override?.updatedAt ?? null,
    lessons: override?.lessons ?? [],
  };
}

/** Built-in skills with the user's adjustments, followed by the user's own skills. */
export function resolveSkills(
  language: Language,
  overrides: readonly SkillOverride[],
  custom: readonly SkillDefinition[],
): SkillDefinition[] {
  const byId = new Map(overrides.map((override) => [override.skillId, override]));
  return [
    ...BUILT_IN_SKILLS.map((skill) => builtInDefinition(skill, language, byId.get(skill.id))),
    ...custom,
  ];
}

export function defaultSkillText(skillId: string, language: Language): { instructions: string; request: string } | null {
  const skill = BUILT_IN_SKILLS.find((candidate) => candidate.id === skillId);
  return skill ? { instructions: skill.instructions[language], request: skill.request[language] } : null;
}

export function isSkillAdjusted(skillId: string, overrides: readonly SkillOverride[]): boolean {
  const override = overrides.find((candidate) => candidate.skillId === skillId);
  return Boolean(override && (override.instructions !== undefined || override.request !== undefined));
}

/** Tools a user-authored skill can offer its agent. */
export const CUSTOM_SKILL_TOOLS: readonly string[] = [
  'day_list_items',
  'day_list_circles',
  'day_read_handbook',
  'day_recent_changes',
  'day_create_item',
  'day_update_item',
  'day_complete_item',
  'day_ask_user',
  'day_save_note',
];

export const CUSTOM_SKILL_MATERIALS: readonly MaterialKind[] = ['today', 'week', 'waiting', 'circles', 'handbook', 'recent-sources'];

const CHAT_INSTRUCTIONS: LocalizedText = {
  zh: [
    '用户正在 NimiDay 里和你说话。像平常一样回应；需要时用 NimiDay 的生活技能把事情落实：',
    '- 让你记下、安排或提醒某件事时，一定先调用 day_create_item（说了时间就填日期和时间，重要的事标 important），看到成功结果后再告诉用户；要改已有事项用 day_update_item，做完了用 day_complete_item。只在嘴上答应不会产生任何提醒。',
    '- 问到安排、照看对象、家庭手册或其他 App 的提醒时，先用对应工具查，不要凭印象回答。',
    '- 新建之前先看资料里有没有同一件事（比如同一天的同类事项）；已经有了就用 day_update_item 调整那一条，不要重复新建。',
    '- 值得长期记住的家庭信息（过敏、习惯、联系人等）用 day_save_note 记进手册。',
    '- 拿不准用户的意思就直接问；需要用户稍后决定的事用 day_ask_user 留下问题，不要替用户决定。',
    '- 只是聊天时就正常聊天，不必调用工具。改了什么，要在回复里说清楚。',
  ].join('\n'),
  en: [
    'The user is talking with you in NimiDay. Reply as you normally would, and use NimiDay\'s everyday skills when something should actually get done:',
    '- When asked to note, arrange or remind about something, always call day_create_item first (fill in the date and time when given; mark important things important) and tell the user only after it succeeded. Use day_update_item to change an item and day_complete_item when it is done. A promise in words creates no reminder.',
    '- For questions about plans, the people and areas being looked after, the household handbook or reminders from other apps, check with the matching tool instead of answering from memory.',
    '- Before adding, check the material for the same thing (for example a similar item on the same day); if it is already there, adjust it with day_update_item instead of adding a duplicate.',
    '- Household facts worth keeping (allergies, habits, contacts) go into the handbook with day_save_note.',
    '- If you are unsure what the user means, ask. Leave decisions for later with day_ask_user; never decide for the user.',
    '- If it is just a chat, simply chat; no tools needed. Always say what you changed.',
  ].join('\n'),
};

export function chatSkill(language: Language): SkillDefinition {
  return {
    id: CHAT_SKILL,
    builtIn: true,
    icon: 'message-circle',
    name: language === 'zh' ? '对话' : 'Conversation',
    purpose: language === 'zh' ? '在对话中帮你记下、查找和安排。' : 'Notes, looks up and arranges things during a conversation.',
    instructions: CHAT_INSTRUCTIONS[language],
    request: '',
    tools: CUSTOM_SKILL_TOOLS,
    // Other apps' open reminders too, so an arrangement made in conversation can name the reminder it is for.
    materials: ['today', 'overdue', 'week', 'circles', 'recent-sources'],
    enabled: true,
    updatedAt: null,
    lessons: [],
  };
}
