import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { EntityAvatar } from '@renderer/components/entity-avatar.js';
import { getSemanticAgentPalette } from '@renderer/components/agent-theme.js';
import { CreateAgentDrawer, type CreateAgentInput } from './create-agent-drawer';
import type {
  WorldAgent,
  WorldAuditItem,
  WorldDetailData,
  WorldEventsBundle,
  WorldPublicAssetsData,
  WorldRecommendedAgent,
  WorldSemanticData,
} from './world-detail-types';
import { TimeFlowDynamics } from './time-flow-dynamics';
import { WorldScoringMatrix } from './world-scoring-matrix';
import { WorldDetailSkeletonPage } from './world-detail-route-state';

const statusGlowStyles = `
  @keyframes pulse-glow {
    0%, 100% { opacity: 0.45; transform: scale(1); }
    50% { opacity: 0.8; transform: scale(1.04); }
  }

  @keyframes float-card {
    0%, 100% { transform: translateY(0px); }
    50% { transform: translateY(-6px); }
  }
`;

function displayValue(value: unknown, fallback = 'N/A') {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'number' && Number.isNaN(value)) return fallback;
  return String(value);
}

function formatSemanticValue(value: string, t: (key: string) => string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === 'yes') return t('WorldDetail.xianxia.v2.common.yes');
  if (normalized === 'false' || normalized === 'no') return t('WorldDetail.xianxia.v2.common.no');
  return value;
}

function joinParts(parts: Array<string | null | undefined>): string | null {
  const values = parts.map((part) => (typeof part === 'string' ? part.trim() : '')).filter(Boolean);
  return values.length ? values.join(' · ') : null;
}

function formatDateTime(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatPercent(value?: number | null): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return `${Math.round(value * 100)}%`;
}

function formatEnum(value?: string | null): string | null {
  if (!value) return null;
  return value
    .toLowerCase()
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatFreezeReason(value?: string | null): string | null {
  switch (value) {
    case 'QUOTA_OVERFLOW':
      return '配额超限';
    case 'WORLD_INACTIVE':
      return '世界不活跃';
    case 'GOVERNANCE_LOCK':
      return '治理锁定';
    default:
      return formatEnum(value);
  }
}

function formatCreationState(value?: string | null): string | null {
  switch (value) {
    case 'OPEN':
      return '开放';
    case 'NATIVE_CREATION_FROZEN':
      return '冻结';
    default:
      return formatEnum(value);
  }
}

function formatStatus(value: WorldDetailData['status']): string {
  switch (value) {
    case 'ACTIVE':
      return '运行中';
    case 'DRAFT':
      return '草稿';
    case 'PENDING_REVIEW':
      return '审核中';
    case 'SUSPENDED':
      return '已暂停';
    case 'ARCHIVED':
      return '已归档';
    default:
      return value;
  }
}

function buildVisibleAgentGroups(agents: WorldAgent[], limit: number, expanded: boolean) {
  const order: Array<WorldAgent['importance']> = ['PRIMARY', 'SECONDARY', 'BACKGROUND'];
  const grouped = order.map((importance) => ({
    importance,
    items: agents
      .filter((agent) => agent.importance === importance)
      .sort((left, right) => {
        const vitalityDelta = (right.stats?.vitalityScore ?? 0) - (left.stats?.vitalityScore ?? 0);
        if (vitalityDelta !== 0) return vitalityDelta;
        return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
      }),
  })).filter((group) => group.items.length > 0);

  if (expanded) {
    return grouped;
  }

  let remaining = limit;
  return grouped.reduce<typeof grouped>((acc, group) => {
    if (remaining <= 0) return acc;
    const visible = group.items.slice(0, remaining);
    remaining -= visible.length;
    if (visible.length > 0) {
      acc.push({ ...group, items: visible });
    }
    return acc;
  }, []);
}

function SectionShell({
  title,
  subtitle,
  children,
  className = '',
}: {
  title: string;
  subtitle?: string | null;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`relative overflow-hidden rounded-[22px] border border-[#4ECCA3]/15 bg-[#0f1612]/82 backdrop-blur-sm ${className}`}>
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#4ECCA3]/55 to-transparent" />
      <div className="px-5 pt-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold tracking-[0.08em] text-[#4ECCA3]">{title}</h3>
            {subtitle ? <p className="mt-1 text-xs text-[#d8efe4]/45">{subtitle}</p> : null}
          </div>
        </div>
      </div>
      <div className="px-5 pb-5 pt-4">{children}</div>
    </section>
  );
}

function HeroTag({ label }: { label: string }) {
  return (
    <span className="rounded-full border border-white/20 bg-black/18 px-3 py-1 text-xs font-medium text-white/82 backdrop-blur-sm">
      {label}
    </span>
  );
}

function MetricPill({
  label,
  value,
  className = '',
  valueClassName = '',
}: {
  label: string;
  value: string;
  className?: string;
  valueClassName?: string;
}) {
  return (
    <span className={`inline-flex max-w-full items-center gap-1.5 rounded-full border border-[#4ECCA3]/20 bg-[#4ECCA3]/10 px-2.5 py-1 text-[11px] text-[#86f0ca] ${className}`}>
      <span className="text-[#c5f7e6]/55">{label}</span>
      <span className={`font-medium text-[#dffdf2] ${valueClassName}`}>{value}</span>
    </span>
  );
}

export type XianxiaWorldData = WorldDetailData;

export type XianxiaWorldTemplateProps = {
  world: XianxiaWorldData;
  agents: WorldAgent[];
  events: WorldEventsBundle;
  semantic: WorldSemanticData;
  audits: WorldAuditItem[];
  publicAssets: WorldPublicAssetsData;
  loading?: boolean;
  error?: boolean;
  agentsLoading?: boolean;
  eventsLoading?: boolean;
  semanticLoading?: boolean;
  auditsLoading?: boolean;
  publicAssetsLoading?: boolean;
  onBack?: () => void;
  onEnterEdit?: () => void;
  onCreateSubWorld?: () => void;
  onChatAgent?: (agent: WorldAgent) => void;
  onVoiceAgent?: (agent: WorldAgent) => void;
  onCreateAgent?: (input: CreateAgentInput) => void;
  createAgentMutating?: boolean;
};

