import type { AriaAttributes, ComponentType } from 'react';
import {
  Cloud,
  Database,
  FileText,
  Heart,
  Leaf,
} from 'lucide-react';

import { translateAgentCenter } from '../i18n.js';
import { agentCenterEnCatalog, getAgentCenterCatalogRecord } from '../locales/index.js';
import type {
  AgentCenterI18n,
  AgentCenterSession,
  AgentCenterSnapshot,
  AgentCenterState,
} from '../types.js';
import {
  Card,
  SectionHeader,
  SectionShell,
  cnAgentCenter,
} from './AgentCenterPrimitives.js';
import { AgentCenterProductActionNotice } from './AgentCenterProductActionNotice.js';

export interface AgentCenterCognitionSectionProps {
  readonly session: AgentCenterSession;
  readonly snapshot: AgentCenterSnapshot;
  readonly i18n?: AgentCenterI18n;
}

const LIFECYCLE_STATUS_DEFAULTS = getAgentCenterCatalogRecord('AgentCenter.cognition.lifecycle.');

const EMOTION_STATUS_DEFAULTS = getAgentCenterCatalogRecord('AgentCenter.cognition.emotion.');

function localizedProjectionValue(
  value: string | null | undefined,
  defaults: Record<string, string>,
  namespace: string,
  i18n?: AgentCenterI18n,
) {
  const normalized = value?.trim();
  if (!normalized) {
    return translateAgentCenter(i18n, 'AgentCenter.cognition.value.notProjected', agentCenterEnCatalog["AgentCenter.cognition.value.notProjected"]);
  }
  const key = normalized.toLowerCase();
  if (defaults[key]) {
    return translateAgentCenter(i18n, `AgentCenter.cognition.${namespace}.${key}`, defaults[key]);
  }
  return /[\u4e00-\u9fff]/u.test(normalized)
    ? normalized
    : translateAgentCenter(i18n, 'AgentCenter.cognition.value.projected', agentCenterEnCatalog["AgentCenter.cognition.value.projected"]);
}

function memoryStateLabel(state: AgentCenterState['cognition']['memoryState'], i18n?: AgentCenterI18n) {
  switch (state) {
    case 'ready':
      return translateAgentCenter(i18n, 'AgentCenter.cognition.memory.ready', agentCenterEnCatalog["AgentCenter.cognition.memory.ready"]);
    case 'empty':
      return translateAgentCenter(i18n, 'AgentCenter.cognition.memory.empty', agentCenterEnCatalog["AgentCenter.cognition.memory.empty"]);
    default:
      return translateAgentCenter(i18n, 'AgentCenter.cognition.memory.unavailable', agentCenterEnCatalog["AgentCenter.cognition.memory.unavailable"]);
  }
}

function hasCognitionProjection(cognition: AgentCenterState['cognition']) {
  return Boolean(
    cognition.lifecycleStatus
      || cognition.currentEmotion
      || cognition.statusText
      || cognition.recentCanonicalMemoryCount > 0
      || cognition.memoryState === 'ready'
      || cognition.memoryState === 'empty',
  );
}

