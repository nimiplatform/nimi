/**
 * knowledge-world-page.tsx — SJ-KNOW-008
 *
 * World-scoped knowledge detail view: `/knowledge/:worldId`
 *   - Concepts grouped by domain with per-domain depth distribution
 *   - Each concept: name, depth indicator, definition preview, first session
 *   - Depth 2 concepts show verification status
 *   - Classification provenance at page level (SJ-KNOW-007)
 */
import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  sqliteGetKnowledgeEntries,
  type KnowledgeEntry,
} from '@renderer/bridge/sqlite-bridge.js';
import { useAppStore } from '@renderer/app-shell/app-store.js';
import { getCatalogEntry } from '@renderer/data/world-catalog.js';
import { getClassification } from '@renderer/data/classification.js';

// ── Depth styling ──────────────────────────────────────────────────────

const DEPTH_COLORS: Record<number, { dot: string; ring: string; label: string }> = {
  0: { dot: 'bg-stone-500', ring: 'ring-stone-500/30', label: 'depthMentioned' },
  1: { dot: 'bg-blue-500', ring: 'ring-blue-500/30', label: 'depthExplained' },
  2: { dot: 'bg-amber-500', ring: 'ring-amber-500/30', label: 'depthVerified' },
};

function DepthBadge({ depth, t }: { depth: number; t: (k: string) => string }) {
  const fallback = { dot: 'bg-stone-500', ring: 'ring-stone-500/30', label: 'depthMentioned' };
  const style = DEPTH_COLORS[depth] ?? fallback;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span className={`w-2 h-2 rounded-full ${style.dot} ring-2 ${style.ring}`} />
      <span className="text-stone-400">{t(`knowledge.${style.label}`)}</span>
    </span>
  );
}

// ── Domains ─────────────────────────────────────────────────────────────

const DOMAIN_ORDER = [
  'politics',
  'military',
  'philosophy',
  'economy',
  'culture',
  'geography',
  'institution',
  'unknown',
] as const;

type DomainGroup = {
  domain: string;
  entries: KnowledgeEntry[];
  depthDistribution: { d0: number; d1: number; d2: number };
};

// ── Main component ────────────────────────────────────────────────────────