function WorldHeroSection({
  world,
  onBack,
  onEnterEdit,
  onCreateSubWorld,
}: {
  world: XianxiaWorldData;
  onBack?: () => void;
  onEnterEdit?: () => void;
  onCreateSubWorld?: () => void;
}) {
  const { t } = useTranslation();
  const tags = [world.genre, world.era, ...(world.themes ?? [])].filter((value): value is string => Boolean(value));
  const heroTimeLine = world.currentTimeLabel || joinParts([world.eraLabel, world.currentWorldTime]);

  return (
    <section className="relative overflow-hidden rounded-[28px] border border-[#4ECCA3]/20">
      <div className="relative h-[420px]">
        <div
          className="absolute inset-0"
          style={{
            background: world.bannerUrl
              ? `url(${world.bannerUrl}) center/cover no-repeat`
              : 'linear-gradient(135deg, #102219 0%, #0a1712 52%, #050907 100%)',
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            background: `
              radial-gradient(circle at 24% 22%, rgba(78, 204, 163, 0.18), transparent 34%),
              radial-gradient(circle at 78% 18%, rgba(78, 204, 163, 0.08), transparent 25%),
              linear-gradient(180deg, rgba(7, 12, 10, 0.28) 0%, rgba(7, 12, 10, 0.45) 48%, rgba(7, 12, 10, 0.94) 100%)
            `,
          }}
        />
        <div
          className="absolute inset-0 opacity-10"
          style={{
            backgroundImage: `
              linear-gradient(90deg, rgba(78, 204, 163, 0.3) 1px, transparent 1px),
              linear-gradient(0deg, rgba(78, 204, 163, 0.3) 1px, transparent 1px)
            `,
            backgroundSize: '92px 92px',
          }}
        />

        {onBack ? (
          <button
            onClick={onBack}
            className="absolute left-4 top-4 z-20 flex h-10 w-10 items-center justify-center rounded-full border border-[#4ECCA3]/20 bg-black/45 text-[#4ECCA3] backdrop-blur-md transition-all hover:border-[#4ECCA3]/40 hover:bg-black/65"
            aria-label={t('WorldDetail.xianxia.v2.hero.back')}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
        ) : null}

        <div className="absolute right-5 top-5 z-10 flex flex-wrap items-center justify-end gap-2">
          {onCreateSubWorld ? (
            <button
              onClick={onCreateSubWorld}
              className="rounded-full border border-[#4ECCA3]/20 bg-black/40 px-4 py-2 text-xs font-medium text-[#dffdf2] backdrop-blur-sm transition-colors hover:bg-black/60"
            >
              {t('WorldDetail.createSubWorld')}
            </button>
          ) : null}
          {onEnterEdit ? (
            <button
              onClick={onEnterEdit}
              className="rounded-full border border-[#4ECCA3]/28 bg-[#4ECCA3]/18 px-4 py-2 text-xs font-semibold text-[#dffdf2] transition-colors hover:bg-[#4ECCA3]/24"
            >
              {t('WorldDetail.enterEdit')}
            </button>
          ) : null}
          <span className="inline-flex items-center rounded-full border border-[#4ECCA3]/35 bg-[#4ECCA3]/14 px-4 py-2 text-[11px] font-semibold tracking-[0.16em] text-[#86f0ca]">
            {world.type === 'OASIS' ? t('WorldDetail.xianxia.v2.hero.oasisWorld') : t('WorldDetail.xianxia.v2.hero.creatorWorld')}
          </span>
        </div>

        <div className="absolute inset-x-0 bottom-0 p-8">
          <div className="flex items-end justify-between gap-8">
            <div className="flex min-w-0 flex-1 items-start gap-6">
              <div className="relative flex-shrink-0" style={{ animation: 'float-card 6s ease-in-out infinite' }}>
                <div
                  className="absolute inset-0 rounded-[28px]"
                  style={{
                    boxShadow: '0 0 24px rgba(78, 204, 163, 0.28), 0 0 64px rgba(78, 204, 163, 0.12)',
                    animation: 'pulse-glow 4.5s ease-in-out infinite',
                  }}
                />
                {world.iconUrl ? (
                  <img
                    src={world.iconUrl}
                    alt={world.name}
                    className="relative z-10 h-28 w-28 rounded-[28px] border-2 border-[#4ECCA3]/30 object-cover shadow-2xl"
                  />
                ) : (
                  <div className="relative z-10 flex h-28 w-28 items-center justify-center rounded-[28px] border-2 border-[#4ECCA3]/30 bg-[#122219] text-4xl font-serif text-[#4ECCA3]">
                    {world.name.charAt(0)}
                  </div>
                )}
              </div>

              <div className="min-w-0 flex-1">
                {world.tagline ? (
                  <p className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-[#86f0ca]">
                    {world.tagline}
                  </p>
                ) : null}
                <h1 className="mb-2 text-[46px] font-serif leading-tight tracking-wide text-white" style={{ fontFamily: '"Noto Serif SC", serif' }}>
                  {displayValue(world.name)}
                </h1>
                {world.motto ? <p className="mb-3 text-sm italic text-white/78">{world.motto}</p> : null}
                <p className="max-w-3xl text-base leading-relaxed text-white/72">
                  {displayValue(world.overview || world.description)}
                </p>

                {tags.length ? (
                  <div className="mt-5 flex flex-wrap gap-2">
                    {tags.map((tag) => <HeroTag key={tag} label={tag} />)}
                  </div>
                ) : null}

                <div className="mt-5 flex flex-wrap gap-2.5">
                  <MetricPill label={t('WorldDetail.xianxia.v2.hero.status')} value={formatStatus(world.status)} />
                  <MetricPill label={t('WorldDetail.xianxia.v2.hero.level')} value={`Lv.${world.level}`} />
                  <MetricPill label={t('WorldDetail.xianxia.v2.hero.agentCount')} value={`${world.agentCount}`} />
                  {heroTimeLine ? (
                    <MetricPill
                      label={t('WorldDetail.xianxia.v2.hero.worldTime')}
                      value={heroTimeLine}
                      className="min-w-0"
                      valueClassName="truncate"
                    />
                  ) : null}
                </div>
              </div>
            </div>

            <div className="w-[132px] flex-shrink-0">
              <TimeFlowDynamics ratio={world.flowRatio || 1} className="h-[132px]" variant="compact" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function WorldCoreRulesSection({ semantic }: { semantic: WorldSemanticData }) {
  const { t } = useTranslation();
  const blocks = [
    semantic.operationTitle || semantic.operationDescription || semantic.operationRules.length
      ? (
          <div key="operation" className="rounded-2xl border border-[#4ECCA3]/12 bg-black/14 p-4">
            <div className="mb-2 text-xs font-semibold tracking-[0.12em] text-[#86f0ca]">{t('WorldDetail.xianxia.v2.coreRules.operation')}</div>
            {semantic.operationTitle ? <div className="text-lg font-semibold text-[#effff8]">{semantic.operationTitle}</div> : null}
            {semantic.operationDescription ? <p className="mt-2 text-sm leading-relaxed text-[#d8efe4]/70">{semantic.operationDescription}</p> : null}
            {semantic.operationRules.length ? (
              <div className="mt-4 grid gap-2">
                {semantic.operationRules.map((rule) => (
                  <div key={rule.label} className="rounded-xl border border-[#4ECCA3]/10 bg-[#0a0f0c]/45 p-3">
                    <div className="text-[11px] uppercase tracking-[0.14em] text-[#86f0ca]/80">{rule.label}</div>
                    <div className="mt-1 text-sm leading-relaxed text-[#effff8]/74">{formatSemanticValue(rule.value, t)}</div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        )
      : null,
    semantic.powerSystems.length || semantic.standaloneLevels.length
      ? (
          <div key="power" className="rounded-2xl border border-[#4ECCA3]/12 bg-black/14 p-4">
            <div className="mb-3 text-xs font-semibold tracking-[0.12em] text-[#86f0ca]">{t('WorldDetail.xianxia.v2.coreRules.powerSystems')}</div>
            {semantic.powerSystems.map((system) => (
              <div key={system.name} className="mb-4 rounded-xl border border-[#4ECCA3]/10 bg-[#0a0f0c]/45 p-3 last:mb-0">
                <div className="text-sm font-semibold text-[#effff8]">{system.name}</div>
                {system.description ? <div className="mt-1 text-sm leading-relaxed text-[#d8efe4]/68">{system.description}</div> : null}
                {system.levels.length ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {system.levels.slice(0, 8).map((level) => (
                      <span key={`${system.name}-${level.name}`} className="rounded-full border border-[#4ECCA3]/18 bg-[#4ECCA3]/10 px-3 py-1 text-xs text-[#dffdf2]">
                        {level.name}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
            {semantic.standaloneLevels.length ? (
              <div className="grid gap-2 md:grid-cols-2">
                {semantic.standaloneLevels.slice(0, 8).map((level) => (
                  <div key={level.name} className="rounded-xl border border-[#4ECCA3]/10 bg-[#0a0f0c]/45 p-3">
                    <div className="text-sm font-semibold text-[#effff8]">{level.name}</div>
                    {level.description ? <div className="mt-1 text-sm leading-relaxed text-[#d8efe4]/68">{level.description}</div> : null}
                    {level.extra ? <div className="mt-2 text-xs text-[#86f0ca]/78">{t('WorldDetail.xianxia.v2.coreRules.breakthroughCondition')}: {level.extra}</div> : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        )
      : null,
    semantic.taboos.length
      ? (
          <div key="taboos" className="rounded-2xl border border-[#4ECCA3]/12 bg-black/14 p-4">
            <div className="mb-3 text-xs font-semibold tracking-[0.12em] text-[#86f0ca]">{t('WorldDetail.xianxia.v2.coreRules.taboos')}</div>
            <div className="grid gap-2 md:grid-cols-2">
              {semantic.taboos.map((taboo) => (
                <div key={taboo.name} className="rounded-xl border border-[#4ECCA3]/10 bg-[#0a0f0c]/45 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-[#effff8]">{taboo.name}</div>
                    {taboo.severity ? <span className="text-[10px] uppercase tracking-[0.14em] text-[#86f0ca]/65">{taboo.severity}</span> : null}
                  </div>
                  {taboo.description ? <div className="mt-1 text-sm leading-relaxed text-[#d8efe4]/68">{taboo.description}</div> : null}
                </div>
              ))}
            </div>
          </div>
        )
      : null,
    semantic.topology && (semantic.topology.realms.length || semantic.topology.type || semantic.topology.boundary || semantic.topology.dimensions)
      ? (
          <div key="topology" className="rounded-2xl border border-[#4ECCA3]/12 bg-black/14 p-4">
            <div className="mb-3 text-xs font-semibold tracking-[0.12em] text-[#86f0ca]">{t('WorldDetail.xianxia.v2.coreRules.topology')}</div>
            <div className="mb-3 flex flex-wrap gap-2">
              {semantic.topology.type ? <MetricPill label={t('WorldDetail.xianxia.v2.coreRules.topologyType')} value={semantic.topology.type} /> : null}
              {semantic.topology.boundary ? <MetricPill label={t('WorldDetail.xianxia.v2.coreRules.topologyBoundary')} value={semantic.topology.boundary} /> : null}
              {semantic.topology.dimensions ? <MetricPill label={t('WorldDetail.xianxia.v2.coreRules.topologyDimensions')} value={semantic.topology.dimensions} /> : null}
            </div>
            {semantic.topology.realms.length ? (
              <div className="grid gap-3 md:grid-cols-2">
                {semantic.topology.realms.map((realm) => (
                  <div key={realm.name} className="rounded-xl border border-[#4ECCA3]/10 bg-[#0a0f0c]/45 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-semibold text-[#effff8]">{realm.name}</div>
                      {realm.accessibility ? <span className="text-[10px] uppercase tracking-[0.14em] text-[#86f0ca]/65">{realm.accessibility}</span> : null}
                    </div>
                    {realm.description ? <div className="mt-1 text-sm leading-relaxed text-[#d8efe4]/68">{realm.description}</div> : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        )
      : null,
    semantic.causality && (semantic.causality.type || semantic.causality.karmaEnabled != null || semantic.causality.fateWeight != null)
      ? (
          <div key="causality" className="rounded-2xl border border-[#4ECCA3]/12 bg-black/14 p-4">
            <div className="mb-3 text-xs font-semibold tracking-[0.12em] text-[#86f0ca]">{t('WorldDetail.xianxia.v2.coreRules.causality')}</div>
            <div className="grid gap-3 md:grid-cols-3">
              {semantic.causality.type ? (
                <div className="rounded-xl border border-[#4ECCA3]/10 bg-[#0a0f0c]/45 p-3">
                  <div className="text-[11px] uppercase tracking-[0.14em] text-[#86f0ca]/72">{t('WorldDetail.xianxia.v2.coreRules.causalityType')}</div>
                  <div className="mt-1 text-sm font-medium text-[#effff8]">{semantic.causality.type}</div>
                </div>
              ) : null}
              {semantic.causality.karmaEnabled != null ? (
                <div className="rounded-xl border border-[#4ECCA3]/10 bg-[#0a0f0c]/45 p-3">
                  <div className="text-[11px] uppercase tracking-[0.14em] text-[#86f0ca]/72">{t('WorldDetail.xianxia.v2.coreRules.karma')}</div>
                  <div className="mt-1 text-sm font-medium text-[#effff8]">{semantic.causality.karmaEnabled ? t('WorldDetail.xianxia.v2.coreRules.karmaEnabled') : t('WorldDetail.xianxia.v2.coreRules.karmaDisabled')}</div>
                </div>
              ) : null}
              {semantic.causality.fateWeight != null ? (
                <div className="rounded-xl border border-[#4ECCA3]/10 bg-[#0a0f0c]/45 p-3">
                  <div className="text-[11px] uppercase tracking-[0.14em] text-[#86f0ca]/72">{t('WorldDetail.xianxia.v2.coreRules.fateWeight')}</div>
                  <div className="mt-1 text-sm font-medium text-[#effff8]">{semantic.causality.fateWeight.toFixed(2)}</div>
                </div>
              ) : null}
            </div>
          </div>
        )
      : null,
    semantic.languages.length
      ? (
          <div key="languages" className="rounded-2xl border border-[#4ECCA3]/12 bg-black/14 p-4">
            <div className="mb-3 text-xs font-semibold tracking-[0.12em] text-[#86f0ca]">{t('WorldDetail.xianxia.v2.coreRules.languages')}</div>
            <div className="grid gap-3 md:grid-cols-2">
              {semantic.languages.map((language) => (
                <div key={language.name} className="rounded-xl border border-[#4ECCA3]/10 bg-[#0a0f0c]/45 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-[#effff8]">{language.name}</div>
                    {language.category ? <span className="text-[10px] uppercase tracking-[0.14em] text-[#86f0ca]/65">{language.category}</span> : null}
                  </div>
                  {language.description ? <div className="mt-1 text-sm leading-relaxed text-[#d8efe4]/68">{language.description}</div> : null}
                  {language.writingSample ? <div className="mt-2 text-xs text-[#86f0ca]/78">{t('WorldDetail.xianxia.v2.coreRules.writingSample')}: {language.writingSample}</div> : null}
                  {language.spokenSample ? <div className="mt-1 text-xs text-[#d8efe4]/58">{t('WorldDetail.xianxia.v2.coreRules.spokenSample')}: {language.spokenSample}</div> : null}
                </div>
              ))}
            </div>
          </div>
        )
      : null,
  ].filter(Boolean);

  if (!blocks.length) {
    return null;
  }

  return (
    <SectionShell title={t('WorldDetail.xianxia.v2.coreRules.title')} subtitle={t('WorldDetail.xianxia.v2.coreRules.subtitle')}>
      <div className="grid gap-4">{blocks}</div>
    </SectionShell>
  );
}

function WorldTimelineSection({
  events,
  loading,
}: {
  events: WorldEventsBundle;
  loading?: boolean;
}) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<'ALL' | 'PRIMARY' | 'SECONDARY'>('ALL');
  const [visibleCount, setVisibleCount] = useState(8);
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});

  const filteredEvents = useMemo(() => (
    filter === 'ALL' ? events.items : events.items.filter((item) => item.level === filter)
  ), [events.items, filter]);

  const visibleEvents = filteredEvents.slice(0, visibleCount);

  const toggleExpanded = (eventId: string) => {
    setExpandedIds((current) => ({ ...current, [eventId]: !current[eventId] }));
  };

  return (
    <SectionShell title={t('WorldDetail.xianxia.v2.timeline.title')} subtitle={t('WorldDetail.xianxia.v2.timeline.subtitle')}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {events.summary ? (
            <>
              <MetricPill label={t('WorldDetail.xianxia.v2.timeline.primary')} value={`${events.summary.primaryCount}`} />
              <MetricPill label={t('WorldDetail.xianxia.v2.timeline.secondary')} value={`${events.summary.secondaryCount}`} />
              {formatPercent(events.summary.eventCharacterCoverage) ? (
                <MetricPill label={t('WorldDetail.xianxia.v2.timeline.characters')} value={formatPercent(events.summary.eventCharacterCoverage) || '0%'} />
              ) : null}
              {formatPercent(events.summary.eventLocationCoverage) ? (
                <MetricPill label={t('WorldDetail.xianxia.v2.timeline.locations')} value={formatPercent(events.summary.eventLocationCoverage) || '0%'} />
              ) : null}
            </>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {[
            { key: 'ALL', label: t('WorldDetail.xianxia.v2.timeline.filterAll') },
            { key: 'PRIMARY', label: t('WorldDetail.xianxia.v2.timeline.filterPrimary') },
            { key: 'SECONDARY', label: t('WorldDetail.xianxia.v2.timeline.filterSecondary') },
          ].map((item) => (
            <button
              key={item.key}
              onClick={() => {
                setFilter(item.key as 'ALL' | 'PRIMARY' | 'SECONDARY');
                setVisibleCount(8);
              }}
              className={`rounded-full border px-3 py-1.5 text-xs transition-all ${
                filter === item.key
                  ? 'border-[#4ECCA3]/45 bg-[#4ECCA3]/16 text-[#dffdf2]'
                  : 'border-[#4ECCA3]/14 bg-black/12 text-[#d8efe4]/55 hover:border-[#4ECCA3]/24 hover:text-[#d8efe4]/85'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex min-h-[220px] items-center justify-center text-sm text-[#d8efe4]/42">{t('WorldDetail.xianxia.v2.timeline.loading')}</div>
      ) : visibleEvents.length ? (
        <div className="relative flex flex-col gap-4">
          <div className="absolute bottom-0 left-[11px] top-2 w-px bg-gradient-to-b from-[#4ECCA3] via-[#4ECCA3]/30 to-transparent" />
          {visibleEvents.map((event) => {
            const isExpanded = Boolean(expandedIds[event.id]);
            const summary = event.summary || event.description;
            return (
              <article key={event.id} className="relative pl-8">
                <div className="absolute left-0 top-0 flex h-6 w-6 items-center justify-center rounded-full border-2 border-[#4ECCA3]/28 bg-[#0f1612]">
                  <div className="h-2 w-2 rounded-full bg-[#4ECCA3]" />
                </div>
                <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-[#86f0ca]">
                  <span>{formatDateTime(event.time) || 'N/A'}</span>
                  <span className="rounded-full border border-[#4ECCA3]/16 bg-[#4ECCA3]/10 px-2 py-0.5 text-[10px] tracking-[0.14em] text-[#dffdf2]">
                    {event.level === 'PRIMARY' ? t('WorldDetail.xianxia.v2.timeline.primary') : t('WorldDetail.xianxia.v2.timeline.secondary')}
                  </span>
                </div>
                <div className="rounded-2xl border border-[#4ECCA3]/10 bg-[#0a0f0c]/60 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h4 className="text-base font-semibold text-[#effff8]">{displayValue(event.title)}</h4>
                      {summary ? <p className="mt-2 text-sm leading-relaxed text-[#d8efe4]/66">{summary}</p> : null}
                    </div>
                    <button
                      onClick={() => toggleExpanded(event.id)}
                      className="rounded-full border border-[#4ECCA3]/16 bg-[#4ECCA3]/8 px-3 py-1 text-[11px] text-[#86f0ca] transition-colors hover:bg-[#4ECCA3]/14"
                    >
                      {isExpanded ? t('WorldDetail.xianxia.v2.timeline.collapse') : t('WorldDetail.xianxia.v2.timeline.expand')}
                    </button>
                  </div>

                  {isExpanded ? (
                    <div className="mt-4 grid gap-3">
                      {event.cause ? (
                        <div className="rounded-xl border border-[#4ECCA3]/10 bg-black/16 p-3">
                          <div className="text-[11px] uppercase tracking-[0.14em] text-[#86f0ca]/74">{t('WorldDetail.xianxia.v2.timeline.cause')}</div>
                          <div className="mt-1 text-sm leading-relaxed text-[#d8efe4]/68">{event.cause}</div>
                        </div>
                      ) : null}
                      {event.process ? (
                        <div className="rounded-xl border border-[#4ECCA3]/10 bg-black/16 p-3">
                          <div className="text-[11px] uppercase tracking-[0.14em] text-[#86f0ca]/74">{t('WorldDetail.xianxia.v2.timeline.process')}</div>
                          <div className="mt-1 text-sm leading-relaxed text-[#d8efe4]/68">{event.process}</div>
                        </div>
                      ) : null}
                      {event.result ? (
                        <div className="rounded-xl border border-[#4ECCA3]/10 bg-black/16 p-3">
                          <div className="text-[11px] uppercase tracking-[0.14em] text-[#86f0ca]/74">{t('WorldDetail.xianxia.v2.timeline.result')}</div>
                          <div className="mt-1 text-sm leading-relaxed text-[#d8efe4]/68">{event.result}</div>
                        </div>
                      ) : null}
                      {event.characterRefs.length || event.locationRefs.length ? (
                        <div className="flex flex-wrap gap-2 text-xs text-[#d8efe4]/62">
                          {event.characterRefs.length ? (
                            <span className="rounded-full border border-[#4ECCA3]/14 bg-[#4ECCA3]/10 px-3 py-1">
                              {t('WorldDetail.xianxia.v2.timeline.characterRefs')}: {event.characterRefs.join(' / ')}
                            </span>
                          ) : null}
                          {event.locationRefs.length ? (
                            <span className="rounded-full border border-[#4ECCA3]/14 bg-[#4ECCA3]/10 px-3 py-1">
                              {t('WorldDetail.xianxia.v2.timeline.locationRefs')}: {event.locationRefs.join(' / ')}
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                      {event.evidenceRefs.length ? (
                        <div className="rounded-xl border border-[#4ECCA3]/10 bg-black/16 p-3">
                          <div className="text-[11px] uppercase tracking-[0.14em] text-[#86f0ca]/74">{t('WorldDetail.xianxia.v2.timeline.evidence')}</div>
                          <div className="mt-2 grid gap-2">
                            {event.evidenceRefs.slice(0, 2).map((evidence) => (
                              <div key={`${event.id}-${evidence.segmentId}-${evidence.offsetStart}`} className="rounded-lg border border-[#4ECCA3]/8 bg-[#0a0f0c]/55 p-3 text-sm leading-relaxed text-[#d8efe4]/66">
                                {evidence.excerpt}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-[#4ECCA3]/14 bg-black/12 p-6 text-sm text-[#d8efe4]/46">
          {t('WorldDetail.xianxia.v2.timeline.empty')}
        </div>
      )}

      {filteredEvents.length > visibleCount ? (
        <div className="mt-4 flex justify-center">
          <button
            onClick={() => setVisibleCount((current) => current + 8)}
            className="rounded-full border border-[#4ECCA3]/18 bg-[#4ECCA3]/10 px-4 py-2 text-sm text-[#dffdf2] transition-colors hover:bg-[#4ECCA3]/16"
          >
            {t('WorldDetail.xianxia.v2.common.loadMore')}
          </button>
        </div>
      ) : null}
    </SectionShell>
  );
}

function WorldScenesSection({ scenes }: { scenes: WorldPublicAssetsData['scenes'] }) {
  const { t } = useTranslation();
  if (!scenes.length) {
    return null;
  }

  return (
    <SectionShell title={t('WorldDetail.xianxia.v2.scenes.title')} subtitle={t('WorldDetail.xianxia.v2.scenes.subtitle')}>
      <div className="grid gap-3 md:grid-cols-2">
        {scenes.slice(0, 8).map((scene) => (
          <div key={scene.id} className="rounded-2xl border border-[#4ECCA3]/10 bg-[#0a0f0c]/56 p-4">
            <div className="text-base font-semibold text-[#effff8]">{scene.name}</div>
            <div className="mt-2 text-sm leading-relaxed text-[#d8efe4]/66">{scene.description || t('WorldDetail.xianxia.v2.scenes.noDescription')}</div>
            {scene.activeEntities.length ? (
              <div className="mt-3 text-xs text-[#86f0ca]/74">{t('WorldDetail.xianxia.v2.scenes.activeEntities')}: {scene.activeEntities.slice(0, 4).join(' / ')}</div>
            ) : null}
          </div>
        ))}
      </div>
    </SectionShell>
  );
}

function WorldRuntimeFactsSection({
  world,
  lorebookCount,
  sceneCount,
  latestAudit,
}: {
  world: XianxiaWorldData;
  lorebookCount: number;
  sceneCount: number;
  latestAudit?: WorldAuditItem;
}) {
  const { t } = useTranslation();
  const facts = [
    { label: t('WorldDetail.xianxia.v2.runtimeFacts.flowRatio'), value: `${world.flowRatio.toFixed(1)}x` },
    { label: t('WorldDetail.xianxia.v2.runtimeFacts.agentCount'), value: `${world.agentCount}` },
    { label: t('WorldDetail.xianxia.v2.runtimeFacts.lorebookCount'), value: `${lorebookCount}` },
    { label: t('WorldDetail.xianxia.v2.runtimeFacts.sceneCount'), value: `${sceneCount}` },
    { label: t('WorldDetail.xianxia.v2.runtimeFacts.creationState'), value: formatCreationState(world.nativeCreationState) ?? t('WorldDetail.xianxia.v2.common.notAvailable') },
    { label: t('WorldDetail.xianxia.v2.runtimeFacts.contentRating'), value: world.contentRating ?? t('WorldDetail.xianxia.v2.common.notAvailable') },
  ];

  if (world.freezeReason) {
    facts.push({ label: t('WorldDetail.xianxia.v2.runtimeFacts.freezeReason'), value: formatFreezeReason(world.freezeReason) ?? world.freezeReason });
  }

  return (
    <SectionShell title={t('WorldDetail.xianxia.v2.runtimeFacts.title')} subtitle={t('WorldDetail.xianxia.v2.runtimeFacts.subtitle')}>
      <div className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-2">
          {facts.map((fact) => (
            <div key={fact.label} className="rounded-2xl border border-[#4ECCA3]/10 bg-[#0a0f0c]/56 p-3">
              <div className="text-[11px] uppercase tracking-[0.14em] text-[#86f0ca]/74">{fact.label}</div>
              <div className="mt-2 text-sm font-medium text-[#effff8]">{fact.value}</div>
            </div>
          ))}
        </div>

        <div className="rounded-2xl border border-[#4ECCA3]/10 bg-[#0a0f0c]/56 p-4">
          <div className="text-[11px] uppercase tracking-[0.14em] text-[#86f0ca]/74">{t('WorldDetail.xianxia.v2.sidebar.governanceSummary')}</div>
          <div className="mt-3 flex flex-wrap gap-2">
            <MetricPill label="EWMA" value={world.scoreEwma.toFixed(2)} />
            <MetricPill label={t('WorldDetail.xianxia.v2.sidebar.level')} value={`Lv.${world.level}`} />
            <MetricPill label={t('WorldDetail.xianxia.v2.sidebar.nativeCreation')} value={formatCreationState(world.nativeCreationState) ?? t('WorldDetail.xianxia.v2.common.notAvailable')} />
          </div>
          {latestAudit ? (
            <div className="mt-3 text-sm leading-relaxed text-[#d8efe4]/62">
              {t('WorldDetail.xianxia.v2.sidebar.latestAudit')}: {latestAudit.label}
              {latestAudit.nextLevel ? ` · Lv.${latestAudit.nextLevel}` : ''}
            </div>
          ) : null}
        </div>
      </div>
    </SectionShell>
  );
}

function RecommendedAgentCard({ agent }: { agent: WorldRecommendedAgent }) {
  const palette = getSemanticAgentPalette({
    description: joinParts([agent.display?.role, agent.display?.faction, agent.display?.rank]),
    worldName: agent.name,
  });
  const identityLine = joinParts([agent.display?.role, agent.display?.faction, agent.display?.rank]);
  const locationLine = joinParts([agent.display?.sceneName, agent.display?.location]);

  return (
    <article className="rounded-2xl border border-[#4ECCA3]/10 bg-[#0a0f0c]/56 p-4">
      <div className="flex items-start gap-3">
        <EntityAvatar
          imageUrl={agent.avatarUrl}
          name={agent.name}
          kind="agent"
          sizeClassName="h-14 w-14"
          radiusClassName="rounded-[12px]"
          innerRadiusClassName="rounded-[10px]"
          textClassName="text-lg font-serif"
        />
        <div className="min-w-0 flex-1">
          <div className="text-base font-semibold text-[#effff8]">{agent.name}</div>
          {identityLine ? <div className="mt-1 text-sm text-[#d8efe4]/66">{identityLine}</div> : null}
          {locationLine ? <div className="mt-1 text-xs" style={{ color: palette.accent }}>{locationLine}</div> : null}
        </div>
      </div>
    </article>
  );
}

function WorldDashboardSection({
  world,
  audits,
  publicAssets,
}: {
  world: XianxiaWorldData;
  audits: WorldAuditItem[];
  publicAssets: WorldPublicAssetsData;
}) {
  const { t } = useTranslation();
  const recommendedAgents = world.recommendedAgents?.slice(0, 3) ?? [];
  const timeLine = joinParts([world.currentTimeLabel, world.eraLabel, world.currentWorldTime]);
  const sampleLanguage = world.commonLanguages?.slice(0, 3).join(' · ');
  const latestAudit = audits[0];
  const lorebookCount = publicAssets.lorebooks.length;
  const sceneCount = publicAssets.scenes.length;
  const chronologyFacts = [
    timeLine
      ? {
          label: t('WorldDetail.xianxia.v2.sidebar.currentWorldTime'),
          value: timeLine,
        }
      : null,
    world.primaryLanguage
      ? {
          label: t('WorldDetail.xianxia.v2.sidebar.primaryLanguage'),
          value: world.primaryLanguage,
        }
      : null,
    sampleLanguage
      ? {
          label: t('WorldDetail.xianxia.v2.sidebar.commonLanguages'),
          value: sampleLanguage,
        }
      : null,
  ].filter((item): item is { label: string; value: string } => Boolean(item));

  return (
    <section className="relative overflow-hidden rounded-[24px] border border-[#4ECCA3]/16 bg-[#101813]/82 backdrop-blur-sm">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#4ECCA3]/45 to-transparent" />
      <div className="absolute inset-y-0 right-0 w-[30%] bg-[radial-gradient(circle_at_center,rgba(78,204,163,0.12),transparent_68%)] opacity-70" />
      <div className="relative grid items-start gap-5 p-5">
        <div className="grid items-start gap-5 xl:grid-cols-12">
        <div className="min-w-0 xl:col-span-5">
          <section className="overflow-hidden rounded-[22px] border border-[#4ECCA3]/15 bg-[#0f1612]/82 backdrop-blur-sm">
            <WorldScoringMatrix
              data={{
                scoreA: world.scoreA,
                scoreC: world.scoreC,
                scoreQ: world.scoreQ,
                scoreE: world.scoreE,
                scoreEwma: world.scoreEwma,
              }}
              className="min-h-[420px]"
            />
            <div className="border-t border-[#4ECCA3]/10 px-5 py-4">
              <div className="text-[11px] uppercase tracking-[0.14em] text-[#86f0ca]/74">{t('WorldDetail.xianxia.v2.sidebar.governanceSummary')}</div>
              <div className="mt-2 flex items-end justify-between gap-4">
                <div>
                  <div className="text-[13px] text-[#d8efe4]/55">EWMA</div>
                  <div className="mt-1 text-[32px] font-semibold leading-none text-[#4ECCA3]">{world.scoreEwma.toFixed(2)}</div>
                </div>
                <MetricPill label={t('WorldDetail.xianxia.v2.sidebar.level')} value={`Lv.${world.level}`} />
              </div>
            </div>
          </section>
        </div>

        <div className="min-w-0 xl:col-span-3">
          <WorldRuntimeFactsSection
            world={world}
            lorebookCount={lorebookCount}
            sceneCount={sceneCount}
            latestAudit={latestAudit}
          />
        </div>

        <div className="min-w-0 xl:col-span-4">
          {recommendedAgents.length ? (
            <SectionShell title={t('WorldDetail.xianxia.v2.sidebar.recommendedAgents')} subtitle={t('WorldDetail.xianxia.v2.sidebar.recommendedAgentsSubtitle')}>
              <div className="grid gap-3">
                {recommendedAgents.map((agent) => (
                  <RecommendedAgentCard key={agent.id} agent={agent} />
                ))}
              </div>
            </SectionShell>
          ) : null}
        </div>
        </div>

        {chronologyFacts.length ? (
          <SectionShell title={t('WorldDetail.xianxia.v2.sidebar.chronologyAndLanguage')} subtitle={t('WorldDetail.xianxia.v2.sidebar.chronologyAndLanguageSubtitle')}>
            <div className="grid items-start gap-3 xl:grid-cols-3">
              {chronologyFacts.map((fact) => (
                <div key={fact.label} className="rounded-2xl border border-[#4ECCA3]/10 bg-[#0a0f0c]/56 p-4">
                  <div className="text-[11px] uppercase tracking-[0.14em] text-[#86f0ca]/74">{fact.label}</div>
                  <div className="mt-2 text-sm leading-relaxed text-[#effff8]">{fact.value}</div>
                </div>
              ))}
              {chronologyFacts.length < 3 ? (
                <div className="hidden xl:block" />
              ) : null}
              {chronologyFacts.length < 2 ? (
                <div className="hidden xl:block" />
              ) : null}
            </div>
          </SectionShell>
        ) : null}
      </div>
    </section>
  );
}

function FullAgentCard({
  agent,
  onChatAgent,
  onVoiceAgent,
}: {
  agent: WorldAgent;
  onChatAgent?: (agent: WorldAgent) => void;
  onVoiceAgent?: (agent: WorldAgent) => void;
}) {
  const { t } = useTranslation();
  const palette = getSemanticAgentPalette({
    description: agent.bio,
    worldName: agent.name,
  });
  const identityLine = joinParts([agent.role, agent.faction, agent.rank]);
  const locationLine = joinParts([agent.sceneName, agent.location]);

  return (
    <article className="flex h-full flex-col rounded-2xl border border-[#4ECCA3]/10 bg-[#0a0f0c]/58 p-4">
      <div className="flex items-start gap-3">
        <EntityAvatar
          imageUrl={agent.avatarUrl}
          name={agent.name || 'Agent'}
          kind="agent"
          sizeClassName="h-14 w-14"
          radiusClassName="rounded-[10px]"
          innerRadiusClassName="rounded-[8px]"
          textClassName="text-lg font-serif"
        />
        <div className="min-w-0 flex-1">
          <h4 className="truncate text-sm font-semibold text-[#effff8]">{agent.name}</h4>
          <div className="truncate text-xs" style={{ color: palette.accent }}>{agent.handle}</div>
          {identityLine ? <div className="mt-1 text-xs text-[#d8efe4]/62">{identityLine}</div> : null}
        </div>
      </div>

      <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-[#d8efe4]/62">{agent.bio}</p>

      {locationLine ? <div className="mt-3 text-xs text-[#86f0ca]/76">{locationLine}</div> : null}

      {agent.stats?.vitalityScore != null ? (
        <div className="mt-3 text-[11px] text-[#d8efe4]/45">{t('WorldDetail.xianxia.v2.agents.vitality')} {agent.stats.vitalityScore}</div>
      ) : null}

      {(onChatAgent || onVoiceAgent) ? (
        <div className="mt-4 flex gap-2">
          {onChatAgent ? (
            <button
              onClick={() => onChatAgent(agent)}
              className="rounded-full border border-[#4ECCA3]/18 bg-[#4ECCA3]/10 px-3 py-1 text-xs text-[#dffdf2] transition-colors hover:bg-[#4ECCA3]/16"
            >
              {t('WorldDetail.xianxia.v2.agents.chat')}
            </button>
          ) : null}
          {onVoiceAgent ? (
            <button
              onClick={() => onVoiceAgent(agent)}
              className="rounded-full border border-[#4ECCA3]/18 bg-black/18 px-3 py-1 text-xs text-[#d8efe4]/72 transition-colors hover:border-[#4ECCA3]/28 hover:text-[#effff8]"
            >
              {t('WorldDetail.xianxia.v2.agents.voice')}
            </button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function WorldAgentsSection({
  agents,
  agentsLoading,
  onCreateAgent,
  onChatAgent,
  onVoiceAgent,
}: {
  agents: WorldAgent[];
  agentsLoading?: boolean;
  onCreateAgent?: () => void;
  onChatAgent?: (agent: WorldAgent) => void;
  onVoiceAgent?: (agent: WorldAgent) => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const visibleGroups = useMemo(() => buildVisibleAgentGroups(agents, 12, expanded), [agents, expanded]);
  const totalCount = agents.length;

  return (
    <SectionShell title={t('WorldDetail.xianxia.v2.agents.title')} subtitle={t('WorldDetail.xianxia.v2.agents.subtitle')}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="text-sm text-[#d8efe4]/58">{t('WorldDetail.xianxia.v2.agents.totalCount', { count: totalCount })}</div>
        {onCreateAgent ? (
          <button
            onClick={onCreateAgent}
            className="rounded-full border border-[#4ECCA3]/20 bg-[#4ECCA3]/12 px-4 py-2 text-sm text-[#dffdf2] transition-colors hover:bg-[#4ECCA3]/18"
          >
            {t('WorldDetail.xianxia.v2.agents.createAgent')}
          </button>
        ) : null}
      </div>

      {agentsLoading ? (
        <div className="flex min-h-[260px] items-center justify-center text-sm text-[#d8efe4]/42">{t('WorldDetail.xianxia.v2.agents.loading')}</div>
      ) : totalCount ? (
        <div className="grid gap-6">
          {visibleGroups.map((group) => (
            <div key={group.importance}>
              <div className="mb-3 inline-flex rounded-full border border-[#4ECCA3]/18 bg-[#4ECCA3]/10 px-3 py-1 text-xs font-medium text-[#86f0ca]">
                {group.importance === 'PRIMARY'
                  ? t('WorldDetail.xianxia.v2.agents.groupPrimary')
                  : group.importance === 'SECONDARY'
                    ? t('WorldDetail.xianxia.v2.agents.groupSecondary')
                    : t('WorldDetail.xianxia.v2.agents.groupBackground')}
              </div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {group.items.map((agent) => (
                  <FullAgentCard
                    key={agent.id}
                    agent={agent}
                    onChatAgent={onChatAgent}
                    onVoiceAgent={onVoiceAgent}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-[#4ECCA3]/14 bg-black/12 p-6 text-sm text-[#d8efe4]/46">
          {t('WorldDetail.xianxia.v2.agents.empty')}
        </div>
      )}

      {!expanded && totalCount > 12 ? (
        <div className="mt-5 flex justify-center">
          <button
            onClick={() => setExpanded(true)}
            className="rounded-full border border-[#4ECCA3]/18 bg-[#4ECCA3]/10 px-4 py-2 text-sm text-[#dffdf2] transition-colors hover:bg-[#4ECCA3]/16"
          >
            {t('WorldDetail.xianxia.v2.common.loadMore')}
          </button>
        </div>
      ) : null}
    </SectionShell>
  );
}

function WorldExtendedSection({
  semantic,
  audits,
  publicAssets,
  auditsLoading,
  publicAssetsLoading,
}: {
  semantic: WorldSemanticData;
  audits: WorldAuditItem[];
  publicAssets: WorldPublicAssetsData;
  auditsLoading?: boolean;
  publicAssetsLoading?: boolean;
}) {
  const { t } = useTranslation();
  const hasEvolution = semantic.worldviewEvents.length > 0 || semantic.worldviewSnapshots.length > 0;
  const hasAudits = audits.length > 0;
  const hasLorebooks = publicAssets.lorebooks.length > 0;
  const hasMutations = publicAssets.mutations.length > 0;

  if (!hasEvolution && !hasAudits && !hasLorebooks && !hasMutations && !auditsLoading && !publicAssetsLoading) {
    return null;
  }

  return (
    <div className="grid gap-5">
      {hasEvolution ? (
        <SectionShell title={t('WorldDetail.xianxia.v2.extended.evolutionTitle')} subtitle={t('WorldDetail.xianxia.v2.extended.evolutionSubtitle')}>
          <div className="grid gap-4 lg:grid-cols-2">
            {semantic.worldviewEvents.length ? (
              <div className="rounded-2xl border border-[#4ECCA3]/10 bg-[#0a0f0c]/56 p-4">
                <div className="mb-3 text-xs font-semibold tracking-[0.12em] text-[#86f0ca]">{t('WorldDetail.xianxia.v2.extended.recentChanges')}</div>
                <div className="grid gap-3">
                  {semantic.worldviewEvents.slice(0, 5).map((item) => (
                    <div key={item.id} className="rounded-xl border border-[#4ECCA3]/10 bg-black/16 p-3">
                      <div className="text-sm font-semibold text-[#effff8]">{item.title}</div>
                      {item.summary ? <div className="mt-1 text-sm leading-relaxed text-[#d8efe4]/64">{item.summary}</div> : null}
                      <div className="mt-2 text-[11px] text-[#86f0ca]/74">{joinParts([item.eventType, formatDateTime(item.createdAt)])}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {semantic.worldviewSnapshots.length ? (
              <div className="rounded-2xl border border-[#4ECCA3]/10 bg-[#0a0f0c]/56 p-4">
                <div className="mb-3 text-xs font-semibold tracking-[0.12em] text-[#86f0ca]">{t('WorldDetail.xianxia.v2.extended.snapshots')}</div>
                <div className="grid gap-3">
                  {semantic.worldviewSnapshots.slice(0, 5).map((snapshot) => (
                    <div key={snapshot.id} className="rounded-xl border border-[#4ECCA3]/10 bg-black/16 p-3">
                      <div className="text-sm font-semibold text-[#effff8]">{snapshot.versionLabel}</div>
                      {snapshot.summary ? <div className="mt-1 text-sm leading-relaxed text-[#d8efe4]/64">{snapshot.summary}</div> : null}
                      <div className="mt-2 text-[11px] text-[#86f0ca]/74">{formatDateTime(snapshot.createdAt) || 'N/A'}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </SectionShell>
      ) : null}

      {(hasLorebooks || hasMutations || hasAudits || auditsLoading || publicAssetsLoading) ? (
        <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="grid gap-5">
            {hasLorebooks ? (
              <SectionShell title={t('WorldDetail.xianxia.v2.extended.knowledgeTitle')} subtitle={t('WorldDetail.xianxia.v2.extended.knowledgeSubtitle')}>
                <div className="grid gap-3 md:grid-cols-2">
                  {publicAssets.lorebooks.slice(0, 8).map((lorebook) => (
                    <div key={lorebook.id} className="rounded-2xl border border-[#4ECCA3]/10 bg-[#0a0f0c]/56 p-4">
                      <div className="text-base font-semibold text-[#effff8]">{lorebook.name || lorebook.key}</div>
                      <div className="mt-2 line-clamp-4 text-sm leading-relaxed text-[#d8efe4]/66">{lorebook.content}</div>
                      {lorebook.keywords.length ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {lorebook.keywords.slice(0, 4).map((keyword) => (
                            <span key={`${lorebook.id}-${keyword}`} className="rounded-full border border-[#4ECCA3]/16 bg-[#4ECCA3]/10 px-2.5 py-1 text-[11px] text-[#86f0ca]">
                              {keyword}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </SectionShell>
            ) : null}

          </div>

          <div className="grid gap-5">
            {(hasAudits || auditsLoading) ? (
              <SectionShell title={t('WorldDetail.xianxia.v2.extended.auditsTitle')} subtitle={t('WorldDetail.xianxia.v2.extended.auditsSubtitle')}>
                {auditsLoading ? (
                  <div className="flex min-h-[220px] items-center justify-center text-sm text-[#d8efe4]/42">{t('WorldDetail.xianxia.v2.extended.auditsLoading')}</div>
                ) : (
                  <div className="grid gap-3">
                    {audits.slice(0, 6).map((audit) => (
                      <div key={audit.id} className="rounded-2xl border border-[#4ECCA3]/10 bg-[#0a0f0c]/56 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="text-sm font-semibold text-[#effff8]">{audit.label}</div>
                          <div className="text-[11px] text-[#86f0ca]/72">{formatDateTime(audit.occurredAt) || 'N/A'}</div>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {audit.prevLevel != null ? <MetricPill label={t('WorldDetail.xianxia.v2.extended.prevLevel')} value={`Lv.${audit.prevLevel}`} /> : null}
                          {audit.nextLevel != null ? <MetricPill label={t('WorldDetail.xianxia.v2.extended.nextLevel')} value={`Lv.${audit.nextLevel}`} /> : null}
                          {audit.ewmaScore != null ? <MetricPill label="EWMA" value={audit.ewmaScore.toFixed(2)} /> : null}
                          {audit.freezeReason ? <MetricPill label={t('WorldDetail.xianxia.v2.runtimeFacts.freezeReason')} value={formatFreezeReason(audit.freezeReason) ?? audit.freezeReason} /> : null}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </SectionShell>
            ) : null}

            {hasMutations ? (
              <SectionShell title={t('WorldDetail.xianxia.v2.extended.mutationsTitle')} subtitle={t('WorldDetail.xianxia.v2.extended.mutationsSubtitle')}>
                <div className="grid gap-3">
                  {publicAssets.mutations.slice(0, 8).map((mutation) => (
                    <div key={mutation.id} className="rounded-2xl border border-[#4ECCA3]/10 bg-[#0a0f0c]/56 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="text-sm font-semibold text-[#effff8]">{formatEnum(mutation.mutationType) || mutation.mutationType}</div>
                        <div className="text-[11px] text-[#86f0ca]/72">{formatDateTime(mutation.createdAt) || 'N/A'}</div>
                      </div>
                      <div className="mt-2 text-xs text-[#d8efe4]/58">{mutation.targetPath}</div>
                      {mutation.reason ? <div className="mt-2 text-sm leading-relaxed text-[#d8efe4]/66">{mutation.reason}</div> : null}
                    </div>
                  ))}
                </div>
              </SectionShell>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function XianxiaWorldTemplate(props: XianxiaWorldTemplateProps) {
  const { t } = useTranslation();
  const world = props.world;
  const [showCreateAgent, setShowCreateAgent] = useState(false);

  if (props.loading) {
    return <WorldDetailSkeletonPage />;
  }

  if (props.error || !world) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0f0c]">
        <span className="text-sm text-red-400">{t('WorldDetail.error')}</span>
      </div>
    );
  }

  return (
    <>
      <style>{statusGlowStyles}</style>
      <div className="relative min-h-screen overflow-x-hidden bg-[#0a0f0c] font-sans text-[#e8f5ee]">
        <div className="fixed inset-0 pointer-events-none">
          <div className="absolute inset-0 bg-gradient-to-br from-[#0d1f16] via-[#0a0f0c] to-[#050705]" />
          <div
            className="absolute inset-0 opacity-25"
            style={{
              backgroundImage: 'radial-gradient(circle, rgba(78, 204, 163, 0.28) 1px, transparent 1px)',
              backgroundSize: '42px 42px',
            }}
          />
          <div
            className="absolute -right-40 -top-36 h-[560px] w-[560px] rounded-full"
            style={{
              background: 'radial-gradient(circle, rgba(78, 204, 163, 0.16) 0%, transparent 68%)',
              animation: 'pulse-glow 4.5s ease-in-out infinite',
            }}
          />
          <div
            className="absolute -left-32 top-1/3 h-[480px] w-[480px] rounded-full"
            style={{
              background: 'radial-gradient(circle, rgba(78, 204, 163, 0.08) 0%, transparent 68%)',
              animation: 'pulse-glow 5.5s ease-in-out infinite 0.8s',
            }}
          />
        </div>

        <div className="relative z-10 mx-auto flex w-full max-w-[1400px] flex-col gap-5 px-5 py-6">
          <WorldHeroSection
            world={world}
            onBack={props.onBack}
            onEnterEdit={props.onEnterEdit}
            onCreateSubWorld={props.onCreateSubWorld}
          />

          <WorldDashboardSection world={world} audits={props.audits} publicAssets={props.publicAssets} />

          {props.semantic.hasContent ? <WorldCoreRulesSection semantic={props.semantic} /> : null}

          <WorldTimelineSection events={props.events} loading={props.eventsLoading} />

          <WorldScenesSection scenes={props.publicAssets.scenes} />

          <WorldAgentsSection
            agents={props.agents}
            agentsLoading={props.agentsLoading}
            onCreateAgent={props.onCreateAgent ? () => setShowCreateAgent(true) : undefined}
            onChatAgent={props.onChatAgent}
            onVoiceAgent={props.onVoiceAgent}
          />

          {/* Main Content Grid - 3 Columns */}
          <div className="grid grid-cols-[1fr_1.2fr_1fr] gap-5">
            {/* Left Column - World Overview */}
            <section className="relative overflow-hidden rounded-[16px] border border-[#4ECCA3]/15 bg-[#0f1612]/80 backdrop-blur-sm p-5">
              {/* Top glow line */}
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#4ECCA3]/50 to-transparent" />

              {/* Section Title */}
              <div className="flex items-center gap-2 mb-5">
                <span className="text-sm text-[#4ECCA3] font-medium">{t('WorldDetail.section.overview')}</span>
              </div>

              {/* World Name + ID Badge */}
              <div className="flex items-center gap-3 mb-3 flex-wrap">
                <h3 className="text-xl font-bold text-[#e8f5ee]">{displayValue(world.name)}</h3>
                <div className="inline-flex max-w-full items-start gap-2 rounded-lg border border-[#4ECCA3]/20 bg-[#4ECCA3]/10 px-3 py-1.5 text-xs font-mono text-[#4ECCA3]">
                  <span className="shrink-0">{t('WorldDetail.xianxia.id')}:</span>
                  <span className="break-all whitespace-normal">
                    {world.id || 'N/A'}
                  </span>
                </div>
              </div>

              {/* Meta info row */}
              <div className="flex items-center gap-4 mb-5 text-xs text-[#e8f5ee]/60">
                <span className="inline-flex items-center gap-1.5">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                    <line x1="16" y1="2" x2="16" y2="6" />
                    <line x1="8" y1="2" x2="8" y2="6" />
                    <line x1="3" y1="10" x2="21" y2="10" />
                  </svg>
                  {world.createdAt ? formatDateTime(world.createdAt) : 'N/A'}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                  {t('WorldDetail.agents', {
                    count: world.agentCount !== undefined ? world.agentCount : 0,
                    defaultValue: '{{count}} Agents',
                  })}
                </span>
              </div>

              {/* Description */}
              <div className="mb-5">
                <div className="text-xs text-[#4ECCA3] mb-2">{t('WorldDetail.description')}</div>
                <p className="text-sm text-[#e8f5ee]/70 leading-relaxed">
                  {displayValue(world.overview || world.description)}
                </p>
              </div>
            </section>

            {/* Middle Column - Scoring Matrix */}
            <section className="relative overflow-hidden rounded-[16px] border border-[#4ECCA3]/15 bg-[#0f1612]/80 backdrop-blur-sm">
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#4ECCA3]/50 to-transparent" />
              <WorldScoringMatrix
                data={{
                  scoreA: world.scoreA,
                  scoreC: world.scoreC,
                  scoreQ: world.scoreQ,
                  scoreE: world.scoreE,
                  scoreEwma: world.scoreEwma,
                }}
                className="h-full"
              />
            </section>

            {/* Right Column - Chronicle */}
            <section className="relative overflow-hidden rounded-[16px] border border-[#4ECCA3]/15 bg-[#0f1612]/80 backdrop-blur-sm p-5">
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#4ECCA3]/50 to-transparent" />

              {/* Section Title */}
              <div className="flex items-center gap-2 mb-5">
                <span className="text-sm text-[#4ECCA3] font-medium">{t('WorldDetail.section.timeline')}</span>
              </div>

              {/* Timeline */}
              <div className="relative flex flex-col gap-4">
                {/* Timeline line */}
                <div className="absolute left-[11px] top-2 bottom-2 w-px bg-gradient-to-b from-[#4ECCA3] via-[#4ECCA3]/30 to-transparent" />

                {props.eventsLoading ? (
                  <>
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="relative pl-8 animate-pulse">
                        <div className="absolute left-0 top-0 w-6 h-6 rounded-full bg-[#173422]" />
                        <div className="h-3 w-20 rounded bg-[#173422] mb-2" />
                        <div className="p-3 rounded-xl bg-[#0a0f0c]/60 border border-[#4ECCA3]/10 space-y-2">
                          <div className="h-4 w-32 rounded bg-[#173422]" />
                          <div className="h-3 w-full rounded bg-[#173422]" />
                          <div className="h-3 w-4/5 rounded bg-[#173422]" />
                        </div>
                      </div>
                    ))}
                  </>
                ) : props.events.length > 0 ? (
                  props.events.slice(0, 5).map((event) => (
                    <div key={event.id} className="relative pl-8">
                      {/* Timeline dot */}
                      <div className="absolute left-0 top-0 w-6 h-6 rounded-full bg-[#0f1612] border-2 border-[#4ECCA3]/30 flex items-center justify-center">
                        <div className="w-2 h-2 rounded-full bg-[#4ECCA3]" />
                      </div>

                      {/* Date */}
                      <div className="text-xs text-[#4ECCA3] tracking-wider mb-1">
                        {event.time ? formatDateTime(event.time) : 'N/A'}
                      </div>

                      {/* Content */}
                      <div className="p-3 rounded-xl bg-[#0a0f0c]/60 border border-[#4ECCA3]/10">
                        <h4 className="text-sm font-bold text-[#e8f5ee] mb-1">
                          {displayValue(event.title)}
                        </h4>
                        <p className="text-xs text-[#e8f5ee]/50 leading-relaxed line-clamp-3">
                          {displayValue(event.description)}
                        </p>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="pl-8 p-4 text-center text-[#e8f5ee]/50 text-sm">
                    {t('WorldDetail.xianxia.timeline.noData')}
                  </div>
                )}
              </div>
            </section>
          </div>

          {/* Bottom Section - World Agents */}
          <section className="relative overflow-hidden rounded-[16px] border border-[#4ECCA3]/15 bg-[#0f1612]/80 backdrop-blur-sm p-5">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#4ECCA3]/50 to-transparent" />

            {/* Section Title */}
            <div className="flex items-center justify-between mb-5">
              <span className="text-sm text-[#4ECCA3] font-medium">{t('WorldDetail.section.agents')}</span>
            </div>

            {/* Agent Grid - 4 columns per row */}
            <div className="grid auto-rows-fr grid-cols-4 gap-4">
              {/* 创建�?Agent 专属卡片 */}
              {props.onCreateAgent && (
                <article
                  onClick={() => setShowCreateAgent(true)}
                  className="group relative h-full min-h-[174px] w-full min-w-0 cursor-pointer overflow-hidden rounded-xl border-2 border-dashed bg-gradient-to-br from-[#0b120e]/60 to-[#111a15]/78 p-4 transition-all duration-500 hover:-translate-y-0.5 hover:shadow-[0_0_30px_rgba(78,204,163,0.18)]"
                  style={{
                    borderColor: 'rgba(117, 240, 194, 0.48)',
                    boxShadow: 'inset 0 0 0 1px rgba(117, 240, 194, 0.06), inset 0 0 22px rgba(78, 204, 163, 0.08)',
                  }}
                >
                  {/* 呼吸灯效果的微光动画 */}
                  <div className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500">
                    <div 
                      className="absolute inset-0 rounded-xl animate-pulse"
                      style={{
                        background: 'linear-gradient(135deg, rgba(78,204,163,0) 0%, rgba(78,204,163,0.1) 50%, rgba(78,204,163,0) 100%)',
                      }}
                    />
                  </div>
                  
                  <div className="relative z-10 flex h-full min-h-[140px] flex-col items-center justify-center">
                    {/* 大号薄荷�?+ �?*/}
                    <div 
                      className="w-14 h-14 rounded-full flex items-center justify-center mb-3 transition-transform duration-300 group-hover:scale-110"
                      style={{ background: 'linear-gradient(135deg, #4ECCA3, #3DBB94)' }}
                    >
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="12" y1="5" x2="12" y2="19" />
                        <line x1="5" y1="12" x2="19" y2="12" />
                      </svg>
                    </div>
                    {/* 文案 */}
                    <span className="text-sm font-semibold tracking-[0.01em] text-[#76e6bf]">
                      {t('World.createAgent.title', { defaultValue: 'Create New Agent' })}
                    </span>
                  </div>
                </article>
              )}

              {props.agentsLoading ? (
                <>
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="h-[174px] rounded-xl border border-[#4ECCA3]/10 bg-[#0a0f0c]/60 p-4 animate-pulse">
                      <div className="flex items-start gap-3 mb-3">
                        <div className="w-14 h-14 rounded-[10px] bg-[#173422]" />
                        <div className="flex-1 space-y-2">
                          <div className="h-4 w-24 rounded bg-[#173422]" />
                          <div className="h-3 w-16 rounded bg-[#173422]" />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <div className="h-3 w-full rounded bg-[#173422]" />
                        <div className="h-3 w-5/6 rounded bg-[#173422]" />
                      </div>
                    </div>
                  ))}
                </>
              ) : props.agents.length > 0 ? (
                props.agents.map((agent) => (
                  <article
                    key={agent.id}
                    className="relative h-full min-h-[174px] w-full min-w-0 overflow-hidden rounded-xl border border-[#4ECCA3]/10 bg-[#0a0f0c]/60 p-4"
                  >
                    {/* Agent header */}
                    <div className="flex items-start gap-3 mb-3">
                      {/* Theme exception: xianxia cards intentionally keep a tighter silhouette. */}
                      <EntityAvatar
                        imageUrl={agent.avatarUrl}
                        name={agent.name || 'Agent'}
                        kind="agent"
                        sizeClassName="h-14 w-14"
                        radiusClassName="rounded-[10px]"
                        innerRadiusClassName="rounded-[8px]"
                        textClassName="text-lg font-serif"
                      />
                      <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-bold text-[#e8f5ee] truncate">
                          {displayValue(agent.name)}
                        </h4>
                        <div className="text-xs truncate" style={{ color: getSemanticAgentPalette({ description: agent.bio, worldName: agent.name }).accent }}>
                          {displayValue(agent.handle)}
                        </div>
                      </div>
                    </div>

                    {/* Bio */}
                    <p className="text-xs text-[#e8f5ee]/60 leading-relaxed line-clamp-2">
                      {displayValue(agent.bio, 'No bio available')}
                    </p>

                    {(agent.sceneName || agent.location) ? (
                      <div className="mt-3 space-y-1 text-[11px] text-[#8EBFA7]">
                        {agent.sceneName ? (
                          <div className="truncate">
                            {displayValue(agent.sceneName)}
                          </div>
                        ) : null}
                        {agent.location ? (
                          <div className="truncate text-[#e8f5ee]/45">
                            {displayValue(agent.location)}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </article>
                ))
              ) : (
                <div className="col-span-4 py-16 flex flex-col items-center justify-center text-center">
                  <div className="w-16 h-16 mb-4 rounded-full bg-[#4ECCA3]/10 border border-[#4ECCA3]/20 flex items-center justify-center">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#4ECCA3" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                      <circle cx="9" cy="7" r="4" />
                      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                    </svg>
                  </div>
                  <p className="text-[#e8f5ee]/60 text-sm">
                    {t('WorldDetail.noAgentsYet', { defaultValue: 'No agents in this world yet' })}
                  </p>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>

      <CreateAgentDrawer
        isOpen={showCreateAgent && Boolean(props.onCreateAgent)}
        onClose={() => setShowCreateAgent(false)}
        onSubmit={(input) => {
          props.onCreateAgent?.(input);
          setShowCreateAgent(false);
        }}
        worldName={world.name}
        worldBannerUrl={world.bannerUrl}
        worldDescription={world.description}
        submitting={props.createAgentMutating}
      />
    </>
  );
}
