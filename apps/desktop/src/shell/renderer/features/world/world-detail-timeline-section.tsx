import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DataFactCard,
  displayValue,
  formatDateTime,
  SectionShell,
} from './world-detail-primitives.js';
import type { WorldHistoryBundle } from './world-detail-types.js';

export function WorldTimelineSection({
  history,
  loading,
  onSelectCharacterName,
  onSelectSceneName,
  compact = false,
  title,
  subtitle,
}: {
  history: WorldHistoryBundle;
  loading?: boolean;
  onSelectCharacterName?: (name: string) => void;
  onSelectSceneName?: (name: string) => void;
  compact?: boolean;
  title?: string;
  subtitle?: string;
}) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<'ALL' | 'PRIMARY' | 'SECONDARY'>('ALL');
  const [visibleCount, setVisibleCount] = useState(8);
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});

  const filteredEvents = useMemo(() => (
    filter === 'ALL' ? history.items : history.items.filter((item) => item.level === filter)
  ), [history.items, filter]);

  const visibleEvents = filteredEvents.slice(0, visibleCount);

  return (
    <SectionShell
      title={title ?? t('WorldDetail.xianxia.v2.timeline.title')}
      subtitle={subtitle ?? t('WorldDetail.xianxia.v2.timeline.subtitle')}
      dataTestId="world-detail-timeline"
    >
      {!compact ? (
        <div className="mb-4 flex flex-wrap justify-end gap-2">
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
      ) : null}

      {loading ? (
        <div className="flex min-h-[220px] items-center justify-center text-sm text-[#d8efe4]/42">{t('WorldDetail.xianxia.v2.timeline.loading')}</div>
      ) : compact ? (
        filteredEvents.length ? (
          <div className="grid gap-3">
            {filteredEvents.slice(0, 5).map((event) => (
              <article key={event.id} className="rounded-2xl border border-[#4ECCA3]/10 bg-[#0a0f0c]/58 p-4">
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-[#86f0ca]/74">
                  <span>{formatDateTime(event.time) || event.time || 'N/A'}</span>
                  <span className="rounded-full border border-[#4ECCA3]/16 bg-[#4ECCA3]/10 px-2 py-0.5 tracking-[0.12em] text-[#dffdf2]">
                    {event.level === 'PRIMARY' ? t('WorldDetail.xianxia.v2.timeline.primary') : t('WorldDetail.xianxia.v2.timeline.secondary')}
                  </span>
                </div>
                <h4 className="mt-2 text-base font-semibold text-[#effff8]">{displayValue(event.title)}</h4>
                {event.summary || event.description ? (
                  <p className="mt-2 text-sm leading-relaxed text-[#d8efe4]/66">{event.summary || event.description}</p>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-[#4ECCA3]/14 bg-black/12 p-6 text-sm text-[#d8efe4]/46">
            {t('WorldDetail.xianxia.v2.timeline.empty')}
          </div>
        )
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
                      onClick={() => setExpandedIds((current) => ({ ...current, [event.id]: !current[event.id] }))}
                      className="rounded-full border border-[#4ECCA3]/16 bg-[#4ECCA3]/8 px-3 py-1 text-[11px] text-[#86f0ca] transition-colors hover:bg-[#4ECCA3]/14"
                    >
                      {isExpanded ? t('WorldDetail.xianxia.v2.timeline.collapse') : t('WorldDetail.xianxia.v2.timeline.expand')}
                    </button>
                  </div>

                  {isExpanded ? (
                    <div className="mt-4 grid gap-3">
                      {event.cause ? <DataFactCard label={t('WorldDetail.xianxia.v2.timeline.cause')} value={event.cause} /> : null}
                      {event.process ? <DataFactCard label={t('WorldDetail.xianxia.v2.timeline.process')} value={event.process} /> : null}
                      {event.result ? <DataFactCard label={t('WorldDetail.xianxia.v2.timeline.result')} value={event.result} /> : null}
                      {event.characterRefs.length || event.locationRefs.length ? (
                        <div className="flex flex-wrap gap-2 text-xs text-[#d8efe4]/62">
                          {event.characterRefs.length ? (
                            <div className="flex flex-wrap gap-2">
                              {event.characterRefs.map((name) => (
                                <button
                                  key={`${event.id}-char-${name}`}
                                  type="button"
                                  onClick={() => onSelectCharacterName?.(name)}
                                  className="rounded-full border border-[#4ECCA3]/14 bg-[#4ECCA3]/10 px-3 py-1 text-xs text-[#dffdf2] transition-colors hover:bg-[#4ECCA3]/16"
                                >
                                  {name}
                                </button>
                              ))}
                            </div>
                          ) : null}
                          {event.locationRefs.length ? (
                            <div className="flex flex-wrap gap-2">
                              {event.locationRefs.map((name) => (
                                <button
                                  key={`${event.id}-loc-${name}`}
                                  type="button"
                                  onClick={() => onSelectSceneName?.(name)}
                                  className="rounded-full border border-[#4ECCA3]/14 bg-black/16 px-3 py-1 text-xs text-[#d8efe4]/72 transition-colors hover:border-[#4ECCA3]/24 hover:text-[#effff8]"
                                >
                                  {name}
                                </button>
                              ))}
                            </div>
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

      {!compact && filteredEvents.length > visibleCount ? (
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