export default function KnowledgeWorldPage() {
  const { worldId } = useParams<{ worldId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const activeProfile = useAppStore((s) => s.activeProfile);
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Load entries for this world ────────────────────────────────────────

  useEffect(() => {
    if (!activeProfile || !worldId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const all = await sqliteGetKnowledgeEntries(activeProfile.id, worldId);
        if (!cancelled) setEntries(all);
      } catch {
        // Non-critical
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [activeProfile, worldId]);

  // ── Catalog + classification ───────────────────────────────────────────

  const catalogEntry = worldId ? getCatalogEntry(worldId) : undefined;
  const worldName = catalogEntry?.displayName ?? worldId ?? '';
  const classification = catalogEntry
    ? getClassification(catalogEntry.contentType, catalogEntry.truthMode)
    : null;

  // ── Group by domain ────────────────────────────────────────────────────

  const domainGroups = useMemo((): DomainGroup[] => {
    const domainMap = new Map<string, KnowledgeEntry[]>();
    for (const e of entries) {
      const key = DOMAIN_ORDER.includes(e.domain as typeof DOMAIN_ORDER[number])
        ? e.domain
        : 'unknown';
      const list = domainMap.get(key) ?? [];
      list.push(e);
      domainMap.set(key, list);
    }

    return DOMAIN_ORDER
      .filter((d) => domainMap.has(d))
      .map((d): DomainGroup => {
        const domainEntries = domainMap.get(d)!;
        let d0 = 0, d1 = 0, d2 = 0;
        for (const e of domainEntries) {
          if (e.depth >= 2) d2++;
          else if (e.depth >= 1) d1++;
          else d0++;
        }
        return { domain: d, entries: domainEntries, depthDistribution: { d0, d1, d2 } };
      });
  }, [entries]);

  // ── Stats ──────────────────────────────────────────────────────────────

  const totalConcepts = entries.length;
  const verifiedCount = entries.filter((e) => e.depth >= 2).length;
  const verifiedPercent =
    totalConcepts > 0 ? Math.round((verifiedCount / totalConcepts) * 100) : 0;

  // ── Render ──────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-amber-200 border-t-amber-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto px-6 py-6">
      {/* Back link */}
      <button
        onClick={() => navigate('/knowledge')}
        className="text-sm text-stone-500 hover:text-stone-300 mb-4 flex items-center gap-1"
      >
        <span>←</span> {t('knowledge.backToGraph')}
      </button>

      {/* Header with classification badge (SJ-KNOW-008:5, SJ-KNOW-007) */}
      <div className="flex items-center gap-3 mb-1">
        <h1 className="text-2xl font-bold text-stone-100">
          {t('knowledge.worldKnowledge', { world: worldName })}
        </h1>
        {classification && (
          <span className="text-xs px-2.5 py-1 rounded-full bg-stone-700 text-stone-300 border border-stone-600/50">
            {classification.badge}
          </span>
        )}
      </div>

      {/* Stats */}
      {totalConcepts > 0 && (
        <div className="flex items-center gap-4 text-sm text-stone-400 mb-6">
          <span>{t('knowledge.totalConcepts', { count: totalConcepts })}</span>
          <span className="text-amber-400">
            {t('knowledge.verifiedPercent', { percent: verifiedPercent })}
          </span>
        </div>
      )}

      {/* Domain distribution bar */}
      {totalConcepts > 0 && (
        <div className="mb-6">
          <p className="text-xs text-stone-500 font-medium mb-2 uppercase tracking-wide">
            {t('knowledge.domainDistribution')}
          </p>
          <div className="flex gap-1 h-3 rounded-full overflow-hidden bg-stone-800">
            {domainGroups.map((g) => {
              const widthPercent = (g.entries.length / totalConcepts) * 100;
              if (widthPercent < 1) return null;
              return (
                <div
                  key={g.domain}
                  className="bg-amber-600/70 first:rounded-l-full last:rounded-r-full"
                  style={{ width: `${widthPercent}%` }}
                  title={`${t(`knowledge.domains.${g.domain}`)}: ${g.entries.length}`}
                />
              );
            })}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
            {domainGroups.map((g) => (
              <span key={g.domain} className="text-xs text-stone-500">
                {t(`knowledge.domains.${g.domain}`)} ({g.entries.length})
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {totalConcepts === 0 && (
        <div className="text-stone-500 text-sm text-center mt-12">
          {t('knowledge.noConcepts')}
        </div>
      )}

      {/* Domain sections with concept cards */}
      <div className="space-y-6">
        {domainGroups.map((group) => (
          <div key={group.domain}>
            {/* Domain header with depth distribution */}
            <div className="flex items-center gap-3 mb-3">
              <h2 className="text-lg font-semibold text-stone-200">
                {t(`knowledge.domains.${group.domain}`)}
              </h2>
              <div className="flex items-center gap-2 text-xs text-stone-500">
                {group.depthDistribution.d0 > 0 && (
                  <span className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-stone-500" />
                    {group.depthDistribution.d0}
                  </span>
                )}
                {group.depthDistribution.d1 > 0 && (
                  <span className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                    {group.depthDistribution.d1}
                  </span>
                )}
                {group.depthDistribution.d2 > 0 && (
                  <span className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                    {group.depthDistribution.d2}
                  </span>
                )}
              </div>
            </div>

            {/* Concept cards (SJ-KNOW-008:3, SJ-KNOW-008:4) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {group.entries.map((entry) => (
                <ConceptCard key={entry.id} entry={entry} t={t} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Concept card ──────────────────────────────────────────────────────────

function ConceptCard({
  entry,
  t,
}: {
  entry: KnowledgeEntry;
  t: (k: string, opts?: Record<string, unknown>) => string;
}) {
  const conceptLabel = entry.conceptKey.split('.').pop() ?? entry.conceptKey;

  return (
    <div className="bg-stone-800/50 border border-stone-700/50 rounded-lg px-3 py-2.5">
      <div className="flex items-center gap-2 mb-1">
        <DepthBadge depth={entry.depth} t={t} />
        <span className="text-stone-100 text-sm font-medium">{conceptLabel}</span>
      </div>

      {/* Concept key as domain path */}
      <p className="text-stone-500 text-xs mb-1">{entry.conceptKey}</p>

      {/* First seen date */}
      <p className="text-stone-600 text-xs">
        {t('knowledge.firstSeen')} {new Date(entry.firstSeenAt).toLocaleDateString()}
      </p>

      {/* Verified badge for depth 2 (SJ-KNOW-008:4) */}
      {entry.depth >= 2 && (
        <div className="mt-1.5 flex items-center gap-1 text-xs text-amber-400">
          <span>✓</span>
          <span>{t('knowledge.depthVerified')}</span>
        </div>
      )}
    </div>
  );
}
