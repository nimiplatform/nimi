import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAppStore, computeAgeMonths } from '../../app-shell/app-store.js';
import { S } from '../../app-shell/page-style.js';
import { OBSERVATION_DIMENSIONS } from '../../knowledge-base/index.js';
import { getActiveDimensions } from '../../engine/observation-matcher.js';
import { getJournalEntries } from '../../bridge/sqlite-bridge.js';
import { computeRecommendedPrompts } from '../journal/journal-recommended-prompts.js';
import { getExperimentSuggestion } from '../journal/journal-experiment-templates.js';
import { catchLogThen } from '../../infra/telemetry/catch-log.js';

interface DimensionCard {
  dimensionId: string;
  displayName: string;
  parentQuestion: string;
  observableSignals: string[];
  guidedQuestions: string[];
  entryCountLast14d: number;
  experiment: string | null;
}

export default function ObservePage() {
  const { activeChildId, children } = useAppStore();
  const child = children.find((c) => c.childId === activeChildId);
  const [searchParams] = useSearchParams();
  const focusDimensionId = searchParams.get('dimensionId');

  const [expandedId, setExpandedId] = useState<string | null>(focusDimensionId);
  const [entries, setEntries] = useState<Array<{ dimensionId: string | null; recordedAt: string }>>([]);

  const ageMonths = child ? computeAgeMonths(child.birthDate) : 0;

  const activeDimensions = useMemo(
    () => getActiveDimensions(OBSERVATION_DIMENSIONS, ageMonths),
    [ageMonths],
  );

  useEffect(() => {
    if (!child) return;
    getJournalEntries(child.childId, 50)
      .then((rows) => setEntries(rows.map((r) => ({ dimensionId: r.dimensionId, recordedAt: r.recordedAt }))))
      .catch(catchLogThen('observe', 'load-entries-failed', () => setEntries([])));
  }, [child]);

  const cards: DimensionCard[] = useMemo(() => {
    const prompts = computeRecommendedPrompts(activeDimensions, entries, {
      maxPrompts: activeDimensions.length,
      windowDays: 14,
    });
    const countMap = new Map(prompts.map((p) => [p.dimensionId, p.entryCountLast14d]));

    return activeDimensions
      .map((dim) => ({
        dimensionId: dim.dimensionId,
        displayName: dim.displayName,
        parentQuestion: dim.parentQuestion,
        observableSignals: dim.observableSignals,
        guidedQuestions: dim.guidedQuestions,
        entryCountLast14d: countMap.get(dim.dimensionId) ?? 0,
        experiment: getExperimentSuggestion(dim.dimensionId)?.title ?? null,
      }))
      .sort((a, b) => a.entryCountLast14d - b.entryCountLast14d);
  }, [activeDimensions, entries]);

  useEffect(() => {
    if (focusDimensionId) {
      setExpandedId(focusDimensionId);
      requestAnimationFrame(() => {
        document.getElementById(`obs-${focusDimensionId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    }
  }, [focusDimensionId]);

  if (!child) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-[13px]" style={{ color: S.sub }}>请先添加孩子档案</p>
      </div>
    );
  }

  return (
    <div className={S.container} style={{ paddingTop: S.topPad }}>
      <div className="mb-6">
        <h1 className="text-[18px] font-semibold tracking-tight" style={{ color: S.text }}>观察任务</h1>
        <p className="mt-1 text-[12px] leading-relaxed" style={{ color: S.sub }}>
          选一个方向，带着好奇心去观察。不用每个都做，挑感兴趣的就好。
        </p>
      </div>

      <div className="space-y-3">
        {cards.map((card) => {
          const isExpanded = expandedId === card.dimensionId;
          return (
            <div
              key={card.dimensionId}
              id={`obs-${card.dimensionId}`}
              className={`${S.radiusSm} overflow-hidden transition-shadow`}
              style={{ background: S.card, boxShadow: isExpanded ? S.shadow : 'none' }}
            >
              {/* Header — always visible */}
              <button
                type="button"
                onClick={() => setExpandedId(isExpanded ? null : card.dimensionId)}
                className="flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-[#fafbf8]"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium" style={{ color: S.text }}>{card.displayName}</span>
                    {card.entryCountLast14d === 0 && (
                      <span
                        className="rounded-full px-1.5 py-0.5 text-[9px] font-medium"
                        style={{ background: '#f0f4e8', color: '#7aa06e' }}
                      >
                        最近未记录
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-[11px] leading-relaxed" style={{ color: S.sub }}>
                    {card.parentQuestion}
                  </p>
                </div>
                <span
                  className="mt-1 shrink-0 text-[10px] transition-transform"
                  style={{ color: S.sub, transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
                >
                  ▾
                </span>
              </button>

              {/* Expanded detail */}
              {isExpanded && (
                <div className="border-t px-4 pb-4 pt-3" style={{ borderColor: '#f0f2ee' }}>
                  {/* Observable signals */}
                  {card.observableSignals.length > 0 && (
                    <div className="mb-3">
                      <p className="mb-1.5 text-[10px] font-medium" style={{ color: S.accent }}>可以观察的信号</p>
                      <div className="flex flex-wrap gap-1.5">
                        {card.observableSignals.map((signal, i) => (
                          <span
                            key={i}
                            className="rounded-full px-2.5 py-1 text-[10px]"
                            style={{ background: '#f6f8f5', color: S.text }}
                          >
                            {signal}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Guided questions */}
                  {card.guidedQuestions.length > 0 && (
                    <div className="mb-3">
                      <p className="mb-1.5 text-[10px] font-medium" style={{ color: S.accent }}>引导问题</p>
                      <div className="space-y-1">
                        {card.guidedQuestions.map((q, i) => (
                          <p key={i} className="text-[11px] leading-relaxed" style={{ color: S.text }}>
                            {i + 1}. {q}
                          </p>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Experiment suggestion */}
                  {card.experiment && (
                    <div
                      className={`mb-3 ${S.radiusSm} px-3 py-2.5`}
                      style={{ background: '#faf9f6' }}
                    >
                      <p className="mb-1 text-[10px] font-medium" style={{ color: '#c9891a' }}>试试这个小实验</p>
                      <p className="text-[11px] leading-relaxed" style={{ color: S.text }}>{card.experiment}</p>
                    </div>
                  )}

                  {/* CTA */}
                  <Link
                    to={`/journal?dimensionId=${encodeURIComponent(card.dimensionId)}`}
                    className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[12px] font-medium no-underline transition-colors hover:opacity-90"
                    style={{ background: S.accent, color: '#fff' }}
                  >
                    开始记录
                  </Link>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {cards.length === 0 && (
        <div className="py-16 text-center">
          <p className="text-[13px]" style={{ color: S.sub }}>当前年龄暂无可用的观察维度</p>
        </div>
      )}
    </div>
  );
}
