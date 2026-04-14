/**
 * Guided prompts for journal entries triggered from stage focus reminders.
 *
 * When a user clicks "去记录" from a reminder, the journal shows topic-specific
 * guided questions instead of the generic prompt. The answers become structured
 * observation data stored in the `guidedAnswers` field.
 *
 * Map: ruleId → guided questions (2-3 per rule).
 */

const RULE_PROMPTS: Record<string, string[]> = {
  // ── Relationship (亲子关系) ──
  'PO-REM-REL-001': [
    '今天孩子哭闹或呼唤时，你大概多久做出了回应？',
    '你回应后孩子的情绪变化是怎样的？',
  ],
  'PO-REM-REL-002': [
    '今天有没有孩子自己探索/玩耍时你在旁边但没有干预的时刻？',
    '孩子在探索中遇到困难时，你做了什么？',
  ],
  'PO-REM-REL-003': [
    '今天孩子有哪些事想要自己做？',
    '你是怎么回应他"我自己来"的？结果怎样？',
  ],
  'PO-REM-REL-004': [
    '最近一次孩子犯错时，你说的第一句话是什么？',
    '孩子听到后的反应是什么？如果重来你会怎么说？',
  ],
  'PO-REM-REL-005': [
    '最近和孩子发生过冲突吗？事后你们是怎么和好的？',
    '孩子在冲突后的情绪恢复大概需要多久？',
  ],
  'PO-REM-REL-006': [
    '这周你和孩子的对话中，有多少是关于学习/作业的？有多少是关于他感兴趣的事？',
    '最近有没有一次你只是听孩子说，没有评价或建议？他说了什么？',
  ],
  'PO-REM-REL-007': [
    '最近孩子有没有"不想说"的时候？你是怎么应对的？',
    '你觉得他的沉默是在思考、难过、还是保护隐私？',
  ],
  'PO-REM-REL-008': [
    '你和孩子之间有没有一个纯粹的、没有教育目的的共同活动？',
    '最近一次"无目的共处"是什么时候？做了什么？',
  ],
  'PO-REM-REL-009': [
    '最近孩子跟你说一件事时，你有没有忍住不马上评价？',
    '让他把话说完后，你最后回应了什么？他的反应如何？',
  ],
  'PO-REM-REL-010': [
    '最近一次批评孩子时，你用的是"你做错了"还是"你觉得怎样会更好"？',
    '孩子当时的反应是什么？情绪恢复需要多长时间？',
    '有没有尝试过让孩子自己评价自己的表现？效果如何？',
  ],
  'PO-REM-REL-011': [
    '孩子最近有没有关上房门的时候？你当时的感受和反应是什么？',
    '你觉得他是在拒绝你还是在建立自己的空间？',
  ],
  'PO-REM-REL-012': [
    '最近有没有在外人面前提到孩子的表现（表扬或批评）？',
    '孩子当时的反应是什么？事后有没有跟你提过？',
  ],
  'PO-REM-REL-013': [
    '最近你想教孩子的一件事是什么？你是用语言说的还是自己先做了示范？',
    '孩子有没有模仿过你的某个行为或习惯？是什么？',
  ],
  'PO-REM-REL-014': [
    '最近孩子做决定时，你是直接告诉他答案还是问他怎么想？',
    '有没有一次你忍住不给建议、让他自己决定的经历？结果如何？',
  ],
  'PO-REM-REL-015': [
    '你有没有跟孩子分享过你自己的困惑或不确定？',
    '分享后孩子的反应是什么？你们之间的关系有什么变化？',
  ],
  'PO-REM-REL-016': [
    '最近孩子主动找你聊天是什么时候？聊了什么？',
    '当时你正在做什么？你是怎么回应的？',
  ],

  // ── Emotional (情绪发展) ──
  'PO-REM-EMO-001': [
    '你为入园做了哪些准备？（如提前参观、讲故事等）',
    '孩子对即将上幼儿园表现出什么情绪？',
    '你打算在分离时用什么方式告别？',
  ],
  'PO-REM-EMO-002': [
    '你感受到孩子沟通方式的变化了吗？比如不愿意直接服从了？',
    '你是怎么调整自己的沟通方式的？从指令式到对话协商式，有什么具体尝试？',
    '效果如何？孩子的回应有什么不同？',
  ],

  // ── Sensitive periods (敏感期) ──
  'PO-REM-SEN-001': [
    '孩子最近有没有特别爱把东西放进嘴里？',
    '你给他提供了哪些可以安全啃咬/探索的物品？',
  ],
  'PO-REM-SEN-002': [
    '孩子最近对物品的位置、顺序有没有特别执着？',
    '当秩序被打乱时他的反应是什么？你怎么应对的？',
  ],
  'PO-REM-SEN-003': [
    '孩子最近学会了哪些新词或新的表达方式？',
    '你每天大约花多少时间和孩子对话或讲故事？',
  ],
  'PO-REM-SEN-004': [
    '孩子最近对哪些精细操作特别感兴趣？（如扣纽扣、画画、搭积木等）',
    '他能专注在这类活动上多长时间？',
  ],
  'PO-REM-SEN-005': [
    '孩子和同龄人在一起时表现怎样？主动社交还是观望为主？',
    '有没有发生社交冲突？他是怎么处理的？',
  ],

  // ── Sexuality education ──
  'PO-REM-SEX-001': [
    '孩子对自己的身体部位有过提问吗？你是怎么回答的？',
    '你有没有用绘本或日常机会进行身体认知教育？',
  ],
  'PO-REM-SEX-002': [
    '你打算什么时候和孩子聊身体即将发生的变化？',
    '你准备用什么方式解释？（对话、绘本、视频等）',
  ],

  // ── Digital (数字素养) ──
  'PO-REM-DIG-001': [
    '孩子每天的屏幕时间大概多久？主要看/玩什么？',
    '有没有设置屏幕时间规则？孩子执行得怎样？',
  ],
  'PO-REM-DIG-002': [
    '孩子有没有独自使用网络的情况？',
    '你们有没有讨论过网络安全规则？孩子的理解程度如何？',
  ],

  // ── Safety (安全) ──
  'PO-REM-SAF-001': [
    '家里有没有做过安全排查？（插座保护、桌角防护、柜子固定等）',
    '孩子最近会爬到了哪些新地方？有没有新的安全隐患？',
  ],
  'PO-REM-SAF-002': [
    '孩子会走后，家里有什么新的安全隐患需要处理？',
    '厨房、浴室、阳台等区域的安全措施做好了吗？',
  ],

  // ── Nutrition / Sleep / Hygiene ──
  'PO-REM-NUT-001': [
    '你准备或已经开始给孩子添加辅食了吗？添了什么？',
    '孩子对新食物的反应怎样？有没有过敏迹象？',
  ],
  'PO-REM-NUT-002': [
    '孩子每天有在补充维生素 D 吗？用的什么品牌/剂量？',
    '最近有没有做过维生素 D 相关的检查？',
  ],
  'PO-REM-SLP-001': [
    '宝宝的睡眠环境是否安全？（仰卧、无枕头/被子、床面坚实等）',
    '目前的睡眠作息是怎样的？',
  ],
  'PO-REM-SLP-002': [
    '孩子目前的入睡时间和起床时间大概是？',
    '有没有形成固定的睡前仪式？包含什么环节？',
  ],
  'PO-REM-HYG-001': [
    '孩子有没有表现出如厕训练的准备信号？（如对马桶感兴趣、会表达想尿尿等）',
    '你打算什么时候开始尝试？准备用什么方式？',
  ],

  // ── Independence / Values ──
  'PO-REM-IND-001': [
    '孩子目前能自己做哪些事？（穿衣、刷牙、收拾玩具等）',
    '你最近在培养他哪方面的自理能力？进展如何？',
  ],
  'PO-REM-IND-002': [
    '你给孩子零花钱了吗？怎么安排的？',
    '孩子对"存钱"和"花钱"有什么理解？',
  ],
  'PO-REM-VAL-001': [
    '孩子最近有没有表现出对别人情绪的关注？（如看到别人哭会问为什么）',
    '你怎么引导他理解别人的感受？',
  ],

  // ── Interest ──
  'PO-REM-INT-001': [
    '你给孩子创造了什么接触音乐的机会？（听歌、乐器、节奏游戏等）',
    '孩子对哪种音乐/乐器表现出特别的兴趣？',
  ],
  'PO-REM-INT-002': [
    '孩子最近最喜欢的运动或身体活动是什么？',
    '他每天大约有多少时间在做户外/运动活动？',
  ],
  'PO-REM-INT-003': [
    '孩子持续表现出兴趣的领域是什么？持续多久了？',
    '你有没有考虑为这个兴趣提供更系统的学习机会？',
  ],
};

export interface GuidedPromptContext {
  title: string;
  description: string;
  prompts: string[];
}

/**
 * Look up guided prompts for a reminder rule.
 * Returns null if no rule found or no prompts available.
 */
export function getGuidedPrompts(
  ruleId: string,
  rules: readonly { ruleId: string; title: string; description: string; actionType: string }[],
): GuidedPromptContext | null {
  const rule = rules.find((r) => r.ruleId === ruleId);
  if (!rule) return null;
  if (!['observe', 'read_guide', 'ai_consult'].includes(rule.actionType)) return null;

  const specific = RULE_PROMPTS[ruleId];
  if (specific) {
    return { title: rule.title, description: rule.description, prompts: specific };
  }

  // Fallback: generate generic prompts from rule content
  return {
    title: rule.title,
    description: rule.description,
    prompts: [
      `关于"${rule.title}"，你最近观察到孩子有什么相关的表现或变化？`,
      '你做了什么回应或调整？效果怎样？',
    ],
  };
}
