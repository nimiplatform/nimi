import type { AriaAttributes, ComponentType } from 'react';
import {
  Cloud,
  Database,
  FileText,
  Heart,
  Leaf,
} from 'lucide-react';

import type { AgentCenterState } from '../types.js';
import {
  Card,
  SectionHeader,
  SectionShell,
  cnAgentCenter,
} from './AgentCenterPrimitives.js';

export interface AgentCenterCognitionSectionProps {
  readonly state: AgentCenterState;
}

const LOCALIZED_LIFECYCLE_STATUS: Record<string, string> = {
  active: '活跃',
  blocked: '受阻',
  idle: '空闲',
  inactive: '未激活',
  offline: '离线',
  paused: '已暂停',
  ready: '就绪',
  sleeping: '休眠',
  starting: '启动中',
  stopped: '已停止',
  stopping: '停止中',
  suspended: '已暂停',
};

const LOCALIZED_EMOTION_STATUS: Record<string, string> = {
  angry: '生气',
  anxious: '紧张',
  calm: '平静',
  confused: '困惑',
  curious: '好奇',
  excited: '兴奋',
  focused: '专注',
  happy: '开心',
  neutral: '中性',
  sad: '低落',
  tired: '疲惫',
};

const LOCALIZED_MEMORY_CLASS: Record<string, string> = {
  dyadic: '双人关系',
  episodic: '情节记忆',
  fact: '事实',
  preference: '偏好',
  profile: '画像',
  relation: '关系',
  relationship: '关系',
  safety: '安全',
  semantic: '语义记忆',
  task: '任务',
};

const LOCALIZED_MEMORY_POLICY: Record<string, string> = {
  admitted_runtime: '运行时准入',
  'admitted-runtime': '运行时准入',
  memory_observatory: '记忆观测',
  'memory-observatory': '记忆观测',
  runtime_inspect: '运行时检查',
  'runtime-inspect': '运行时检查',
  runtime_projection: '运行时投影',
  'runtime-projection': '运行时投影',
};

function localizedProjectionValue(
  value: string | null | undefined,
  labels: Record<string, string>,
  fallback: string,
) {
  const normalized = value?.trim();
  if (!normalized) {
    return '尚未投影';
  }
  const key = normalized.toLowerCase();
  if (labels[key]) {
    return labels[key];
  }
  return /[\u4e00-\u9fff]/u.test(normalized) ? normalized : fallback;
}

function memoryStateLabel(state: AgentCenterState['cognition']['memoryState']) {
  switch (state) {
    case 'ready':
      return '可展示';
    case 'empty':
      return '暂无摘要';
    default:
      return '暂不可用';
  }
}

function hasCognitionProjection(cognition: AgentCenterState['cognition']) {
  return Boolean(
    cognition.lifecycleStatus
      || cognition.currentEmotion
      || cognition.statusText
      || cognition.recentCanonicalMemories.length > 0
      || cognition.memoryState === 'ready'
      || cognition.memoryState === 'empty',
  );
}

