import { Component, Suspense, lazy, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import {
  DataFactCard,
  resolveChronologyValue,
  SectionShell,
  type XianxiaWorldData,
} from './world-detail-primitives.js';

const TimeFlowDynamics = lazy(() => import('./time-flow-dynamics').then((module) => ({
  default: module.TimeFlowDynamics,
})));
const WorldScoringMatrix = lazy(() => import('./world-scoring-matrix').then((module) => ({
  default: module.WorldScoringMatrix,
})));

function resolveProjectedWorldDate(
  world: Pick<XianxiaWorldData, 'currentWorldTime' | 'flowRatio' | 'isPaused'>,
  anchorNowMs: number,
  nowMs: number,
): Date | null {
  if (!world.currentWorldTime) {
    return null;
  }
  const anchor = new Date(world.currentWorldTime);
  if (Number.isNaN(anchor.getTime())) {
    return null;
  }
  if (world.isPaused) {
    return anchor;
  }
  const elapsedClientMs = Math.max(0, nowMs - anchorNowMs);
  return new Date(anchor.getTime() + elapsedClientMs * Math.max(0.0001, world.flowRatio || 1));
}

function WorldChronologyCard({ world }: { world: XianxiaWorldData }) {
  const { t } = useTranslation();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const anchorNowMsRef = useRef(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 80);
    return () => {
      window.clearInterval(timer);
    };
  }, []);

  const chronology = resolveChronologyValue(world);
  if (!chronology) {
    return null;
  }

  const projectedDate = resolveProjectedWorldDate(world, anchorNowMsRef.current, nowMs);
  if (!projectedDate) {
    return (
      <SectionShell
        title={t('WorldDetail.xianxia.v2.sidebar.chronology')}
        subtitle={t('WorldDetail.xianxia.v2.sidebar.chronologySubtitle')}
        className="h-full"
        dataTestId="world-detail-chronology-card"
      >
        <DataFactCard label={t('WorldDetail.xianxia.v2.sidebar.currentWorldTime')} value={chronology} />
      </SectionShell>
    );
  }

  const hour = projectedDate.getUTCHours();
  const minute = projectedDate.getUTCMinutes();
  const second = projectedDate.getUTCSeconds();
  const millisecond = projectedDate.getUTCMilliseconds();
  const flowRatio = Math.max(0.0001, world.flowRatio || 1);
  const flowPulse = (millisecond / 999) * 28;
  const flowWidth = Math.min(100, Math.max(24, (Math.log10(flowRatio + 1) / Math.log10(1000 + 1)) * 52 + flowPulse));

  return (
    <SectionShell
      title={t('WorldDetail.xianxia.v2.sidebar.chronology')}
      subtitle={t('WorldDetail.xianxia.v2.sidebar.chronologySubtitle')}
      className="h-full"
      dataTestId="world-detail-chronology-card"
    >
      <div
        className="relative overflow-hidden rounded-[22px] border border-white/12 bg-[linear-gradient(135deg,rgba(15,24,19,0.96),rgba(22,31,43,0.82))] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
      >
        <div
          className="pointer-events-none absolute inset-0 opacity-80"
          style={{
            background: 'radial-gradient(circle at top right, rgba(255,122,245,0.18), transparent 28%), radial-gradient(circle at left center, rgba(86,211,178,0.14), transparent 26%)',
          }}
        />
        <div className="relative">
          <div className="flex items-start justify-between gap-3">
            <span className="text-[10px] uppercase tracking-[0.22em] text-[#56D3B2]/78">
              {t('World.syncTicker')}
            </span>
            <span
              className="max-w-[72%] text-right text-[13px] font-semibold leading-relaxed text-white/92"
              style={{ textShadow: '1px 0 rgba(255,0,255,0.4), -0.75px 0 rgba(86,211,178,0.45)' }}
            >
              {chronology}
            </span>
          </div>

          <div className="mt-6 flex items-end text-white">
            <div className="font-mono text-[42px] font-black leading-none tracking-[-0.05em] text-white">
              {String(hour).padStart(2, '0')}:{String(minute).padStart(2, '0')}
            </div>
            <div className="ml-3 flex flex-col pb-1">
              <span className="text-xl leading-none text-[#56D3B2]">
                :{String(second).padStart(2, '0')}
              </span>
              <span className="mt-1 font-mono text-[11px] leading-none text-fuchsia-300/78">
                {String(millisecond).padStart(3, '0')}
              </span>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2.5">
            {world.eraLabel ? (
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-white/72">
                {world.eraLabel}
              </span>
            ) : null}
            <span className="rounded-full border border-[#4ECCA3]/12 bg-[#4ECCA3]/10 px-3 py-1 text-[11px] text-[#a6f7de]">
              {t('World.chronoFlow', { value: flowRatio.toFixed(1) })}
            </span>
          </div>

          <div className="mt-4 overflow-hidden rounded-full bg-white/8">
            <div
              className="h-[3px] rounded-full bg-[linear-gradient(90deg,#56D3B2_0%,#b6fff1_38%,#f197ff_100%)] shadow-[0_0_14px_rgba(86,211,178,0.55)]"
              style={{ width: `${flowWidth}%` }}
            />
          </div>
        </div>
      </div>
    </SectionShell>
  );
}

type CanvasCrashBoundaryProps = { children: ReactNode; fallback: ReactNode };
type CanvasCrashBoundaryState = { crashed: boolean };

