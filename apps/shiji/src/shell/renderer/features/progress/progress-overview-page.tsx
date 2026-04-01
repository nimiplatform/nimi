/**
 * progress-overview-page.tsx — SJ-PROG-003, SJ-PROG-006
 *
 * Learning progress overview:
 *   1. Summary cards: total hours, worlds explored, concepts learned, verification rate
 *   2. World progress grid: chapter completion bars per world
 *   3. Recent sessions: last 5 sessions with world/agent/duration
 *   4. Timeline: chronological view of chapters completed
 *
 * SJ-PROG-006: Statistics distinguish contentType categories (canonical vs non-canonical).
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  sqliteGetSessionsForLearner,
  sqliteGetChapterProgress,
  sqliteGetKnowledgeEntries,
  type Session,
  type ChapterProgress,
  type KnowledgeEntry,
} from '@renderer/bridge/sqlite-bridge.js';
import { useAppStore } from '@renderer/app-shell/app-store.js';
import { getCatalogEntry, getActiveCatalogEntries } from '@renderer/data/world-catalog.js';
import { getClassification } from '@renderer/data/classification.js';

// ── Main component ────────────────────────────────────────────────────────

export default function ProgressOverviewPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const activeProfile = useAppStore((s) => s.activeProfile);

  const [sessions, setSessions] = useState<Session[]>([]);
  const [chapters, setChapters] = useState<ChapterProgress[]>([]);
  const [knowledge, setKnowledge] = useState<KnowledgeEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Load data ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (!activeProfile) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const [s, c, k] = await Promise.all([
          sqliteGetSessionsForLearner(activeProfile.id),
          sqliteGetChapterProgress(activeProfile.id),
          sqliteGetKnowledgeEntries(activeProfile.id),
        ]);
        if (!cancelled) {
          setSessions(s);
          setChapters(c);
          setKnowledge(k);
        }
      } catch {
        // Non-critical — show empty
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [activeProfile]);

  // ── Computed stats ─────────────────────────────────────────────────────

  const stats = useMemo(() => {
    // Total hours (estimate from session timestamps)
    let totalMinutes = 0;
    for (const s of sessions) {
      const start = new Date(s.startedAt).getTime();
      const end = s.completedAt
        ? new Date(s.completedAt).getTime()
        : new Date(s.updatedAt).getTime();
      totalMinutes += Math.max(0, (end - start) / 60_000);
    }

    // Worlds explored (unique worldIds with at least one session)
    const worldIds = new Set(sessions.map((s) => s.worldId));

    // Concepts learned (depth >= 1)
    const conceptsLearned = knowledge.filter((k) => k.depth >= 1).length;
    const conceptsVerified = knowledge.filter((k) => k.depth >= 2).length;
    const verificationRate =
      conceptsLearned > 0
        ? Math.round((conceptsVerified / conceptsLearned) * 100)
        : 0;

    return {
      totalMinutes: Math.round(totalMinutes),
      worldsExplored: worldIds.size,
      conceptsLearned,
      conceptsVerified,
      verificationRate,
    };
  }, [sessions, knowledge]);

  // ── World progress ─────────────────────────────────────────────────────

  const worldProgress = useMemo(() => {
    const catalog = getActiveCatalogEntries();
    const chaptersByWorld = new Map<string, ChapterProgress[]>();
    for (const c of chapters) {
      const list = chaptersByWorld.get(c.worldId) ?? [];
      list.push(c);
      chaptersByWorld.set(c.worldId, list);
    }

    return catalog
      .filter((w) => chaptersByWorld.has(w.worldId))
      .map((w) => {
        const worldChapters = chaptersByWorld.get(w.worldId) ?? [];
        const completed = worldChapters.filter((c) => c.completedAt != null).length;
        const classification = getClassification(w.contentType, w.truthMode);
        return {
          worldId: w.worldId,
          worldName: w.displayName,
          badge: classification?.badge ?? '',
          completedChapters: completed,
          totalChapters: Math.max(completed, worldChapters.length),
        };
      });
  }, [chapters]);

  // ── Recent sessions ────────────────────────────────────────────────────

  const recentSessions = useMemo(() => {
    return [...sessions]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 5)
      .map((s) => {
        const catalog = getCatalogEntry(s.worldId);
        const durationMin = Math.round(
          (new Date(s.updatedAt).getTime() - new Date(s.startedAt).getTime()) / 60_000,
        );
        return {
          id: s.id,
          worldName: catalog?.displayName ?? s.worldId,
          agentId: s.agentId,
          durationMin: Math.max(1, durationMin),
          chapterReached: s.chapterIndex,
          status: s.sessionStatus,
          date: new Date(s.updatedAt).toLocaleDateString(),
        };
      });
  }, [sessions]);

  // ── Chapter timeline ───────────────────────────────────────────────────

  const chapterTimeline = useMemo(() => {
    return [...chapters]
      .filter((c) => c.completedAt != null)
      .sort((a, b) => new Date(a.completedAt!).getTime() - new Date(b.completedAt!).getTime())
      .map((c) => {
        const catalog = getCatalogEntry(c.worldId);
        return {
          id: c.id,
          worldName: catalog?.displayName ?? c.worldId,
          chapterIndex: c.chapterIndex,
          title: c.title,
          date: new Date(c.completedAt!).toLocaleDateString(),
          verificationScore: c.verificationScore,
        };
      });
  }, [chapters]);

  // ── Render ──────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-amber-200 border-t-amber-600 rounded-full animate-spin" />
      </div>
    );
  }

  const totalHours = Math.floor(stats.totalMinutes / 60);
  const remainingMinutes = stats.totalMinutes % 60;

  return (
    <div className="h-full overflow-y-auto px-6 py-6">
      <h1 className="text-2xl font-bold text-stone-100 mb-6">{t('progress.title')}</h1>

      {/* ── Summary cards (SJ-PROG-003:1) ─────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
        <SummaryCard
          label={t('progress.totalHours')}
          value={
            totalHours > 0
              ? `${totalHours}${t('progress.hoursUnit')} ${remainingMinutes}${t('progress.minutesUnit')}`
              : `${stats.totalMinutes}${t('progress.minutesUnit')}`
          }
        />
        <SummaryCard
          label={t('progress.worldsExplored')}
          value={`${stats.worldsExplored}${t('progress.worldsUnit')}`}
        />
        <SummaryCard
          label={t('progress.conceptsLearned')}
          value={String(stats.conceptsLearned)}
        />
        <SummaryCard
          label={t('progress.verificationRate')}
          value={`${stats.verificationRate}%`}
          accent
        />
      </div>

      {/* ── World progress grid (SJ-PROG-003:2) ──────────────────────── */}
      {worldProgress.length > 0 && (
        <section className="mb-8">
          <h2 className="text-lg font-semibold text-stone-200 mb-3">
            {t('progress.worldProgress')}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {worldProgress.map((w) => (
              <button
                key={w.worldId}
                onClick={() => navigate(`/knowledge/${w.worldId}`)}
                className="bg-stone-800/50 border border-stone-700/50 rounded-lg px-4 py-3 text-left hover:bg-stone-800/70 transition-colors"
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-stone-100 font-medium text-sm">{w.worldName}</span>
                  {w.badge && (
                    <span className="text-xs text-stone-400 bg-stone-700 px-1.5 py-0.5 rounded">
                      {w.badge}
                    </span>
                  )}
                </div>
                {/* Chapter bar */}
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-2 bg-stone-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-amber-500 rounded-full transition-all"
                      style={{
                        width: `${w.totalChapters > 0 ? (w.completedChapters / w.totalChapters) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <span className="text-xs text-stone-500 shrink-0">
                    {t('progress.chapterProgress', {
                      completed: w.completedChapters,
                      total: w.totalChapters,
                    })}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ── Recent sessions (SJ-PROG-003:3) ──────────────────────────── */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold text-stone-200 mb-3">
          {t('progress.recentSessions')}
        </h2>
        {recentSessions.length === 0 ? (
          <p className="text-stone-500 text-sm">{t('progress.noSessions')}</p>
        ) : (
          <div className="space-y-2">
            {recentSessions.map((s) => (
              <div
                key={s.id}
                className="bg-stone-800/40 border border-stone-700/40 rounded-lg px-4 py-2.5 flex items-center justify-between"
              >
                <div>
                  <p className="text-stone-200 text-sm font-medium">{s.worldName}</p>
                  <p className="text-stone-500 text-xs">
                    Ch.{s.chapterReached} · {s.durationMin}{t('progress.minutesUnit')} · {s.date}
                  </p>
                </div>
                <span
                  className={[
                    'text-xs px-2 py-0.5 rounded',
                    s.status === 'completed'
                      ? 'bg-green-900/40 text-green-400'
                      : s.status === 'active'
                        ? 'bg-amber-900/40 text-amber-400'
                        : 'bg-stone-700 text-stone-400',
                  ].join(' ')}
                >
                  {s.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Chapter timeline (SJ-PROG-003:4) ─────────────────────────── */}
      <section>
        <h2 className="text-lg font-semibold text-stone-200 mb-3">
          {t('progress.timeline')}
        </h2>
        {chapterTimeline.length === 0 ? (
          <p className="text-stone-500 text-sm">{t('progress.noChapters')}</p>
        ) : (
          <div className="border-l-2 border-stone-700 ml-3 space-y-4 pl-4">
            {chapterTimeline.map((ch) => (
              <div key={ch.id} className="relative">
                {/* Dot on timeline */}
                <div className="absolute -left-[1.375rem] top-1 w-2.5 h-2.5 rounded-full bg-amber-500 ring-2 ring-stone-900" />
                <p className="text-stone-200 text-sm font-medium">
                  {ch.worldName} · {ch.title || `Ch.${ch.chapterIndex}`}
                </p>
                <p className="text-stone-500 text-xs">
                  {ch.date}
                  {ch.verificationScore != null && (
                    <span className="ml-2 text-amber-400">
                      Score: {ch.verificationScore}
                    </span>
                  )}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ── Summary card ──────────────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="bg-stone-800/50 border border-stone-700/50 rounded-xl px-4 py-3 text-center">
      <p className={`text-xl font-bold ${accent ? 'text-amber-400' : 'text-stone-100'}`}>
        {value}
      </p>
      <p className="text-xs text-stone-500 mt-0.5">{label}</p>
    </div>
  );
}
