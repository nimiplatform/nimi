export interface ExperimentTemplate {
  dimensionId: string;
  title: string;
}

/**
 * Static micro-experiment templates per observation dimension.
 * Each experiment is a short, actionable, time-bounded suggestion
 * that parents can try and then observe the result.
 *
 * Covered dimensions: the 8 most commonly used across all age ranges.
 * No AI dependency — works fully offline.
 */
const EXPERIMENT_TEMPLATES: Record<string, string[]> = {
  'PO-OBS-CONC-001': [
    '今天选一段孩子自己玩的时间，试着在旁边安静坐 10 分钟，不打断、不引导，只观察',
    '准备两三样材料放在桌上，让孩子自己选，看看 ta 会沉浸多久',
    '下次孩子专注时，注意自己有没有想要打断的冲动，试着忍住',
    '如果孩子正在重复做一件事，不叫停，等 ta 自己结束后记录 ta 的表情',
  ],
  'PO-OBS-EMOT-001': [
    '今天孩子闹情绪时，先蹲下来和 ta 平视，等 10 秒再说话',
    '睡前和孩子一起回忆：今天最开心的事是什么？有没有不开心的事？',
    '下次孩子哭的时候，试着只说一句"我在这里"，看 ta 的反应',
    '和孩子一起给情绪起名字："你现在觉得是生气还是委屈？"',
  ],
  'PO-OBS-SOCL-001': [
    '带孩子去有同龄人的场合，在旁边观察 ta 怎么加入或回避互动',
    '下次孩子和小朋友起冲突，试着等 30 秒看 ta 们能不能自己解决',
    '在家模拟一个需要轮流的游戏，观察孩子等待时的反应',
    '问孩子："今天和谁玩了？你们做了什么？"看 ta 怎么描述',
  ],
  'PO-OBS-CHOI-001': [
    '今天给孩子两个选择（不是问"你想干嘛"），观察 ta 怎么决定',
    '让孩子自己决定今天穿什么，不评价 ta 的选择',
    '下次孩子说"我不要"时，问一句"那你想要什么？"',
    '准备三本书让孩子自己挑一本睡前读，看 ta 选择的过程',
  ],
  'PO-OBS-INDP-001': [
    '选一件孩子即将能独立完成的事（如穿鞋），今天只在旁边等，不动手帮',
    '让孩子自己倒水/盛饭，即使会洒，先看 ta 怎么做',
    '出门前给孩子 5 分钟自己准备，看 ta 能记住带哪些东西',
    '如果孩子说"我不会"，试着回答"你先试试看，我在旁边"',
  ],
  'PO-OBS-RELQ-001': [
    '今晚试一次 10 分钟的"不看手机陪伴"——让孩子决定你们一起做什么',
    '下次孩子说话时，放下手里的事，蹲下来认真听完再回应',
    '睡前和孩子说一句具体的肯定："今天你自己收拾了玩具，我很欣赏"',
    '和孩子发生冲突后，主动找 ta 修复："刚才妈妈/爸爸态度不好，对不起"',
    '今天试着问孩子一个开放问题："今天学校里有什么有意思的事吗？"',
  ],
  'PO-OBS-ATTC-001': [
    '出门前和孩子做一个固定的告别仪式（击掌、拥抱、特殊口号），看 ta 的分离反应',
    '孩子在新环境探索时，坐在可见的位置，不催促，看 ta 会不会回头确认你在',
    '下次孩子受委屈哭了，先抱一抱，不急着问"怎么了"',
    '和孩子一起建立一个专属的"安全信号"——当 ta 觉得不舒服时可以用的暗号',
  ],
  'PO-OBS-EXEC-001': [
    '让孩子自己规划明天的安排：先做什么、后做什么，晚上一起看 ta 的计划执行得怎样',
    '下次孩子做作业拖延时，问一句："你觉得这个需要多长时间？"',
    '给孩子一个需要两步以上才能完成的任务（如"先洗手再拿碗筷到桌上"），观察执行过程',
    '当孩子忘带东西时，不替 ta 解决，问"你觉得下次怎么才能记住？"',
  ],
};

/**
 * Pick one experiment suggestion for the given dimension.
 * Returns null if the dimension is not covered or dimensionId is null.
 */
export function getExperimentSuggestion(
  dimensionId: string | null,
): ExperimentTemplate | null {
  if (!dimensionId) return null;
  const templates = EXPERIMENT_TEMPLATES[dimensionId];
  if (!templates || templates.length === 0) return null;
  const index = Math.floor(Math.random() * templates.length);
  return { dimensionId, title: templates[index]! };
}
