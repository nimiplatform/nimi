import { useTranslation } from 'react-i18next';
import { ScrollShell } from '@renderer/components/scroll-shell.js';
import { EntityAvatar } from '@renderer/components/entity-avatar.js';
import { getSemanticAgentPalette } from '@renderer/components/agent-theme.js';
import {
  mapCultivationRingsData,
  mapRealmConstellationData,
} from './world-detail-layout.js';
import { RealmConstellationCard } from './world-detail-visuals.js';
import {
  DataFactCard,
  displayValue,
  formatCreationState,
  formatFreezeReason,
  formatSemanticValue,
  formatStatus,
  HeroTag,
  joinParts,
  MAIN_ROW_SPAN_CLASS,
  MetricPill,
  SectionShell,
  usePrefersReducedMotion,
  type XianxiaWorldData,
} from './world-detail-primitives.js';
import type {
  WorldPublicAssetsData,
  WorldRecommendedAgent,
  WorldSemanticData,
} from './world-detail-types.js';
import { TimeFlowDynamics } from './time-flow-dynamics';
import { WorldScoringMatrix } from './world-scoring-matrix';

export function WorldHeroSection({
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
  const prefersReducedMotion = usePrefersReducedMotion();
  const tags = [world.genre, world.era, ...(world.themes ?? [])].filter((value): value is string => Boolean(value));
  const heroTimeLine = world.currentTimeLabel || joinParts([world.eraLabel, world.currentWorldTime]);

  return (
    <section
      data-testid="world-detail-hero"
      className="relative overflow-hidden rounded-[28px] border border-[#4ECCA3]/20"
    >
      <div className="relative h-[360px]">
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

        <div className="absolute inset-x-0 bottom-0 p-7">
          <div className="flex min-w-0 items-end gap-6">
            <div className="relative flex-shrink-0" style={{ animation: prefersReducedMotion ? undefined : 'float-card 6s ease-in-out infinite' }}>
              <div
                className="absolute inset-0 rounded-[24px]"
                style={{
                  boxShadow: '0 0 24px rgba(78, 204, 163, 0.28), 0 0 64px rgba(78, 204, 163, 0.12)',
                  animation: prefersReducedMotion ? undefined : 'pulse-glow 4.5s ease-in-out infinite',
                }}
              />
              {world.iconUrl ? (
                <img
                  src={world.iconUrl}
                  alt={world.name}
                  className="relative z-10 h-24 w-24 rounded-[24px] border-2 border-[#4ECCA3]/30 object-cover shadow-2xl"
                />
              ) : (
                <div className="relative z-10 flex h-24 w-24 items-center justify-center rounded-[24px] border-2 border-[#4ECCA3]/30 bg-[#122219] text-3xl font-serif text-[#4ECCA3]">
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
              <h1 className="mb-2 text-[40px] font-serif leading-tight tracking-wide text-white" style={{ fontFamily: '"Noto Serif SC", serif' }}>
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
        </div>
      </div>
    </section>
  );
}

function WorldRuntimeFactsCard({
  world,
  lorebookCount,
  sceneCount,
}: {
  world: XianxiaWorldData;
  lorebookCount: number;
  sceneCount: number;
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
    <SectionShell
      title={t('WorldDetail.xianxia.v2.runtimeFacts.title')}
      subtitle={t('WorldDetail.xianxia.v2.runtimeFacts.subtitle')}
      className="h-full"
      dataTestId="world-detail-runtime-facts-card"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {facts.map((fact) => (
          <DataFactCard key={fact.label} label={fact.label} value={fact.value} />
        ))}
      </div>
    </SectionShell>
  );
}

function RecommendedAgentCard({
  agent,
  onSelectAgent,
  featured = false,
}: {
  agent: WorldRecommendedAgent;
  onSelectAgent?: (agentId: string) => void;
  featured?: boolean;
}) {
  const palette = getSemanticAgentPalette({
    description: joinParts([agent.display?.role, agent.display?.faction, agent.display?.rank]),
    worldName: agent.name,
  });
  const identityLine = joinParts([agent.display?.role, agent.display?.faction, agent.display?.rank]);
  const locationLine = joinParts([agent.display?.sceneName, agent.display?.location]);

  return (
    <button
      type="button"
      onClick={() => onSelectAgent?.(agent.id)}
      className={`w-full rounded-2xl border border-[#4ECCA3]/10 bg-[#0a0f0c]/56 text-left transition-all hover:border-[#4ECCA3]/22 hover:bg-[#0d1511]/70 ${featured ? 'p-5' : 'p-4'}`}
    >
      <div className="flex items-start gap-3">
        <EntityAvatar
          imageUrl={agent.avatarUrl}
          name={agent.name}
          kind="agent"
          sizeClassName={featured ? 'h-16 w-16' : 'h-14 w-14'}
          radiusClassName="rounded-[12px]"
          innerRadiusClassName="rounded-[10px]"
          textClassName={featured ? 'text-xl font-serif' : 'text-lg font-serif'}
        />
        <div className="min-w-0 flex-1">
          <div className={featured ? 'text-lg font-semibold text-[#effff8]' : 'text-base font-semibold text-[#effff8]'}>{agent.name}</div>
          {identityLine ? <div className={`mt-1 ${featured ? 'text-[15px]' : 'text-sm'} text-[#d8efe4]/66`}>{identityLine}</div> : null}
          {locationLine ? <div className="mt-1 text-xs" style={{ color: palette.accent }}>{locationLine}</div> : null}
        </div>
      </div>
    </button>
  );
}

function WorldChronologyCard({ world }: { world: XianxiaWorldData }) {
  const { t } = useTranslation();
  const chronology = joinParts([world.currentTimeLabel, world.eraLabel, world.currentWorldTime]);
  if (!chronology) {
    return null;
  }

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

function WorldLanguagesFactCard({ world }: { world: XianxiaWorldData }) {
  const { t } = useTranslation();
  const facts = [
    world.primaryLanguage
      ? {
          label: t('WorldDetail.xianxia.v2.sidebar.primaryLanguage'),
          value: world.primaryLanguage,
        }
      : null,
    world.commonLanguages?.length
      ? {
          label: t('WorldDetail.xianxia.v2.sidebar.commonLanguages'),
          value: world.commonLanguages.slice(0, 3).join(' · '),
        }
      : null,
  ].filter((item): item is { label: string; value: string } => Boolean(item));

  if (!facts.length) {
    return null;
  }

  return (
    <SectionShell
      title={t('WorldDetail.xianxia.v2.sidebar.languages')}
      subtitle={t('WorldDetail.xianxia.v2.sidebar.languagesSubtitle')}
      className="h-full"
      dataTestId="world-detail-languages-fact-card"
    >
      <div className="grid gap-3 md:grid-cols-2">
        {facts.map((fact) => <DataFactCard key={fact.label} label={fact.label} value={fact.value} />)}
      </div>
    </SectionShell>
  );
}

function WorldRecommendedAgentsCard({
  agents,
  onSelectAgent,
}: {
  agents: WorldRecommendedAgent[];
  onSelectAgent?: (agentId: string) => void;
}) {
  const { t } = useTranslation();
  if (!agents.length) {
    return null;
  }
  const featuredAgent = agents[0]!;
  const secondaryAgents = agents.slice(1);

  return (
    <SectionShell
      title={t('WorldDetail.xianxia.v2.sidebar.recommendedAgents')}
      subtitle={t('WorldDetail.xianxia.v2.sidebar.recommendedAgentsSubtitle')}
      className="h-full"
      dataTestId="world-detail-recommended-agents-card"
    >
      <div className="grid gap-3">
        <RecommendedAgentCard agent={featuredAgent} onSelectAgent={onSelectAgent} featured />
        {secondaryAgents.length ? (
          <div className="grid gap-3 md:grid-cols-2">
            {secondaryAgents.map((agent) => (
              <RecommendedAgentCard key={agent.id} agent={agent} onSelectAgent={onSelectAgent} />
            ))}
          </div>
        ) : null}
      </div>
    </SectionShell>
  );
}

export function WorldDashboardSection({
  world,
}: {
  world: XianxiaWorldData;
}) {
  const { t } = useTranslation();
  const hasChronology = Boolean(joinParts([world.currentTimeLabel, world.eraLabel, world.currentWorldTime]));

  return (
    <section
      data-testid="world-detail-dashboard"
      className="relative overflow-hidden rounded-[24px] border border-[#4ECCA3]/16 bg-[#101813]/82 backdrop-blur-sm"
    >
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#4ECCA3]/45 to-transparent" />
      <div className="absolute inset-y-0 right-0 w-[30%] bg-[radial-gradient(circle_at_center,rgba(78,204,163,0.12),transparent_68%)] opacity-70" />
      <div className="relative grid gap-5 p-5">
        <div className="grid gap-5 xl:grid-cols-12">
          <div className="col-span-12 xl:col-span-8">
            <section
              data-testid="world-detail-score-matrix-card"
              className="h-full overflow-hidden rounded-[22px] border border-[#4ECCA3]/15 bg-[#0f1612]/82 backdrop-blur-sm"
            >
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
                  <TimeFlowDynamics ratio={world.flowRatio || 1} className="h-[200px] w-full" />
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

export function WorldRecommendedEntrySection({
  world,
  onSelectAgent,
}: {
  world: XianxiaWorldData;
  onSelectAgent?: (agentId: string) => void;
}) {
  const recommendedAgents = world.recommendedAgents?.slice(0, 3) ?? [];
  if (!recommendedAgents.length) {
    return null;
  }

  return <WorldRecommendedAgentsCard agents={recommendedAgents} onSelectAgent={onSelectAgent} />;
}

export function WorldRuntimeFactsSection({
  world,
  publicAssets,
}: {
  world: XianxiaWorldData;
  publicAssets: WorldPublicAssetsData;
}) {
  return (
    <WorldRuntimeFactsCard
      world={world}
      lorebookCount={publicAssets.lorebooks.length}
      sceneCount={publicAssets.scenes.length}
    />
  );
}

export function WorldLanguageFactsSection({ world }: { world: XianxiaWorldData }) {
  return <WorldLanguagesFactCard world={world} />;
}

function WorldCultivationCard({
  data,
}: {
  data: NonNullable<ReturnType<typeof mapCultivationRingsData>>;
}) {
  const { t } = useTranslation();

  return (
    <SectionShell
      title={t('WorldDetail.xianxia.v2.coreRules.powerSystem')}
      subtitle={t('WorldDetail.xianxia.v2.coreRules.powerSystemSubtitle')}
      className="h-full"
      dataTestId="world-detail-power-system-card"
    >
      <div className="grid h-full gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <DataFactCard label={t('WorldDetail.xianxia.v2.coreRules.primarySystem')} value={data.systemName} />
          <DataFactCard
            label={t('WorldDetail.xianxia.v2.coreRules.levelTierCount')}
            value={t('WorldDetail.xianxia.v2.visuals.cultivationLevelCount', { count: data.levels.length })}
          />
        </div>
        {data.systemDescription ? (
          <div className="rounded-xl border border-[#4ECCA3]/10 bg-[#0a0f0c]/45 p-3 text-sm leading-relaxed text-[#d8efe4]/68">
            {data.systemDescription}
          </div>
        ) : null}
        {data.extraSystems.length ? (
          <div className="flex flex-wrap gap-2">
            {data.extraSystems.map((system) => (
              <MetricPill
                key={system.name}
                label={t('WorldDetail.xianxia.v2.coreRules.supportingSystem')}
                value={system.name}
              />
            ))}
          </div>
        ) : null}
        <ScrollShell viewportClassName="xl:max-h-[430px]" contentClassName="grid gap-2 xl:pr-1">
          {data.levels.map((level, index) => (
            <div key={level.name} className="rounded-xl border border-[#4ECCA3]/10 bg-[#0a0f0c]/45 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-[#effff8]">{level.name}</div>
                <span className="text-[10px] uppercase tracking-[0.14em] text-[#86f0ca]/70">
                  {index + 1}/{data.levels.length}
                </span>
              </div>
              {level.description ? <div className="mt-1 text-sm leading-relaxed text-[#d8efe4]/68">{level.description}</div> : null}
              {level.extra ? <div className="mt-2 text-xs text-[#86f0ca]/76">{level.extra}</div> : null}
            </div>
          ))}
        </ScrollShell>
      </div>
    </SectionShell>
  );
}

function WorldOperationCard({ semantic }: { semantic: WorldSemanticData }) {
  const { t } = useTranslation();
  if (!semantic.operationTitle && !semantic.operationDescription && !semantic.operationRules.length) {
    return null;
  }

  return (
    <SectionShell
      title={t('WorldDetail.xianxia.v2.coreRules.operation')}
      subtitle={semantic.operationTitle ?? null}
      className="h-full"
      dataTestId="world-detail-operation-card"
    >
      {semantic.operationDescription ? <p className="text-sm leading-relaxed text-[#d8efe4]/70">{semantic.operationDescription}</p> : null}
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
    </SectionShell>
  );
}

function WorldTaboosCard({ semantic }: { semantic: WorldSemanticData }) {
  const { t } = useTranslation();
  if (!semantic.taboos.length) {
    return null;
  }

  return (
    <SectionShell
      title={t('WorldDetail.xianxia.v2.coreRules.taboos')}
      subtitle={t('WorldDetail.xianxia.v2.visuals.taboosSubtitle')}
      className="h-full"
      dataTestId="world-detail-taboos-card"
    >
      <div className="grid gap-2">
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
    </SectionShell>
  );
}

function WorldCausalityCard({ semantic }: { semantic: WorldSemanticData }) {
  const { t } = useTranslation();
  if (!semantic.causality || (!semantic.causality.type && semantic.causality.karmaEnabled == null && semantic.causality.fateWeight == null)) {
    return null;
  }

  return (
    <SectionShell
      title={t('WorldDetail.xianxia.v2.coreRules.causality')}
      subtitle={t('WorldDetail.xianxia.v2.visuals.causalitySubtitle')}
      className="h-full"
      dataTestId="world-detail-causality-card"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {semantic.causality.type ? <DataFactCard label={t('WorldDetail.xianxia.v2.coreRules.causalityType')} value={semantic.causality.type} /> : null}
        {semantic.causality.karmaEnabled != null ? (
          <DataFactCard
            label={t('WorldDetail.xianxia.v2.coreRules.karma')}
            value={semantic.causality.karmaEnabled ? t('WorldDetail.xianxia.v2.coreRules.karmaEnabled') : t('WorldDetail.xianxia.v2.coreRules.karmaDisabled')}
          />
        ) : null}
        {semantic.causality.fateWeight != null ? (
          <DataFactCard label={t('WorldDetail.xianxia.v2.coreRules.fateWeight')} value={semantic.causality.fateWeight.toFixed(2)} />
        ) : null}
      </div>
    </SectionShell>
  );
}

function WorldLanguagesCard({ semantic }: { semantic: WorldSemanticData }) {
  const { t } = useTranslation();
  if (!semantic.languages.length) {
    return null;
  }

  return (
    <SectionShell
      title={t('WorldDetail.xianxia.v2.coreRules.languages')}
      subtitle={t('WorldDetail.xianxia.v2.visuals.languagesSubtitle')}
      className="h-full"
      dataTestId="world-detail-languages-card"
    >
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
    </SectionShell>
  );
}

export function WorldCoreRulesSection({ semantic }: { semantic: WorldSemanticData }) {
  const { t } = useTranslation();
  const cultivationData = mapCultivationRingsData(semantic);
  const constellationData = mapRealmConstellationData(semantic);
  const hasOperation = Boolean(semantic.operationTitle || semantic.operationDescription || semantic.operationRules.length);
  const hasCultivation = Boolean(cultivationData);
  const hasConstellation = Boolean(constellationData);
  const hasTaboos = semantic.taboos.length > 0;
  const hasCausality = Boolean(
    semantic.causality && (semantic.causality.type || semantic.causality.karmaEnabled != null || semantic.causality.fateWeight != null),
  );
  const hasLanguages = semantic.languages.length > 0;

  if (!hasOperation && !hasCultivation && !hasConstellation && !hasTaboos && !hasCausality && !hasLanguages) {
    return null;
  }

  return (
    <SectionShell
      title={t('WorldDetail.xianxia.v2.coreRules.title')}
      subtitle={t('WorldDetail.xianxia.v2.coreRules.subtitle')}
      dataTestId="world-detail-core-rules"
    >
      <div className="grid gap-5">
        {hasOperation ? <WorldOperationCard semantic={semantic} /> : null}

        {hasCultivation || hasConstellation ? (
          <div className="grid gap-5 xl:grid-cols-12">
            {hasCultivation && cultivationData ? (
              <div className={`${hasConstellation ? MAIN_ROW_SPAN_CLASS[6] : 'col-span-12'} xl:min-h-[760px]`}>
                <WorldCultivationCard data={cultivationData} />
              </div>
            ) : null}
            {hasConstellation && constellationData ? (
              <div className={`${hasCultivation ? MAIN_ROW_SPAN_CLASS[6] : 'col-span-12'} xl:min-h-[760px]`}>
                <RealmConstellationCard
                  data={constellationData}
                  title={t('WorldDetail.xianxia.v2.visuals.constellationTitle')}
                  subtitle={t('WorldDetail.xianxia.v2.visuals.constellationSubtitle')}
                />
              </div>
            ) : null}
          </div>
        ) : null}

        {hasTaboos ? (
          hasCausality || hasLanguages ? (
            <div className="grid gap-5 xl:grid-cols-12">
              <div className={MAIN_ROW_SPAN_CLASS[8]}>
                <WorldTaboosCard semantic={semantic} />
              </div>
              <div className={MAIN_ROW_SPAN_CLASS[4]}>
                <div className="grid gap-5 xl:grid-rows-2">
                  {hasCausality ? <WorldCausalityCard semantic={semantic} /> : null}
                  {hasLanguages ? <WorldLanguagesCard semantic={semantic} /> : null}
                </div>
              </div>
            </div>
          ) : (
            <WorldTaboosCard semantic={semantic} />
          )
        ) : hasCausality || hasLanguages ? (
          <div className="grid gap-5 xl:grid-cols-12">
            {hasCausality ? (
              <div className={hasLanguages ? MAIN_ROW_SPAN_CLASS[6] : 'col-span-12'}>
                <WorldCausalityCard semantic={semantic} />
              </div>
            ) : null}
            {hasLanguages ? (
              <div className={hasCausality ? MAIN_ROW_SPAN_CLASS[6] : 'col-span-12'}>
                <WorldLanguagesCard semantic={semantic} />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </SectionShell>
  );
}