export function AgentCenterCognitionSection({ session, snapshot, i18n }: AgentCenterCognitionSectionProps) {
  const cognition = snapshot.state.cognition;
  const availability = snapshot.availability.readMemorySummary;
  const hasProjection = hasCognitionProjection(cognition);
  const memoryLabel = memoryStateLabel(cognition.memoryState, i18n);
  const lifecycleLabel = localizedProjectionValue(
    cognition.lifecycleStatus,
    LIFECYCLE_STATUS_DEFAULTS,
    'lifecycle',
    i18n,
  );
  const emotionLabel = localizedProjectionValue(
    cognition.currentEmotion,
    EMOTION_STATUS_DEFAULTS,
    'emotion',
    i18n,
  );

  return (
    <SectionShell
      className="gap-3"
      labelledBy="agent-center-cognition-title"
    >
      <SectionHeader
        description={translateAgentCenter(i18n, 'AgentCenter.cognition.description', agentCenterEnCatalog["AgentCenter.cognition.description"])}
        id="agent-center-cognition-title"
        title={translateAgentCenter(i18n, 'AgentCenter.cognition.title', agentCenterEnCatalog["AgentCenter.cognition.title"])}
      />
      {availability.state === 'unavailable' ? (
        <AgentCenterProductActionNotice
          action="readMemorySummary"
          availability={availability}
          i18n={i18n}
          session={session}
        />
      ) : null}
      <div
        className="grid min-w-0 gap-3"
        data-agent-center-cognition-surface="read-only-projection"
      >
        <div data-agent-center-cognition-current="true">
          <Card className="p-4">
            <h3 className="m-0 text-[15px] font-semibold leading-[1.35] text-slate-950">
              {translateAgentCenter(i18n, 'AgentCenter.cognition.current.title', agentCenterEnCatalog["AgentCenter.cognition.current.title"])}
            </h3>
            <div className="mt-4 grid min-w-0 justify-items-center text-center">
              <div className="relative grid h-[82px] w-[140px] place-items-center text-violet-300">
                <Cloud aria-hidden="true" className="h-11 w-11 opacity-80" strokeWidth={1.8} />
                <span aria-hidden="true" className="absolute left-7 top-4 h-2 w-2 rounded-full bg-violet-300/75" />
                <span aria-hidden="true" className="absolute right-7 top-10 h-2.5 w-2.5 rounded-full bg-violet-300/75" />
                <span aria-hidden="true" className="absolute left-12 top-1 text-[22px] leading-none text-violet-300/70">*</span>
              </div>
              <strong className="text-[16px] font-semibold leading-[1.35] text-slate-950">
                {hasProjection
                  ? translateAgentCenter(i18n, 'AgentCenter.cognition.current.available', agentCenterEnCatalog["AgentCenter.cognition.current.available"])
                  : translateAgentCenter(i18n, 'AgentCenter.cognition.current.empty', agentCenterEnCatalog["AgentCenter.cognition.current.empty"])}
              </strong>
            </div>
            <div className="mt-5 grid min-w-0 grid-cols-1 gap-2.5 sm:grid-cols-3">
              <CognitionMetric
                icon={Leaf}
                label={translateAgentCenter(i18n, 'AgentCenter.cognition.lifecycle.label', agentCenterEnCatalog["AgentCenter.cognition.lifecycle.label"])}
                tone="emerald"
                value={lifecycleLabel}
              />
              <CognitionMetric
                icon={Heart}
                label={translateAgentCenter(i18n, 'AgentCenter.cognition.emotion.label', agentCenterEnCatalog["AgentCenter.cognition.emotion.label"])}
                tone="rose"
                value={emotionLabel}
              />
              <CognitionMetric
                icon={Database}
                label={translateAgentCenter(i18n, 'AgentCenter.cognition.memory.label', agentCenterEnCatalog["AgentCenter.cognition.memory.label"])}
                tone="violet"
                value={memoryLabel}
              />
            </div>
          </Card>
        </div>

        <div data-agent-center-cognition-memory="true">
          <Card className="p-4">
            <h3 className="m-0 text-[15px] font-semibold leading-[1.35] text-slate-950">
              {translateAgentCenter(i18n, 'AgentCenter.cognition.recentMemory.title', agentCenterEnCatalog["AgentCenter.cognition.recentMemory.title"])}
            </h3>
            <div
              className="mt-4 grid min-w-0 gap-2.5"
              role="list"
              aria-label={translateAgentCenter(i18n, 'AgentCenter.cognition.recentMemory.ariaLabel', agentCenterEnCatalog["AgentCenter.cognition.recentMemory.ariaLabel"])}
            >
              {cognition.recentCanonicalMemoryCount > 0 ? (
                <div
                  className="min-w-0 rounded-[12px] border border-slate-200 bg-white/90 p-3.5"
                  data-agent-center-cognition-memory-count={cognition.recentCanonicalMemoryCount}
                  role="listitem"
                >
                  <div className="min-w-0 text-[13px] font-semibold leading-[1.55] text-slate-950">
                    {cognition.recentCanonicalMemoryCount}
                  </div>
                </div>
              ) : (
                <div className="flex min-w-0 items-center gap-3 rounded-[12px] border border-violet-200/60 bg-violet-50/45 p-3.5">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px] bg-violet-100/70 text-violet-400">
                    <FileText aria-hidden="true" className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-[13.5px] font-semibold leading-[1.4] text-slate-950">
                      {translateAgentCenter(i18n, 'AgentCenter.cognition.recentMemory.empty', agentCenterEnCatalog["AgentCenter.cognition.recentMemory.empty"])}
                    </div>
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