export function AgentCenterCognitionSection({ state }: AgentCenterCognitionSectionProps) {
  const cognition = state.cognition;
  const hasProjection = hasCognitionProjection(cognition);
  const memoryLabel = memoryStateLabel(cognition.memoryState);
  const lifecycleLabel = localizedProjectionValue(
    cognition.lifecycleStatus,
    LOCALIZED_LIFECYCLE_STATUS,
    '已投影',
  );
  const emotionLabel = localizedProjectionValue(
    cognition.currentEmotion,
    LOCALIZED_EMOTION_STATUS,
    '已投影',
  );

  return (
    <SectionShell
      className="gap-3"
      labelledBy="agent-center-cognition-title"
    >
      <SectionHeader
        description="查看这个伙伴当前可展示的状态、情绪与记忆摘要"
        id="agent-center-cognition-title"
        title="认知状态"
      />
      <div
        className="grid min-w-0 gap-3"
        data-agent-center-cognition-surface="read-only-projection"
      >
        <div data-agent-center-cognition-current="true">
          <Card className="p-4">
            <h3 className="m-0 text-[15px] font-semibold leading-[1.35] text-slate-950">当前认知状态</h3>
            <div className="mt-4 grid min-w-0 justify-items-center text-center">
              <div className="relative grid h-[82px] w-[140px] place-items-center text-violet-300">
                <Cloud aria-hidden="true" className="h-11 w-11 opacity-80" strokeWidth={1.8} />
                <span aria-hidden="true" className="absolute left-7 top-4 h-2 w-2 rounded-full bg-violet-300/75" />
                <span aria-hidden="true" className="absolute right-7 top-10 h-2.5 w-2.5 rounded-full bg-violet-300/75" />
                <span aria-hidden="true" className="absolute left-12 top-1 text-[22px] leading-none text-violet-300/70">*</span>
              </div>
              <strong className="text-[16px] font-semibold leading-[1.35] text-slate-950">
                {hasProjection ? '当前有可展示的认知投影' : '当前暂无认知投影'}
              </strong>
            </div>
            <div className="mt-5 grid min-w-0 grid-cols-1 gap-2.5 sm:grid-cols-3">
              <CognitionMetric
                icon={Leaf}
                label="生命周期"
                tone="emerald"
                value={lifecycleLabel}
              />
              <CognitionMetric
                icon={Heart}
                label="情绪投影"
                tone="rose"
                value={emotionLabel}
              />
              <CognitionMetric
                icon={Database}
                label="记忆状态"
                tone="violet"
                value={memoryLabel}
              />
            </div>
          </Card>
        </div>

        <div data-agent-center-cognition-memory="true">
          <Card className="p-4">
            <h3 className="m-0 text-[15px] font-semibold leading-[1.35] text-slate-950">最近记忆</h3>
            <div className="mt-4 grid min-w-0 gap-2.5" role="list" aria-label="最近规范记忆摘要">
              {cognition.recentCanonicalMemories.length > 0 ? cognition.recentCanonicalMemories.map((memory) => (
                <div
                  className="min-w-0 rounded-[12px] border border-slate-200 bg-white/90 p-3.5"
                  key={memory.memoryId}
                  role="listitem"
                >
                  <div className="min-w-0 text-[13px] font-semibold leading-[1.55] text-slate-950">{memory.summary}</div>
                  <div className="mt-1.5 min-w-0 text-[12px] leading-[1.45] text-slate-500">
                    {localizedProjectionValue(memory.canonicalClass, LOCALIZED_MEMORY_CLASS, '规范记忆')} · {localizedProjectionValue(memory.policyReason, LOCALIZED_MEMORY_POLICY, '运行时投影')}
                  </div>
                </div>
              )) : (
                <div className="flex min-w-0 items-center gap-3 rounded-[12px] border border-violet-200/60 bg-violet-50/45 p-3.5">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px] bg-violet-100/70 text-violet-400">
                    <FileText aria-hidden="true" className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-[13.5px] font-semibold leading-[1.4] text-slate-950">还没有可展示的记忆摘要</div>
                  </div>
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </SectionShell>
  );
}

type CognitionMetricTone = 'emerald' | 'rose' | 'violet';

const COGNITION_METRIC_TONE_CLASS: Record<CognitionMetricTone, string> = {
  emerald: 'bg-emerald-50 text-emerald-700',
  rose: 'bg-rose-50 text-rose-600',
  violet: 'bg-violet-50 text-violet-600',
};

function CognitionMetric(props: {
  readonly icon: ComponentType<{ className?: string; 'aria-hidden'?: AriaAttributes['aria-hidden'] }>;
  readonly label: string;
  readonly value: string;
  readonly tone: CognitionMetricTone;
}) {
  const Icon = props.icon;
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-[12px] border border-slate-200/90 bg-white/95 px-3 py-3">
      <span className={cnAgentCenter(
        'grid h-9 w-9 shrink-0 place-items-center rounded-[12px]',
        COGNITION_METRIC_TONE_CLASS[props.tone],
      )}>
        <Icon aria-hidden="true" className="h-[18px] w-[18px]" />
      </span>
      <span className="grid min-w-0 gap-0.5">
        <span className="min-w-0 truncate text-[12px] font-semibold leading-[1.35] text-slate-500">{props.label}</span>
        <strong className="min-w-0 truncate text-[13.5px] font-semibold leading-[1.35] text-slate-950">{props.value}</strong>
      </span>
    </div>
  );
}
