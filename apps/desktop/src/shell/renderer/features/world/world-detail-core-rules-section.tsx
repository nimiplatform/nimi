import { useTranslation } from 'react-i18next';
import { ScrollShell } from '@renderer/components/scroll-shell.js';
import {
  mapCultivationRingsData,
  mapRealmConstellationData,
} from './world-detail-layout.js';
import { RealmConstellationCard } from './world-detail-visuals.js';
import {
  DataFactCard,
  formatSemanticValue,
  MAIN_ROW_SPAN_CLASS,
  MetricPill,
  SectionShell,
  type XianxiaWorldData,
} from './world-detail-primitives.js';
import type { WorldSemanticData } from './world-detail-types.js';

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
            <div key={rule.key} className="rounded-xl border border-[#4ECCA3]/10 bg-[#0a0f0c]/45 p-3">
              <div className="text-[11px] uppercase tracking-[0.14em] text-[#86f0ca]/80">{rule.title}</div>
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

function WorldLanguagesCard({
  semantic,
  world,
}: {
  semantic: WorldSemanticData;
  world?: Pick<XianxiaWorldData, 'primaryLanguage' | 'commonLanguages'>;
}) {
  const { t } = useTranslation();
  const languageFacts = [
    world?.primaryLanguage
      ? {
          label: t('WorldDetail.xianxia.v2.sidebar.primaryLanguage'),
          value: world.primaryLanguage,
        }
      : null,
    world?.commonLanguages?.length
      ? {
          label: t('WorldDetail.xianxia.v2.sidebar.commonLanguages'),
          value: world.commonLanguages.slice(0, 3).join(' · '),
        }
      : null,
  ].filter((item): item is { label: string; value: string } => Boolean(item));

  if (!semantic.languages.length && !languageFacts.length) {
    return null;
  }

  return (
    <SectionShell
      title={t('WorldDetail.xianxia.v2.coreRules.languages')}
      subtitle={t('WorldDetail.xianxia.v2.visuals.languagesSubtitle')}
      className="h-full"
      dataTestId="world-detail-languages-card"
    >
      <div className="grid gap-3">
        {languageFacts.length ? (
          <div className="grid gap-3 md:grid-cols-2">
            {languageFacts.map((fact) => (
              <DataFactCard key={fact.label} label={fact.label} value={fact.value} />
            ))}
          </div>
        ) : null}

        {semantic.languages.length ? (
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
        ) : null}
      </div>
    </SectionShell>
  );
}

function WorldRulesSnapshot({
  semantic,
  cultivationData,
}: {
  semantic: WorldSemanticData;
  cultivationData: ReturnType<typeof mapCultivationRingsData>;
}) {
  const { t } = useTranslation();
  const items = [
    semantic.operationTitle
      ? {
          label: t('WorldDetail.xianxia.v2.coreRules.snapshotOperation'),
          value: semantic.operationTitle,
        }
      : null,
    cultivationData?.systemName
      ? {
          label: t('WorldDetail.xianxia.v2.coreRules.snapshotPowerSystem'),
          value: cultivationData.systemName,
        }
      : null,
    semantic.taboos.length
      ? {
          label: t('WorldDetail.xianxia.v2.coreRules.snapshotTaboos'),
          value: t('WorldDetail.xianxia.v2.coreRules.snapshotTaboosValue', { count: semantic.taboos.length }),
        }
      : null,
    semantic.causality && (semantic.causality.type || semantic.causality.karmaEnabled != null || semantic.causality.fateWeight != null)
      ? {
          label: t('WorldDetail.xianxia.v2.coreRules.snapshotCausality'),
          value: semantic.causality.type
            ? semantic.causality.type
            : (semantic.causality.karmaEnabled != null
              ? (semantic.causality.karmaEnabled
                ? t('WorldDetail.xianxia.v2.coreRules.karmaEnabled')
                : t('WorldDetail.xianxia.v2.coreRules.karmaDisabled'))
              : t('WorldDetail.xianxia.v2.common.notAvailable')),
        }
      : null,
  ].filter((item): item is { label: string; value: string } => Boolean(item));

  if (!items.length) {
    return null;
  }

  return (
    <div className="rounded-[22px] border border-[#4ECCA3]/10 bg-[linear-gradient(180deg,rgba(78,204,163,0.07),rgba(10,15,12,0.18))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="mb-3">
        <div className="text-sm font-semibold tracking-[0.08em] text-[#9af5dd]">
          {t('WorldDetail.xianxia.v2.coreRules.snapshotTitle')}
        </div>
        <div className="mt-1 text-xs leading-relaxed text-[#d8efe4]/44">
          {t('WorldDetail.xianxia.v2.coreRules.snapshotSubtitle')}
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {items.map((item) => (
          <DataFactCard key={item.label} label={item.label} value={item.value} />
        ))}
      </div>
    </div>
  );
}

export function WorldCoreRulesSection({
  semantic,
  world,
}: {
  semantic: WorldSemanticData;
  world?: Pick<XianxiaWorldData, 'primaryLanguage' | 'commonLanguages'>;
}) {
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
  const hasLanguages = semantic.languages.length > 0 || Boolean(world?.primaryLanguage || world?.commonLanguages?.length);

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
        <WorldRulesSnapshot semantic={semantic} cultivationData={cultivationData} />

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
                  {hasLanguages ? <WorldLanguagesCard semantic={semantic} world={world} /> : null}
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
                <WorldLanguagesCard semantic={semantic} world={world} />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </SectionShell>
  );
}
