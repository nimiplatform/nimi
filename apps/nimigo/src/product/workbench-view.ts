import type { NimiAppActivityRecord } from '@nimiplatform/sdk';
import type { Skill, Work } from './model';

export function nextWorkAction(work: Work): string {
  if (work.status === 'needs-input') return '回答搭档的问题';
  if (work.status === 'uncertain') return '核对执行结果';
  if (work.status === 'failed') return '查看问题并重试';
  if (work.status === 'review') return '继续完成交付';
  if (work.status === 'draft' && work.queuedInput) return '恢复这项委托';
  if (work.status === 'draft' || work.status === 'stopped') return '准备好后开始';
  return work.status === 'complete' ? '查看与使用成果' : '查看进展';
}

export function attentionWorks(works: readonly Work[]): Work[] {
  const rank: Partial<Record<Work['status'], number>> = { 'needs-input': 0, uncertain: 1, failed: 2, draft: 3, review: 4 };
  return works.filter(work => !work.archived && ((work.status !== 'draft' && rank[work.status] !== undefined) || (work.status === 'draft' && work.queuedInput)))
    .sort((a, b) => (rank[a.status] ?? 4) - (rank[b.status] ?? 4) || b.updatedAt.localeCompare(a.updatedAt));
}

export function skillPresentation(skill: Skill) {
  const defaults: Record<string, { materials: string; result: string }> = {
    brief: { materials: '原始笔记、参考资料，以及受众和交付要求', result: '结构清楚、标明来源的完整文稿' },
    decision: { materials: '备选方案、约束、可核对的事实与数据', result: '包含比较、建议与下一步的决策备忘录' },
    review: { materials: '已有稿件、原始目标，以及本次修改意见', result: '具体问题清单与保留旧版的完整修订稿' },
    weekly: { materials: '项目成果、相关应用动态与本周关注点', result: '区分事实、风险与建议的进展简报' },
  };
  return {
    materials: skill.materials || defaults[skill.id]?.materials || '交付目标、相关资料与需要参考的已有成果',
    result: skill.result || defaults[skill.id]?.result || '按此方法保存、可继续编辑的成果',
  };
}

export function visibleActivities(records: readonly NimiAppActivityRecord[], includeRuntime = false, query = '') {
  const search = query.trim().toLocaleLowerCase();
  return records.filter(record => (includeRuntime || record.source.kind === 'app')
    && (!search || `${record.title} ${record.summary || ''} ${record.source.displayName || ''}`.toLocaleLowerCase().includes(search)))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