class CanvasCrashBoundary extends Component<CanvasCrashBoundaryProps, CanvasCrashBoundaryState> {
  constructor(props: CanvasCrashBoundaryProps) {
    super(props);
    this.state = { crashed: false };
  }

  static getDerivedStateFromError(): CanvasCrashBoundaryState {
    return { crashed: true };
  }

  override render() {
    return this.state.crashed ? this.props.fallback : this.props.children;
  }
}

function WorldScoreMatrixFallback({ world }: { world: XianxiaWorldData }) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-[620px] flex-col gap-4 p-6">
      <div className="text-xs font-semibold uppercase tracking-widest text-[#4ECCA3]">
        {t('WorldDetail.section.scores', { defaultValue: 'World Scoring Matrix' })}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {([
          { label: t('WorldDetail.activity', { defaultValue: 'Activity' }), value: world.scoreA },
          { label: t('WorldDetail.consensus', { defaultValue: 'Consensus' }), value: world.scoreC },
          { label: t('WorldDetail.quality', { defaultValue: 'Quality' }), value: world.scoreQ },
          { label: t('WorldDetail.engagement', { defaultValue: 'Engagement' }), value: world.scoreE },
        ] as Array<{ label: string; value: number }>).map(({ label, value }) => (
          <div key={label} className="rounded-xl border border-[#4ECCA3]/18 bg-[#0a1210]/60 p-4 text-center">
            <div className="text-2xl font-bold text-[#4ECCA3]">{(value ?? 0).toFixed(0)}</div>
            <div className="mt-1 text-[10px] uppercase tracking-widest text-[#86f0ca]/60">{label}</div>
          </div>
        ))}
      </div>
      <div className="mt-auto rounded-xl border border-[#4ECCA3]/10 bg-[#0a1210]/40 p-4">
        <div className="text-[10px] uppercase tracking-widest text-[#4ECCA3]/70">
          {t('WorldDetail.comprehensiveIndex', { defaultValue: 'Comprehensive Index' })}
        </div>
        <div className="mt-1 text-2xl font-bold text-[#4ECCA3]">
          {(world.scoreEwma ?? 0).toFixed(2)}
        </div>
      </div>
    </div>
  );
}

function TimeFlowFallback({ world }: { world: XianxiaWorldData }) {
  const { t } = useTranslation();
  return (
    <div className="flex h-[200px] w-full flex-col items-center justify-center gap-2 rounded-xl border border-[#4ECCA3]/15 bg-[#0f1612]/40">
      <span className="font-mono text-4xl font-black text-[#4ECCA3]">
        {(world.flowRatio || 1).toFixed(1)}x
      </span>
      <span className="text-xs uppercase tracking-widest text-[#86f0ca]/50">
        {t('WorldDetail.xianxia.v2.visuals.timeFlowTitle')}
      </span>
    </div>
  );
}

export function WorldDashboardSection({
  world,
}: {
  world: XianxiaWorldData;
}) {
  const { t } = useTranslation();
  const hasChronology = Boolean(resolveChronologyValue(world));

  return (
    <section
      data-testid="world-detail-dashboard"
      className="relative overflow-hidden rounded-[24px] nimi-material-glass-thin border border-[#4ECCA3]/16 bg-[#101813]/82 backdrop-blur-[var(--nimi-backdrop-blur-thin)]"
    >
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#4ECCA3]/45 to-transparent" />
      <div className="absolute inset-y-0 right-0 w-[30%] bg-[radial-gradient(circle_at_center,rgba(78,204,163,0.12),transparent_68%)] opacity-70" />
      <div className="relative grid gap-5 p-5">
        <div className="grid gap-5 xl:grid-cols-12">
          <div className="col-span-12 xl:col-span-8">
            <section
              data-testid="world-detail-score-matrix-card"
              className="h-full overflow-hidden rounded-[22px] nimi-material-glass-thin border border-[#4ECCA3]/15 bg-[#0f1612]/82 backdrop-blur-[var(--nimi-backdrop-blur-thin)]"
            >
              <Suspense fallback={<WorldScoreMatrixFallback world={world} />}>
                <CanvasCrashBoundary fallback={<WorldScoreMatrixFallback world={world} />}>
                  <WorldScoringMatrix
                    data={{
                      scoreA: world.scoreA,
                      scoreC: world.scoreC,
                      scoreQ: world.scoreQ,
                      scoreE: world.scoreE,
                      scoreEwma: world.scoreEwma,
                    }}
                    className="min-h-[620px]"
                  />
                </CanvasCrashBoundary>
              </Suspense>
            </section>
          </div>

          <div className="col-span-12 xl:col-span-4">
            <div className={`grid gap-5 ${hasChronology ? 'xl:grid-rows-[300px_300px]' : ''}`}>
              <SectionShell
                title={t('WorldDetail.xianxia.v2.visuals.timeFlowTitle')}
                subtitle={t('WorldDetail.xianxia.v2.visuals.timeFlowSubtitle')}
                className="h-full min-h-[300px]"
                dataTestId="world-detail-time-flow-card"
              >
                <div className="flex h-full min-h-[220px] items-center justify-center">
                  <Suspense fallback={<TimeFlowFallback world={world} />}>
                    <CanvasCrashBoundary fallback={<TimeFlowFallback world={world} />}>
                      <TimeFlowDynamics ratio={world.flowRatio || 1} className="h-[200px] w-full" />
                    </CanvasCrashBoundary>
                  </Suspense>
                </div>
              </SectionShell>
              {hasChronology ? <WorldChronologyCard world={world} /> : null}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
